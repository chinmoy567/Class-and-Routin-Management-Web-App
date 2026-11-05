# Load test (OPS-14)

Run from a developer machine against a test copy of the server, with test accounts only.

    k6 run -e BASE_URL=https://<host> -e EMAIL=<test account> -e PASSWORD=<test password> loadtest/k6-script.js

Targets: dashboard and routine p95 < 300 ms server time, free-room view p95 < 500 ms, chat delivery p95 < 2 s (chat is not in the script yet), no errors. The script needs `k6` on the developer machine; it is not an npm dependency. Confirm you want k6 before running it (CLAUDE.md: no unlisted tools without asking).
