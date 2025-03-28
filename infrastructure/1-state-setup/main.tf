module "terraform_state_backend" {
  source                      = "cloudposse/tfstate-backend/aws"
  version                     = "1.5.0"
  namespace                   = "edge-marketplace"
  environment                 = "dev"
  name                        = "terraform-state"
  deletion_protection_enabled = true
}

provider "aws" {
  region = "us-east-1"
  # assume_role {
  #   role_arn = var.role_arn
  # }
  default_tags {
    tags = {
      Environment = "dev"
      Service     = "dev/1-remote-state"
      Repository  = "aws-marketplace-serverless-saas-integration"
    }
  }
}

# variable "role_arn" {
#   description = "The ARN of the role to assume"
#   type = string
#   default = "arn"
# }

resource "aws_s3_bucket" "marketplace_terraform_state" {
  bucket = "edge-marketplace-terraform-state-dev"
  tags = {
    Environment = "dev"
    Service     = "dev/1-remote-state"
    Repository  = "aws-marketplace-serverless-saas-integration"
  }
}

resource "aws_dynamodb_table" "marketplace_terraform_lock_state" {
  name         = "edge_marketplace_terraform_lock_state_dev"
  read_capacity = 1
  write_capacity = 1
  hash_key     = "LockID"
  attribute {
    name = "LockID"
    type = "S"
  }
}

terraform {
  backend "s3" {
    bucket         = "edge-marketplace-terraform-state-dev"
    key            = "remote-state/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "marketplace_terraform_lock_state"
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