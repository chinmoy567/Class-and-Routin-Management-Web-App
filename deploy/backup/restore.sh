#!/bin/sh
# OPS-10: restore one encrypted backup into a SCRATCH MongoDB, never the live one.
#   sh deploy/backup/restore.sh <backup.archive.gz.enc> <scratch mongo uri>
# Then start the app against the scratch database and check it. Record the result in docs/restore-log.md.
set -eu
[ "$#" -eq 2 ] || { echo "usage: restore.sh <file.enc> <scratch-mongo-uri>"; exit 2; }
: "${BACKUP_PASSPHRASE_FILE:?set BACKUP_PASSPHRASE_FILE}"
case "$2" in *localhost*|*127.0.0.1*|*scratch*) ;; *) echo "refusing: target must be a scratch server"; exit 2;; esac
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$1" -out "$tmp" -pass "file:$BACKUP_PASSPHRASE_FILE"
mongorestore --uri="$2" --oplogReplay --gzip --archive="$tmp" --drop
echo "restore finished into scratch target; now start the app against it and run the smoke checks"
