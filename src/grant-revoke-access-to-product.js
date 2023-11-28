const winston = require('winston');
const AWS = require('aws-sdk');

const SNS = new AWS.SNS({ apiVersion: '2010-03-31', region: "eu-central-1" });
const { SupportSNSArn: SupportTopicArn,
  UserRegistrationTopic: userRegistrationTopic,
  UserRemoveTopic: userRemoveTopic } = process.env;
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console(),
  ],
});

exports.dynamodbStreamHandler = async (event, context) => {
  await Promise.all(event.Records.map(async (record) => {
    logger.defaultMeta = { requestId: context.awsRequestId };
    logger.debug('event', { 'data': event });
    logger.debug('context', { 'data': context });
    const oldImage = AWS.DynamoDB.Converter.unmarshall(record.dynamodb.OldImage);
    const newImage = AWS.DynamoDB.Converter.unmarshall(record.dynamodb.NewImage);

    /*
      successfully_subscribed is set true:
        - for SaaS Contracts: no email is sent but after receiving the message in the subscription topic
        - for SaaS Subscriptions: after reciving the subscribe-success message in subscription-sqs.js
  
      subscription_expired is set to true:
        - for SaaS Contracts: after detecting expired entitlement in entitlement-sqs.js
        - for SaaS Subscriptions: after reciving the unsubscribe-success message in subscription-sqs.js
    */
    // TODO: bring it back
    // const grantAccess = newImage.successfully_subscribed === true &&
    //   typeof newImage.is_free_trial_term_present !== "undefined" &&
    //   (oldImage.successfully_subscribed !== true || typeof oldImage.is_free_trial_term_present === "undefined")

    // const revokeAccess = newImage.subscription_expired === true
    //   && !oldImage.subscription_expired;

    // TODO: remove it when Markerplace ID is there, was only user for testing:
    const grantAccess = Object.values(newImage).length === 0 ? false : true;
    const revokeAccess = false;

    logger.debug('grantAccess', { 'data': grantAccess });
    logger.debug('revokeAccess:', { 'data': revokeAccess });


    if (grantAccess || revokeAccess) {
      let message = '';
      let subject = '';
      const customerId = newImage.customerIdentifier.toString();
      const userEmail = newImage.contactEmail.toString();

      if (grantAccess) {
        subject = 'New AWS Marketplace Subscriber';
        message = `subscribe-success: ${JSON.stringify(newImage)}`;

        const SNSParamsForCreatingUser = {
          TargetArn: userRegistrationTopic,
          Subject: subject,
          Message: message,
          MessageAttributes: {
            'email': {
              DataType: "String",
              StringValue: userEmail
            },
            'customerId': {
              DataType: "String",
              StringValue: customerId
            }
          }
        }

        await SNS.publish(SNSParamsForCreatingUser).promise(); // automatically creating user in cognito

      } else if (revokeAccess) {
        subject = 'AWS Marketplace customer end of subscription';
        message = `unsubscribe-success: ${JSON.stringify(newImage)}`;

        const SNSParamsForRemovingUser = {
          TargetArn: userRemoveTopic,
          Subject: subject,
          Message: message,
          MessageAttributes: {
            'email': {
              DataType: "String",
              StringValue: userEmail
            }
          }
        }

        await SNS.publish(SNSParamsForRemovingUser).promise(); // disabling user in Cognito

      }

      const SNSparamsForSupportTopic = {
        TargetArn: SupportTopicArn,
        Subject: subject,
        Message: message,
      };

      logger.info('Sending notification to the Support topic');
      logger.debug('SNSparamsForSupportTopic', { 'data': SNSparamsForSupportTopic });
      await SNS.publish(SNSparamsForSupportTopic).promise(); // tech email will be notified about subscription
    }
  }));

  return {};
};
