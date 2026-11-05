# Restore runbook (OPS-09, OPS-10)

RPO: 24 hours with daily backups. RTO: 4 hours. Point-in-time recovery (7 days) is **not set up yet** (decision: self-managed oplog archiving or MongoDB Atlas).

1. Pick the backup: list the off-site copies (`rclone ls <BACKUP_REMOTE>`), newest first.
2. Fetch it and run `sh deploy/backup/restore.sh <file.enc> <scratch-mongo-uri>`. The script refuses any target that is not a scratch host.
3. Start the app against the scratch database and check: sign in, open the dashboard, open the routine, open the audit log.
4. Record the date, the backup used, the time taken and the result in `docs/restore-log.md`.
