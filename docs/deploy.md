# Deploying (OPS-06)

**First time on a new server**
1. Install Docker and Compose. Create the directory and copy `deploy/` and the compose file.
2. Create `deploy/mongo-keyfile` (`openssl rand -base64 756 > deploy/mongo-keyfile && chmod 400 deploy/mongo-keyfile`).
3. Copy `deploy/.env.production.example` to `deploy/.env.production`, fill it in, `chmod 600` it (OPS-04).
4. `docker compose -f deploy/docker-compose.yml --env-file deploy/.env.production up -d mongo`
5. `sh deploy/mongo/init-replica.sh` (replica set, users, audit-log role). Then bring up the rest.
6. Install the backup cron entry from `deploy/backup/crontab` once the off-site destination is chosen.

**Each release** (outside teaching hours: 07:00–18:00 Sunday–Thursday is protected)
1. Merge to `main`. GitHub Actions builds the images tagged with the commit SHA (`.github/workflows/images.yml`).
2. On the server: set `IMAGE_TAG=<sha>` in `deploy/.env.production`, then
   `docker compose -f deploy/docker-compose.yml --env-file deploy/.env.production pull && docker compose -f deploy/docker-compose.yml --env-file deploy/.env.production up -d`
3. Run pending migrations: `docker compose ... exec server node server/scripts/migrate.js` (OPS-07).
4. Check `https://<host>/api/health`, then run the load test before the release is final (`loadtest/README.md`).

Rollback: set `IMAGE_TAG` back to the previous SHA and run step 2 again.
