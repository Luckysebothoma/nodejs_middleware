#!/usr/bin/env bash
# sweetyctl.sh — build, push, and run sweety-api on Docker Swarm
# usage: ./sweetyctl.sh <init|build|push|up|down|restart|logs|ls|ps|status|deploy> [args]
set -euo pipefail

# ---- config ---------------------------------------------------------------
REGISTRY="192.168.0.140:5000"
IMAGE="sweety-api"
STACK="sweety-sweet"
SERVICE="${STACK}_sweety-api"
NETWORK="databases"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="${SRC_DIR}/deploy"          # generated build/stack artifacts live here, separate from source
TAG_FILE="${DEPLOY_DIR}/.last_tag"

mkdir -p "${DEPLOY_DIR}"

log()  { echo -e "==> $*"; }
die()  { echo "!! $*" >&2; exit 1; }

# ---- write: Dockerfile + stack file (the "fix") ----------------------------
write_dockerfile() {
  cat > "${SRC_DIR}/Dockerfile" <<'EOF'
FROM node:22

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN chown -R node:node /app
USER node

EXPOSE 8080
EXPOSE 8443

CMD ["node", "index.js"]
EOF
  log "wrote ${SRC_DIR}/Dockerfile"
}

write_stack() {
  cat > "${DEPLOY_DIR}/docker-stack.yml" <<EOF
version: "3.8"

networks:
  ${NETWORK}:
    external: true

services:
  sweety-api:
    image: ${REGISTRY}/${IMAGE}:\${IMAGE_TAG:-latest}
    env_file:
      - ${SRC_DIR}/.env
    environment:
      - TZ=Africa/Johannesburg
    volumes:
      - ${SRC_DIR}/edge_reasume_certs:/certs:ro
    ports:
      - 8183:8443
      - 8193:8080
    networks:
      - ${NETWORK}
    deploy:
      replicas: 1
      restart_policy:
        condition: on-failure
      update_config:
        order: start-first
        failure_action: rollback
EOF
  log "wrote ${DEPLOY_DIR}/docker-stack.yml"
}

# ---- init -------------------------------------------------------------------
cmd_init() {
  [ -f "${SRC_DIR}/.env" ] || die ".env not found in ${SRC_DIR} — required by the stack file"

  write_dockerfile
  write_stack

  local swarm_state
  swarm_state="$(docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null || echo inactive)"
  if [ "${swarm_state}" != "active" ]; then
    log "swarm not active — initializing"
    docker swarm init
  else
    log "swarm already active"
  fi

  if ! docker network ls --format '{{.Name}}' | grep -qx "${NETWORK}"; then
    log "creating overlay network '${NETWORK}'"
    docker network create -d overlay --attachable "${NETWORK}"
  else
    log "network '${NETWORK}' already exists"
  fi

  if ! grep -q "${REGISTRY}" /etc/docker/daemon.json 2>/dev/null; then
    log "WARNING: ${REGISTRY} not found in /etc/docker/daemon.json insecure-registries."
    log "         Add it on every node that builds/pulls, then: sudo systemctl restart docker"
    log '         { "insecure-registries": ["'"${REGISTRY}"'"] }'
  fi

  log "init complete"
}

# ---- build / push -------------------------------------------------------------
cmd_build() {
  local git_sha tag
  git_sha="$(git -C "${SRC_DIR}" rev-parse --short HEAD 2>/dev/null || echo nogit)"
  tag="$(date +%Y%m%d-%H%M%S)-${git_sha}"
  local full="${REGISTRY}/${IMAGE}:${tag}"

  log "building ${full}"
  docker build --no-cache \
    -t "${full}" \
    -t "${REGISTRY}/${IMAGE}:latest" \
    "${SRC_DIR}"

  echo "${tag}" > "${TAG_FILE}"
  log "built and tagged: ${tag} (also tagged latest)"
}

cmd_push() {
  [ -f "${TAG_FILE}" ] || die "no build found — run './sweetyctl.sh build' first"
  local tag full
  tag="$(cat "${TAG_FILE}")"
  full="${REGISTRY}/${IMAGE}:${tag}"

  log "pushing ${full}"
  docker push "${full}"
  docker push "${REGISTRY}/${IMAGE}:latest"
}

# ---- up / down / restart -------------------------------------------------------
cmd_up() {
  [ -f "${TAG_FILE}" ] || die "no build found — run './sweetyctl.sh build' first"
  local tag
  tag="$(cat "${TAG_FILE}")"

  log "deploying ${STACK} with image tag ${tag}"
  IMAGE_TAG="${tag}" docker stack deploy -c "${DEPLOY_DIR}/docker-stack.yml" "${STACK}" --with-registry-auth

  log "waiting for rollout"
  docker service update --image "${REGISTRY}/${IMAGE}:${tag}" "${SERVICE}" --detach=false || true
  docker service ps "${SERVICE}" --no-trunc
}

cmd_down() {
  log "removing stack ${STACK}"
  docker stack rm "${STACK}"
}

cmd_restart() {
  log "forcing rolling restart of ${SERVICE}"
  docker service update --force "${SERVICE}"
}

# ---- deploy: build + push + up in one shot -------------------------------------
cmd_deploy() {
  cmd_build
  cmd_push
  cmd_up
}

# ---- inspection -----------------------------------------------------------------
cmd_logs() {
  docker service logs -f --tail 100 "${SERVICE}"
}

cmd_ls() {
  docker stack services "${STACK}"
}

cmd_ps() {
  docker service ps "${SERVICE}" --no-trunc
}

cmd_status() {
  echo "-- stack --"
  docker stack services "${STACK}" 2>/dev/null || echo "  (stack '${STACK}' not deployed)"
  echo "-- tasks --"
  docker service ps "${SERVICE}" --no-trunc 2>/dev/null || echo "  (service '${SERVICE}' not found)"
  echo "-- last built tag --"
  cat "${TAG_FILE}" 2>/dev/null || echo "  (none)"
}

# ---- dispatch -------------------------------------------------------------------
cmd="${1:-}"
shift || true
case "${cmd}" in
  init)    cmd_init ;;
  build)   cmd_build ;;
  push)    cmd_push ;;
  up)      cmd_up ;;
  down)    cmd_down ;;
  restart) cmd_restart ;;
  deploy)  cmd_deploy ;;
  logs)    cmd_logs ;;
  ls)      cmd_ls ;;
  ps)      cmd_ps ;;
  status)  cmd_status ;;
  *)
    cat <<USAGE
usage: $0 <command>

  init      write Dockerfile + deploy/docker-stack.yml, init swarm, create network, check registry config
  build     docker build, tag with timestamp+git-sha and 'latest'
  push      push both tags to ${REGISTRY}
  up        stack deploy using the last built tag
  down      docker stack rm ${STACK}
  restart   force a rolling restart of the running service
  deploy    build + push + up
  logs      follow service logs
  ls        docker stack services ${STACK}
  ps        docker service ps ${SERVICE}
  status    quick summary of stack, tasks, and last built tag
USAGE
    exit 1
    ;;
esac
