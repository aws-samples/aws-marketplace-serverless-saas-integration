const winston = require('winston');
const AWS = require('aws-sdk');
const SNS = new AWS.SNS({ apiVersion: '2010-03-31' });
const { SupportSNSArn: TopicArn } = process.env;
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

    // eslint-disable-next-line no-console
    logger.debug('OldImage', { 'data': oldImage });
    logger.debug('NewImage', { 'data': newImage });
    /*
      successfully_subscribed is set true:
        - for SaaS Contracts: no email is sent but after receiving the message in the subscription topic
        - for SaaS Subscriptions: after reciving the subscribe-success message in subscription-sqs.js
  
      subscription_expired is set to true:
        - for SaaS Contracts: after detecting expired entitlement in entitlement-sqs.js
        - for SaaS Subscriptions: after reciving the unsubscribe-success message in subscription-sqs.js
    */
    const grantAccess = newImage.successfully_subscribed === true &&
      typeof newImage.is_free_trial_term_present !== "undefined" &&
      (oldImage.successfully_subscribed !== true || typeof oldImage.is_free_trial_term_present === "undefined")


    const revokeAccess = newImage.subscription_expired === true
      && !oldImage.subscription_expired;

    let entitlementUpdated = false;

    if (newImage.entitlement && oldImage.entitlement && (newImage.entitlement !== oldImage.entitlement)) {
      entitlementUpdated = true;
    }

    logger.debug('grantAccess', { 'data': grantAccess });
    logger.debug('revokeAccess:', { 'data': revokeAccess });
    logger.debug('entitlementUpdated', { 'data': entitlementUpdated });

    if (grantAccess || revokeAccess || entitlementUpdated) {
      let message = '';
      let subject = '';


      if (grantAccess) {
        subject = 'New AWS Marketplace Subscriber';
        message = `subscribe-success: ${JSON.stringify(newImage)}`;
      } else if (revokeAccess) {
        subject = 'AWS Marketplace customer end of subscription';
        message = `unsubscribe-success: ${JSON.stringify(newImage)}`;
      } else if (entitlementUpdated) {
        subject = 'AWS Marketplace customer change of subscription';
        message = `entitlement-updated: ${JSON.stringify(newImage)}`;
      }

      const SNSparams = {
        TopicArn,
        Subject: subject,
        Message: message,
      };

      logger.info('Sending notification');
      logger.debug('SNSparams', { 'data': SNSparams });
      await SNS.publish(SNSparams).promise();
    }
  }));


  return {};
};
