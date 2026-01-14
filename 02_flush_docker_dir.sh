#mkdir -p /opt/n8n/data
#mkdir -p /opt/n8n/postgres
docker volume rm docker_n8n_data
docker volume rm docker_n8n_postgres

docker volume create docker_n8n_data
docker volume create docker_n8n_postgres
#docker_n8n_postgres
