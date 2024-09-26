const winston = require("winston");
const AWS = require("aws-sdk");
const SNS = new AWS.SNS({ apiVersion: "2010-03-31" });
const {
  SupportSNSArn: TopicArn,
  TenantAdminRoleName: tenantAdminRoleName,
  SaasAccountId: saasAccountId,
  CognitoUserPoolId: cognitoUserPoolId
} = process.env;

const {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  ListUsersCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminUpdateUserAttributesCommand,
  CognitoIdentityProviderClient,
} = require("@aws-sdk/client-cognito-identity-provider");
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
      logger.debug("Environment Variables", { data: process.env });

      /*
      successfully_subscribed is set true:
        - for SaaS Contracts: no email is sent but after receiving the message in the subscription topic
        - for SaaS Subscriptions: after receiving the subscribe-success message in subscription-sqs.js
  
      subscription_expired is set to true:
        - for SaaS Contracts: after detecting expired entitlement in entitlement-sqs.js
        - for SaaS Subscriptions: after receiving the unsubscribe-success message in subscription-sqs.js
      */
      // Logic modified for newImage: previously, both successfully_subscribed AND is_free_trial_term_present had to be true for grantAccess to be true:
      const grantAccess = (newImage.successfully_subscribed === true && oldImage.successfully_subscribed !== true) ||
        (typeof newImage.is_free_trial_term_present !== "undefined" && typeof oldImage.is_free_trial_term_present === "undefined");

      const revokeAccess = newImage.subscription_expired === true && !oldImage.subscription_expired;
      const reinstateAccess = !newImage.subscription_expired === true && oldImage.subscription_expired;

      let entitlementUpdated = false;

      if (
        newImage.entitlement &&
        oldImage.entitlement &&
        newImage.entitlement !== oldImage.entitlement
      ) {
        entitlementUpdated = true;
      }

      const subscriptionEvent = {
        accessGrant: grantAccess,
        accessRevocation: revokeAccess,
        accessReinstatement: reinstateAccess,
        entitlementUpdate: entitlementUpdated,
      };

      logger.debug("Subscription Event Trigger", { data: subscriptionEvent });

      let message = "";
      let subject = "";
      const sts = new AWS.STS();

      if (grantAccess || revokeAccess || reinstateAccess || entitlementUpdated) {
        const tenantAdminRoleArn = `arn:aws:iam::${saasAccountId}:role/${tenantAdminRoleName}`;
        logger.debug("Assuming Tenant Admin role in AWS account where CTX deployed", { data: tenantAdminRoleArn })
        const assumeRoleParams = {
          RoleArn: tenantAdminRoleArn,
          RoleSessionName: "SaaS-MPI-Grant-Revoke-Access",
          DurationSeconds: 900,
        };
        try {
          const data = await sts.assumeRole(assumeRoleParams).promise();
          const credentials = data.Credentials;
          const accessKeyId = credentials.AccessKeyId;
          const secretAccessKey = credentials.SecretAccessKey;
          const sessionToken = credentials.SessionToken;

          const cognitoConfig = {
            credentials: {
              accessKeyId,
              secretAccessKey,
              sessionToken,
            },
          };

          logger.debug("Cognito Config", { data: cognitoConfig });

          const cognitoIdentityClient = new CognitoIdentityProviderClient(cognitoConfig);

          if (entitlementUpdated) {
            //  To do: if more users configured than updated entitlement, fail and prompt Support and customer admin via SNS notification to remove some
            subject = "AWS Marketplace Subscription Change";
            message = `entitlement-updated: ${JSON.stringify(newImage)}`;
            sendMessage(subject, message);
          } else if (grantAccess) {
            try {
              const createUserResponse = await createAdminUser(cognitoIdentityClient, newImage);
              subject = "New AWS Marketplace Subscription";
              message = `subscribe-success: ${JSON.stringify(createUserResponse)}`
              sendMessage(subject, message);
            } catch (error) {
              subject = "Marketplace Subscription failure";
              message = `subscribe-fail: ${JSON.stringify(error)}`
              sendMessage(subject, message);
              logger.error("Failed to create new user in City Trax tenant account", { data: error });
            };
          } else if (revokeAccess) {
            try {
              const revokeCustomerAccess = await disableUsers(cognitoIdentityClient, newImage);
              subject = "AWS Marketplace Subscription Revoked";
              message = `unsubscribe-success: ${revokeCustomerAccess}`;
              sendMessage(subject, message);
            } catch (err) {
              const errorCode = `${err.code ? err.code + ': ' : ''}`;
              const statusCode = `${err.statusCode ? 'Status code: ' + err.statusCode : ''}`;
              const errorString = `${errorCode} ${err.message} ${statusCode}`;
              logger.error("Failed to disable user", { data: errorString });
              subject = "AWS Marketplace - failed to revoke subscription for customer ID " + newImage.customerIdentifier;
              message = `unsubscribe-fail: ${JSON.stringify(newImage)}`;
              sendMessage(subject, message);
              throw err;
              // throw new Error(`Failed to disable user: ${err.message}`);
            };
          } else if (reinstateAccess) {
            try {
              const reinstateCustomerAccess = await enableUsers(cognitoIdentityClient, newImage);
              subject = "AWS Marketplace Subscription Reinstate";
              message = `subscribe-success: ${reinstateCustomerAccess}`;
              sendMessage(subject, message);
            } catch (err) {
              const errorCode = `${err.code ? err.code + ': ' : ''}`;
              const statusCode = `${err.statusCode ? 'Status code: ' + err.statusCode : ''}`;
              const errorString = `${errorCode} ${err.message} ${statusCode}`;
              logger.error("Failed to enable user", { data: errorString });
              subject = "AWS Marketplace - failed to reinstate subscription for customer ID " + newImage.customerIdentifier;
              message = `unsubscribe-fail: ${JSON.stringify(newImage)}`;
              sendMessage(subject, message);
              // throw new Error(`Failed to enable user: ${err.message}`);
              throw err;
            };
          }
          // sendMessage(subject, message);
        } catch (err) {
          console.error(err);
          const errorCode = `${err.code ? err.code + ': ' : ''}`;
          const statusCode = `${err.statusCode ? 'Status code: ' + err.statusCode : ''}`;
          const errorString = `${errorCode} ${err.message} ${statusCode}`;
          logger.error("Failed to process change to customer subscription", { data: errorString });
          subject = "AWS Marketplace - failed to process change to customer subscription";
          message = `subscribe-fail: ${JSON.stringify(newImage)}`;
          sendMessage(subject, message);
          // throw new Error(`Failed to assume role: ${err.message}`);
          throw err;
        }
      } else {
        if (JSON.stringify(newImage) === '{}') {
          logger.info("Tenant record deleted");
          subject = "Subscriber deleted for City Trax Translate";
          message = `Customer ${oldImage.organisationName} (Tenant ID ${oldImage.customerIdentifier}) deleted`;
          sendMessage(subject, message);
        }
      };
    }));
  return {};
};

async function createAdminUser(cognitoClient, newUser) {
  const createUserParams = {
    UserPoolId: cognitoUserPoolId,
    DesiredDeliveryMediums: ["EMAIL"],
    Username: newUser.contactEmail,
    ForceAliasCreation: true,
    UserAttributes: [
      { Name: "email", Value: newUser.contactEmail },
      { Name: "email_verified", Value: "true" },
      { Name: "given_name", Value: newUser.firstName },
      { Name: "family_name", Value: newUser.lastName },
      { Name: "phone_number", Value: newUser.contactPhone },
      { Name: "phone_number_verified", Value: "true" },
      { Name: "custom:tenantId", Value: newUser.customerIdentifier },
      { Name: "custom:organisationName", Value: newUser.organisationName },
    ],
  };
  logger.debug("Attempt to create Admin user for new tenant", { data: createUserParams.Username });
  const adminGroupParams = {
    UserPoolId: cognitoUserPoolId,
    Username: newUser.contactEmail,
    GroupName: "TenantAdmins",
  };

  try {
    const createUserCommand = new AdminCreateUserCommand(createUserParams);
    const createUserResponse = await cognitoClient.send(createUserCommand);
    logger.debug("createNewUserResponse", { data: createUserResponse });

    const addUserToGroupCommand = new AdminAddUserToGroupCommand(adminGroupParams);
    const addUserToGroupResponse = await cognitoClient.send(addUserToGroupCommand);
    logger.debug("addNewUserToTenantAdminsGroupOutcome", { data: addUserToGroupResponse });
    return `${JSON.stringify(createUserResponse)} \n ${JSON.stringify(addUserToGroupResponse)}`;
  } catch (err) {
    if (err.name === "UsernameExistsException") {
      const updateUserParams = {
        UserPoolId: cognitoUserPoolId,
        Username: newUser.contactEmail,
        UserAttributes: [
          { Name: "given_name", Value: newUser.firstName },
          { Name: "family_name", Value: newUser.lastName },
          { Name: "phone_number", Value: newUser.contactPhone },
        ],
      };
      const updateUserCommand = new AdminUpdateUserAttributesCommand(updateUserParams);
      const updateUserResponse = await cognitoClient.send(updateUserCommand);
      logger.debug("updateUserResponse", { data: updateUserResponse });
      return `Admin user already exists, but attributes updated: ${JSON.stringify(updateUserResponse)}`;
    }
    console.error(`Error details:\n${err}`);
    const errorCode = `${err.code ? err.code + ': ' : ''}`;
    const statusCode = `${err.statusCode ? 'Status code: ' + err.statusCode : ''}`;
    const errorString = `${errorCode} ${err.message} ${statusCode}`;
    logger.error("Failed to create new Tenant Admin user", { data: errorString });
    throw err;
  }
}

async function disableUsers(cognitoClient, tenantDetails) {
  const listUsersParams = {
    UserPoolId: cognitoUserPoolId,
    AttributesToGet: ["custom:tenantId"],
    Limit: 60,
    // PaginationToken: null  // Add code to iterate through multiple retrievals
  };
  try {
    // List users in Cognito with this Customer Identifier
    const listUsersCommand = new ListUsersCommand(listUsersParams);
    const listUsersResponse = await cognitoClient.send(listUsersCommand);
    logger.debug("listUsersResponse", { data: listUsersResponse });
    const disableUserParams = {
      UserPoolId: cognitoUserPoolId,
    };
    // Now disable all users in that list
    for (const user of listUsersResponse.Users) {
      if (user.Attributes.find((attr) => attr.Name === "custom:tenantId" && attr.Value === tenantDetails.customerIdentifier)) {
        disableUserParams.Username = user.Username;
        const disableUserCommand = new AdminDisableUserCommand(disableUserParams);
        const disableUserResponse = await cognitoClient.send(disableUserCommand);
        logger.debug("Disabling user", { data: disableUserResponse });
      }
    };
    return `Subscription revoked for customer ${tenantDetails.organisationName}, ID ${tenantDetails.customerIdentifier}`;
  } catch (err) {
    const errorCode = `${err.code ? err.code + ': ' : ''}`;
    const statusCode = `${err.statusCode ? 'Status code: ' + err.statusCode : ''}`;
    const errorString = `${errorCode} ${err.message} ${statusCode}`;
    logger.error("Failed to disable users", { data: errorString });
    throw err;
    // throw new Error(`Failed to disable users: ${err.message}`);
  };
}

async function enableUsers(cognitoClient, tenantDetails) {
  const listUsersParams = {
    UserPoolId: cognitoUserPoolId,
    AttributesToGet: ["custom:tenantId"],
    Limit: 60,
    // PaginationToken: null  // Add code to iterate through multiple retrievals
  };
  try {
    // List users in Cognito with this Customer Identifier
    const listUsersCommand = new ListUsersCommand(listUsersParams);
    const listUsersResponse = await cognitoClient.send(listUsersCommand);
    logger.debug("listUsersResponse", { data: listUsersResponse });
    const enableUserParams = {
      UserPoolId: cognitoUserPoolId,
    };
    // Now re-enable all users in the list
    for (const user of listUsersResponse.Users) {
      if (user.Attributes.find((attr) => attr.Name === "custom:tenantId" && attr.Value === tenantDetails.customerIdentifier)) {
        enableUserParams.Username = user.Username;
        const enableUserCommand = new AdminEnableUserCommand(enableUserParams);
        const enableUserResponse = await cognitoClient.send(enableUserCommand);
        logger.debug("Enabling user", { data: enableUserResponse });
      }
    };
    return `Subscription reinstated for customer ${tenantDetails.organisationName}, ID ${tenantDetails.customerIdentifier}`;
  } catch (err) {
    const errorCode = `${err.code ? err.code + ': ' : ''}`;
    const statusCode = `${err.statusCode ? 'Status code: ' + err.statusCode : ''}`;
    const errorString = `${errorCode} ${err.message} ${statusCode}`;
    logger.error("Failed to re-enable users", { data: errorString });
    throw err;
    // throw new Error(`Failed to re-enable users: ${err.message}`);
  };
}

async function sendMessage(subject, message) {
  const SNSparams = {
    TopicArn,
    Subject: subject,
    Message: message,
  };

  logger.debug("Notification sent with above SNSparams", { data: SNSparams });
  await SNS.publish(SNSparams).promise();
}