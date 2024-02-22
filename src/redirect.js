const { RedirectUrl: landingPageUrl } = process.env;

exports.redirecthandler = async(event, context, callback) => {
  
  const redirectUrl = landingPageUrl + "?" + event['body'];
  const response = {
      statusCode: 302,
      headers: {
          Location: redirectUrl
      },
  };
  
  return response;

};
