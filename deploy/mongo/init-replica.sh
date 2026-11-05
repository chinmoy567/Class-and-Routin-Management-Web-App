#!/bin/sh
# OPS-03: one-time setup of the replica set and the database users. Run from the repo root:
#   sh deploy/mongo/init-replica.sh
# Needs the stack's mongo container up. MONGO_APP_PASSWORD and MONGO_BACKUP_PASSWORD must be set in
# the environment (passed into the container). The container's own root password is used to log in.
# Passwords must be URL-safe (letters and digits): they go into MONGO_URL. `openssl rand -hex 24`.
set -eu
: "${MONGO_APP_PASSWORD:?set MONGO_APP_PASSWORD}"
: "${MONGO_BACKUP_PASSWORD:?set MONGO_BACKUP_PASSWORD}"
COMPOSE="docker compose -f deploy/docker-compose.yml"

# Feed each script to mongosh on stdin; -T keeps stdin a plain pipe (no TTY).
$COMPOSE exec -T mongo sh -c 'mongosh --quiet -u root -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin' < deploy/mongo/init-replica.js
$COMPOSE exec -T -e MONGO_APP_PASSWORD -e MONGO_BACKUP_PASSWORD mongo \
  sh -c 'mongosh --quiet -u root -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin' < deploy/mongo/init-users.js
echo "Replica set and users are ready. Put the app user's password in MONGO_URL (see docs/deploy.md)."
