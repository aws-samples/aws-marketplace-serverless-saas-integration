const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
const { MarketplaceMeteringClient, ResolveCustomerCommand } = require("@aws-sdk/client-marketplace-metering");
const { MarketplaceAgreementClient, GetAgreementContactsCommand } = require("@aws-sdk/client-marketplace-agreement");
const { DynamoDBClient, UpdateItemCommand } = require("@aws-sdk/client-dynamodb");

const { NewSubscribersTableName: newSubscribersTableName, MarketplaceSellerEmail: marketplaceSellerEmail, AWS_REGION: aws_region } = process.env;

const ses = new SESClient({ region: aws_region });
const marketplacemetering = new MarketplaceMeteringClient({ region: aws_region });
// GetAgreementContacts is only available in us-east-1 (commercial partition),
// regardless of the region the stack is deployed in.
const marketplaceagreement = new MarketplaceAgreementClient({
  region: "us-east-1",
});
const dynamodb = new DynamoDBClient({ region: aws_region });

// Retrieve the buyer contact (Profile Snapshot) for an agreement.
// Buyer-contact retrieval is an additive, non-blocking step: any failure must
// never break registration, so all errors are logged and resolved to null.
const getBuyerContact = async function (agreementId) {
  console.log("getBuyerContact: agreementId =", JSON.stringify(agreementId));
  if (!agreementId) {
    console.log("getBuyerContact: no agreementId provided, skipping GetAgreementContacts");
    return null;
  }
  try {
    console.log("getBuyerContact: calling GetAgreementContacts for", agreementId);
    const resp = await marketplaceagreement.send(
      new GetAgreementContactsCommand({ agreementId })
    );
    const contact = resp.acceptorContact || null;
    console.log("getBuyerContact: acceptorContact present:", !!contact);
    return contact;
  } catch (error) {
    // Buyer opted out, or the agreement predates the feature: expected, not an error.
    if (error.name === "ResourceNotFoundException"
        && error.resourceType === "AGREEMENT_ACCEPTOR_CONTACT") {
      console.log("getBuyerContact: No buyer contact captured for agreement", agreementId,
        "(ResourceNotFoundException / AGREEMENT_ACCEPTOR_CONTACT)");
      return null;
    }
    // Any other error (ValidationException, AccessDeniedException,
    // ThrottlingException, etc.): log and continue. Contact retrieval must
    // NEVER block registration.
    console.error("getBuyerContact: GetAgreementContacts FAILED:", error.name, "|", error.message,
      "| resourceType:", error.resourceType);
    return null;
  }
};

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

  // catch SES error. When SES fails to send an email
  // to the email address the customer entered
  // the registering page fails with internal error
  // catching this error solves this internal error message
  ses.send(new SendEmailCommand(params))
    .then(result => {
      return true
    })
    .catch(error => {
      // SES error messages can include the recipient address: log the error name only.
      console.error('sending email via SES failed:', error.name);
      return false
    });
};

exports.registerNewSubscriber = async (event) => {
  const {
    // Accept form inputs from ../web/index.html
    regToken, companyName, contactPerson, contactPhone, contactEmail, country,
  } = JSON.parse(event.body);

  // Validate the request with form inputs from ../web/index.html
  if (regToken && companyName && contactPerson && contactPhone && contactEmail) {
    try {
      const resolveCustomerResponse = await marketplacemetering.send(
        new ResolveCustomerCommand({ RegistrationToken: regToken })
      );

      // Store new subscriber data in dynamoDb
      // Get ProductCode, customerAwsAccountId and LicenseArn from Registration Token.
      // ResolveCustomer returns the agreement id nested under Metadata.AgreementId.
      // Fall back to a top-level AgreementId in case the field is promoted.
      const { ProductCode, CustomerAWSAccountId, LicenseArn } = resolveCustomerResponse;
      const AgreementId = (resolveCustomerResponse.Metadata && resolveCustomerResponse.Metadata.AgreementId)
        || resolveCustomerResponse.AgreementId;

      // Retrieve the buyer contact (Profile Snapshot) for the agreement.
      // This is additive and non-blocking: a missing contact or any API error
      // must not prevent registration from completing.
      const buyerContact = await getBuyerContact(AgreementId);
      const rawContact = buyerContact ? { S: JSON.stringify(buyerContact) } : { NULL: true };

      const datetime = new Date().getTime().toString();

      // Country is captured from the web form (optional field) and, when the
      // buyer pre-filled the form from their AWS Marketplace buyer contact,
      // originates from the contact's countryCode. Normalize to a trimmed
      // string so an absent value is stored as "" rather than undefined.
      const countryCode = (typeof country === 'string' ? country.trim() : '');

      // Write form inputs from ../web/index.html
      // Use UpdateItem to upsert (update if exists, create if doesn't)
      const dynamoDbParams = {
        TableName: newSubscribersTableName,
        Key: {
          customerIdentifier: { S: LicenseArn },
        },
        // buyerContact is an immutable snapshot. When one was retrieved, write it.
        // When none was (opt-out, or GetAgreementContacts failed), only initialise
        // the attribute to NULL so a snapshot already back-filled by the async
        // EventBridge path (entitlement-sqs.js) is never clobbered.
        UpdateExpression: 'set companyName = :cn, contactPerson = :cp, contactPhone = :cph, contactEmail = :ce, countryCode = :cc, productCode = :pc, customerAwsAccountId = :caid, successfully_registered = :sr, updated_at = :ua, '
          + (buyerContact ? 'buyerContact = :bc' : 'buyerContact = if_not_exists(buyerContact, :bc)'),
        ExpressionAttributeValues: {
          ':cn': { S: companyName },
          ':cp': { S: contactPerson },
          ':cph': { S: contactPhone },
          ':ce': { S: contactEmail },
          ':cc': { S: countryCode },
          ':pc': { S: ProductCode },
          ':caid': { S: CustomerAWSAccountId },
          ':sr': { BOOL: true },
          ':ua': { S: new Date().toISOString() },
          // JSON snapshot string, or { NULL: true } when no contact was returned.
          ':bc': rawContact,
        },
        // Only set created timestamp if the item doesn't exist
        ConditionExpression: 'attribute_not_exists(created)',
        ReturnValues: 'UPDATED_NEW',
      };

      try {
        console.log('updating DynamoDB subscriber record');
        await dynamodb.send(new UpdateItemCommand(dynamoDbParams));
        console.log('DynamoDB updated - new record created');
      } catch (error) {
        // If condition fails, it means the record exists, so update without the condition
        if (error.name === 'ConditionalCheckFailedException') {
          delete dynamoDbParams.ConditionExpression;
          console.log('Record exists, updating existing record');
          await dynamodb.send(new UpdateItemCommand(dynamoDbParams));
          console.log('DynamoDB updated - existing record modified');
        } else {
          throw error;
        }
      }

      await setBuyerNotificationHandler(contactEmail);

      return lambdaResponse(200, 'Success! Registration completed. You have purchased an enterprise product that requires some additional setup. A representative from our team will be contacting you within two business days with your account credentials. Please contact Support through our website if you have any questions.');
    } catch (error) {
      // Do not log the error object: it may carry request details (token, contact).
      console.error('registerNewSubscriber failed:', error.name);
      return lambdaResponse(400, 'Registration data not valid. Please try again, or contact support!');
    }
  } else {
    return lambdaResponse(400, 'Request no valid');
  }
};
