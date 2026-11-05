# Operations checks (spec 23 acceptance tests)

Run these on the real server. None of them can run in the test suite.

1. From outside: `nmap -p 27017 <host>` shows closed.
2. As `crm_app`: `db.audit_log.updateOne({}, {$set:{x:1}})` and `db.audit_log.deleteOne({})` are refused.
3. `curl -I http://<host>` redirects to HTTPS; the HTTPS response has `Strict-Transport-Security`.
4. Restore last night's backup into a scratch server; the app works (`docs/restore-runbook.md`).
5. Stop `mongo`; the uptime alert arrives within 2 minutes.
6. The load test passes the OPS-14 thresholds (`loadtest/README.md`).
