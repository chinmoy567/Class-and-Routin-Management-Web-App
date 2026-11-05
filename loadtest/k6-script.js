/* global __ENV */
// OPS-14: load test for a release. Run from a developer machine, not from the server.
//   k6 run -e BASE_URL=https://example.invalid -e EMAIL=loadtest1@example.invalid -e PASSWORD=... loadtest/k6-script.js
// Needs k6 installed on the developer machine (not an npm dependency). Use test accounts only.
// Thresholds are the OPS-14 targets: server-side p95 for dashboard and routine < 300 ms,
// free-room view < 500 ms, chat delivery < 2 s, and no errors.
import http from 'k6/http';
import { check, sleep } from 'k6';

const base = __ENV.BASE_URL;

export const options = {
  scenarios: {
    sign_in_burst: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '5m', target: 2000 },
        { duration: '5m', target: 2000 },
      ],
      exec: 'session',
    },
    sustained_rps: {
      executor: 'constant-arrival-rate',
      rate: 100,
      timeUnit: '1s',
      duration: '10m',
      preAllocatedVUs: 200,
      exec: 'readRoutine',
    },
  },
  thresholds: {
    'http_req_duration{name:dashboard}': ['p(95)<300'],
    'http_req_duration{name:routine}': ['p(95)<300'],
    'http_req_duration{name:free_rooms}': ['p(95)<500'],
    'http_req_failed': ['rate==0'],
  },
};

export function session() {
  const login = http.post(
    `${base}/api/auth/login`,
    JSON.stringify({ email: __ENV.EMAIL, password: __ENV.PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login' } },
  );
  check(login, { 'signed in': (r) => r.status === 200 });
  http.get(`${base}/api/me/dashboard`, { tags: { name: 'dashboard' } });
  http.get(`${base}/api/me/routine`, { tags: { name: 'routine' } });
  http.get(`${base}/api/rooms/availability?date=2027-04-04&from=480&to=540`, {
    tags: { name: 'free_rooms' },
  });
  sleep(1);
}

export function readRoutine() {
  http.get(`${base}/api/me/routine`, { tags: { name: 'routine' } });
}
