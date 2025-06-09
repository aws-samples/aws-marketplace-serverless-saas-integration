# AWS Marketplace - Serverless integration for SaaS products (Example)

![](misc/banner.png)

This project demonstrates a serverless integration example for SaaS products in AWS Marketplace using AWS SAM (Serverless Application Model) for configuration, building, and deployment. It is primarily designed for users who are familiar with deploying AWS resources via CLI, need full configuration options, and want to customize the solution. For users seeking a simpler approach with less configuration, limited customization needs, or demo purposes, an alternative lab called "[Integrate your SaaS with the Serverless SaaS Integration reference](https://catalog.workshops.aws/mpseller/en-US/saas/integration-with-quickstart#background)" is available.

> [!IMPORTANT]
> **For reference purposes only**: The solution created in this repo serves as a reference demonstrating the core components needed for integrating and operating a SaaS listing in AWS Marketplace. While we periodically update the solution to reflect current integration standards, it does not adhere to any service level agreement. Proceed with caution if you intend to use this solution in your production accounts, or on production or other critical data. You are responsible for testing, securing, and optimizing AWS Content, such as sample code, as appropriate for production grade use based on your specific quality control practices and standards.

If you are a new seller on AWS Marketplace, we advise you to check the following resources: 

* [SaaS Product Requirements & Recommendations](https://docs.aws.amazon.com/marketplace/latest/userguide/saas-guidelines.html) : This document outlines the requirements that must be met before gaining approval to publish a SaaS product to the catalog.
* [SaaS Listing Process & Integration Guide](https://awsmp-loadforms.s3.amazonaws.com/AWS+Marketplace+-+SaaS+Integration+Guide.pdf) : This document outlines what is required to integrate with Marketplace for each SaaS pricing model. You will find integration diagrams, codes examples, FAQs, and additional resources.
* [SaaS Integration Video](https://www.youtube.com/watch?v=glG44f-L8us) : This video guides you through the requirements and steps needed to integrate. 
* [SaaS Pricing Video](https://www.youtube.com/watch?v=E0uWp8nhzAk) : This video guides you through the pricing options available when choosing to list a SaaS product.
* [AWS Marketplace - Seller Guide](https://docs.aws.amazon.com/marketplace/latest/userguide/what-is-marketplace.html) : This document covers more information about creating a SaaS product, pricing, and setting up your integration.


# Project Structure

The sample in this repository demonstrates how to use AWS SAM (Serverless application model) to integrate your SaaS product with AWS Marketplace and how to perform:

- [Register new customers](#register-new-customers)
- [Grant and revoke access to your product](#grant-and-revoke-access-to-your-product)
- [Metering for usage](#metering-for-usage)
- [Deploying the sample application using Serverless Application Model Command Line Interface (SAM CLI)](#)


## Register new customers

With SaaS subscriptions and SaaS contracts, your customers subscribe to your products through AWS Marketplace, but access the product on environment you manage in your AWS account. After subscribing to the product, your customer is directed to a website you create and manage as a part of your SaaS product to register their account and conﬁgure the product.

When creating your product, you provide a URL to your registration landing page. AWS Marketplace uses that URL to redirect customers to your registration landing page after they subscribe. On your software's registration URL, you collect whatever information is required to create an account for the customer. AWS Marketplace recommends collecting your customer’s email addresses if you plan to contact them through email for usage notifications.

The registration landing page needs to be able to identify and accept the x-amzn-marketplace-token token in the form data from AWS Marketplace with the customer’s identiﬁer for billing. It should then pass that token value to the AWS Marketplace Metering Service and AWS Marketplace Entitlement Service APIs to resolve for the unique customer identiﬁer and corresponding product code.

![](misc/onbording.gif)

> NOTE: Deploying the static landing page is optional.
You can choose to use your existing SaaS registration page, after collecting the data you should call the register new subscriber endpoint. Please see the deployment section.

### Implementation

In this sample we created CloudFront Distribution, which can be configured to use domain/CNAME by your choice. The POST request coming from AWS Marketplace is intercepted by the Edge `src/redirect.js`, which transforms the POST request to a GET request, and passes the x-amzn-marketplace-token in the query string. 
A static landing page hosted on S3 which takes the users inputs defined in the html form and submits them to the /subscriber API Gateway endpoint.  <<<confirm

The handler for the /subscriber endpoint is defined in the `src/register-new-subscriber.js` file. This lambda function calls the  `resolveCustomerAPI` and validates the token. If the token is valid, a customer record is created in the `AWSMarketplaceSubscribers` DynamoDB table and the data the customer submitted in the html form is stored.  <<< add links 

![](misc/Onbording-CF.png)

## Grant and revoke access to your product

### Grant access to new subscribers

Once the resolveCustomer endpoint return successful response, the SaaS vendors must to provide access to the solution to the new subscriber. 
Based on the type of listing contract or subscription we have defined different conditions in the `grant-revoke-access-to-product.js` stream handler that is executed on adding new or updating existing rows.

In our implementation the Marketplace Tech Admin (The email address you have entered when deploying), will receive email when new environment needs to be provisioned or existing environment needs to be updated. AWS Marketplace strongly recommends automating the access and environment management which can be achieved by modifying the `grant-revoke-access-to-product.js` function.

The property successfully subscribed is set when successful response is returned from the SQS entitlement handler for SaaS Contract based listings or after receiving **subscribe-success message from the Subscription SNS Topic in the case of AWS SaaS subscriptions in the `subscription-sqs-handler.js`.


### Update entitlement levels to new subscribers (SaaS Contracts only)

Each time the entitlement is update we receive message on the SNS topic. 
The lambda function `entitlement-sqs.js` on each message is calling the marketplaceEntitlementService and storing the response in the dynamoDB.

We are using the same DynamoDB stream to detect changes in the entailment for SaaS contracts. When the entitlement is update notification is sent to the `MarketplaceTechAdmin`.


### Revoke access to customers with expired contracts and cancelled subscriptions 

The revoke access logic is implemented in a similar manner as the grant access logic. 

In our implementation the `MarketplaceTechAdmin` receives email when the contract expires or the subscription is cancelled. 
AWS Marketplace strongly recommends automating the access and environment management which can be achieved by modifying the `grant-revoke-access-to-product.js` function.

## Metering for usage

For SaaS subscriptions, the SaaS provider must meter for all usage, and then customers are billed by AWS based on the metering records provided. For SaaS contracts, you only meter for usage beyond a customer’s contract entitlements. When your application meters usage for a customer, your application is providing AWS with a quantity of usage accrued. Your application meters for the pricing dimensions that you defined when you created your product, such as gigabytes transferred or hosts scanned in a given hour.

### Implementation

We have created MeteringSchedule CloudWatch Event rule that is **triggered every hour**. The `metering-hourly-job.js` gets triggered by this rule and it's querying all of the pending/unreported metering records from the `AWSMarketplaceMeteringRecords` table using the PendingMeteringRecordsIndex.
All of the pending records are aggregated based on the customerIdentifier and dimension name, and sent to the SQSMetering queue.
The records in the `AWSMarketplaceMeteringRecords` table are expected to be inserted programmatically by your SaaS application. In this case you will have to give permissions to the service in charge of collecting usage data in your existing SaaS product to be able to write to `AWSMarketplaceMeteringRecords` table. 

The lambda function `metering-sqs.js` is sending all of the queued metering records to the AWS Marketplace Metering service.
After every call to the `batchMeterUsage` endpoint the rows are updated in the AWSMarketplaceMeteringRecords table, with the response returned from the Metering Service, which can be found in the `metering_response` field. If the request was unsuccessful the metering_failed value with be set to true and you will have to investigate the issue the error will be also stored in the `metering_response` field.

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

Where the `create_timestamp` is the sort key and `customerIdentifier` is the partition key, and they are both forming the Primary key. 
Note:The new records format is in DynamoDB JSON format. It is different than JSON. The accepted time stamp is UNIX timestamp in UTC time. 

After the record is submitted to AWS Marketplace BatchMeterUsage API, it will be updated and it will look like this:

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

## Deploying the sample application using the SAM CLI

The Serverless Application Model Command Line Interface (SAM CLI) is an extension of the AWS CLI that adds functionality for building and testing Lambda applications. To learn more about SAM, visit the [AWS SAM developer guide](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-install.html).

To build and deploy your application, you must sign in to the AWS Management Console with IAM permissions for the resources that the templates deploy. For more information, see [AWS managed policies for job functions](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_job-functions.html). Your organization may choose to use a custom policy with more restrictions. These are the AWS services that you need permissions to create as part of the deployment:

* AWS IAM role
* Amazon CloudWatch Logs
* Amazon CloudFront
* Amazon S3 bucket
* AWS CloudFormation stack
* AWS Lambda function
* Amazon API Gateway
* Amazon DynamoDB database
* Amazon SQS queue
* Amazon SNS topic
* Amazon EventBridge


> [!NOTE]  
For simplicity, we use [AWS CloudShell](https://docs.aws.amazon.com/cloudshell/latest/userguide/welcome.html) to deploy the application since it has the required tools pre-installed. If you wish to run the deployment in an alternate shell, you'll need to install [Docker community edition](https://hub.docker.com/search/?type=edition&offering=community), [Node.js 10 (including NPM)](https://nodejs.org/en/), [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html), and [SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-install.html).


To build and deploy your application for the first time, complete the following steps.


1. Using the AWS account registered as your [AWS Marketplace Seller account](https://docs.aws.amazon.com/marketplace/latest/userguide/seller-registration-process.html), open [AWS CloudShell](https://us-east-1.console.aws.amazon.com/cloudshell). 

2. Clone the **aws-marketplace-serverless-saas-integration repository** and change to the root of the repository.

  ```bash
  git clone https://github.com/aws-samples/aws-marketplace-serverless-saas-integration.git
  ```

3. Change to the root directory of the repository

  ```bash
  cd aws-marketplace-serverless-saas-integration
  ```

4. Build the application using SAM. 

  ```bash
  sam build
  ```

5. Deploy the application using the SAM guided experience.

  ```bash
  sam deploy --guided --capabilities CAPABILITY_NAMED_IAM
  ```

6. Follow the SAM guided experience to configure the deployment. Reference the following table for solution parameters.
 
    Parameter name | Description
    ------------ | -------------
    Stack Name | Name of the resulting CloudFormation stack.
    AWS Region | Name of the region that the solution is being deployed in. Default value: us-east-1
    WebsiteS3BucketName | S3 bucket to store the HTML files; Mandatory if CreateRegistrationWebPage is set to true; will be created
    NewSubscribersTableName | Name for the New Subscribers Table; Default value: AWSMarketplaceSubscribers
    AWSMarketplaceMeteringRecordsTableName | Name for the Metering Records Table; Default value: AWSMarketplaceMeteringRecords
    TypeOfSaaSListing | allowed values: contracts_with_subscription, contracts, subscriptions; Default value: contracts_with_subscription
    ProductId | Product id provided from AWS Marketplace
    MarketplaceTechAdminEmail | Email to be notified on changes requiring action
    MarketplaceSellerEmail | (Optional) Seller email address, verified in SES and in 'Production' mode. See [Verify an email address](https://docs.aws.amazon.com/ses/latest/DeveloperGuide/verify-email-addresses-procedure.html) for instruction to verify email addresses.
    SNSAccountID | AWS account ID hosting the Entitlements and Subscriptions SNS topics. Leave as default.
    SNSRegion | AWS region that the Entitlements and Subscriptions SNS topics are hosted in. Leave as default.
    CreateCrossAccountRole | Creates a cross-account role granting access to the NewSubscribersTableName and AWSMarketplaceMeteringRecordsTableName tables. Default value: false.
    CrossAccountId | (Optional) AWS account ID for the cross-account role.
    CrossAccountRoleName |  (Optional) Role name for the cross-account role.
    CreateRegistrationWebPage | Creates a registration page. Default value: true

7. Wait for the stack to complete successfully.

8. Check the email account for **MarketplaceTechAdminEmail** and approve the subscription to the SNS topic.


### Diagram of created resources

Based on the value of the **TypeOfSaaSListing** parameter different set of resources will be created. 

In the case of *contracts_with_subscription* all of the resources depicted on the diagram below will be created.

In the case of a *contracts*, the resources market with orange circles will not be created.

In the case of a *subscriptions* the resources market with purple circles will not be created.

The landing page is optional. Use the CreateRegistrationWebPage parameter.


![](misc/AWS-Marketplace-SaaS-Integration.drawio.png)


## Cleanup

To delete the sample application that you created, use the AWS CLI. Assuming you used your project name for the stack name, you can run the following:

```bash
aws cloudformation delete-stack --stack-name app
```


## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.


## Post deployment steps

## Registration page is true
1. Update the MarketplaceFulfillmentUrl in your AWS Marketplace Management Portal with the value from the output key 'MarketplaceFulfillmentUrl'. The value would be in a the form of a AWS cloudfront based url.
2. Replace the baseUrl value in the web/script.js file from the web template provided with the value from the output key 'RedirectUrl'. 
3. Replace the RedirectUrl value in the lambda environment variable with the value from the output key 'RedirectUrl'. Navigate to the AWS Console, look for AWS Lambda service, filter to the lambda with name ....Redirect... . Select the lambda function, go to configuration tab and then select the environment variable. 
4. Ensure the email address used is a verified identity/domain in Amazon Simple Email Service.
5. Ensure your Amazon Simple Email Service account is a production account. 

## Registration page is false
1. Update the MarketplaceFulfillmentUrl in your AWS Marketplace Management Portal with the value from the output key 'MarketplaceFulfillmentUrl'. The value would be in the form of an AWS API gateway url.
2. Replace the baseUrl value in the web/script.js file from the web template provided with the value from the output key 'RedirectUrl'.
3. Ensure the email address used is a verified identity/domain in Amazon Simple Email Service.
4. Ensure your Amazon Simple Email Service account is a production account.
