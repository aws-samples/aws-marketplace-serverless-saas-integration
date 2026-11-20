// index.mjs
//
// Lambda probe: does the AWS Lambda Node.js runtime ship a built-in AWS SDK v3
// recent enough to call GetAgreementContacts?
//
// Deliberately NOT bundled: this function imports @aws-sdk/client-marketplace-
// agreement from the Lambda-provided runtime SDK (no node_modules in the zip).
// If the runtime's SDK is too old, the import itself throws and that is the
// answer we want to capture.
//
// Event shape:
//   { "agreementId": "agmt-xxxxxxxx" }
//
// Env (optional):
//   MP_AGREEMENT_REGION    defaults to us-east-1
//   MP_AGREEMENT_ENDPOINT  endpoint override; unset => SDK default endpoint

export const handler = async (event) => {
  const agreementId = event && event.agreementId;
  const region = process.env.MP_AGREEMENT_REGION || "us-east-1";
  const endpoint = process.env.MP_AGREEMENT_ENDPOINT || undefined;

  const result = {
    region,
    endpoint: endpoint || "(SDK default)",
    agreementId: agreementId || null,
  };

  // Dynamic import so a missing/old runtime SDK is reported as data, not a
  // hard INIT crash.
  let mod;
  try {
    mod = await import("@aws-sdk/client-marketplace-agreement");
  } catch (e) {
    return {
      ...result,
      sdkAvailable: false,
      stage: "import",
      error: { name: e.name, message: e.message },
    };
  }

  const { MarketplaceAgreementClient, GetAgreementContactsCommand } = mod;

  result.commandExported = typeof GetAgreementContactsCommand === "function";

  // Report the runtime SDK version if we can find it.
  try {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    result.sdkVersion = require("@aws-sdk/client-marketplace-agreement/package.json").version;
  } catch {
    result.sdkVersion = "unknown";
  }

  if (!result.commandExported) {
    return {
      ...result,
      sdkAvailable: true,
      stage: "export-check",
      error: { message: "GetAgreementContactsCommand not exported by runtime SDK" },
    };
  }

  if (!agreementId) {
    return {
      ...result,
      sdkAvailable: true,
      stage: "no-agreement-id",
      note: "SDK and command available; pass { agreementId } to make the real call",
    };
  }

  const clientConfig = { region };
  if (endpoint) clientConfig.endpoint = endpoint;
  const client = new MarketplaceAgreementClient(clientConfig);

  try {
    const resp = await client.send(new GetAgreementContactsCommand({ agreementId }));
    return {
      ...result,
      sdkAvailable: true,
      stage: "call",
      success: true,
      acceptorContact: resp.acceptorContact || null,
      response: resp,
    };
  } catch (e) {
    return {
      ...result,
      sdkAvailable: true,
      stage: "call",
      success: false,
      error: {
        name: e.name,
        message: e.message,
        resourceType: e.resourceType,
        httpStatus: e.$metadata && e.$metadata.httpStatusCode,
      },
    };
  }
};
