#!/bin/bash

if [ $# -ne 2 ]; then
    echo "Usage: $0 <log-group-pattern> <search-string>"
    echo "Example: $0 '/aws/lambda' 'error'"
    exit 1
fi

LOG_GROUP_PATTERN="$1"
SEARCH_STRING="$2"
START_TIME=$(date -d '1 hour ago' +%s)
END_TIME=$(date +%s)

# Get all log groups containing the pattern
LOG_GROUPS=$(aws logs describe-log-groups --query "logGroups[?contains(logGroupName, '$LOG_GROUP_PATTERN')].logGroupName" --output text)

if [ -z "$LOG_GROUPS" ]; then
    echo "No log groups found containing: $LOG_GROUP_PATTERN"
    exit 1
fi

echo "Searching for '$SEARCH_STRING' in log groups containing '$LOG_GROUP_PATTERN'"
echo "Time range: $(date -d @$START_TIME) to $(date -d @$END_TIME)"
echo

for LOG_GROUP in $LOG_GROUPS; do
    echo "Querying log group: $LOG_GROUP"
    
    QUERY_ID=$(aws logs start-query \
        --log-group-name "$LOG_GROUP" \
        --start-time $START_TIME \
        --end-time $END_TIME \
        --query-string "fields @timestamp, @message | filter @message like /(?i)$SEARCH_STRING/ | sort @timestamp desc | limit 10" \
        --query 'queryId' --output text)
    
    # Wait for query to complete
    sleep 3
    
    # Get results
    RESULTS=$(aws logs get-query-results --query-id "$QUERY_ID" --query 'results' --output json)
    
    if [ "$RESULTS" != "[]" ]; then
        echo "Found matches in $LOG_GROUP:"
        echo "$RESULTS" | jq -r '.[] | "\(.[0].value) | \(.[1].value)"'
        echo
    fi
done
