docker stack services api-stack
# View api-stack logs
docker service logs api-stack_api-stack -f

# View postgres logs
docker service logs api-stack_sweety-api -f
