const winston = require("winston");
const AWS = require('aws-sdk');
const { SupportSNSArn: TopicArn, NewSubscribersTableName: newSubscribersTableName, AWS_REGION: aws_region } = process.env;
const dynamodb = new AWS.DynamoDB({ apiVersion: '2012-08-10', region: aws_region });
const SNS = new AWS.SNS({ apiVersion: '2010-03-31' });
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.json(),
  transports: [new winston.transports.Console()],
});

exports.SQSHandler = async (event) => {
  await Promise.all(event.Records.map(async (record) => {
    const { body } = record;
    let { Message: message } = JSON.parse(body);;
    logger.debug("Message received", { data: message });    

    if (typeof message === 'string' || message instanceof String) {
      message = JSON.parse(message);
    }

    let successfullySubscribed = false;
    let subscriptionExpired = false;

    if (message.action === 'subscribe-success') {
      successfullySubscribed = true;
      const SNSparams = {
        TopicArn,
        Subject: 'Successful subscription to City Trax Translate on AWS Marketplace  ',
        Message: `Subscription successful: ${JSON.stringify(message)}`,
      };
      await SNS.publish(SNSparams).promise();
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
        Subject: 'AWS Marketplace Subscription Setup failed',
        Message: `Subscription setup failed: ${JSON.stringify(message)}`,
      };
      await SNS.publish(SNSparams).promise();
    } else if (message.action === 'unsubscribe-success') {
      subscriptionExpired = true;
      const SNSparams = {
        TopicArn,
        Subject: 'Subscription to City Trax Translate expired',
        Message: `Subscription expired: ${JSON.stringify(message)}`,
      };
      await SNS.publish(SNSparams).promise();
    } else {
      console.error('Unhandled action');
      throw new Error(`Unhandled action - msg: ${JSON.stringify(record)}`);
    }

    let isFreeTrialTermPresent = false;
    if (typeof message.isFreeTrialTermPresent === "string") {
      isFreeTrialTermPresent = message.isFreeTrialTermPresent.toLowerCase() === "true";
    }

    const dynamoDbParams = {
      TableName: newSubscribersTableName,
      Key: {
        customerIdentifier: { S: message['customer-identifier'] },
      },
      UpdateExpression: 'SET subscription_action = :ac, successfully_subscribed = :ss, subscription_expired = :se, is_free_trial_term_present = :ft',
      ExpressionAttributeValues: {
        ':ac': { S: message['action'] },
        ':ss': { BOOL: successfullySubscribed },
        ':se': { BOOL: subscriptionExpired },
        ':ft': { BOOL: isFreeTrialTermPresent }
      },
      ReturnValues: 'UPDATED_NEW',
    };

    await dynamodb.updateItem(dynamoDbParams).promise();
  }));
};
