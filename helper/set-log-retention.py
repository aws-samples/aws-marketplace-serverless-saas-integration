#!/usr/bin/env python3
"""Set log retention for all log groups in a CloudFormation stack (including nested stacks)."""

import argparse
import boto3

LOG_GROUP_RESOURCE_TYPES = {
    "AWS::Logs::LogGroup",
    "AWS::Lambda::Function",
}


def get_log_groups(cf_client, stack_name):
    """Get all log group names from a stack and its nested stacks."""
    log_groups = []
    paginator = cf_client.get_paginator("list_stack_resources")
    for page in paginator.paginate(StackName=stack_name):
        for resource in page["StackResourceSummaries"]:
            rtype = resource["ResourceType"]
            physical_id = resource["PhysicalResourceId"]
            if rtype == "AWS::Logs::LogGroup":
                log_groups.append(physical_id)
            elif rtype == "AWS::Lambda::Function":
                log_groups.append(f"/aws/lambda/{physical_id}")
            elif rtype == "AWS::CloudFormation::Stack":
                log_groups.extend(get_log_groups(cf_client, physical_id))
    return log_groups


def set_log_retention(logs_client, log_group, retention_days, dry_run=False):
    """Set retention on a log group. Returns True if changed."""
    try:
        resp = logs_client.describe_log_groups(logGroupNamePrefix=log_group)
        groups = [g for g in resp["logGroups"] if g["logGroupName"] == log_group]
        if not groups:
            print(f"  SKIP (not found): {log_group}")
            return False
        current = groups[0].get("retentionInDays")
        if current == retention_days:
            print(f"  OK (already {retention_days}d): {log_group}")
            return False
        if dry_run:
            print(f"  WOULD SET {current or 'never'} -> {retention_days}d: {log_group}")
        else:
            logs_client.put_retention_policy(logGroupName=log_group, retentionInDays=retention_days)
            print(f"  SET {current or 'never'} -> {retention_days}d: {log_group}")
        return True
    except Exception as e:
        print(f"  ERROR: {log_group}: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="Set log retention for all log groups in a CloudFormation stack")
    parser.add_argument("--stack-name", required=True, help="CloudFormation stack name")
    parser.add_argument("--retention-days", type=int, default=7,
                        choices=[1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653],
                        help="Retention period in days (default: 7)")
    parser.add_argument("--region", default=None, help="AWS region")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be changed without applying")
    args = parser.parse_args()

    session = boto3.Session(region_name=args.region)
    cf_client = session.client("cloudformation")
    logs_client = session.client("logs")

    print(f"Finding log groups in stack '{args.stack_name}'...")
    log_groups = get_log_groups(cf_client, args.stack_name)
    # Deduplicate (a Lambda and its explicit LogGroup may overlap)
    log_groups = sorted(set(log_groups))
    print(f"Found {len(log_groups)} log group(s)\n")

    changed = 0
    for lg in log_groups:
        if set_log_retention(logs_client, lg, args.retention_days, args.dry_run):
            changed += 1

    action = "Would update" if args.dry_run else "Updated"
    print(f"\n{action} {changed}/{len(log_groups)} log group(s) to {args.retention_days} day retention")


if __name__ == "__main__":
    main()
