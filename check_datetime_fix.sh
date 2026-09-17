#!/usr/bin/env bash
# check_datetime_fix.sh — verify the ISO->MySQL datetime fix is actually
# present in every code path that writes to availableItems, and in the
# image that's currently running.
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE="sweety-sweet_sweety-api"

echo "== 1. every place 'availableItems' is written in source =="
grep -rn "INSERT INTO availableItems\|INTO availableItems\|availableItems (productId" \
  --include=*.js "${SRC_DIR}" | grep -v node_modules || echo "  (no raw INSERTs found)"

echo
echo "== 2. every call site that could feed lastUpdated unformatted =="
grep -rn "lastUpdated" --include=*.js "${SRC_DIR}" | grep -v node_modules

echo
echo "== 3. does formatForMySQL exist, and where =="
grep -rln "formatForMySQL\|toMySqlDateTime" --include=*.js "${SRC_DIR}" | grep -v node_modules

echo
echo "== 4. is addProductRecord a SEPARATE insert path (the suspect) =="
grep -rln "addProductRecord" --include=*.js "${SRC_DIR}" | grep -v node_modules

echo
echo "== 5. what's actually inside the RUNNING container right now =="
CID="$(docker ps -q -f "name=${SERVICE}" | head -n1)"
if [ -z "${CID}" ]; then
  echo "  !! no running task found for ${SERVICE}"
else
  echo "  container: ${CID}"
  docker exec "${CID}" grep -rn "toISOString\|formatForMySQL" /app --include=*.js 2>/dev/null \
    | grep -v node_modules || echo "  !! fix not found inside running container"
fi

echo
echo "== 6. image tag currently deployed vs last built tag =="
docker service inspect "${SERVICE}" --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' 2>/dev/null || true
cat "${SRC_DIR}/deploy/.last_tag" 2>/dev/null || echo "  (no .last_tag file)"
