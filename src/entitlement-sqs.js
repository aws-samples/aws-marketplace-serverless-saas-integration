const AWS = require('aws-sdk');
const { NewSubscribersTableName: newSubscribersTableName, AWS_REGION: aws_region } = process.env;
// MarketplaceEntitlementService is instantianise only in the us-east-1 https://docs.aws.amazon.com/general/latest/gr/aws-marketplace.html#marketplaceentitlement
const marketplaceEntitlementService = new AWS.MarketplaceEntitlementService({ apiVersion: '2017-01-11', region: 'us-east-1' });
const dynamodb = new AWS.DynamoDB({ apiVersion: '2012-08-10', region: aws_region });

exports.handler = async (event) => {
  await Promise.all(event.Records.map(async (record) => {
    const { body } = record;
    let { Message: message } = JSON.parse(body);

    if (typeof message === 'string' || message instanceof String) {
      message = JSON.parse(message);
    }

    if (message.action === 'entitlement-updated') {
      const entitlementParams = {
        ProductCode: message['product-code'],
        Filter: {
          CUSTOMER_IDENTIFIER: [message['customer-identifier']],
        },
      };

      const entitlementsResponse = await marketplaceEntitlementService.getEntitlements(entitlementParams).promise();

      console.log('entitlementsResponse', entitlementsResponse);

      const isExpired = entitlementsResponse.hasOwnProperty("Entitlements") === false || entitlementsResponse.Entitlements.length === 0 || 
        new Date(entitlementsResponse.Entitlements[0].ExpirationDate) < new Date();

      const dynamoDbParams = {
        TableName: newSubscribersTableName,
        Key: {
          customerIdentifier: { S: message['customer-identifier'] },
        },
        UpdateExpression: 'set entitlement = :e, successfully_subscribed = :ss, subscription_expired = :se',
        ExpressionAttributeValues: {
          ':e': { S: JSON.stringify(entitlementsResponse) },
          ':ss': { BOOL: true },
          ':se': { BOOL: isExpired },
        },
        ReturnValues: 'UPDATED_NEW',
      };

      await dynamodb.updateItem(dynamoDbParams).promise();
    } else {
      console.error('Unhandled action');
      throw new Error(`Unhandled action - msg: ${JSON.stringify(record)}`);
    }
  }));
  return {};
};
