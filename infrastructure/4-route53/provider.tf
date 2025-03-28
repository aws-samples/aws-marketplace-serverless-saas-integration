provider "aws" {
  region = "us-east-1"
  default_tags {
    tags = {
      Environment = "dev"
      Service     = "dev/4-route53"
      Repository  = "aws-marketplace-serverless-saas-integration"
    }
  }
}
