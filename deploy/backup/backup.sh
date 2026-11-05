#!/bin/sh
# OPS-08: daily full backup (mongodump --oplog, GridFS included), encrypted, copied off the server,
# kept 30 days. Run at 02:30 from cron (see deploy/backup/crontab). Logs counts and paths only.
#
# Needs in the environment: BACKUP_MONGO_URI (crm_backup user), BACKUP_PASSPHRASE_FILE (root-only
# file), BACKUP_DIR, and BACKUP_REMOTE (an rclone remote, for example "offsite:crm-backups").
# BACKUP_REMOTE is not chosen yet (spec 23 open question): the script refuses to run without it.
set -eu
: "${BACKUP_MONGO_URI:?set BACKUP_MONGO_URI}"
: "${BACKUP_PASSPHRASE_FILE:?set BACKUP_PASSPHRASE_FILE}"
: "${BACKUP_DIR:=/var/backups/crm}"
: "${BACKUP_REMOTE:?set BACKUP_REMOTE (off-server destination is an open decision)}"
RETAIN_DAYS=30

stamp=$(date -u +%Y-%m-%dT%H%M%SZ)
mkdir -p "$BACKUP_DIR"
raw="$BACKUP_DIR/crm-$stamp.archive.gz"
enc="$raw.enc"

mongodump --uri="$BACKUP_MONGO_URI" --oplog --gzip --archive="$raw"
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
  -in "$raw" -out "$enc" -pass "file:$BACKUP_PASSPHRASE_FILE"
rm -f "$raw"

rclone copy "$enc" "$BACKUP_REMOTE"
# Local and remote copies older than the retention period are removed.
find "$BACKUP_DIR" -name 'crm-*.archive.gz.enc' -mtime +$RETAIN_DAYS -delete
rclone delete "$BACKUP_REMOTE" --min-age "${RETAIN_DAYS}d"
echo "backup ok: $(basename "$enc") ($(wc -c < "$enc") bytes)"
