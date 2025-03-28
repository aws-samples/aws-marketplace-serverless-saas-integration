provider "aws" {
  region = "us-east-1"
  default_tags {
    tags = {
      Environment = "dev"
      Service     = "dev/3-vpc"
      Repository  = "aws-marketplace-serverless-saas-integration"
    }
  }
}
