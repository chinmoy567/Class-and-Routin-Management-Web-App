# Tech Stack

The decided stack for the Class & Routine Management web app is **MERN**: MongoDB, Express, React and Node.js. The whole project is written in **JavaScript only (no TypeScript)**, and the back end uses only Node.js and MongoDB, with no other database, cache or queue server.

## Front end

| Concern | Choice | Notes |
|---|---|---|
| Framework | React 19 + Vite | Single-page app, installable on the home screen (PWA) |
| Language | JavaScript (ES modules, `.jsx` for components) | No TypeScript |
| Styling | Tailwind CSS | Mobile first |
| UI components | shadcn/ui (Radix UI underneath) | Accessible dialogs, tables, forms, menus |
| Routing | React Router | |
| Server data | TanStack Query | Caching and refetching against the REST API |
| Forms + validation | React Hook Form + Zod | |
| Real-time | Socket.IO client | Chat and "something changed" events |
| PWA | vite-plugin-pwa | |

## Back end

| Concern | Choice | Notes |
|---|---|---|
| Runtime | Node.js 24 LTS | |
| Framework | Express | REST API, organised as modules (see Structure) |
| Language | JavaScript (ES modules) | No TypeScript |
| Database | MongoDB 7+ (replica set) | A replica set is required for multi-document transactions |
| ODM | Mongoose | Schemas, validation and indexes |
| Validation | Zod | Same schemas as the front end where possible |
| Auth | Sessions stored in MongoDB (`express-session` + `connect-mongo`), HTTP-only cookies | Central `can(user, action, resource)` policy check |
| Password hashing | argon2 | |
| Rate limiting | `express-rate-limit` with a MongoDB store | |
| Real-time | Socket.IO | Chat and push events only. Everything else is REST |
| Background jobs | Agenda (jobs stored in MongoDB) | Booking expiry, claim escalation, email digests, retention purge, semester rollover |
| File storage | MongoDB GridFS | Chat files and routine uploads |
| Malware scanning | ClamAV | Required by the PRD's file rules; files are scanned by a background job before they become available |
| Excel import | ExcelJS | Routine `.xlsx` import |
| Email | Nodemailer (SMTP provider such as Brevo or Amazon SES) | |
| Logging | pino | |

## How the PRD's data rules map to MongoDB

The PRD was written assuming PostgreSQL. These are the MongoDB equivalents:

| PRD rule | MongoDB approach |
|---|---|
| No double-booking of a room (Postgres exclusion constraint) | A `room_slot_lock` collection with a **unique index on (room, date, time block)**. Approving a booking inserts its locks inside a transaction, so a clash fails the insert |
| At most one current semester, one accepted enrolment per user per semester, one approved UV ID | **Partial unique indexes** (`partialFilterExpression`) |
| "First action wins" decisions | Conditional updates: `findOneAndUpdate({ _id, status: 'pending' }, …)`. If nothing matches, the decision was already taken |
| 3-request limit, approve + cancel overlapping requests together | Multi-document **transactions** (needs the replica set) |
| Append-only audit log | The app's database user has only `insert` and `find` rights on `audit_log` |
| Encrypted email/phone + HMAC lookup | Encrypted fields plus a unique index on `email_hmac` |
| Institution time (`Asia/Dhaka`) | All times are computed on the server in `Asia/Dhaka` using date-fns-tz |

## Structure

```
client/   React + Vite + Tailwind + shadcn/ui
server/   Node.js + Express + Mongoose
  src/modules/  auth, organisation, routine, calendar, rooms, chat, notifications, audit
```

## Quality

| Concern | Choice |
|---|---|
| Tests | Vitest (client and server), Supertest (API), mongodb-memory-server (test database) |
| Browser end-to-end tests | Playwright |
| Lint / format | ESLint + Prettier |
| CI | GitHub Actions: lint, test, build |

## Hosting

One VPS or university VM running Docker Compose with the server, the built client (served by Caddy with HTTPS) and MongoDB as a replica set. MongoDB Atlas is an alternative to running MongoDB yourself. Database backups are kept off the server.
