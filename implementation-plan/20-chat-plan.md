# 20: Chat: implementation plan

## Goal

Build small, safe chat: one-to-one messages between people whose account states allow it, and one automatic group per section per semester. Messages go over REST and are pushed over Socket.IO (ids only). Sent, delivered and seen status for one-to-one messages, unread counts, browser notification hook, and the admin member-restore flow. Section groups are wired to the spec 09, 10 and 14 hooks that already exist.

## Rules and acceptance criteria (numbered)

Who can chat
1. CHT-01: a one-to-one message needs both sides allowed. `active`, `unconfirmed`, `graduated` students; `active` teachers; `active` staff can chat. `claim_pending` students chat only with the CR/DCR of the section of their open join request, and only while it is open. `email_unverified`, `pending`, `deactivated`, `suspended` cannot open chat (`403 STATE_NOT_ALLOWED`).
2. CHT-02: the rules run on every send, not just on open.
3. CHT-02a: all checks go through `can()` with `chat.search`, `chat.open_direct`, `chat.send`, `chat.read`, `chat.delete_own`, `chat.moderate_group`, `chat.restore_member`. Caller's own state fails with `STATE_NOT_ALLOWED`. Other side or conversation fails with `CHAT_NOT_ALLOWED`.

Finding people
4. CHT-03: search by name, at least 2 characters, case-insensitive prefix on any word, at most 20 results. Results carry name, photo, department and role labels (student, teacher, CR, DCR). Never level, term, section, group, UV ID, phone or email. Only people the caller may message.
5. CHT-04: "start chat" works from profile, roster and CR/DCR card. Server side: the endpoint is `POST /api/chat/direct`. Client entry points: see UI.

One-to-one
6. CHT-05: one conversation per pair (unique `pair_key`, sorted ids). Continues across semesters.
7. CHT-06: text 1 to 4,000 characters, server timestamp. Status `sent`, `delivered`, `seen`.
8. CHT-07: sender deletes own message for everyone. Text removed at once, shown as "message deleted" to both sides.

Section groups
9. CHT-08: group created when the first CR of a section in the current semester takes effect (spec 09 hook). Name `CSE 2-II-A · Fall 2026`.
10. CHT-09: owners = CR and DCRs in effect. Members = accepted students of the section (added on acceptance, spec 10 hook; removed on JR-19 removal hook). Teachers never members. Only members read or send.
11. CHT-10: owners delete any group message and remove a member. A removed member can't read or send. Owners can't delete accounts. Owners of section A can't act on section B's group (404).
12. CHT-10a: a removed member files one appeal per removal (text up to 500). Second appeal → `CONFLICT`. Appeal appears in admin's appeals list. Admin restore clears `removed_at`, writes audit, and notifies the member.
13. CHT-10b: owners and the admin of the section's department list members (name, photo, role label, removed flag; never email, phone, UV ID). Ordinary members see current members' names only.
14. CHT-11: a CR/DCR whose role ends stops being an owner; stays a member if still an accepted student.
15. CHT-12: at rollover the old group is closed (no sends, history readable). A new group is created when the new CR takes effect. A student moved to another section joins that section's group on acceptance. An `unconfirmed` student keeps read-only access to their old group.
16. CHT-13: group messages have timestamps only, no delivered/seen.

Real-time and unread
17. CHT-14: send over REST; Socket.IO `message.new` to `user:<other>` (direct) or `conversation:<id>` (group); `message.status` to the sender's `user:<id>` for delivered and seen. Payloads carry ids only.
18. CHT-15: unread counts per conversation and total; opening a conversation marks it read.
19. CHT-16: browser notification for a new message when allowed and the tab is not focused. Never emailed.
20. CHT-17: delivery within 2 s at p95 (load test is spec 23; out of scope here).

Storage and privacy
21. CHT-18: message text encrypted with `encrypt()` (`DATA_ENC_KEY`).
22. CHT-19: no admin endpoint returns message bodies (route scan test).

Socket rooms
23. CHT-20: a socket joins `conversation:<id>` only if a current member. Server joins and leaves rooms; client join requests are ignored. Removal or close makes sockets leave at once. `user:<id>` is only the socket's own user.
24. CHT-21: chat events carry ids only and use `emitAfterCommit`.
25. CHT-22: audit `chat.member_removed`, `chat.member_restored`, `chat.message_deleted_by_owner`. Never log or audit message text.

Other
26. Sending is rate limited to 30 messages per minute per user → `RATE_LIMITED` (429).
27. PRD acceptance (claim_pending message to CR delivered, other refused; unconfirmed delivered).
28. Every role (student, claim_pending student, CR, teacher, dept admin, super admin) trying another pair's conversation → 404.

## Blockers and open questions

- None of the PRD open questions block chat (Q1 concerns mail delivery, Q2 concerns booking, Q3 to Q5 are not chat).
- Spec 22 (block, report, suspension, retention) is out of scope. `BLOCKED` and `CHAT_SUSPENDED` error codes are not returned here.
- Spec 21 (files) is out of scope, so `file_id` is not stored.
- Decision (this plan): owners are derived live from the CR/DCR role in effect (`crDcrOf`), not from a stored role. This covers CHT-11 without a role-end hook. Stored `conversation_member.role` is informational only.
- Decision: the spec 09 hook `runCrAssignedHooks` is currently called only for `cr`. It must also fire for `dcr`, so a DCR becomes an owner of the group. This is a one-line change in `representatives/assign.service.js` (the hook body is idempotent).
- Decision: the CR and DCRs of the section are added as members with role owner. An owner who is also a student of the section stays a member.
- Decision: owners cannot be removed by another owner (`FORBIDDEN`). Owners leave by losing the role (CHT-11).
- Decision: removal and restore notifications use the existing transactional email catalogue only if a template already exists; otherwise restore writes the audit entry and the in-app `routine.changed`-style push to the member (ids only). Confirm with the owner if a dedicated template is wanted (spec 15 catalogue).
- Decision: the admin appeals list is a service function `listChatAppeals` exported from `chat`, mounted at `GET /api/admin/chat/appeals`.
- Decision: room joins are done with `socketsJoin` / `socketsLeave` on the user's room by the server, inside `lib/socket.js` via a `setRoomOps` hook.

## Files

Server (new): `server/src/modules/chat/`
- `chat.model.js`: `Conversation`, `ConversationMember`, `Message` with indexes.
- `chat.schemas.js`: Zod schemas for body, query, params.
- `chat.policy.js`: `can()` actions (pure functions, state, role, membership).
- `chat.people.service.js`: people search.
- `chat.direct.service.js`: open direct conversation (upsert pair).
- `chat.messages.service.js`: list, send, delete, read, delivered, unread, conversation list.
- `chat.group.service.js`: group creation, member add/remove, owners, close at rollover, member list, appeal, restore, admin appeals.
- `chat.hooks.js`: registers hooks with spec 09, 10, 14 modules.
- `chat.sockets.js`: room join/leave rules on connect and membership changes.
- `chat.controller.js`, `chat.routes.js` (`chatRouter`, `chatAdminRouter`).
- `chat.view.js`: public shaping (`toPublicMessage`, `toPublicConversation`).
- `index.js`: the only export surface.
- `__tests__/chat.people.api.test.js`, `chat.direct.api.test.js`, `chat.messages.api.test.js`, `chat.group.api.test.js`, `chat.socket.test.js`, `chat.policy.test.js`, `chat.hooks.test.js`, `chat.routes-scan.test.js` (CHT-19).

Server (changed):
- `server/src/app.js`: mount `chatRouter` at `/api/chat` and `chatAdminRouter` at `/api/admin/chat`.
- `server/src/lib/socket.js`: `setRoomOps` plus `onConnect` join of conversation rooms; client room join requests ignored.
- `server/src/modules/enrolments/index.js`: export `pendingEnrolmentOf(userId)`.
- `server/src/modules/representatives/assign.service.js`: call `runCrAssignedHooks` for `dcr` too.
- `server/src/server.js`: nothing (no new jobs).
- `server/src/modules/join/index.js`, `representatives/index.js`, `rollover/index.js`: no change; chat's hooks module registers in `chat/index.js` via a side-effect import, as other modules do.

Client (new): `client/src/features/chat/` with `api.js`, `hooks.js`, `ChatListPage` (`client/src/routes/ChatListPage.jsx`), `ConversationPage` (`client/src/routes/ConversationPage.jsx`), `PersonSearch` component, `MessageBubble`, `StatusTicks`, `ClosedBanner`, `UnreadBadge`, `useChatSocket`. Translation keys in `client/src/i18n/en.json`. Route registration in `client/src/App.jsx`.

## Data model

- `conversation` (`chat_conversation`): `type` (`direct`|`section_group`), `pair_key?`, `section_id?`, `semester_id?`, `name?`, `closed_at?`, `last_message_at?`. Unique partial `{pair_key}` where type direct. Unique partial `{section_id, semester_id}` where type section_group.
- `conversation_member`: `conversation_id`, `user_id`, `role` (`member`|`owner`), `removed_at?`, `removed_by?`, `appeal_text?`, `appealed_at?`, `last_read_at`, `last_delivered_at`. Unique `{conversation_id, user_id}`, index `{user_id, conversation_id}`.
- `message`: `conversation_id`, `sender_id`, `body_enc?`, `deleted_at?`, `deleted_by?`, `created_at`. Index `{conversation_id, created_at: -1}`, index `{sender_id, created_at: -1}` (rate limit).

Collection names follow the PRD (`conversation`, `conversation_member`, `message`) and the `user` collection convention. Use `collection` options accordingly.

Status of a direct message is computed, not stored per message: `seen` if the other member's `last_read_at >= created_at`; else `delivered` if `last_delivered_at >= created_at`; else `sent`.

Concurrency:
- Pair and section-group creation: `findOneAndUpdate` upsert; on duplicate key (E11000) the loser re-reads the existing row. Tests send two concurrent calls.
- Member removal and restore: conditional `findOneAndUpdate({ _id, removed_at: null })` / `({ _id, removed_at: { $ne: null } })`. No match → `ALREADY_DECIDED` (restore) or `NOT_FOUND`.
- Appeal: conditional update `{ _id, removed_at: {$ne:null}, appealed_at: null }`. No match → `CONFLICT`.
- Send: no transaction needed (single insert); events after commit via `emitAfterCommit`.

## API

| Method and path | Who | Zod | Can (state, role, scope) | Errors | Audit |
|---|---|---|---|---|---|
| GET `/api/chat/people?q=` | chat-enabled | `q` 2 to 60 chars | `chat.search` (own state) | `STATE_NOT_ALLOWED`, `VALIDATION_ERROR` | none |
| GET `/api/chat/conversations` | chat-enabled | none | `chat.read` | `STATE_NOT_ALLOWED` | none |
| POST `/api/chat/direct` | chat-enabled | `user_id` | `chat.open_direct` both sides | `CHAT_NOT_ALLOWED`, `STATE_NOT_ALLOWED` | none |
| GET `/api/chat/conversations/:id/messages?before=` | members | `before` id | `chat.read` (member, not removed) | `NOT_FOUND` | none |
| POST `/api/chat/conversations/:id/messages` | members with send rights | `body` 1 to 4000 | `chat.send` | `CHAT_NOT_ALLOWED`, `GROUP_CLOSED`, `RATE_LIMITED`, `NOT_FOUND` | none |
| DELETE `/api/chat/messages/:id` | sender; group owner | none | `chat.delete_own` / `chat.moderate_group` | `NOT_FOUND`, `FORBIDDEN` | `chat.message_deleted_by_owner` (owner only) |
| POST `/api/chat/conversations/:id/read` | members | none | `chat.read` | `NOT_FOUND` | none |
| POST `/api/chat/messages/:id/delivered` | recipient | none | `chat.read` | `NOT_FOUND` | none |
| DELETE `/api/chat/conversations/:id/members/:userId` | group owner | none | `chat.moderate_group` | `NOT_FOUND`, `FORBIDDEN` | `chat.member_removed` |
| GET `/api/chat/conversations/:id/members` | owners, dept admin; members see names only | none | `chat.read` + role check | `NOT_FOUND` | none |
| POST `/api/chat/conversations/:id/appeal` | removed member | `text` 1 to 500 | `chat.read` (removed member) | `CONFLICT`, `NOT_FOUND` | none |
| GET `/api/chat/unread` | chat-enabled | none | `chat.read` | `STATE_NOT_ALLOWED` | none |
| GET `/api/admin/chat/appeals` | admin of dept (scope) | none | `chat.restore_member` | `FORBIDDEN` | none |
| POST `/api/admin/chat/members/:memberId/restore` | admin of section's dept | none | `chat.restore_member` (`hideExistence`) | `NOT_FOUND`, `ALREADY_DECIDED` | `chat.member_restored` |

Sends: 429 `RATE_LIMITED` above 30 messages in the last 60 s (count of the user's `message` docs, not a separate limiter).

Read and send both check: caller is a current member (not removed), the conversation exists, and for a direct chat both sides are allowed (CHT-02).

## Policy rules (`can()`)

- `chat.search`: `stateIn(user, CHAT_STATES)` where CHAT_STATES = active, unconfirmed, graduated (students), active (teachers, staff), claim_pending (students, restricted to CR/DCR targets in the search filter).
- `chat.open_direct` / `chat.send` (direct): `me` in allowed states; `other` in allowed states; if `me` is `claim_pending`, `other` must be CR/DCR of `me.pending_section_id` and the pending request is open.
- `chat.read`: current member (not removed), or direct member.
- `chat.delete_own`: sender of the message.
- `chat.moderate_group`: current owner (CR/DCR of the section in effect) of a section group.
- `chat.restore_member`: `isAdminOf(user, department_id)` with `hideExistence: true`.

Every policy takes the resource loaded by the service, so the policy itself does no database work.

## UI

- Chat list (`/chat`): conversations with unread badges, last message time, closed groups marked, empty state.
- Conversation view (`/chat/:id`): message list (pages of 50, older on scroll), status ticks for direct messages (sent, delivered, seen, with screen-reader labels), delete own message, closed-group read-only banner, member list for owners, remove member, appeal (for removed members, read-only view with "appeal" button).
- Person search (`/chat/new`): at least 2 characters, results with name, photo, department, role label.
- Entry points: public profile, section roster, CR/DCR card: "Message" button calls `POST /api/chat/direct`.
- Dashboard unread card: total unread count from `GET /api/chat/unread`.
- Browser notifications: permission request on first conversation open, shown when tab hidden.
- Translation keys for every label, status, error (`chat.*` in `en.json`); 360 px layout; WCAG 2.1 AA.

## Tests (each maps to a checklist number)

- Policy unit tests: 1, 2, 3, 28, and each state from the table.
- People search: 4 (no section, phone, email keys; claim_pending results limited; min length; max 20).
- Direct: 5 (two calls, same conversation), 6, 27 (claim_pending to CR delivered, to others refused; unconfirmed delivered), 1 (email_unverified/pending refused, `STATE_NOT_ALLOWED`).
- Messages: 7 (length 1, 4000, 4001 rejected), 8 (deleted shows deleted; body absent), 17 (socket emit ids only), 18 (unread counts and reset on read), 26 (31 sends → `RATE_LIMITED`).
- Groups: 9 (CR assignment creates group named correctly), 10 (accepted student added; teacher not), 11 (owner removes member; cross-section owner 404), 12 (appeal once, second → 409, restore re-opens), 13 (member list, names only for ordinary members), 14 (ended CR stops being owner), 15 (rollover closes; GROUP_CLOSED; read works), 16 (no status on group messages).
- Sockets: 23 (non-member join ignored; removed member stops receiving; teacher can't join a section group room), 24 (events ids only, after commit).
- Audit: 25 (three actions recorded; no message text in audit).
- Privacy: 22 (route scan: no admin route returns message bodies), 21 (encrypted body in DB).
- Concurrency: two simultaneous 'start chat' calls → one conversation; two simultaneous restores → one succeeds, other `ALREADY_DECIDED`; two simultaneous appeals → one `CONFLICT`.
- Cross-scope: every role (student, claim_pending student, CR, teacher, dept admin, super admin) reads another pair's conversation → 404.

## Build order

1. Model and indexes (`chat.model.js`) and Zod schemas. Test: index presence via `syncIndexes` in test db.
2. Policy (`chat.policy.js`) and policy unit tests.
3. Enrolment helper `pendingEnrolmentOf`, and the `dcr` hook fix in representatives.
4. People search and direct conversations, with API tests.
5. Messages: send, list, delete, read, delivered, unread, conversation list, rate limit, status, with tests.
6. Groups: hooks (CR/DCR assigned, acceptance, removal, rollover), owners, close, members list, with tests.
7. Member removal, appeal, admin restore, admin appeals list, with tests and audit.
8. Sockets: room join/leave rules and events, with tests.
9. Mount routers in `app.js`; route scan test (CHT-19).
10. Client: API layer and hooks, chat list, conversation view, person search, entry points, dashboard card, translations, tests for key components.
11. Run lint, tests, build (run-checks).

## Out of scope

- Files (spec 21), block, report, chat suspension and retention (spec 22).
- End-to-end Playwright tests and the load test for the 2-second p95 (spec 23).
- Message search, user-created groups, calls, stories.
- Admin reading private messages (never).

## Status after the build

Status: in progress. Server and client code are written and tested. The gaps below are listed so they can be picked up.

### Deviations from the plan above (and why)

- The spec 09 CR hook still fires for a CR only (CRD-15). A new hook, `registerRepAssignedHook`, fires for a CR or a DCR. The chat group is created only when a CR is in effect, and owners are synced for both roles.
- Owners are derived live from the CR/DCR role in effect, so a role that ends stops giving owner rights (CHT-11) with no role-end hook.
- The chat list includes removed memberships, flagged `removed: true`, so a removed member can reach the appeal form. Their unread count is 0.
- Socket rooms: the server joins a connection to its open group rooms on connect (`onSocketConnect`). Removal and rollover call `leaveUserRoom`. No client join handler exists.
- Chat screens are gated by the release flag `chat.app`, set to `R3`. The routes exist, but the navigation entry and the profile button show only when `CURRENT_RELEASE` is `R3`.
- Chat error code `CHAT_NOT_ALLOWED` (403) and `GROUP_CLOSED` (409) added to `shared/errors.js`, spec 00's table, and the FND-11 list. Translated messages added.
- Appeal text is stored encrypted with `encrypt()`.

### Not done (open items)

- CHT-10a: the restore does not notify the member (no template or push event was decided). Restore writes the audit entry and joins the member's sockets to the room.
- CHT-22: a removal caused by spec 10's JR-19 hook (admin removes a student from the section) does not write `chat.member_removed`, because the hook receives no acting user. The join module's audit entry covers that action.
- CHT-14, CHT-21: no test asserts that `message.new` or `message.status` is emitted after commit (only the room rules are tested).
- Deleting a group message pushes no event (the spec defines only five events). Other members see the deletion on the next refresh.
- Dashboard unread card (spec 16 / CHT-15) and the roster and CR/DCR card entry points (CHT-04) are not built. Only the public profile has "Message".
- Block, report, suspension and retention (spec 22) and files (spec 21) are out of scope, as the plan says.
- Playwright end-to-end tests not written. The 360 px layout and WCAG check have not been run in a browser.
- Full CHT-19 route scan covers the two admin routes only, not every route.
- Translations are English only (Bangla later, as the project plans).
