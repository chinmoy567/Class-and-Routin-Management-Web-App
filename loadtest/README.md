# Load test (OPS-14)

Run from a developer machine against a test copy of the server, with seeded test accounts only.

    k6 run -e BASE_URL=https://<host> -e ACCOUNT_TEMPLATE='loadtest{n}@<test domain>' \
           -e ACCOUNT_COUNT=2000 -e PASSWORD=<test password> loadtest/k6-script.js

- The accounts `loadtest1` … `loadtest2000` must exist, be active, and have a routine.
- Targets: dashboard and routine p95 < 300 ms server time, free-room view p95 < 500 ms, no failed requests.
- Chat delivery p95 < 2 s (OPS-14) is not in this script yet: it needs a second WebSocket scenario.
- k6 is a developer tool, not an npm dependency. Confirm it is allowed before running it (CLAUDE.md).
