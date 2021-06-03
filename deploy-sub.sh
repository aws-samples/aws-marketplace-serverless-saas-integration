#!/bin/sh
sam build
sam package --output-template-file packaged.yaml --s3-bucket awsmp-saas-example.com-sam

sam deploy --template-file packaged.yaml --stack-name awsmp-saas-subscription --capabilities CAPABILITY_IAM \
--region us-east-1 \
--parameter-overrides \
ParameterKey=ProductCode,ParameterValue=e7d832j0ttujq0r77gy3s11mm \
ParameterKey=NewSubscribersTableName,ParameterValue=AWSMarketplaceSubscribersSub \
ParameterKey=AWSMarketplaceMeteringRecordsTableName,ParameterValue=AWSMarketplaceMeteringRecordsSub \
ParameterKey=TypeOfSaaSListing,ParameterValue=subscriptions \
ParameterKey=CreateRegistrationWebPage,ParameterValue=false \
ParameterKey=SubscriptionSNSTopic,ParameterValue=arn:aws:sns:us-east-1:287250355862:aws-mp-subscription-notification-e7d832j0ttujq0r77gy3s11mm \


sam deploy --template-file packaged.yaml --stack-name WUPHFdemoSumeetcont01 --capabilities CAPABILITY_IAM \
--region us-east-1 \
--parameter-overrides \
ParameterKey=ProductCode,ParameterValue=2p409vwjybxwn3pd5tcrz4xbw \
ParameterKey=NewSubscribersTableName,ParameterValue=AWSMarketplaceSubscribersDemoSumeet01 \
ParameterKey=AWSMarketplaceMeteringRecordsTableName,ParameterValue=AWSMarketplaceMeteringRecordsDemoSumeet01 \
ParameterKey=WebsiteS3BucketName,ParameterValue=sgujaran-wuphfcont01 \
ParameterKey=EntitlementSNSTopic,ParameterValue=arn:aws:sns:us-east-1:287250355862:aws-mp-entitlement-notification-2p409vwjybxwn3pd5tcrz4xbw \
ParameterKey=MarketplaceTechAdminEmail,ParameterValue=sgujaran@amazon.com \
ParameterKey=TypeOfSaaSListing,ParameterValue=contracts