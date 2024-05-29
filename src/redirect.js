exports.redirecthandler = async(event, context, callback) => {
  
  const redirectUrl = "/?" + event['body'];
  const response = {
      statusCode: 302,
      headers: {
          Location: redirectUrl
      },
  };
  
  return response;

};
