import {lambdaResponse} from "../model";

// Create a new account in the Edge API
//TODO This is only pointing to the dev environment.  Need to update to point to the prod environment
export async function createAccount(authToken, CustomerAWSAccountId, CustomerIdentifier, companyName, contactEmail) {
    let edgeCreateResp;
    try {
        edgeCreateResp = await fetch("https://edge-rest.dev.edge.artisan-studios.com/v1/accounts", {
            method: "POST",
            headers: {
                'Authorization': authToken,
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                awsAccount: CustomerAWSAccountId,
                awsCustomerId: CustomerIdentifier,
                account_name: companyName,
                email: contactEmail
            })
        });
    } catch (error) {
        console.error(error);
        return lambdaResponse(400, 'Error creating edge account in try catch!');
    }
    return edgeCreateResp
}

// Update the status of an account in the Edge API
//TODO This is only pointing to the dev environment.  Need to update to point to the prod environment
export async function updateAccountStatus(authToken, edgeId, action) {
    let edgeUpdateResp;
    try {
        edgeUpdateResp = await fetch("https://edge-rest.dev.edge.artisan-studios.com/v1/accounts/" + edgeId + "/status", {
            method: "PATCH",
            headers: {
                'Authorization': authToken,
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                status: action
            })
        });
    } catch (error) {
        console.error(error);
        return lambdaResponse(400, 'Error creating edge account in try catch!');
    }
    return edgeUpdateResp
}

// Get the clusters associated with an account in the Edge API.  Used for billing purposes.
// TODO This is only pointing to the dev environment.  Need to update to point to the prod environment
export async function getAccountClusters(authToken, edgeId) {
    let edgeClustersResp;
    const url = "https://edge-rest.dev.edge.artisan-studios.com/v1/clusters/" + edgeId;
    try {
        edgeClustersResp = await fetch(url, {
            method: "GET",
            headers: {
                'Authorization': authToken,
                'content-type': 'application/json'
            }
        });
    } catch (error) {
        console.error(error);
        return lambdaResponse(400, 'Error creating edge account in try catch!');
    }
    const clusterResponse = await edgeClustersResp.json();
    console.log("this is the get response raw " + JSON.stringify(clusterResponse));
    return clusterResponse;
}