import AWS from "aws-sdk";
const { AWS_REGION: aws_region } = process.env;
const dynamodb = new AWS.DynamoDB({ apiVersion: '2012-08-10', region: aws_region });
const { SQSMeteringRecordsUrl: QueueUrl, AWSMarketplaceMeteringRecordsTableName: AWSMarketplaceMeteringRecordsTableName, NewSubscribersTableName: newSubscribersTableName, ProductCode: ProductCode } = process.env;
import {getTokenCluster} from "../token/getToken.js";
const marketplacemetering = new AWS.MarketplaceMetering({ apiVersion: '2016-01-14', region: 'us-east-1' });
import {lambdaResponse} from "../model.js";
import {getAccountClusters} from "../edgeApiCalls/edge.js";


export const bill = async () => {

  // Get all the active subscriptions from the dynamodb table
  const edgeParams = {
    TableName: newSubscribersTableName,
    IndexName: 'ActiveSubscriptionsIndex',
    KeyConditionExpression: 'edgeStatus = :b',
    ExpressionAttributeValues: {
      ':b': { S: 'subscribe-success' },
    },
  };

  const edgeResult = await dynamodb.query(edgeParams).promise();

  const edgeItems = edgeResult.Items.map((i) => AWS.DynamoDB.Converter.unmarshall(i));

  // Process billing info for active customers
  const UsageRecords = [];
  for (let item of edgeItems) {

    // Get a token for the edge API
    const token = await getTokenCluster()
    const edgeId = item.edgeId;

    // Get the clusters for the edge account
    const result = await getAccountClusters(token, edgeId);


    UsageRecords.push(
        {
          CustomerIdentifier: item.customerIdentifier,
          Dimension: 'provision_cluster',
          Quantity: result.clusters.length,
          Timestamp: new Date(),
        });
  }

  const batchMeteringParams = {
    ProductCode,
    UsageRecords,
  };

        let meteringResponse = '';

        //TODO Uncomment the following code to enable metering.  It works, and it will charge our customer account (which is bad).
        // do not enable this code until you are ready to charge customers.

        // try {
        //   meteringResponse = await marketplacemetering.batchMeterUsage(batchMeteringParams).promise();
        //   if(meteringResponse.Results.find(r => r.Status !== 'Success')){
        //     return lambdaResponse(500, 'Error');
        //   }
        // } catch (error) {
        //   return lambdaResponse(500, JSON.stringify(error));
        // }

  return lambdaResponse(200, 'Success');
};