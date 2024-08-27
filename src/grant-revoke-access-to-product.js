const winston = require("winston");
const AWS = require("aws-sdk");
const SNS = new AWS.SNS({ apiVersion: "2010-03-31" });
const { SupportSNSArn: TopicArn, CognitoUserPoolId: cognitoUserPoolId } = process.env;
const cognitoidentityserviceprovider = new AWS.cognitoidentityserviceprovider({ apiVersion: "2016-04-18" });
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.json(),
  transports: [new winston.transports.Console()],
});

exports.dynamodbStreamHandler = async (event, context) => {
  await Promise.all(
    event.Records.map(async (record) => {
      logger.defaultMeta = { requestId: context.awsRequestId };
      logger.debug("event", { data: event });
      logger.debug("context", { data: context });
      const oldImage = AWS.DynamoDB.Converter.unmarshall(record.dynamodb.OldImage);
      const newImage = AWS.DynamoDB.Converter.unmarshall(record.dynamodb.NewImage);

      // eslint-disable-next-line no-console
      logger.debug("OldImage", { data: oldImage });
      logger.debug("NewImage", { data: newImage });
      /*
      successfully_subscribed is set true:
        - for SaaS Contracts: no email is sent but after receiving the message in the subscription topic
        - for SaaS Subscriptions: after receiving the subscribe-success message in subscription-sqs.js
  
      subscription_expired is set to true:
        - for SaaS Contracts: after detecting expired entitlement in entitlement-sqs.js
        - for SaaS Subscriptions: after receiving the unsubscribe-success message in subscription-sqs.js
    */
      const grantAccess =
        newImage.successfully_subscribed === true &&
        typeof newImage.is_free_trial_term_present !== "undefined" &&
        (oldImage.successfully_subscribed !== true ||
          typeof oldImage.is_free_trial_term_present === "undefined");

      const revokeAccess = newImage.subscription_expired === true && !oldImage.subscription_expired;

      let entitlementUpdated = false;

      if (
        newImage.entitlement &&
        oldImage.entitlement &&
        newImage.entitlement !== oldImage.entitlement
      ) {
        entitlementUpdated = true;
      }

      logger.debug("grantAccess", { data: grantAccess });
      logger.debug("revokeAccess:", { data: revokeAccess });
      logger.debug("entitlementUpdated", { data: entitlementUpdated });

      if (grantAccess || revokeAccess || entitlementUpdated) {
        let message = "";
        let subject = "";

        if (grantAccess) {
          // Construct newUser (or equivalent) from DDB Streams message
          // Interim values for newUser; replace with actual values from DDB Streams message
          newImage.contactEmail = "agm+admin@innoventlabs.co.uk";
          newImage.firstName = "Adam";
          newImage.lastName = "Admin";
          newImage.phoneNumber = "+447789213469";
          // End of interim values - replace when CTX deployed into new account with additional attributes
          const createUserParams = {
            UserPoolId: cognitoUserPoolId,
            DesiredDeliveryMediums: ["EMAIL"],
            Username: newImage.contactEmail,
            email_verified: true,
            ForceAliasCreation: true,
            UserAttributes: [
              { Name: "email", Value: newImage.contactEmail },
              { Name: "given_name", Value: newImage.firstName },
              { Name: "family_name", Value: newImage.lastName },
              // { Name: "phone_number", Value: newUser.phoneNumber },
              { Name: "custom:tenantId", Value: newImage.customerIdentifier },
              // { Name: "custom:organisationName", Value: newImage.organisationName},
            ],
          };
          const adminGroupParams = {
            GroupName: "Admin",
            UserPoolId: cognitoUserPoolId,
            Username: newImage.contactEmail,
          };
          cognitoidentityserviceprovider.adminCreateUser(createUserParams, function (err, data) {
            if (err) console.log(err, err.stack);
            else console.log(data);
          });
          cognitoidentityserviceprovider.adminAddUserToGroup(adminGroupParams, function (err, data) {
            if (err) console.log(err, err.stack);
            else console.log(data);
            subject = "New AWS Marketplace Subscription";
            message = `subscribe-success: ${JSON.stringify(newImage)}`;
          });
        } else if (revokeAccess) {
          // To do: disable all users for Tenant Id associated with Admin User
          subject = "AWS Marketplace Subscription End";
          message = `unsubscribe-success: ${JSON.stringify(newImage)}`;
        } else if (entitlementUpdated) {
          //  To do: if more users configured than updated entitlement, fail and prompt admin to remove some
          subject = "AWS Marketplace Subscription Change";
          message = `entitlement-updated: ${JSON.stringify(newImage)}`;
        }

        const SNSparams = {
          TopicArn,
          Subject: subject,
          Message: message,
        };

        logger.info("Sending notification");
        logger.debug("SNSparams", { data: SNSparams });
        await SNS.publish(SNSparams).promise();
      }
    })
  );

  return {};
};

/*
1. Add COGNITO_USER_POOLS_ID to environment variables for this function.
2. Check what info is received in the Streams message triggering this function:
  a. Customer_id (check name)
  b. First Name
  c. Last Name
  d. Phone number
3. Add Cognito to this function's execution role
4. Add that execution role to the trust policy of the Cognito Admin role in hosting account
5. Put Contact Person into Cognito Admin group
6. Work out how to use SAM CLI with VSCode, in order to manage the SAM application as a unit.
*/

