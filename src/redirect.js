// redirect.js
// redirects to signup page and includes registration token in the URL
// Do not log the event or the redirect URL: both contain the registration token.
//const redirectToProductPage = process.env.VARIABLE_NAME || 'false';

exports.redirecthandler = async (event) => {
  const redirectUrl = "/?" + event['body'];

  const response = {
      statusCode: 302,
      headers: {
          Location: redirectUrl
      },
  };
  
  return response;

};
