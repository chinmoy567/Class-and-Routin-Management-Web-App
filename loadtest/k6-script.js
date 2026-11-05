/* global __ENV, __VU */
// OPS-14: load test for a release. Run from a developer machine, never from the server.
//   k6 run -e BASE_URL=https://<host> -e ACCOUNT_TEMPLATE='loadtest{n}@<test domain>' \
//          -e ACCOUNT_COUNT=2000 -e PASSWORD=<test password> loadtest/k6-script.js
// Needs k6 on the developer machine (not an npm dependency). Use seeded test accounts only.
// ACCOUNT_TEMPLATE is the email with {n} for the account number (1..ACCOUNT_COUNT). Each virtual
// user signs in as its own account, so the login throttle is not hit by one account.
// Thresholds are the OPS-14 targets: server time p95 for dashboard and routine < 300 ms,
// free-room view p95 < 500 ms, and no failed requests.
import http from 'k6/http';
import { check, sleep, fail } from 'k6';

const base = __ENV.BASE_URL;
const template = __ENV.ACCOUNT_TEMPLATE;
const count = Number(__ENV.ACCOUNT_COUNT || 2000);
const password = __ENV.PASSWORD;
const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const options = {
  scenarios: {
    sign_in_burst: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '5m', target: count }, // 2,000 people within 5 minutes
        { duration: '5m', target: count },
      ],
      exec: 'session',
    },
    sustained_rps: {
      executor: 'constant-arrival-rate',
      rate: 100, // 100 requests per second sustained
      timeUnit: '1s',
      duration: '10m',
      preAllocatedVUs: 200,
      maxVUs: 400,
      exec: 'readRoutine',
    },
  },
  thresholds: {
    'http_req_duration{name:dashboard}': ['p(95)<300'],
    'http_req_duration{name:routine}': ['p(95)<300'],
    'http_req_duration{name:free_rooms}': ['p(95)<500'],
    http_req_failed: ['rate==0'],
  },
};

// Per virtual user: the account is fixed, and the session cookie stays in k6's cookie jar.
let signedIn = false;

/** FND-28: sign-in is a POST, so it needs the CSRF token from the session first. */
function signIn() {
  const email = template.replace('{n}', String(((__VU - 1) % count) + 1));
  const token = http.get(`${base}/api/auth/csrf`, { tags: { name: 'csrf' } });
  const csrf = token.json('data.token');
  if (!csrf) fail('no CSRF token from /api/auth/csrf');
  const login = http.post(
    `${base}/api/auth/login`,
    JSON.stringify({ email, password }),
    { headers: { ...JSON_HEADERS, 'X-CSRF-Token': csrf }, tags: { name: 'login' } },
  );
  signedIn = check(login, { 'signed in': (r) => r.status === 200 });
  return signedIn;
}

export function session() {
  if (!signIn()) return;
  const headers = { 'X-CSRF-Token': http.get(`${base}/api/auth/csrf`).json('data.token') };
  check(http.get(`${base}/api/me/dashboard`, { tags: { name: 'dashboard' } }), {
    'dashboard ok': (r) => r.status === 200,
  });
  check(http.get(`${base}/api/me/routine`, { tags: { name: 'routine' } }), {
    'routine ok': (r) => r.status === 200,
  });
  check(
    http.get(`${base}/api/rooms/availability?date=2027-04-04&from=480&to=540`, {
      headers,
      tags: { name: 'free_rooms' },
    }),
    { 'free rooms ok': (r) => r.status === 200 },
  );
  sleep(1);
}

export function readRoutine() {
  if (!signedIn && !signIn()) return;
  http.get(`${base}/api/me/routine`, { tags: { name: 'routine' } });
}
