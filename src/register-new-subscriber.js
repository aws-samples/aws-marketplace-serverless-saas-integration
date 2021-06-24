const AWS = require('aws-sdk');

const marketplacemetering = new AWS.MarketplaceMetering({ apiVersion: '2016-01-14', region: 'us-east-1' });
const dynamodb = new AWS.DynamoDB({ apiVersion: '2012-08-10', region: 'us-east-1' });
const sqs = new AWS.SQS({ apiVersion: '2012-11-05', region: 'us-east-1' });
const { NewSubscribersTableName: newSubscribersTableName, EntitlementQueueUrl: entitlementQueueUrl } = process.env;

const lambdaResponse = (statusCode, body) => ({
  statusCode,
  headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'OPTIONS,POST',
  },

  body: JSON.stringify(body),
});

exports.registerNewSubscriber = async (event) => {
  const {
    regToken, companyName, contactPerson, contactPhone, contactEmail,
  } = JSON.parse(event.body);

  // Validate the request
  if (regToken && companyName && contactPerson && contactPhone && contactEmail) {
    try {
      // Call resolveCustomer to validate the subscriber
      const resolveCustomerParams = {
        RegistrationToken: regToken,
      };

      const resolveCustomerResponse = await marketplacemetering
        .resolveCustomer(resolveCustomerParams)
        .promise();

      // Store new subscriber data in dynamoDb
      const { CustomerIdentifier, ProductCode } = resolveCustomerResponse;

      const datetime = new Date().getTime().toString();

      const dynamoDbParams = {
        TableName: newSubscribersTableName,
        Item: {
          companyName: { S: companyName },
          contactPerson: { S: contactPerson },
          contactPhone: { S: contactPhone },
          contactEmail: { S: contactEmail },
          customerIdentifier: { S: CustomerIdentifier },
          productCode: { S: ProductCode },
          created: { S: datetime },
        },
      };

      await dynamodb.putItem(dynamoDbParams).promise();

      // Only for SaaS Contracts, check entitlement
      if (entitlementQueueUrl) {
        const SQSParams = {
          MessageBody: `{ 
              "Type": "Notification", 
              "Message" : {
                  "action" : "entitlement-updated",
                  "customer-identifier": "${CustomerIdentifier}",
                  "product-code" : "${ProductCode}"
                  } 
              }`,
          QueueUrl: entitlementQueueUrl,
        };

        await sqs.sendMessage(SQSParams).promise();
      }

      return lambdaResponse(200, 'Success! Registration completed. You have purchased an enterprise product that requires some additional setup. A representative from our team will be contacting you within two business days with your account credentials. Please contact Support through our website if you have any questions.');
    } catch (error) {
      console.error(error);
      return lambdaResponse(400, 'Registration data not valid. Please try again, or contact support!');
    }
  } else {
    return lambdaResponse(400, 'Request no valid');
  }
};
