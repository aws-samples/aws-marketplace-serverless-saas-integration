exports.redirecthandler = async(event) => {
  
  const redirectUrl = "/?" + event['body'];
  const response = {
      statusCode: 302,
      headers: {
          Location: redirectUrl
      },
  };
  
  return response;

};
