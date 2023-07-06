const AWS = require('aws-sdk');
const { AWS_REGION: aws_region } = process.env;
const dynamodb = new AWS.DynamoDB({ apiVersion: '2012-08-10', region: aws_region });
const sqs = new AWS.SQS({ apiVersion: '2012-11-05', region: aws_region });
const { SQSMeteringRecordsUrl: QueueUrl, AWSMarketplaceMeteringRecordsTableName: AWSMarketplaceMeteringRecordsTableName } = process.env;


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
  const params = {
    TableName: AWSMarketplaceMeteringRecordsTableName,
    IndexName: 'PendingMeteringRecordsIndex',
    KeyConditionExpression: 'metering_pending = :b',
    ExpressionAttributeValues: {
      ':b': { S: 'true' },
    },
  };

  const result = await dynamodb.query(params).promise();

  const items = result.Items.map((i) => AWS.DynamoDB.Converter.unmarshall(i));
  const hashMap = {};

  items.map((item) => {
    const { customerIdentifier } = item;

    if (hashMap[customerIdentifier]) {
      hashMap[customerIdentifier].create_timestamps.push(item.create_timestamp);
      hashMap[customerIdentifier].dimension_usage = addUpDimensions([...hashMap[customerIdentifier].dimension_usage, ...item.dimension_usage]);
    } else {
      hashMap[customerIdentifier] = item;
      hashMap[customerIdentifier].create_timestamps = [item.create_timestamp];
      delete hashMap[customerIdentifier].create_timestamp;
    }
  });

  await asyncForEach(Object.keys(hashMap), async (hash) => {
    const SQSParams = {
      MessageBody: JSON.stringify(hashMap[hash]),
      MessageGroupId: hash,
      QueueUrl,
    };

    try {
      await sqs.sendMessage(SQSParams).promise();
      console.log(`Records submitted to queue: ${JSON.stringify(hashMap[hash])}`);
    } catch (error) {
      console.error(error, error.stack);
    }
  });

  return true;
};
