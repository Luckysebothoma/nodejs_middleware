# Get full service configuration
docker service inspect n8n_n8n --pretty

# Check just the task template
docker service inspect n8n_n8n --format='{{json .Spec.TaskTemplate}}' | jq
