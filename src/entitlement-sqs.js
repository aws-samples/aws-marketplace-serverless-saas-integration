const winston = require('winston');
const { DynamoDBClient, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { MarketplaceCatalogClient, DescribeEntityCommand } = require('@aws-sdk/client-marketplace-catalog');
const { MarketplaceEntitlementServiceClient, GetEntitlementsCommand } = require('@aws-sdk/client-marketplace-entitlement-service');
//const { MarketplaceAgreementServiceClient, DescribeAgreementCommand } = require('@aws-sdk/client-marketplace-agreement');
const { MarketplaceAgreementClient, DescribeAgreementCommand, GetAgreementTermsCommand } = require('@aws-sdk/client-marketplace-agreement');
const { NewSubscribersTableName: newSubscribersTableName, AWS_REGION: aws_region, PricingModel: pricingModel } = process.env;
// MarketplaceEntitlementService is instantiated only in us-east-1 https://docs.aws.amazon.com/general/latest/gr/aws-marketplace.html#marketplaceentitlement
const dynamodb = new DynamoDBClient({ region: aws_region });
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console(),
  ],
});

// get a product for a given productId
// and check if it has entitlements
async function getMarketplaceProduct(productId, region) {
  try {
    logger.info(`getMarketplaceProduct: productId: ${productId}`);
    const mpCatClient = new MarketplaceCatalogClient({ region });
    
    const command = new DescribeEntityCommand({
      Catalog: 'AWSMarketplace',
      EntityId: productId
    });
    
    const response = await mpCatClient.send(command);
    logger.debug(`response: ${JSON.stringify(response, null, 2)}`);
    
    const hasEntitlements = response.DetailsDocument?.Dimensions?.some(
      dimension => dimension.Types?.includes('Entitled')
    ) || false;
    logger.debug(`hasEntitlements: ${hasEntitlements}`);
    
    return { ...response, hasEntitlements, failure: false };
  } catch (error) {
    console.error('Error getting marketplace product:', error);
    return { hasEntitlements: null, failure: true };
  }
}

// call GetEntitlements API
async function getEntitlements(productCode, licenseArn, region) {
  try {
    logger.info(`getEntitlements: productCode: ${productCode}, licenseArn: ${licenseArn}, region: ${region}`);
    const entitlementParams = {
      ProductCode: productCode,
      Filter: {
        LICENSE_ARN: [licenseArn]
      }
    };
    logger.debug(`entitlementParams: ${JSON.stringify(entitlementParams, null, 2)}`);

    const mpClient = new MarketplaceEntitlementServiceClient({ region });
    const command = new GetEntitlementsCommand(entitlementParams);
    return await mpClient.send(command);
  } catch (error) {
    logger.error(`Error getting entitlements: ${error}`);
    return null;
  }
}

async function getAgreementDetails(agreementId) {
  try {
    logger.info(`getAgreementDetails: agreementId: ${agreementId}`);
    const agreementClient = new MarketplaceAgreementClient({ region: 'us-east-1' });
    const command = new DescribeAgreementCommand({
      agreementId: agreementId
    });
    const response = await agreementClient.send(command);
    logger.debug(`agreementResponse: ${JSON.stringify(response, null, 2)}`);
    return response;
  } catch (error) {
    logger.error(`Error getting agreement details for ${agreementId}:`, error);
    return null;
  }
}

async function checkForFreeTrial(agreementId) {
  try {
    const agreementClient = new MarketplaceAgreementClient({ region: 'us-east-1' });
    const response = await agreementClient.send(new GetAgreementTermsCommand({ agreementId }));
    logger.debug(`agreementTerms: ${JSON.stringify(response, null, 2)}`);
    const hasFreeTrialTerm = response.acceptedTerms?.some(term => term.freeTrialPricingTerm) || false;
    if (hasFreeTrialTerm) {
      logger.info('Free trial term found in agreement');
    } else {
      logger.info('No free trial term found in agreement');
    }
    return hasFreeTrialTerm;
  } catch (error) {
    logger.error(`Error getting agreement terms for ${agreementId}:`, error);
    return false;
  }
}


exports.handler = async (event) => {
  logger.info('event:', event);
  await Promise.all(event.Records.map(async (record) => {
    
    const body = JSON.parse(record.body);
    logger.debug('body:', body);
    const detailType = body['detail-type'];

    logger.debug(`Detail Type: ${detailType}`);   // License Updated - Manufacturer

    if (detailType === 'License Updated - Manufacturer' 
        || detailType === 'License Deprovisioned - Manufacturer' 
        || detailType === 'License Updated - Proposer' 
        || detailType === 'License Deprovisioned - Proposer') {
      logger.debug(`processing detail-type: ${detailType}`);

      const productId = body.detail.product.id;
      const productCode = body.detail.product.code;
      const licenseArn = body.detail.license.arn;
      const acceptorAccountId = body.detail.acceptor.accountId;
      const agreementId = body.detail.agreement.id;
      logger.debug(`productId: ${productId}`);
      logger.debug(`productCode: ${productCode}`);
      logger.debug(`licenseArn: ${licenseArn}`);
      logger.debug(`acceptorAccountId: ${acceptorAccountId}`);
      logger.debug(`agreementId: ${agreementId}`);

      // Fetch agreement details and check for free trial
      const agreementDetails = await getAgreementDetails(agreementId);
      const isFreeTrialTermPresent = await checkForFreeTrial(agreementId);
      logger.info(`is_free_trial_term_present: ${isFreeTrialTermPresent}`);

      let entitlementData = {};
      let isExpired = detailType === 'License Deprovisioned - Manufacturer' || detailType === 'License Deprovisioned - Proposer';
      let updateExpression = ""

      // Do we have entitlements
      const resultProduct = await getMarketplaceProduct(productId, aws_region);
      logger.debug(`resultProduct: ${JSON.stringify(resultProduct, null, 2)}`);
      logger.info(`resultProduct.hasEntitlements: ${resultProduct.hasEntitlements}`);
      logger.info(`resultProduct.failure: ${resultProduct.failure}`);

      let callEntitlements = false;
      if (resultProduct.failure) {
        // Use fallback logic
        logger.warning('Error getting marketplace product');
        logger.info('Using fallback logic if pricingModel is not equal subscriptions');
        if (pricingModel !== 'subscriptions') {
          callEntitlements = true;
        }
      } else {
        callEntitlements = resultProduct.hasEntitlements; // true or false
      }
      logger.info(`callEntitlements: ${callEntitlements}`);

      // Only call GetEntitlements for contract-based pricing models
      //if (pricingModel !== 'subscriptions') {
      if (callEntitlements) {
        logger.info(`Calling GetEntitlements for contract-based pricing models with licenseArn: ${licenseArn}`); 
        const entitlementsResponse = await getEntitlements(
          productCode, 
          licenseArn,
          aws_region
        );

        logger.debug(`entitlementsResponse: ${JSON.stringify(entitlementsResponse, null, 2)}`);
        const { $metadata, ...data } = entitlementsResponse;
        entitlementData = data;
        logger.debug(`entitlementData: ${JSON.stringify(entitlementData, null, 2)}`);
        isExpired = entitlementData.hasOwnProperty("Entitlements") === false || entitlementData.Entitlements.length === 0 || 
          new Date(entitlementData.Entitlements[0].ExpirationDate) < new Date();
        logger.debug(`isExpired: ${isExpired}`);
        updateExpression= "set entitlement = :e, successfully_subscribed = :ss, subscription_expired = :se, is_free_trial_term_present = :ft, updated_at = :ua";
      } else {
        updateExpression= "set successfully_subscribed = :ss, subscription_expired = :se, is_free_trial_term_present = :ft, updated_at = :ua";
        logger.info('Skipping GetEntitlements call for subscriptions pricing model');
      }
      logger.debug(`updateExpression: ${updateExpression}`);

      //const dynamoDbKey = acceptorAccountId;
      const dynamoDbKey = licenseArn;
      logger.debug(`dynamoDbKey: ${dynamoDbKey}`);

      // Build ExpressionAttributeValues based on pricing model
      const expressionAttributeValues = {
        ':ss': { BOOL: true },
        ':se': { BOOL: isExpired },
        ':ft': { BOOL: isFreeTrialTermPresent },
        ':ua': { S: new Date().toISOString() },
      };
      
      // Only include entitlement data for contract-based pricing models
      if (pricingModel !== 'subscriptions') {
        expressionAttributeValues[':e'] = { S: JSON.stringify(entitlementData) };
      }

      const dynamoDbParams = {
        TableName: newSubscribersTableName,
        Key: {
          customerIdentifier: { S: dynamoDbKey },
        },
        UpdateExpression: updateExpression,
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: 'UPDATED_NEW',
      };

      logger.debug(`dynamoDbParams: ${JSON.stringify(dynamoDbParams, null, 2)}`);
      await dynamodb.send(new UpdateItemCommand(dynamoDbParams));
      logger.info(`License Agreement updated successfully in DynamoDB table ${newSubscribersTableName}`);
    } else {
      //logger.error('Unhandled action');
      logger.error(`Unhandled action - msg: ${JSON.stringify(record)}`);
      //throw new Error(`Unhandled action - msg: ${JSON.stringify(record)}`);
    }
  }));
  return {};
};
