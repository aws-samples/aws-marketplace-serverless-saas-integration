const AWS = require('aws-sdk');

const dynamodb = new AWS.DynamoDB({ apiVersion: '2012-08-10', region: 'us-east-1' });
const SNS = new AWS.SNS({ apiVersion: '2010-03-31' });
const { SupportSNSArn: TopicArn, NewSubscribersTableName: newSubscribersTableName } = process.env;

exports.SQSHandler = async (event) => {
  await Promise.all(event.Records.map(async (record) => {
    const { body } = record;
    let { Message: message } = JSON.parse(body);

    if (typeof message === 'string' || message instanceof String) {
      message = JSON.parse(message);
    }

    let successfullySubscribed = false;
    let subscriptionExpired = false;

    if (message.action === 'subscribe-success') {
      successfullySubscribed = true;
    } else if (message.action === 'unsubscribe-pending') {
      const SNSparams = {
        TopicArn,
        Subject: 'unsubscribe pending',
        Message: `unsubscribe pending: ${JSON.stringify(message)}`,
      };

      await SNS.publish(SNSparams).promise();
    } else if (message.action === 'subscribe-fail') {
      const SNSparams = {
        TopicArn,
        Subject: 'AWS Marketplace Subscription failed',
        Message: `Subscription failed: ${JSON.stringify(message)}`,
      };

      await SNS.publish(SNSparams).promise();
    } else if (message.action === 'unsubscribe-success') {
      subscriptionExpired = true;
    } else {
      console.error('Unhandled action');
      throw new Error(`Unhandled action - msg: ${JSON.stringify(record)}`);
    }

    let isFreeTrialTermPresent = false;
    if (typeof message.isFreeTrialTermPresent === "string")  {
     isFreeTrialTermPresent = message.isFreeTrialTermPresent.toLowerCase() === "true";
    }

    const dynamoDbParams = {
      TableName: newSubscribersTableName,
      Key: {
        customerIdentifier: { S: message['customer-identifier'] },
      },
      UpdateExpression: 'set subscription_action = :ac, successfully_subscribed = :ss, subscription_expired = :se, is_free_trial_term_present = :ft',
      ExpressionAttributeValues: {
        ':ac': { S: message['action'] },
        ':ss': { BOOL: successfullySubscribed },
        ':se': { BOOL: subscriptionExpired },
        ':ft': { BOOL: isFreeTrialTermPresent}
      },
      ReturnValues: 'UPDATED_NEW',
    };

    await dynamodb.updateItem(dynamoDbParams).promise();
  }));
};
