# Lambda probe — does the Lambda runtime's built-in SDK support GetAgreementContacts?

This probe deploys a tiny Lambda function that imports
`@aws-sdk/client-marketplace-agreement` **from the Lambda Node.js runtime**
(no bundled `node_modules`), reports the runtime SDK version, and tries to call
`GetAgreementContacts`.

## Files

- `index.mjs` — handler. Dynamically imports the runtime SDK, reports its
  version, whether `GetAgreementContactsCommand` is exported, and (if an
  `agreementId` is passed) the result of the call.
- `trust-policy.json` — Lambda assume-role trust policy.
- `permissions-policy.json` — grants `aws-marketplace:GetAgreementContacts`.
- `deploy.sh` — creates/updates the role and function. `RUNTIME=` selects the
  Node runtime (default `nodejs22.x`).
- `invoke.sh` — invokes the function. Pass an agreement id, or nothing for an
  SDK-availability-only check. Works with AWS CLI v1 and v2.

## Usage

```bash
cd scripts/lambda
./deploy.sh                      # create/update (nodejs22.x)
./invoke.sh                      # SDK availability only
./invoke.sh agmt-xxxxxxxxxxxxx   # real GetAgreementContacts call

RUNTIME=nodejs20.x ./deploy.sh   # test another runtime
```

## Finding (as tested in us-east-1)

The Lambda runtime's **built-in** AWS SDK is NOT recent enough. The bundled
`@aws-sdk/client-marketplace-agreement` does not export
`GetAgreementContactsCommand`:

| Runtime      | Built-in SDK version | GetAgreementContactsCommand |
|--------------|----------------------|-----------------------------|
| nodejs24.x   | 3.1105.0             | not exported                |
| nodejs22.x   | 3.1105.0             | not exported                |
| nodejs20.x   | 3.895.0              | not exported                |
| nodejs18.x   | 3.895.0              | not exported                |

(The public npm SDK first exposing this command is newer — 3.1171.0 was used by
the local `scripts/get-agreement-contact.js` probe and worked.)

### Conclusion

While the runtime SDK is older than 3.1171.0, a Lambda **must bundle** a current
`@aws-sdk/client-marketplace-agreement`. Relying on the runtime-provided SDK
fails with "GetAgreementContactsCommand is not a function". This is why
`scripts/prepare-sdk.js` selects the **bundled** strategy for these runtimes,
based on the versions recorded in `runtime-sdk.json`.

## Cleanup

```bash
aws lambda delete-function --function-name probe-get-agreement-contact --region us-east-1
aws iam delete-role-policy --role-name probe-get-agreement-contact-role --policy-name get-agreement-contacts
aws iam detach-role-policy --role-name probe-get-agreement-contact-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
aws iam delete-role --role-name probe-get-agreement-contact-role
```
