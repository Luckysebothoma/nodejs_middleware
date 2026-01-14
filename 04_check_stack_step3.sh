# Follow logs in real-time (if service is running)
docker service logs n8n_n8n -f

# Show last 100 lines
docker service logs n8n_n8n --tail 100

# Show logs with timestamps
docker service logs n8n_n8n --timestamps

# If logs seem "hung", press Ctrl+C and try:
docker service logs n8n_n8n --tail 50 --no-trunc
