exports.lambdaHandler = async (event) => {
  const { request } = event.Records[0].cf;

  const redirect = request.method === 'POST' && request.body.data;


  if (redirect) {
    const body = Buffer.from(request.body.data, 'base64').toString();
    return {
      status: '302',
      statusDescription: 'Found',
      headers: {
        location: [{
          key: 'Location',
          value: `/?${body}`,
        }],
      },
    };
  }

  return request;
};
