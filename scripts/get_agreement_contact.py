#!/usr/bin/env python3
"""get_agreement_contact.py

Standalone probe: calls GetAgreementContacts using the public AWS SDK for
Python (boto3).

Mirrors getBuyerContact() in src/get-buyer-contact.js: it calls
GetAgreementContacts for a given agreement id and prints whatever comes back.

Usage:
    python3 scripts/get_agreement_contact.py <agreement-id>

Environment variables:
    MP_AGREEMENT_REGION    defaults to us-east-1
    MP_AGREEMENT_ENDPOINT  optional endpoint override. Leave unset to use
                           boto3's default resolved endpoint.

Requires a recent boto3 that exposes the marketplace-agreement service:
    pip install "boto3>=1.44"
"""

import json
import os
import sys

import boto3
import botocore
from botocore.exceptions import ClientError


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python3 scripts/get_agreement_contact.py <agreement-id>",
              file=sys.stderr)
        return 2

    agreement_id = sys.argv[1]
    region = os.environ.get("MP_AGREEMENT_REGION", "us-east-1")
    endpoint = os.environ.get("MP_AGREEMENT_ENDPOINT")  # None => boto3 default

    client = boto3.client(
        "marketplace-agreement",
        region_name=region,
        endpoint_url=endpoint,
    )

    has_op = "GetAgreementContacts" in client.meta.service_model.operation_names

    print("boto3 version :", boto3.__version__)
    print("botocore ver  :", botocore.__version__)
    print("region        :", region)
    print("endpoint       :", endpoint or "(boto3 default)")
    print("agreementId   :", agreement_id)
    print("GetAgreementContacts available:", has_op)
    print("---")

    try:
        resp = client.get_agreement_contacts(agreementId=agreement_id)
        # Drop the ResponseMetadata noise for a clean view of the payload.
        resp.pop("ResponseMetadata", None)
        print("SUCCESS: GetAgreementContacts returned:")
        print(json.dumps(resp, indent=2, default=str))
        print("---")
        print("acceptorContact:",
              json.dumps(resp.get("acceptorContact"), indent=2, default=str))
        return 0
    except ClientError as error:
        err = error.response.get("Error", {})
        meta = error.response.get("ResponseMetadata", {})
        print("FAILED:", file=sys.stderr)
        print("  code        :", err.get("Code"), file=sys.stderr)
        print("  message     :", err.get("Message"), file=sys.stderr)
        print("  resourceType:", err.get("ResourceType")
              or error.response.get("resourceType"), file=sys.stderr)
        print("  httpStatus  :", meta.get("HTTPStatusCode"), file=sys.stderr)
        return 1
    except AttributeError:
        # Service model too old to expose the operation at all.
        print("FAILED: this boto3/botocore build does not expose "
              "GetAgreementContacts for marketplace-agreement.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
