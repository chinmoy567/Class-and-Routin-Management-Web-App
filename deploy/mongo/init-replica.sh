#!/bin/sh
# OPS-03: one-time setup of the replica set and the database users.
# Run once after `docker compose up -d mongo`:  sh deploy/mongo/init-replica.sh
# Uses the localhost exception: the first admin user is created from inside the container.
# Needs MONGO_ROOT_PASSWORD, MONGO_APP_PASSWORD and MONGO_BACKUP_PASSWORD in the environment.
set -eu
docker compose exec -T mongo mongosh --quiet --eval '
  try { rs.status() } catch (e) { rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "mongo:27017" }] }) }
'
docker compose exec -T \
  -e MONGO_ROOT_PASSWORD="$MONGO_ROOT_PASSWORD" \
  -e MONGO_APP_PASSWORD="$MONGO_APP_PASSWORD" \
  -e MONGO_BACKUP_PASSWORD="$MONGO_BACKUP_PASSWORD" \
  mongo mongosh --quiet /docker-entrypoint-initdb.d/init-users.js
echo "Replica set and users are ready. Next: set MONGO_URL in deploy/.env.production to the app user."
