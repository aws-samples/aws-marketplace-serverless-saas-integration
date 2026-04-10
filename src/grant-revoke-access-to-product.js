const winston = require('winston');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { unmarshall } = require('@aws-sdk/util-dynamodb');
const { SupportSNSArn: TopicArn, AWS_REGION: aws_region } = process.env;
const sns = new SNSClient({ region: aws_region });
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console(),
  ],
});


function formatMessage(message) {
  const keys = ["productCode", "contactPerson", "companyName", "contactPhone", "contactEmail", "customerAwsAccountId", "customerIdentifier" ];
  return keys.filter((k) => k in message).map((k) => `${k}: ${message[k]}`).join("\n") + "\n\nRaw message:\n" + JSON.stringify(message, null, 2);
}


exports.dynamodbStreamHandler = async (event, context) => {
  logger.debug({"event" : event});
  //console.log({ "message" : "Event parameter" , "data" : event});
  await Promise.all(event.Records.map(async (record) => {
    logger.defaultMeta = { requestId: context.awsRequestId };
    const oldImage = record.dynamodb.OldImage ? unmarshall(record.dynamodb.OldImage) : {};
    const newImage = record.dynamodb.NewImage ? unmarshall(record.dynamodb.NewImage) : {};

    // eslint-disable-next-line no-console
    logger.debug( {"message" : "OldImage", "data": oldImage });
    logger.debug( {"message" : "NewImage", "data": newImage });
    
    if (!oldImage || Object.keys(oldImage).length === 0 || !newImage || Object.keys(newImage).length === 0) {
      logger.info('Skipping record - oldImage or newImage is empty');
      return;
    }
    
    let grantAccess = false;
    let revokeAccess = false;
    let entitlementUpdated = false;

    grantAccess = (newImage.successfully_subscribed && newImage.successfully_registered)
    && !(oldImage.successfully_registered && oldImage.successfully_subscribed )
    
    if  (!grantAccess) {
      revokeAccess = newImage.subscription_expired === true
      && !oldImage.subscription_expired;
    }

    if (!grantAccess && !revokeAccess) {
      entitlementUpdated = newImage.entitlement && oldImage.entitlement && (newImage.entitlement !== oldImage.entitlement);
    }
    
    logger.info('grantAccess', { 'data': grantAccess });
    logger.info('revokeAccess', { 'data': revokeAccess });
    logger.info('entitlementUpdated', { 'data': entitlementUpdated });

    if (grantAccess || revokeAccess || entitlementUpdated) {
      let message = '';
      let subject = '';

      // Include productCode and customerAwsAccountId in the subject line
      const subjectSuffix = ["productCode", "customerAwsAccountId"]
        .filter((k) => k in newImage)
        .map((k) => newImage[k])
        .join(" | ");

      const suffix = subjectSuffix ? ` - ${subjectSuffix}` : "";

      if (grantAccess) {
        subject = `AWS Marketplace - New Subscribtion${suffix}`;
        message = `New product subscribtion:\n\n${formatMessage(newImage)}`;
      } else if (revokeAccess) {
        subject = `AWS Marketplace - Unsubscribe${suffix}`;
        message = `Unsubscribe from product:\n\n${formatMessage(newImage)}`;
      } else if (entitlementUpdated) {
        subject = `AWS Marketplace - Subscription Change${suffix}`;
        message = `Product subscription changed:\n\n${formatMessage(newImage)}`;
      }

      // Truncate subject line if it's too long
      const MAX_SUBJECT_LENGTH = 100;
      const truncatedSubject = subject.length > MAX_SUBJECT_LENGTH 
        ? subject.substring(0, MAX_SUBJECT_LENGTH - 3) + '...' 
        : subject;

      const SNSparams = {
        TopicArn,
        Subject: truncatedSubject,
        Message: message,
      };

      logger.info('Sending notification');
      logger.debug('SNSparams', { 'data': SNSparams });
      await sns.send(new PublishCommand(SNSparams));
    }
  }));


  return {};
};
