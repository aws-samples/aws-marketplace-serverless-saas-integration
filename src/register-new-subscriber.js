const AWS = require('aws-sdk');
const ses = new AWS.SES({ region: "us-east-1" });
const marketplacemetering = new AWS.MarketplaceMetering({ apiVersion: '2016-01-14', region: 'us-east-1' });
const dynamodb = new AWS.DynamoDB({ apiVersion: '2012-08-10', region: 'us-east-1' });
const { NewSubscribersTableName: newSubscribersTableName, MarketplaceSellerEmail: marketplaceSellerEmail } = process.env;

const lambdaResponse = (statusCode, body) => ({
  statusCode,
  headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'OPTIONS,POST',
  },

  body: JSON.stringify(body),
});

const setBuyerNotificationHandler = function (contactEmail) {
  if (typeof marketplaceSellerEmail == 'undefined') {
    return;
  }
  let params = {
    Destination: {
      ToAddresses: [contactEmail],
    },
    Message: {
      Body: {
        Html: {
          Charset: "UTF-8",
          Data: "<!DOCTYPE html><html><head><title>Welcome!<\/title><\/head><body><h1>Welcome!<\/h1><p>Thanks for purchasing<\/p><p>We\u2019re thrilled to have you on board. Our team is hard at work setting up your account, please expect to hear from a member of our customer success team soon<\/p><\/body><\/html>"
        },
        Text: {
          Charset: "UTF-8",
          Data: "Welcome! Thanks for purchasing. We’re thrilled to have you on board. Our team is hard at work setting up your account, please expect to hear from a member of our customer success team soon"
        }
      },

      Subject: {
        Charset: 'UTF-8',
        Data: "Welcome Email"
      }
    },
    Source: marketplaceSellerEmail,
  };

  return ses.sendEmail(params).promise()


};

exports.registerNewSubscriber = async (event) => {
  const {
    regToken, companyName, contactPerson, contactPhone, contactEmail,
  } = JSON.parse(event.body);

  // Validate the request
  if (regToken && companyName && industry && country && contactEmail) {
    try {
      // Call resolveCustomer to validate the subscriber
      const resolveCustomerParams = {
        RegistrationToken: regToken,
      };

      const resolveCustomerResponse = await marketplacemetering
        .resolveCustomer(resolveCustomerParams)
        .promise();

      // Store new subscriber data in dynamoDb
      const { CustomerIdentifier, ProductCode, CustomerAWSAccountId } = resolveCustomerResponse;

      const datetime = new Date().getTime().toString();

      const dynamoDbParams = {
        TableName: newSubscribersTableName,
        Item: {
          companyName: { S: companyName },
          industry: { S: industry },
          country: { S: country },
          contactEmail: { S: contactEmail },
          customerIdentifier: { S: CustomerIdentifier },
          productCode: { S: ProductCode },
          customerAWSAccountID: { S: CustomerAWSAccountId },
          created: { S: datetime },
        },
      };

      await dynamodb.putItem(dynamoDbParams).promise();
      await setBuyerNotificationHandler(contactEmail); // we probably don't need that, TODO: discuss

      return lambdaResponse(200, 'Success! Registration completed. You have purchased an enterprise product that requires some additional setup. A representative from our team will be contacting you within two business days with your account credentials. Please contact Support through our website if you have any questions.');
    } catch (error) {
      console.error(error);
      return lambdaResponse(400, 'Registration data not valid. Please try again, or contact support!');
    }
  } else {
    return lambdaResponse(400, 'Request no valid');
  }
};
