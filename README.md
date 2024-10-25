# AWS Marketplace - Serverless integration for SaaS products (Example)

![](misc/banner.png)

This project provides example of serverless integration for SaaS products listed on the AWS Marketplace.

If you are a new seller on AWS Marketplace, we advise you to check the following resources:

- [SaaS Product Requirements & Recommendations](https://docs.aws.amazon.com/marketplace/latest/userguide/saas-guidelines.html) : This document outlines the requirements that must be met before gaining approval to publish a SaaS product to the catalog.
- [SaaS Listing Process & Integration Guide](https://awsmp-loadforms.s3.amazonaws.com/AWS+Marketplace+-+SaaS+Integration+Guide.pdf) : This document outlines what is required to integrate with Marketplace for each SaaS pricing model. You will find integration diagrams, codes examples, FAQs, and additional resources.
- [SaaS Integration Video](https://www.youtube.com/watch?v=glG44f-L8us) : This video guides you through the requirements and steps needed to integrate.
- [SaaS Pricing Video](https://www.youtube.com/watch?v=E0uWp8nhzAk) : This video guides you through the pricing options available when choosing to list a SaaS product.
- [AWS Marketplace - Seller Guide](https://docs.aws.amazon.com/marketplace/latest/userguide/what-is-marketplace.html) : This document covers more information about creating a SaaS product, pricing, and setting up your integration.

# Project Structure

The sample in this repository demonstrates how to use AWS SAM (Serverless application model) to integrate your SaaS product with AWS Marketplace and how to perform:

- [Register new customers](#register-new-customers)
- [Grant and revoke access to your product](#grant-and-revoke-access-to-your-product)
- [Metering for usage](#metering-for-usage)
- [Deploying the sample application using Serverless Application Model Command Line Interface (SAM CLI)](#)


## Register new customers

With SaaS subscriptions and SaaS contracts, your customers subscribe to your products through AWS Marketplace, but access the product in the environment you manage in your AWS account. After subscribing to the product, your customer is directed to a website you create and manage as a part of your SaaS product to register their account and conﬁgure the product.

When creating your product, you provide a URL for your registration landing page. AWS Marketplace uses that URL to redirect customers to your registration landing page after they subscribe. On your software's registration URL, you collect whatever information is required to create an account for the customer. AWS Marketplace recommends collecting your customer’s email addresses if you plan to contact them through email for usage notifications.

The registration landing page needs to be able to identify and accept the `x-amzn-marketplace-token` token in the form data from AWS Marketplace with the customer’s identiﬁer for billing. It should then pass that token value to the AWS Marketplace Metering Service and AWS Marketplace Entitlement Service APIs to resolve the unique customer identiﬁer and corresponding product code.

![](misc/onbording.gif)

> NOTE: Deploying the static landing page is optional.
> You can choose to use your existing SaaS registration page. After collecting the data, you should invoke the Register New Subscriber endpoint. Please see the Deployment section.

### Implementation

In this sample we create a CloudFront Distribution, which can be configured to use the domain/CNAME of your choice. The POST request from AWS Marketplace is intercepted by the Lambda@Edge function `src/redirect.js`, which transforms the POST request to a GET request, passing the `x-amzn-marketplace-token` in the query string.
A static landing page hosted on S3 takes the user's inputs defined in the html form and submits them to the `/subscriber` API Gateway endpoint.

The handler for the `/subscriber` endpoint is defined in the `src/register-new-subscriber.js` file. This Lambda function calls the `resolveCustomer` API endpoint and validates the token. If the token is valid, a customer record is created in the `AWSMarketplaceSubscribers` DynamoDB table and the data the customer submitted in the html form is stored.

![](misc/Onbording-CF.png)

## Grant and revoke access to your product

### Grant access to new subscribers

Once the `resolveCustomer` endpoint returns a successful response, you must grant the new subscriber access to the solution. Based on the type of listing, Contract or Subscription, we have defined different conditions in the `grant-revoke-access-to-product.js` stream handler that is executed on adding new or updating existing items in the `AWSMarketplaceSubscribers` DynamoDB table.

In our implementation, the Marketplace Tech Admin (whose email address is entered at deployment time) will receive an email when a new environment needs to be provisioned, or the existing environment updated. AWS Marketplace strongly recommends automating the access and environment management, which can be achieved by modifying the `grant-revoke-access-to-product.js` Lambda function.

The property `successfully_subscribed` is set in the DynamoDB table when a successful response is returned from the SQS entitlement handler for SaaS Contract-based listings, or after receiving the `subscribe-success` message from the Subscription SNS Topic (in the case of SaaS subscriptions) in `subscription-sqs-handler.js`.

### Update entitlement levels to new subscribers (SaaS Contracts only)

Each time the entitlement is updated, a message is received on the SNS relevant topic. The `entitlement-sqs.js`Lambda function that then invokes the `marketplaceEntitlementService` API and stores the response in the DynamoDB table.

We use the same DynamoDB stream to detect changes in the entitlement for SaaS contracts. When the entitlement is updated, a notification is sent to the Marketplace Tech Admin.

### Revoke access to customers with expired contracts and cancelled subscriptions

The logic to revoke access is implemented in a similar fashion to that granting access.

In our implementation the Marketplace Tech Admin receives an email when the contract expires or the subscription is cancelled. AWS Marketplace strongly recommends automating the access and environment management, which can be achieved by modifying the `grant-revoke-access-to-product.js` Lambda function.

## Metering for usage

For SaaS Subscriptions, it is the responsibility of the SaaS provider to meter all usage, which then enables AWS to bill customers based on the metering records provided. For SaaS Contracts, you only meter usage beyond a customer’s contract entitlement. When your application meters a customer's usage, your application provides AWS with the quantity accrued. Your application meters the pricing dimensions that you defined when you created your product, such as Gigabytes transferred or hosts scanned in a given hour.

### Implementation

We have created a `MeteringSchedule` CloudWatch Event rule that is **triggered every hour**. This in turn triggers the `metering-hourly-job.js` Lambda function, which queries all of the pending/unreported metering records from the `AWSMarketplaceMeteringRecords` table using the `PendingMeteringRecordsIndex`.

All of the pending records are aggregated based on the `customerIdentifier` and dimension name, and sent to the SQSMetering queue.

The records in the `AWSMarketplaceMeteringRecords` table are expected to be inserted programmatically by your SaaS application. In this case you will have to grant permissions to the service responsible for collecting usage data in your SaaS product to be able to write to the `AWSMarketplaceMeteringRecords` table.

The Lambda function `metering-sqs.js` sends all the queued metering records to the AWS Marketplace Metering service. After each call to the `batchMeterUsage` endpoint, the relevant items in the `AWSMarketplaceMeteringRecords` table are updated with the response returned from the Metering Service, which can be found in the `metering_response` field. If the request is unsuccessful, the `metering_failed` value is set to `true`, and you will need to investigate the why and resolve the issue. The error will also be stored in the `metering_response` field.

The new records in the AWSMarketplaceMeteringRecords table should be stored in the following format:

```javascript
{
  "create_timestamp": {
    "N": "113123"
  },
  "customerIdentifier": {
    "S": "ifAPi5AcF3"
  },
  "dimension_usage": {
    "L": [
      {
        "M": {
          "dimension": {
            "S": "users"
          },
          "value": {
            "N": "3"
          }
        }
      },
      {
        "M": {
          "dimension": {
            "S": "admin_users"
          },
          "value": {
            "N": "1"
          }
        }
      }
    ]
  },
  "metering_pending": {
    "S": "true"
  }
}
```

The Sort Key is `create_timestamp`, the Partition Key is `customerIdentifier`, and together they form the Primary Key.
Note: The new records format is DynamoDB JSON, which is different from JSON. The accepted time stamp is UNIX timestamp in UTC.

After the record is submitted to the AWS Marketplace `BatchMeterUsage` API, it will be updated and look like this:

```javascript
{
  "create_timestamp": 113123,
  "customerIdentifier": "ifAPi5AcF3",
  "dimension_usage": [
    {
      "dimension": "admin_users",
      "value": 3
    }
  ],
  "metering_failed": false,
  "metering_response": "{\"Results\":[{\"UsageRecord\":{\"Timestamp\":\"2020-06-24T04:04:53.776Z\",\"CustomerIdentifier\":\"ifAPi5AcF3\",\"Dimension\":\"admin_users\",\"Quantity\":3},\"MeteringRecordId\":\"35155d37-56cb-423f-8554-5c4f3e3ff56d\",\"Status\":\"Success\"}],\"UnprocessedRecords\":[]}"
}
```

## Deploying the sample application using SAM CLI

The Serverless Application Model Command Line Interface (SAM CLI) is an extension of the AWS CLI that adds functionality for building and testing serverless applications. To learn more about SAM, see the [AWS SAM developer guide](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-install.html).

To build and deploy your application, sign in to the AWS Management Console using credentials with IAM permissions for the resources that the templates deploy. For more information, see [AWS managed policies for job functions](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_job-functions.html). Your organization may choose to use a custom policy with more restrictions. These are the AWS services and resources that you need permissions to create as part of the deployment:

- AWS IAM role
- Amazon CloudWatch Logs
- Amazon CloudFront
- Amazon S3 bucket
- AWS CloudFormation stack
- AWS Lambda function
- Amazon API Gateway
- Amazon DynamoDB database
- Amazon SQS queue
- Amazon SNS topic
- Amazon EventBridge

> [!NOTE]  
> For simplicity, we use [AWS CloudShell](https://docs.aws.amazon.com/cloudshell/latest/userguide/welcome.html) to deploy the application since it has the required tools pre-installed. If you wish to run the deployment in an alternate shell, you'll need to install [Docker community edition](https://hub.docker.com/search/?type=edition&offering=community), [Node.js 10 or later (including NPM)](https://nodejs.org/en/), [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html), and [SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-install.html).

To build and deploy your application for the first time, follow these steps:

1. Using the AWS account registered as your [AWS Marketplace Seller account](https://docs.aws.amazon.com/marketplace/latest/userguide/seller-registration-process.html), open [AWS CloudShell](https://us-east-1.console.aws.amazon.com/cloudshell).

2. Clone the **aws-marketplace-serverless-saas-integration repository**:

```bash
git clone https://github.com/aws-samples/aws-marketplace-serverless-saas-integration.git
```

3. Change to the root directory:

```bash
cd aws-marketplace-serverless-saas-integration
```

4. Build the application using SAM.

```bash
sam build
```

5. Deploy the application using the SAM guided experience:

```bash
sam deploy --guided --capabilities CAPABILITY_NAMED_IAM
```

6. Follow the SAM guided steps to configure the deployment, referring to the following table for solution parameters:

   | Parameter name                           | Description                                                                                                                                                                                                                                                              |
   | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
   | Stack Name                               | Name of the resulting CloudFormation stack.                                                                                                                                                                                                                              |
   | `AWS Region`                             | Name of the region that the solution is being deployed to (default value `us-east-1`)                                                                                                                                                                                    |
   | `WebsiteS3BucketName`                    | S3 bucket to store the HTML files (mandatory if `CreateRegistrationWebPage` is set to true; will be created)                                                                                                                                                             |
   | `NewSubscribersTableName`                | Name for the New Subscribers Table (default value `AWSMarketplaceSubscribers`)                                                                                                                                                                                           |
   | `AWSMarketplaceMeteringRecordsTableName` | Name for the Metering Records Table (default value `AWSMarketplaceMeteringRecords`)                                                                                                                                                                                      |
   | `TypeOfSaaSListing`                      | Allowed values: `contracts_with_subscription`, `contracts`, or `subscriptions` (default value `contracts_with_subscription`)                                                                                                                                             |
   | `ProductId`                              | Product ID provided by AWS Marketplace                                                                                                                                                                                                                                   |
   | `MarketplaceTechAdminEmail`              | Email address for notifications of changes requiring action, verified in SES with AWS account in 'Production' (not 'Sandbox') mode (see **Post deployment steps** below for instructions on how to verify email addresses)                                               |
   | `MarketplaceSellerEmail`                 | (Optional) Seller email address (also verified)                                                                                                                                                                                                                          |
   | `SNSAccountID`                           | AWS account ID hosting the Entitlements and Subscriptions SNS topics - leave as default                                                                                                                                                                                  |
   | `SNSRegion`                              | AWS region that the Entitlements and Subscriptions SNS topics are hosted in - leave as default                                                                                                                                                                           |
   | `CreateCrossAccountRole`                 | Specifies whether to create a cross-account role granting access to the `NewSubscribersTableName` and `AWSMarketplaceMeteringRecordsTableName` tables (default value `false`)                                                                                            |
   | `CrossAccountId`                         | (Optional) AWS account ID for the cross-account role                                                                                                                                                                                                                     |
   | `CrossAccountRoleName`                   | (Optional) name for the cross-account role                                                                                                                                                                                                                               |
   | `CreateRegistrationWebPage`              | Specifies whether to create a registration page (default value `true`)                                                                                                                                                                                                   |
   | `UpdateFulfillmentURL`                   | Specifies whether to create a Lambda function to obtain the Product Code from AWS Marketplace for the solution (default value `false`)                                                                                                                                   |

7. Wait for the stack deployment to complete successfully.

8. Check the email account for **MarketplaceTechAdminEmail** and approve the subscription to the SNS topic.

### Diagram of created resources

Based on the value of the `TypeOfSaaSListing` parameter, a different set of resources will be created:

In the case of _contracts_with_subscription_, all of the resources depicted on the diagram below will be created.

In the case of _contracts_, the resources marked with orange circles will not be created.

In the case of _subscriptions_, the resources marked with purple circles will not be created.

The landing page is optional, depending on the value of the `CreateRegistrationWebPage` parameter.

![](misc/AWS-Marketplace-SaaS-Integration.drawio.png)

## Cleanup

To delete the sample application that you created, use the AWS CLI. Assuming you used your project name for the stack name, run the following command:

```bash
aws cloudformation delete-stack --stack-name app
```


## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.


## Post deployment steps

1. Ensure the email address used is a verified identity/domain in Amazon Simple Email Service - instructions: [Verify an email address](https://docs.aws.amazon.com/ses/latest/DeveloperGuide/verify-email-addresses-procedure.html).
2. Ensure your Amazon Simple Email Service account is a production account - instructions: [Request production access (Moving out of the Amazon SES sandbox)](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html).


