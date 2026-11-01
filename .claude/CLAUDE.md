# CLAUDE.md

Class & Routine Management is a web app for one university (BAIUST). Teachers and students sign in, keep a profile, chat one-to-one and in a section group, read their class routine, and request free classrooms. A super admin and per-department admins run it.

## Source of truth

- **What to build:** `DOCUMENTS/Class and Routine Management - PRD.md`. Read the relevant section before building any feature. Every acceptance criterion in it must become an automated test.
- **What to build it with:** `DOCUMENTS/tech-stack.md`. If it conflicts with the PRD, `tech-stack.md` wins.
- **Diagrams:** `DOCUMENTS/svg/` (Mermaid source in `DOCUMENTS/src/`). Check the state, sequence and ER diagrams before touching onboarding, booking, import or rollover.
- **Open questions:** the PRD's "Open questions" section. Don't build anything an open question blocks. Ask instead.

## Stack (fixed, don't change it)

- **MERN, JavaScript only.** No TypeScript, no `.ts`/`.tsx` files, no JSDoc-as-types tooling. ES modules everywhere (`import`/`export`, `"type": "module"`).
- **Front end:** React 19 + Vite, Tailwind CSS, shadcn/ui, React Router, TanStack Query, React Hook Form + Zod, Socket.IO client, vite-plugin-pwa.
- **Back end:** Node.js 24, Express, MongoDB 7+ (replica set) with Mongoose, Zod, `express-session` + `connect-mongo`, argon2, Agenda, GridFS, ClamAV, ExcelJS, Nodemailer, pino.
- **Only Node.js and MongoDB on the back end.** No PostgreSQL, Redis, RabbitMQ, S3 or any other server. Sessions, rate limits, jobs and files all live in MongoDB.
- **Don't add a library that isn't in `tech-stack.md` without asking first.** That includes animation, 3D and state-management libraries.

## Structure

```
client/                 React + Vite + Tailwind + shadcn/ui
server/
  src/modules/          one folder per module:
                        auth, organisation, routine, calendar, rooms, chat, notifications, audit
```

This is a modular monolith. A module talks to another module only through that module's exported service functions, never by reading its collections directly. No microservices.

## Commands

Three npm workspaces (`client/`, `server/`, `shared/`). Run everything from the repo root. Node 24.

- Install: `npm install`
- Start MongoDB (replica set): the server refuses to start without one. Run a local `mongod --replSet rs0` and `rs.initiate()` once, then set `MONGO_URL=mongodb://localhost:27017/crm?replicaSet=rs0` in `server/.env` (copy from `.env.example`). Tests need nothing running: they start their own in-memory replica set.
- Run server / client: `npm run dev:server` / `npm run dev:client` (the client proxies `/api` and `/socket.io` to port 4000)
- First super admin: `npm run seed:super-admin -- --email <e> --name <n>`
- Test / lint / build: `npm test`, `npm run lint`, `npm run build` (each also works per workspace, e.g. `npm test -w @crm/server`). `npm run format:check` for Prettier.
- Browser tests: `npm run test:e2e -w @crm/client` (Playwright; builds and serves the client; run only when needed)

## Rules that must never be broken

These come from the PRD. If one of them gets in the way, stop and ask. Don't work around it.

**Authorization**
- Every protected action goes through the central `can(user, action, resource)` policy function on the server. Never rely on hiding things in the UI.
- Checks cover the **account state**, the **role** and the **scope** (department, section, semester). A department admin acts only on their own department.
- "Sections a teacher teaches" is always worked out on the server from the routine, never taken from the request.
- Account states (`email_unverified`, `claim_pending`, `active`, `unconfirmed`, `graduated`, `deactivated`, plus the teacher states `pending` and `suspended`) decide what the server allows. Follow the PRD's "What each state can use" table exactly.

**Time**
- All logic runs in `Asia/Dhaka` institution time, computed on the server with date-fns-tz. Store times in UTC. Never hard-code `+6` and never trust the device clock.
- A week runs Sunday 00:00 to Saturday 23:59.

**Data integrity (MongoDB)**
- No double-booking: the `room_slot_lock` collection has a unique index on `(room_id, date, block_start)`. Approving a booking inserts its locks inside a transaction.
- "At most one" and "unique where" rules use **partial unique indexes** (`partialFilterExpression`): one current semester, one accepted enrolment per user per semester, one approved UV ID.
- "First action wins" decisions (join requests, ID claims, room requests) use a conditional `findOneAndUpdate({ _id, status: 'pending' }, …)`. If nothing matches, return "already decided".
- The 3-request limit and booking approval (approve, insert locks, cancel or reject overlapping requests) each run in **one transaction**.
- `audit_log` is append-only: only insert and find, never update or delete. Log every action the PRD's "Auditability" list names.

**Privacy and security**
- Email and phone are stored encrypted (`email_enc`, `phone_enc`). Look up accounts by `email_hmac` (HMAC-SHA256 of the lower-cased email). Keep keys outside the database.
- Only the owner sees their own email and phone. The two exceptions are in the PRD's Privacy rule. Never return them in rosters, profiles, chat or admin lists.
- Passwords are hashed with argon2id. Admin accounts need the second step at every sign-in.
- CSRF protection on every state-changing request. HTTP-only session cookies.
- Uploaded files are not available until ClamAV has scanned them.
- Admins can never read users' private messages.

**Real-time**

- Socket.IO is for chat and "something changed" push events only (`routine.changed`, `booking.changed`, `calendar.changed`, `message.new`, `message.status`). Everything else is REST.

## Conventions

- Validate every request body, query and param with Zod. Share schemas between client and server where you can.
- Mongoose models declare their indexes in the schema, including partial unique indexes.
- Keep all user-facing text in a translation file (English now, Bangla later). No hard-coded strings in components.
- Mobile first, at least 360 px wide, WCAG 2.1 AA.
- Use pino for logging. Never log passwords, tokens, email addresses or phone numbers.

## Testing

- Vitest on client and server, Supertest for the API, mongodb-memory-server (as a replica set, so transactions work) for the test database, Playwright for end-to-end tests.
- Every PRD acceptance criterion gets a test.
- Every role gets tests that try to reach another section's or department's data and must be refused.
- Concurrency rules (double-booking, first action wins, the 3-request limit) get tests that send requests at the same time.

## How to work

- Do only what is asked. Don't scaffold, refactor or add features beyond the request.
- For a change that touches several files or modules, say the plan first.
- Write the tests together with the code, not afterwards.
- Keep commits small and about one thing. Commit only when asked.
