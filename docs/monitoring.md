# Monitoring and alerts (OPS-11 to OPS-13)

- **Uptime (OPS-11):** an external uptime service calls `https://<host>/api/health` every minute and alerts the developers after 2 failures. Its account is not chosen yet. Test it by stopping `mongo` once; the alert must arrive within 2 minutes.
- **Logs (OPS-12):** pino logs go to Docker's `json-file` driver, rotated at 50 MB × 14 files. `server/src/lib/errorCounter.js` counts error-level lines; the alert wiring (pino hook and an email to the developers) is not done yet.
- **Daily ops email (OPS-13):** failed Agenda jobs and a ClamAV that is down. Not built yet; ClamAV health is also shown by the compose healthcheck.
