# Remove the stack
docker stack rm n8n

# Wait 30 seconds for cleanup
sleep 30

# Verify everything is gone
docker stack ls
docker service ls

# Remove the network
docker network rm n8n-network

# Clean up any orphaned containers
docker container prune -f

# Clean up volumes if needed (WARNING: deletes data)
docker volume prune -f

# Optional: Full system prune (removes unused images, containers, networks)
docker system prune -af
