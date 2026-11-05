# Monitoring and alerts (OPS-11 to OPS-13)

- **Uptime (OPS-11):** an external uptime service calls `https://<host>/api/health` every minute and alerts the developers after 2 failures. Its account is not chosen yet. Test it by stopping `mongo` once; the alert must arrive within 2 minutes.
- **Logs (OPS-12):** pino logs go to Docker's `json-file` driver, rotated at 50 MB × 14 files. The server counts error-level lines (`server/src/lib/errorCounter.js`): more than 20 in 5 minutes emails `OPS_ALERT_EMAIL` once for that burst.
- **Daily ops email (OPS-13):** every day at 08:00 Dhaka time the server emails `OPS_ALERT_EMAIL`: failed background jobs in the last 24 hours (count and job names) and whether ClamAV answers PING. An email is always sent, so a missing one means the server or the job is down.
