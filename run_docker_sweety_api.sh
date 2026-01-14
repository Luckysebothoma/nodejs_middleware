#!/bin/bash

# Define environment variables
export TZ="Africa/Johannesburg"
export PGUSER="${Postgres_User}"
export PGHOST="${Postgres_HOST}"
export PGDATABASE="${Postgres_DATABASE}"
export PGPASSWORD="${Postgres_PASSWORD}"
export PGPORT="${Postgres_PORT}"
export MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD}"
export MYSQL_DATABASE="${MYSQL_DATABASE}"
export MYSQL_USER="${MYSQL_USER}"
export MYSQL_PASSWORD="${MYSQL_PASSWORD}"
export MYSQL_HOST="${MYSQL_HOST}"
export MYSQL_PORT="${MYSQL_PORT}"

# Create the Docker network if it doesn't exist
docker network ls | grep -q "sweety-sweet-network-bridge"
if [ $? -ne 0 ]; then
  docker network create --driver bridge sweety-sweet-network-bridge
  echo "Network 'sweety-sweet-network-bridge' created."
else
  echo "Network 'sweety-sweet-network-bridge' already exists."
fi

# Build and run the container
docker build -t sweety-api-image -f Dockerfile .

docker run -d \
  --name sweety-api-container \
  --network sweety-sweet-network-bridge \
  -v "$(pwd):/app" \
  -v "/certs/:/certs/" \
  -p 8083:8083 \
  -p 5000:5000 \
  --restart unless-stopped \
  -e TZ \
  -e PGUSER \
  -e PGHOST \
  -e PGDATABASE \
  -e PGPASSWORD \
  -e PGPORT \
  -e MYSQL_ROOT_PASSWORD \
  -e MYSQL_DATABASE \
  -e MYSQL_USER \
  -e MYSQL_PASSWORD \
  -e MYSQL_HOST \
  -e MYSQL_PORT \
  sweety-api-image

echo "Container 'sweety-api-container' started successfully."

