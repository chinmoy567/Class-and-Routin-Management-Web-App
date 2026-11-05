# Launch checklist (OPS-16, before 4 Apr 2027)

- [ ] Two super admins exist
- [ ] Every launching department has an admin, rooms, a published routine and CRs for all sections
- [ ] Email delivery confirmed (OPS-15, real `@baiust.ac.bd` inbox)
- [ ] A backup and a test restore have succeeded (`docs/restore-log.md`)
- [ ] The uptime check is on and has been tested (OPS-11)
- [ ] The load test has passed the OPS-14 thresholds (`loadtest/README.md`)
- [ ] `/api/health` is up; HTTPS redirect and HSTS checked (OPS-02)
- [ ] Port 27017 is closed from outside (OPS-03)
- [ ] Keys are stored off the server (`docs/key-backup.md`)
