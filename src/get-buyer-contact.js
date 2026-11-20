// get-buyer-contact.js
// Pre-fill handler for the registration page.
// Backs GET /contact?x-amzn-marketplace-token=...
// Resolves the registration token and, if a buyer-contact Profile Snapshot
// exists on the agreement, returns the buyer-provided fields so the static
// landing page can pre-populate the form. The buyer confirms/edits and submits
// to POST /subscriber (which resolves the token again, server-side, and is the
// authoritative writer).
//
// NOTE: ResolveCustomer is intentionally performed here (pre-fill) and again on
// submit. Identifiers are never trusted from the browser; each path resolves the
// token server-side.

const { MarketplaceMeteringClient, ResolveCustomerCommand } = require("@aws-sdk/client-marketplace-metering");
const { MarketplaceAgreementClient, GetAgreementContactsCommand } = require("@aws-sdk/client-marketplace-agreement");

const { AWS_REGION: aws_region } = process.env;

const marketplacemetering = new MarketplaceMeteringClient({ region: aws_region });
// GetAgreementContacts is only available in us-east-1 (commercial partition),
// regardless of the region the stack is deployed in.
const marketplaceagreement = new MarketplaceAgreementClient({
  region: "us-east-1",
});

const lambdaResponse = (statusCode, body) => ({
  statusCode,
  headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'OPTIONS,GET',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(body),
});

// Retrieve the buyer contact (Profile Snapshot) for an agreement.
// Non-blocking: any failure resolves to null so pre-fill degrades gracefully to
// an empty form. Logs never include the contact or token (buyer PII).
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
    if (error.name === "ResourceNotFoundException"
        && error.resourceType === "AGREEMENT_ACCEPTOR_CONTACT") {
      console.log("getBuyerContact: No buyer contact captured for agreement", agreementId,
        "(ResourceNotFoundException / AGREEMENT_ACCEPTOR_CONTACT)");
      return null;
    }
    console.error("getBuyerContact: GetAgreementContacts FAILED:", error.name, "|", error.message,
      "| resourceType:", error.resourceType);
    return null;
  }
};

exports.getBuyerContactHandler = async (event) => {
  const regToken = event.queryStringParameters
    && event.queryStringParameters['x-amzn-marketplace-token'];

  if (!regToken) {
    return lambdaResponse(400, { message: 'Registration token missing' });
  }

  try {
    const resolveCustomerResponse = await marketplacemetering.send(
      new ResolveCustomerCommand({ RegistrationToken: regToken })
    );
    // ResolveCustomer returns the agreement id nested under Metadata.AgreementId.
    // Fall back to a top-level AgreementId in case the field is promoted.
    const AgreementId = (resolveCustomerResponse.Metadata && resolveCustomerResponse.Metadata.AgreementId)
      || resolveCustomerResponse.AgreementId;
    console.log('get-buyer-contact: extracted AgreementId =', JSON.stringify(AgreementId));

    const buyerContact = await getBuyerContact(AgreementId);

    // Return only buyer-facing contact fields for pre-fill. No identifiers are
    // returned to the browser; the submit path re-resolves the token itself.
    if (!buyerContact) {
      console.log('get-buyer-contact: no contact to return; responding { contact: null }');
      return lambdaResponse(200, { contact: null });
    }

    const contactOut = {
      firstName: buyerContact.firstName || '',
      lastName: buyerContact.lastName || '',
      emailAddress: buyerContact.emailAddress || '',
      companyName: buyerContact.companyName || '',
      countryCode: buyerContact.countryCode || '',
    };
    return lambdaResponse(200, { contact: contactOut });
  } catch (error) {
    // Pre-fill is best-effort. Never block the page on failure; the buyer can
    // still fill the form manually.
    console.error('get-buyer-contact failed:', error.name, error.message);
    return lambdaResponse(200, { contact: null });
  }
};
