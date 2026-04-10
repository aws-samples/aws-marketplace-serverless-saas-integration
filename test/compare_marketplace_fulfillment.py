#!/usr/bin/env python3

import boto3
import sys

def compare_fulfillment_urls(stack_name):
    print(f"=== Comparing Fulfillment URLs for Stack: {stack_name} ===\n")
    
    cfn = boto3.client('cloudformation')
    marketplace = boto3.client('marketplace-catalog')
    
    print("Step 1: Retrieving CloudFormation stack details...")
    stack = cfn.describe_stacks(StackName=stack_name)['Stacks'][0]
    print(f"  ✓ Stack found: {stack['StackName']}")
    print(f"  ✓ Stack status: {stack['StackStatus']}\n")
    
    print("Step 2: Extracting ProductId parameter from stack...")
    product_id = next(p['ParameterValue'] for p in stack['Parameters'] if p['ParameterKey'] == 'ProductId')
    print(f"  ✓ ProductId: {product_id}\n")
    
    print("Step 3: Extracting MarketplaceFulfillmentURL output from stack...")
    stack_url = next(o['OutputValue'] for o in stack['Outputs'] if o['OutputKey'] == 'MarketplaceFulfillmentURL')
    print(f"  ✓ Stack Fulfillment URL: {stack_url}\n")
    
    print("Step 4: Retrieving product details from AWS Marketplace...")
    product = marketplace.describe_entity(Catalog='AWSMarketplace', EntityId=product_id)
    print(f"  ✓ Product Type: {product['EntityType']}")
    print(f"  ✓ Product Title: {product['DetailsDocument']['Description']['ProductTitle']}\n")
    
    print("Step 5: Extracting FulfillmentUrl from product configuration...")
    product_url = product['DetailsDocument']['Versions'][0]['DeliveryOptions'][0]['FulfillmentUrl']
    print(f"  ✓ Product Fulfillment URL: {product_url}\n")
    
    print("=== Comparison Result ===")
    print(f"Stack URL:   {stack_url}")
    print(f"Product URL: {product_url}")
    match = stack_url == product_url
    print(f"Match: {'✓ YES' if match else '✗ NO'}")
    
    return match

if __name__ == '__main__':
    if len(sys.argv) != 2:
        print("Usage: python compare_marketplace_fulfillment.py <stack-name>")
        sys.exit(1)
    
    compare_fulfillment_urls(sys.argv[1])
