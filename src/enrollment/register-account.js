import fetch from "node-fetch"
import AWS from 'aws-sdk';
const { NewSubscribersTableName: newSubscribersTableName, AWS_REGION:aws_region } = process.env;
const marketplacemetering = new AWS.MarketplaceMetering({ apiVersion: '2016-01-14', region: aws_region });
const dynamodb = new AWS.DynamoDB({ apiVersion: '2012-08-10', region: aws_region });
import {getToken} from "../token/getToken.js"
import {createAccount} from "../edgeApiCalls/edge.js";

const lambdaResponse = (statusCode, body) => ({
    statusCode,
    headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'OPTIONS,POST',
    },

    body: JSON.stringify(body),
});

export const registerNewSubscriber = async (event) => {
    const {
        // Accept form inputs from ../web/index.html
        regToken, companyName, contactPerson, contactPhone, contactEmail,
    } = JSON.parse(event.body);

    // Validate the request with form inputs from ../web/index.html
    if (regToken && companyName && contactPerson && contactPhone && contactEmail) {
        try {
            // Call resolveCustomer to validate the subscriber
            const resolveCustomerParams = {
                RegistrationToken: regToken,
            };

            const resolveCustomerResponse = await marketplacemetering
                .resolveCustomer(resolveCustomerParams)
                .promise();

            const { CustomerIdentifier, ProductCode, CustomerAWSAccountId } = resolveCustomerResponse;

            // Get the Edge API auth token
            const authToken = getToken();

            // Create the Edge account in the Edge API
            const edgeCreateResp = await createAccount(authToken, CustomerAWSAccountId, CustomerIdentifier, companyName, contactEmail);

    if(!edgeCreateResp.ok) {
        console.log("Error creating edge account: " + edgeCreateResp.status + " " + edgeCreateResp.statusText + " " + edgeCreateResp.body);
        return lambdaResponse(400, 'Error creating edge account!');
    }

    const edgeId = await edgeCreateResp.json().id;
            const datetime = new Date().getTime().toString();

            // Save the subscriber data to the DynamoDB table
            const dynamoDbParams = {
                TableName: newSubscribersTableName,
                Item: {
                    edgeId: {S: edgeId},
                    companyName: { S: companyName },
                    contactEmail: { S: contactEmail },
                    customerIdentifier: { S: CustomerIdentifier },
                    productCode: { S: ProductCode },
                    customerAWSAccountID: { S: CustomerAWSAccountId },
                    status: { S: 'subscribe-success' },
                    created: { S: datetime },
                },
            };

            await dynamodb.putItem(dynamoDbParams).promise();
        } catch (error) {
            console.error(error);
            return lambdaResponse(400, 'Registration data not valid. Please try again, or contact support!');
        }
    } else {
        return lambdaResponse(400, 'Request no valid');
    }
}