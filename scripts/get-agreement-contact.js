#!/usr/bin/env node
// get-agreement-contact.js
//
// Standalone probe: calls GetAgreementContacts using the public AWS SDK for
// JavaScript v3.
//
// It mirrors the getBuyerContact() call in src/get-buyer-contact.js: it sends
// a GetAgreementContactsCommand for a given agreement id and prints whatever
// comes back.
//
// Usage:
//   node scripts/get-agreement-contact.js <agreement-id>
//
// Options via env:
//   MP_AGREEMENT_REGION    defaults to us-east-1
//   MP_AGREEMENT_ENDPOINT  optional endpoint override. Leave unset to use the
//                          SDK's default resolved endpoint.
//
// Install the public SDK first (from this directory, not the src/vendor tarballs):
//   npm install @aws-sdk/client-marketplace-agreement

const {
  MarketplaceAgreementClient,
  GetAgreementContactsCommand,
} = require("@aws-sdk/client-marketplace-agreement");

async function main() {
  const agreementId = process.argv[2];
  if (!agreementId) {
    console.error("Usage: node scripts/get-agreement-contact.js <agreement-id>");
    process.exit(2);
  }

  const region = process.env.MP_AGREEMENT_REGION || "us-east-1";
  const endpoint = process.env.MP_AGREEMENT_ENDPOINT; // undefined => SDK default

  const sdkVersion = require("@aws-sdk/client-marketplace-agreement/package.json").version;
  console.log("SDK version :", sdkVersion);
  console.log("region      :", region);
  console.log("endpoint    :", endpoint || "(SDK default)");
  console.log("agreementId :", agreementId);
  console.log("GetAgreementContactsCommand exported:", typeof GetAgreementContactsCommand === "function");
  console.log("---");

  const clientConfig = { region };
  if (endpoint) clientConfig.endpoint = endpoint;
  const client = new MarketplaceAgreementClient(clientConfig);

  try {
    const resp = await client.send(new GetAgreementContactsCommand({ agreementId }));
    console.log("SUCCESS: GetAgreementContacts returned:");
    console.log(JSON.stringify(resp, null, 2));
    const contact = resp.acceptorContact || null;
    console.log("---");
    console.log("acceptorContact:", JSON.stringify(contact, null, 2));
  } catch (error) {
    console.error("FAILED:");
    console.error("  name        :", error.name);
    console.error("  message     :", error.message);
    console.error("  resourceType:", error.resourceType);
    if (error.$metadata) {
      console.error("  httpStatus  :", error.$metadata.httpStatusCode);
    }
    // Distinguish "SDK can't do this at all" from "call reached the service".
    if (error.name === "TypeError") {
      console.error("  => Looks like the command/shape is not available in this SDK build.");
    }
    process.exit(1);
  }
}

main();
