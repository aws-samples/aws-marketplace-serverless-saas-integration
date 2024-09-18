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
  AdminDeleteUserCommand,
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
        entitlementUpdate: entitlementUpdated,
      };

      logger.debug("Subscription Event Trigger", { data: subscriptionEvent });

      let message = "";
      let subject = "";
      const sts = new AWS.STS();

      if (grantAccess || revokeAccess || entitlementUpdated) {
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
          } else if (grantAccess) {
            try {
              const createUserResponse = await createAdminUser(cognitoIdentityClient, newImage);
              subject = "New AWS Marketplace Subscription";
              message = `subscribe-success: ${JSON.stringify(createUserResponse)}`
            } catch (error) {
              subject = "Marketplace Subscription failure";
              message = `subscribe-fail: ${JSON.stringify(error)}`
              logger.error("Failed to create new user in City Trax tenant account", { data: error });
            };
            // try {
            //   const createUserResponse = await new Promise((resolve, reject) => {
            //     cognitoIdentityClient.adminCreateUser(createUserParams, (err, data) => {
            //       if (err) {
            //         const errorString = `${err.code}: ${err.message}\nStatus code: ${err.statusCode}`;
            //         logger.error("Failed to create new user in City Trax tenant account", { data: errorString });
            //         subject = "AWS Marketplace Subscription Failure";
            //         message = `subscribe-fail: ${JSON.stringify(newImage)}`;
            //         reject(err);
            //         throw new Error(`Failed to create new user in City Trax tenant account: ${err.message}`);
            //       } else {
            //         resolve(data);
            //         logger.debug("createNewUserResponse", { data: createUserResponse });
            //         logger.debug("Data returned from createUser Promise", { data: data });
            //       }
            //     });
            //   });

            //   const addUserToGroupResponse = await new Promise((resolve, reject) => {
            //     cognitoIdentityClient.adminAddUserToGroup(adminGroupParams, (err, data) => {
            //       if (err) {
            //         const errorString = `${err.code}: ${err.message}\nStatus code: ${err.statusCode}`;
            //         logger.error("Failed to add user to TenantAdmins group", { data: errorString });
            //         subject = "AWS Marketplace Subscription Failure";
            //         message = `subscribe-fail: ${JSON.stringify(newImage)}`;
            //         reject(err);
            //       } else {
            //         resolve(data);
            //         logger.debug("addNewUserToTenantAdminsGroupOutcome", { data: addUserToGroupResponse });
            //         logger.debug("Data returned from addUserToGroup Promise", { data: data });
            //         subject = "New AWS Marketplace Subscription";
            //         message = `subscribe-success: ${JSON.stringify(createUserResponse)}`;
            //       }
            //     });
            //   });

            //   /* Temporary commenting out of async code that doesn't wait to complete:

            //   const createUserCommand = new AdminCreateUserCommand(
            //     createUserParams
            //   );
            //   const createUserResponse =
            //   await cognitoClient.send(createUserCommand);
            //   logger.debug("createNewUserOutcome", { data: createUserResponse });
            //   console.log(`\nFollow-on message after success:\n${JSON.stringify(createUserResponse)}\n`);

            //   const addUserToGroupCommand = new AdminAddUserToGroupCommand(
            //     adminGroupParams
            //   );
            //   const addUserToGroupResponse =
            //   await cognitoClient.send(addUserToGroupCommand);
            //   logger.debug("addNewUserToTenantAdminsGroupOutcome", { data: addUserToGroupResponse });
            //   subject = "New AWS Marketplace Subscription";
            //   message = `subscribe-success: ${JSON.stringify(createUserResponse)}`;
            //   */

            //   /*
            //   In this restructured code:
            //   - adminCreateUser is called, and its response is awaited using .promise().
            //   - If the user creation is successful, the then block is executed, where the adminAddUserToGroup is called, and its response is awaited using .promise().
            //   - If the adminAddUserToGroup is successful, the then block after that is executed, where you can perform any additional follow-up actions.
            //   - If any of the Cognito operations fail, the catch block is executed, where you can handle the error.
            //   - By using promises and async/await, you can ensure that the subsequent operations are executed only after the previous asynchronous operation has completed successfully.
            //   Note: Make sure to handle errors appropriately and replace process.env.USER_POOL_ID and process.env.ADMIN_GROUP_NAME with the actual values from your environment variables.
            //   */

            //   // cognitoidentityserviceprovider.adminCreateUser(createUserParams)
            //   //   .promise()
            //   //   .then(data => {
            //   //     logger.debug("createNewUserOutcome", { data: data.User });
            //   //     console.log(`\nFollow-on message after success:\n${JSON.stringify(data.User)}\n`);
            //   //     return cognitoidentityserviceprovider.adminAddUserToGroup(adminGroupParams).promise();
            //   //   })
            //   //   .then(data => {
            //   //     logger.debug("addNewUserToTenantAdminsGroupOutcome", { data });
            //   //     subject = "New AWS Marketplace Subscription";
            //   //     message = `subscribe-success: ${JSON.stringify(newImage)}`;
            //   //   })
            //   //   .catch(err => {
            //   //     const errorString = `${err.code}: ${err.message}\nStatus code: ${err.statusCode}`;
            //   //     logger.error("Failed to create user", { data: errorString });
            //   //     subject = "AWS Marketplace Subscription Failure";
            //   //     message = `subscribe-fail: ${JSON.stringify(newImage)}`;
            //   //   });

            // } catch (error) {
            //   const errorString = `${err.code}: ${err.message}\nStatus code: ${err.statusCode}`;
            //   logger.debug("Failed to create admin user", { data: errorString });
            //   subject = "AWS Marketplace Subscription Failure";
            //   message = `subscribe-fail: ${JSON.stringify(newImage)}`;
            // };
          } else if (revokeAccess) {
            try {
              const revokeCustomerAccess = await disableUsers(cognitoIdentityClient, newImage.customerIdentifier);
              subject = "AWS Marketplace Subscription Revoked";
              message = `unsubscribe-success: ${JSON.stringify(revokeCustomerAccess)}`;
            } catch (err) {
              const errorString = `${err.code ? err.code : ''}: ${err.message} ${err.statusCode ? 'Status code' : err.statusCode}`;
              logger.error("Failed to disable user", { data: errorString });
              subject = "AWS Marketplace - failed to revoke subscription for customer " + newImage.customerIdentifier;
              message = `unsubscribe-fail: ${JSON.stringify(newImage)}`;
              throw new Error(`Failed to disable user: ${err.message}`);
            };
          }
          sendMessage(subject, message);
        } catch (err) {
          console.error(err);
          const errorString = `${err.code ? err.code : ''}: ${err.message} ${err.statusCode ? 'Status code' : err.statusCode}`;
          logger.error("Failed to process customer subscription", { data: errorString });
          subject = "AWS Marketplace - failed to process customer subscription";
          message = `subscribe-fail: ${JSON.stringify(newImage)}`;
          sendMessage(subject, message);
          throw new Error(`Failed to assume role: ${err.message}`);
        }
      } else {
        if (JSON.stringify(newImage) === '{}') {
          logger.info("Tenant record deleted");
          subject = "Subscriber Deleted for City Trax Translate";
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
    const errorString = `${err.code ? err.code + ':' : ''} ${err.message} ${err.statusCode ? 'Status code: ' + err.statusCode : err.statusCode}`;
    logger.error("Failed to create new Tenant Admin user", { data: errorString });
    throw err;
  }
}

async function disableUsers(cognitoClient, tenantId) {
  const listUsersParams = {
    UserPoolId: cognitoUserPoolId,
    AttributesToGet: ["custom:tenantId", "Username"],
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
      if (user.Attributes.find((attr) => attr.Name === "custom:tenantId" && attr.Value === tenantId)) {
        disableUserParams.Username = user.Username;
        const disableUserCommand = new AdminDisableUserCommand(disableUserParams);
        const disableUserResponse = await cognitoClient.send(disableUserCommand);
        logger.debug("Disabling user", { data: disableUserResponse });
      }
    };
  } catch (err) {
    const errorString = `${err.code ? err.code : ''}: ${err.message} ${err.statusCode ? 'Status code' : err.statusCode}`;
    logger.error("Failed to disable users", { data: errorString });
    throw err;
    // throw new Error(`Failed to disable users: ${err.message}`);
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