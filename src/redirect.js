// redirect.js
// redirects to signup page and includes registration token in the URL
//const redirectToProductPage = process.env.VARIABLE_NAME || 'false';

exports.redirecthandler = async (event) => {
  console.log("event:", event);
  const redirectUrl = "/?" + event['body'];
  console.log("redirectUrl:", redirectUrl);

  const response = {
      statusCode: 302,
      headers: {
          Location: redirectUrl
      },
  };
  
  return response;

};
