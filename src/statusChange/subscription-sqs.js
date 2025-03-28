/*
  TODO Needs to be tested, new code
  Handles the SQS messages tied to the Marketplace SNS topic for account updates.
 */

import {lambdaResponse} from "../model";
import {getToken} from "../token/getToken.js";
import AWS from 'aws-sdk';
const {  NewSubscribersTableName: newSubscribersTableName, AWS_REGION: aws_region } = process.env;
const dynamodb = new AWS.DynamoDB({ apiVersion: '2012-08-10', region: aws_region });


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
      //TODO We can send an email if we want to register one on our side.
    } else if (message.action === 'subscribe-fail') {
      //TODO We can send an email if we want to register one on our side.
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

    // Get the Edge Organization id from the DynamoDB table
    const dynamoGet = {
      TableName: newSubscribersTableName,
      Key: {
        customerIdentifier: { S: message['customer-identifier'] }
      },
      ProjectionExpression: "ATTRIBUTE_NAME",
    };

    var edgeId;
    ddb.getItem(dynamoGet, function (err, data) {
      if (err) {
        console.log("Error", err);
      } else {
        console.log("Success", data.Item);
        edgeId = data.edgeId;
      }
    });

    // Get the Edge API auth token
    const authToken = getToken();

    // Update the status of an account in the Edge API
    let edgeCreateResp;
    try {
      edgeCreateResp = await fetch("https://edge-rest.dev.edge.artisan-studios.com/v1/accounts/" + edgeId + "/status", {
        method: "PATCH",
        headers: {
          'Authorization': authToken,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          status: message['action']
        })
      });
    } catch (error) {
      console.error(error);
      return lambdaResponse(400, 'Error creating edge account in try catch!');
    }


    if(!edgeCreateResp.ok) {
      console.log("Error creating edge account: " + edgeCreateResp.status + " " + edgeCreateResp.statusText + " " + edgeCreateResp.body);
      return lambdaResponse(400, 'Error creating edge account!');
    }


    // Update the DynamoDB table with the subscription status
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
