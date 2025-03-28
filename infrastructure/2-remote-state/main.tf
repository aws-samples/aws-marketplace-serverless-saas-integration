provider "aws" {
  region = "us-east-1"
  # assume_role {
  #   role_arn = var.role_arn
  # }
  default_tags {
    tags = {
      Environment = "dev"
      Service     = "dev/2-remote-state"
      Repository  = "aws-marketplace-serverless-saas-integration"
    }
  }
}

terraform {
  backend "s3" {
    bucket         = "edge-marketplace-terraform-state-dev"
    key            = "remote-state/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "edge_marketplace_terraform_lock_state_dev"
    encrypt        = true
  }
  required_version = ">= 1.8.2"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "5.81.0"
    }
  }
}