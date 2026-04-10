const { DynamoDBClient, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const winston = require('winston');
const { AWS_REGION: aws_region } = process.env;
const dynamodb = new DynamoDBClient({ region: aws_region });
const sqs = new SQSClient({ region: aws_region });
const { SQSMeteringRecordsUrl: QueueUrl, AWSMarketplaceMeteringRecordsTableName: AWSMarketplaceMeteringRecordsTableName } = process.env;
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console(),
  ],
});

async function asyncForEach(array, callback) {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array)
  }
}

const addUpDimensions = (objectArray) => Object.values(objectArray.reduce((accumulator, currentValue) => (
  (accumulator[currentValue.dimension]
    ? (accumulator[currentValue.dimension].value += currentValue.value)
    : accumulator[currentValue.dimension] = { ...currentValue }
  ), accumulator), {}));


exports.job = async () => {
  logger.info('Starting metering job')
  const params = {
    TableName: AWSMarketplaceMeteringRecordsTableName,
    IndexName: 'PendingMeteringRecordsIndex',
    KeyConditionExpression: 'metering_pending = :b',
    ExpressionAttributeValues: {
      ':b': { S: 'true' },
    },
  };
  logger.debug({ "params:": params });

  const result = await dynamodb.send(new QueryCommand(params));

  const items = result.Items.map((i) => unmarshall(i));
  logger.debug({ "items": items });
  const hashMap = {};

  items.map((item) => {
    const { customerIdentifier} = item;

    if (hashMap[customerIdentifier]) {
      hashMap[customerIdentifier].create_timestamps.push(item.create_timestamp);
      hashMap[customerIdentifier].dimension_usage = addUpDimensions([...hashMap[customerIdentifier].dimension_usage, ...item.dimension_usage]);
    } else {
      hashMap[customerIdentifier] = item;
      hashMap[customerIdentifier].create_timestamps = [item.create_timestamp];
      delete hashMap[customerIdentifier].create_timestamp;
    }
  });

  logger.debug({ "items":items });

  logger.debug({"hashMap": hashMap});
  await asyncForEach(Object.keys(hashMap), async (hash) => {
    logger.debug({"hash": hash});
    const SQSParams = {
      MessageBody: JSON.stringify(hashMap[hash], (key, value) => 
        typeof value === 'bigint' ? value.toString() : value
      ),
      MessageGroupId: hash,
      QueueUrl,
    };
    logger.debug({ "SQSParams": SQSParams });
  
    try {
      logger.debug('Sending message to SQS');
      await sqs.send(new SendMessageCommand(SQSParams));
      logger.info(`Records submitted to queue: ${JSON.stringify(hashMap[hash], (key, value) => 
        typeof value === 'bigint' ? value.toString() : value, 2)}`);
    } catch (error) {
      console.error(error, error.stack);
      logger.error({ "error": error });
    }
  });

  return true;
};
