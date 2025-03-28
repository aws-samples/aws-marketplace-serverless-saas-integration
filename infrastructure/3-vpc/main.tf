module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.13.0"

  name = "edge-aws-marketplace-dev"
  cidr = "10.90.0.0/16"

  azs                  = ["us-east-1a", "us-east-1b"]
  private_subnet_names = ["private-us-east-1a", "private-us-east-1b"]
  private_subnets      = ["10.90.1.0/24", "10.90.2.0/24"]


  #Public subnets with routing directly to the internet and public ip are usable
  public_subnet_names = ["public-us-east-1a", "public-us-east-1b"]
  public_subnets      = ["10.90.101.0/24", "10.90.102.0/24"]

  #Database subnets with local routing only no access to the internet
  database_subnet_group_name             = "private-data"
  database_subnets                       = ["10.90.201.0/24", "10.90.202.0/24"]
  create_database_subnet_route_table     = true
  create_database_internet_gateway_route = true //only for dev

  enable_nat_gateway     = true
  one_nat_gateway_per_az = true
}
