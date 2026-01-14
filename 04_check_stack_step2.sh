# Show current and previous task attempts
docker service ps n8n_n8n --no-trunc

# Show only running tasks
docker service ps n8n_n8n --filter "desired-state=running"

# Show failed tasks with full error messages
docker service ps n8n_n8n --filter "desired-state=shutdown" --no-trunc
