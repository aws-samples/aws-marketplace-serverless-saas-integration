import fetch from 'node-fetch';
import {lambdaResponse} from "../model.js";

/*
TODO This is only pointing to the dev environment.  Need to update to point to the prod environment
TODO Need to use secrets manager and not just have credentials in the code.
TODO Need to pass in scopes so we don't have to hard code them.
 */

// Get the Edge API auth token with the cluster_account_admin scope
export async function getToken() {
    const oauthRequest =
        {
            grant_type: 'password',
            username: 'demo.account@artisan-studios.com',
            password: 'nxIQ317Q)rnh',
            audience: 'https://api.dev.edge.artisan-studios.com',
            scope:    'cluster_account_admin',
            client_id: 'AqIfrYSFaVFSCPGTQLnCUfN8Mq39I49Y',
            client_secret: 'QRXcOnEkjSiRcz2DRZDHfXjoa4pTSAMsOkVAngfMLyjStta-N1TB023aVNKX8wf5'
        }

    const fetchResp = await fetch("https://dev-i2km6jyn67eepw5p.us.auth0.com/oauth/token", {
        method: "POST",
        headers: {
            'content-type' : 'application/json'
        },
        body: JSON.stringify(oauthRequest)
    })

    if(!fetchResp.ok) {
        console.log("Error fetching token");
        return lambdaResponse(400, 'Failed to fetch edge token!');
    }
    const jsonBody = await fetchResp.json();
    console.log("This is the token body: " + jsonBody);
    const authToken = jsonBody.access_token;
    console.log("This is the token: " + authToken);
    return authToken;
}


// Get a token with the cluster_all scope
export async function getTokenCluster() {
    const oauthRequest =
        {
            grant_type: 'password',
            username: 'demo.account@artisan-studios.com',
            password: 'nxIQ317Q)rnh',
            audience: 'https://api.dev.edge.artisan-studios.com',
            scope:    'cluster_all',
            client_id: 'AqIfrYSFaVFSCPGTQLnCUfN8Mq39I49Y',
            client_secret: 'QRXcOnEkjSiRcz2DRZDHfXjoa4pTSAMsOkVAngfMLyjStta-N1TB023aVNKX8wf5'
        }

    const fetchResp = await fetch("https://dev-i2km6jyn67eepw5p.us.auth0.com/oauth/token", {
        method: "POST",
        headers: {
            'content-type' : 'application/json'
        },
        body: JSON.stringify(oauthRequest)
    })

    if(!fetchResp.ok) {
        console.log("Error fetching token");
        return lambdaResponse(400, 'Failed to fetch edge token!');
    }
    const jsonBody = await fetchResp.json();
    console.log("This is the token body: " + jsonBody);
    const authToken = jsonBody.access_token;
    console.log("This is the token: " + authToken);
    return authToken;
}