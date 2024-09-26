const winston = require("winston");
const AWS = require("aws-sdk");
const {
  NewSubscribersTableName: newSubscribersTableName,
  EntitlementQueueUrl: entitlementQueueUrl,
  MarketplaceSellerEmail: marketplaceSellerEmail,
  AWS_REGION: aws_region,
} = process.env;
const ses = new AWS.SES({ region: aws_region });
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.json(),
  transports: [new winston.transports.Console()],
});
const marketplacemetering = new AWS.MarketplaceMetering({
  apiVersion: "2016-01-14",
  region: aws_region,
});
const dynamodb = new AWS.DynamoDB({ apiVersion: "2012-08-10", region: aws_region });
const sqs = new AWS.SQS({ apiVersion: "2012-11-05", region: aws_region });

const lambdaResponse = (statusCode, body) => ({
  statusCode,
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "OPTIONS,POST",
  },

  body: JSON.stringify(body),
});

const setBuyerNotificationHandler = function (contactEmail) {
  if (typeof marketplaceSellerEmail == "undefined") {
    logger.info("Marketplace configuration error", {data: "No Marketplace Seller Email defined"});
    return;
  }
  const htmlContent = `<!DOCTYPE html>
    <html>
      <head>
        <title>Welcome!</title>
      </head>
      <body>
        <h1>Welcome!</h1>
        <p>Thank you for purchasing City Trax Translate.</p>
        <p>We\u2019re thrilled to have you on board.  Your account credentials are being set up.  You will shortly receive one email confirming your subscription, and a separate email with your initial login password to access it on https://ctxtranslate.cloud.  If this has not arrived within 24 hours, please check your email spam folder, and if you still have not received it, contact Support through our website.</p>
        <p>Kind regards,</p>
        <p>City Trax Sales</p>
      </body>
    </html>`;
  const textContent = `Welcome! Thank you for purchasing City Trax Translate. We’re thrilled to have you on board.  Your account credentials are being set up.  You will shortly receive one email confirming your subscription, and a separate email with your initial login password to access it on https://ctxtranslate.cloud.  If this has not arrived within 24 hours, please check your email spam folder, and if you still have not received it, contact Support through our website.
  
  Kind regards,
  
  City Trax Sales`;

  const subjectContent = "Welcome to City Trax Translate";

  let params = {
    Destination: {
      ToAddresses: [contactEmail],
    },
    Message: {
      Body: {
        Html: {
          Charset: "UTF-8",
          Data: htmlContent,
        },
        Text: {
          Charset: "UTF-8",
          Data: textContent
        },
      },
      Subject: {
        Charset: "UTF-8",
        Data: subjectContent,
      },
    },
    Source: marketplaceSellerEmail,
  };

  return ses.sendEmail(params).promise();
};

exports.registerNewSubscriber = async (event, context) => {
  logger.debug("event", { data: event });
  logger.debug("context", { data: context });

  const {
    // Accept form inputs from ../web/index.html
    regToken,
    organisationName,
    contactPersonFirstName,
    contactPersonLastName,
    contactPhone,
    contactEmail,
  } = JSON.parse(event.body);

  // Validate the request with form inputs from ../web/index.html
  if (regToken && organisationName && contactPersonFirstName && contactPersonLastName && contactPhone && contactEmail) {
    try {
      // Call resolveCustomer to validate the subscriber
      logger.debug("Resolving customer");
      const resolveCustomerParams = {
        RegistrationToken: regToken,
      };

      const resolveCustomerResponse = await marketplacemetering
        .resolveCustomer(resolveCustomerParams)
        .promise();

      // Store new subscriber data in dynamoDb
      const { CustomerIdentifier, ProductCode, CustomerAWSAccountId } = resolveCustomerResponse;
      logger.debug("Details of new customer", { data: resolveCustomerResponse });

      const datetime = new Date().getTime().toString();

      // Write form inputs from ../web/index.html
      const dynamoDbParams = {
        TableName: newSubscribersTableName,
        Item: {
          organisationName: { S: organisationName },
          firstName: { S: contactPersonFirstName },
          lastName: { S: contactPersonLastName },
          contactPhone: { S: contactPhone },
          contactEmail: { S: contactEmail },
          customerIdentifier: { S: CustomerIdentifier },
          productCode: { S: ProductCode },
          customerAWSAccountID: { S: CustomerAWSAccountId },
          created: { S: datetime },
        },
      };
      logger.debug("Being written to DDB", { data: dynamoDbParams });
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

      await setBuyerNotificationHandler(contactEmail);

      return lambdaResponse(
        200,
        "Success! Registration completed: you have purchased access to City Trax Translate.  Your account credentials are being set up.  You will shortly receive a separate email with your initial login password to access it on https://ctxtranslate.cloud.  If this has not arrived within 24 hours, please check your email spam folder, and if you still have not received it, contact Support through our website."
      );
    } catch (error) {
      console.error(`\n\nError attempting to register new subscriber:\n${error}\n`);
      return lambdaResponse(
        400,
        `Registration not succesful - ${error}.  Please try again, or contact City Trax Support.`
      );
    }
  } else {
    return lambdaResponse(400, "Request not valid");
  }
};
