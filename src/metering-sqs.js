const winston = require('winston');
const { DynamoDBClient, UpdateItemCommand, GetItemCommand } = require('@aws-sdk/client-dynamodb');
const { MarketplaceMeteringClient, BatchMeterUsageCommand } = require('@aws-sdk/client-marketplace-metering');
const { ProductCode: ProductCode, AWSMarketplaceMeteringRecordsTableName: AWSMarketplaceMeteringRecordsTableName, NewSubscribersTableName: NewSubscribersTableName, AWS_REGION: aws_region } = process.env;
const dynamodb = new DynamoDBClient({ region: aws_region });
// MarketplaceMetering is instantianize in us-east-1 as all SaaS product listing ARN is stored in us-east-1.
const marketplacemetering = new MarketplaceMeteringClient({ region: 'us-east-1' });
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console(),
  ],
});

async function getCustomerAwsAccountId(licenseArn) {
  try {
    const result = await dynamodb.send(new GetItemCommand({
      TableName: NewSubscribersTableName,
      Key: { customerIdentifier: { S: licenseArn } },
      ProjectionExpression: 'customerAwsAccountId',
    }));
    const accountId = result.Item?.customerAwsAccountId?.S;
    if (!accountId) {
      logger.error(`Could not resolve customerAwsAccountId for LicenseArn: ${licenseArn}`);
    }
    return accountId;
  } catch (error) {
    logger.error(`Error looking up customerAwsAccountId for ${licenseArn}:`, error);
    return null;
  }
}

// Determine the type of customerIdentifier:
// 1. 12-digit number -> CustomerAWSAccountId
// 2. starts with arn:aws:license-manager: -> LicenseArn
// 3. anything else -> CustomerIdentifier (legacy, being deprecated)
function getIdentifierType(customerIdentifier) {
  if (/^\d{12}$/.test(customerIdentifier)) return 'CustomerAWSAccountId';
  if (customerIdentifier.startsWith('arn:aws:license-manager:')) return 'LicenseArn';
  return 'CustomerIdentifier';
}

exports.handler = async (event) => {
  logger.debug({"event" : event});
  await Promise.all(event.Records.map(async (record) => {
    const body = JSON.parse(record.body);
    logger.debug({"SQS message body": body});

    const timestmpNow = new Date();
    const identifierType = getIdentifierType(body.customerIdentifier);

    logger.debug({
      "customerIdentifierType": identifierType,
      "customerIdentifier": body.customerIdentifier
    });

    const UsageRecords = [];
    for (const r of body.dimension_usage) {
      const record = {
        Dimension: r.dimension,
        Quantity: r.value,
        Timestamp: timestmpNow,
      };

      switch (identifierType) {
        case 'CustomerAWSAccountId':
          record.CustomerAWSAccountId = body.customerIdentifier;
          break;
        case 'LicenseArn':
          record.LicenseArn = body.customerIdentifier;
          record.CustomerAWSAccountId = await getCustomerAwsAccountId(body.customerIdentifier);
          break;
        case 'CustomerIdentifier':
        default:
          record.CustomerIdentifier = body.customerIdentifier;
          break;
      }

      UsageRecords.push(record);
    }

    // LicenseArn-based metering does not require ProductCode
    const batchMeteringParams = identifierType === 'LicenseArn'
      ? { UsageRecords }
      : { ProductCode, UsageRecords };

    logger.debug({"UsageRecords" : UsageRecords});
    let meteringResponse = '';
    let meteringFailed = false;
    try {
      logger.debug({"batchMeteringParams" : batchMeteringParams});
      meteringResponse = await marketplacemetering.send(new BatchMeterUsageCommand(batchMeteringParams));
      logger.debug({"meteringResponse" :  meteringResponse});
      if(meteringResponse.Results.find(r => r.Status !== 'Success')){
        logger.error({"meteringResponse" :  meteringResponse});
        meteringFailed = true;
      }
    } catch (error) {
      logger.error({'error': error});
      meteringResponse = JSON.stringify(error);
      meteringFailed = true;
    }

    await Promise.all(body.create_timestamps.map(async (ts) => {
      const dynamoDbParams = {
        TableName: AWSMarketplaceMeteringRecordsTableName,
        Key: {
          customerIdentifier: { S: body.customerIdentifier },
          create_timestamp: { N: `${ts}` },
        },
        UpdateExpression: 'set metering_response = :x, metering_failed = :mf remove metering_pending',
        ExpressionAttributeValues: {
          ':x': { S: JSON.stringify(meteringResponse) },
          ':mf': { BOOL: meteringFailed },
        },
        ReturnValues: 'UPDATED_NEW',
      };

      await dynamodb.send(new UpdateItemCommand(dynamoDbParams));
      
    }));
  
  }));


  return {};
};
