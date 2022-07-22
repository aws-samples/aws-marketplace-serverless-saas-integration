const AWS = require('aws-sdk');

const SNS = new AWS.SNS({ apiVersion: '2010-03-31' });
const { SupportSNSArn: TopicArn } = process.env;


exports.dynamodbStreamHandler = async (event) => {
  await Promise.all(event.Records.map(async (record) => {
    const oldImage = AWS.DynamoDB.Converter.unmarshall(record.dynamodb.OldImage);
    const newImage = AWS.DynamoDB.Converter.unmarshall(record.dynamodb.NewImage);

    // eslint-disable-next-line no-console
    console.log(`DynamoDb record updated! OldImage: ${JSON.stringify(oldImage)} | NewImage: ${JSON.stringify(newImage)}`);


    /*
      successfully_subscribed is set true:
        - for SaaS Contracts: no email is sent but after receiving the message in the subscription topic
        - for SaaS Subscriptions: after reciving the subscribe-success message in subscription-sqs.js

      subscription_expired is set to true:
        - for SaaS Contracts: after detecting expired entitlement in entitlement-sqs.js
        - for SaaS Subscriptions: after reciving the unsubscribe-success message in subscription-sqs.js
    */
    const grantAccess = newImage.successfully_subscribed === true && (
        ( oldImage.successfully_subscribed !== true && typeof newImage.is_free_trial_term_present !== "undefined" )
        ||
        (  typeof newImage.is_free_trial_term_present !== "undefined"  && typeof oldImage.is_free_trial_term_present === "undefined" )
    )
      

    const revokeAccess = newImage.subscription_expired === true
      && !oldImage.subscription_expired;

    let entitlementUpdated = false;

    if (newImage.entitlement && oldImage.entitlement && (newImage.entitlement !== oldImage.entitlement)) {
      entitlementUpdated = true;
    }

    if (grantAccess || revokeAccess || entitlementUpdated) {
      let message = '';
      let subject = '';


      if (grantAccess) {
        subject = 'New AWS Marketplace Subscriber';
        message = `Grant access to new SaaS customer: ${JSON.stringify(newImage)}`;
      } else if (revokeAccess) {
        subject = 'AWS Marketplace customer end of subscription';
        message = `Revoke access to SaaS customer: ${JSON.stringify(newImage)}`;
      } else if (entitlementUpdated) {
        subject = 'AWS Marketplace customer change of subscription';
        message = `New entitlement for customer: ${JSON.stringify(newImage)}`;
      }

      const SNSparams = {
        TopicArn,
        Subject: subject,
        Message: message,
      };

      await SNS.publish(SNSparams).promise();
    }
  }));


  return {};
};
