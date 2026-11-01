# 20: Chat

R3 · Status: Draft · Depends on: 09, 10 · PRD: Chat (Who can use chat, One-to-one chat, Section group, Notifications, Privacy and retention), Account states and access (chat rows), Acceptance criteria (Account states) · Diagrams: 18-seq-chat-message, 22-state-semester-section

## Goal

Small, safe chat: one-to-one messages between people allowed by their account states, and one group per section per semester that is created and filled automatically. Messages arrive in real time with sent, delivered and seen status. It isn't meant to replace WhatsApp.

## Scope

**In:** who may chat with whom, people search, one-to-one conversations, section groups (creation, membership, owners, closing), messages (text, delete for everyone), delivery and seen status, unread counts, browser notifications, real-time delivery.

**Out:** file sharing (spec 21), block, report, suspension and retention (spec 22). There are no user-created groups, calls, stories or message search.

## Requirements

### Who can chat
- **CHT-01** A one-to-one message can be sent when **both** sides are allowed: `active`, `unconfirmed` or `graduated` students and `active` teachers (and staff admins who are `active`) can message each other. A `claim_pending` student can message only the CR and DCRs of the section their open join request is for, and only while it is open. `email_unverified`, pending teachers, `deactivated` and `suspended` accounts can't open chat (`403 STATE_NOT_ALLOWED`). A suspended-from-chat user can read but not send (spec 22).
- **CHT-02** These rules are checked on every send, not only when a conversation is opened.
- **CHT-02a** All chat checks go through the central `can(user, action, resource)` with the actions `chat.search`, `chat.open_direct`, `chat.send`, `chat.read`, `chat.delete_own`, `chat.moderate_group` and `chat.restore_member`, so search, open and send share one function. Error codes: `STATE_NOT_ALLOWED` when the caller's own account state can't use chat; `CHAT_NOT_ALLOWED` when the caller can chat but not with this person or conversation (the other side's state, or a `claim_pending` student messaging anyone but the section's CR/DCR).

### Finding people
- **CHT-03** Search by name (at least 2 characters, case-insensitive prefix on any word, at most 20 results) shows name, photo, department and role labels (student, teacher, CR, DCR). Never level, term, section, group, phone or email. Results include only people the caller is allowed to message.
- **CHT-04** A chat can also be started from a public profile, a roster or the CR/DCR card.

### One-to-one
- **CHT-05** One conversation per pair of users (unique on the sorted pair). It continues across semesters.
- **CHT-06** A message is plain text, 1–4,000 characters, with a server timestamp. Status: `sent` (stored), `delivered` (the recipient's client received it), `seen` (the recipient opened the conversation).
- **CHT-07** The sender can delete their own message for everyone. It is replaced by "message deleted" for both sides, and the text is removed from view at once (permanent erase and report exceptions in spec 22).

### Section groups
- **CHT-08** A group is created automatically when the first CR of a section in the current semester takes effect (spec 09 hook, and spec 14 at rollover). It is named "CSE 2-II-A · Fall 2026".
- **CHT-09** Members: the section's CR and DCRs (as owners) and its accepted students, added automatically on acceptance (spec 10 hook). Teachers are never members. Only members can read or send.
- **CHT-10** Owners can delete any message in the group and remove a member. A removed member can't read or send, and is listed for the admin (spec 18 ADM-04). They can appeal, and the admin can restore them. Owners can't delete accounts.
- **CHT-10a** A removed member can file one appeal per removal (`POST /api/chat/conversations/:id/appeal`, text up to 500 characters). It appears in the admin's appeals list (spec 18 ADM-04). A second appeal for the same removal returns `CONFLICT`. Restoring the member (admin) clears `removed_at`, writes an audit entry and notifies them.
- **CHT-10b** Owners and the admin of the section's department can list a group's members (name, photo, role label, removed or not; never email or phone). Ordinary members see current members' names only.
- **CHT-11** When a CR/DCR role ends, they stop being an owner. If they remain an accepted student of the section, they stay a member.
- **CHT-12** At rollover the group is **closed**: nobody can send, and history stays readable to its members. A new group is created when the new semester's CR takes effect. A student who moves to another section joins that section's group when accepted. An `unconfirmed` student keeps read-only access to their old group.
- **CHT-13** Group messages have timestamps but no per-member delivered/seen status. Only one-to-one messages show it.

### Real-time and unread
- **CHT-14** Messages are sent over REST (`POST`) and pushed with Socket.IO: `message.new` to the other participant's `user:<id>` room, or to the group's `conversation:<id>` room, and `message.status` back to the sender for delivered and seen. The event payload carries ids only, and the client fetches the message.
- **CHT-15** Unread counts per conversation and in total are shown in the chat list and on the dashboard card. Opening a conversation marks it read (one-to-one: `seen`).
- **CHT-16** A browser notification is shown for a new message if the user allowed notifications and the tab isn't focused. Chat messages are never emailed.
- **CHT-17** Delivery within 2 s at the 95th percentile (checked in spec 23's load test).

### Storage
- **CHT-18** Message text is encrypted at rest with `DATA_ENC_KEY` (spec 00 FND-14). It is not end-to-end encrypted.
- **CHT-19** No admin endpoint returns private messages. The only exception is the reported-message view (spec 22).

### Socket rooms
- **CHT-20** A socket may join `conversation:<id>` only if the user is a current member of that conversation, checked on the server with the same `can()` call as reading. The server joins and leaves rooms itself; a client request to join any other room is ignored. When a member is removed or a conversation closes, their sockets leave the room at once. `user:<id>` is joined only for the socket's own user (spec 00 FND-25).
- **CHT-21** Chat events carry ids only (spec 00 FND-26) and are sent with `emitAfterCommit`.
- **CHT-22** Audit entries: `chat.member_removed`, `chat.member_restored`, `chat.message_deleted_by_owner`. Message text is never written to the audit log or to logs.

## Permissions

| Action | Who |
|---|---|
| Search people, open 1:1, send 1:1 | per CHT-01 (both sides) |
| Read / send in a section group | members of an open group (read-only when closed) |
| Delete own message | the sender |
| Delete any group message, remove member | group owners (CR/DCR in effect) |
| Restore a removed member | admin of the section's dept |

## Data

- `conversation`: type (`direct` | `section_group`), pair_key? (sorted user ids, unique for direct), section_id?, semester_id?, name?, closed_at?, last_message_at. Unique `{ pair_key }` (partial, direct), unique `{ section_id, semester_id }` (partial, group).
- `conversation_member`: conversation_id, user_id, role (`member` | `owner`), removed_at?, removed_by?, last_read_at, last_delivered_at. Unique `{ conversation_id, user_id }`, index `{ user_id, conversation_id }`.
- `message`: conversation_id, sender_id, body_enc, file_id? (spec 21), deleted_at?, deleted_by?, created_at. Index `{ conversation_id, created_at: -1 }`.

## API

| Method and path | Who | Body | Success | Errors |
|---|---|---|---|---|
| `GET /api/chat/people?q=` | chat-enabled | none | search results | `STATE_NOT_ALLOWED` |
| `GET /api/chat/conversations` | chat-enabled | none | list with unread counts | none |
| `POST /api/chat/direct` | chat-enabled | user_id | conversation (existing or new) | `CHAT_NOT_ALLOWED` |
| `GET /api/chat/conversations/:id/messages?before=` | members | none | page of 50 | `NOT_FOUND` |
| `POST /api/chat/conversations/:id/messages` | members (can send) | body | 201 | `CHAT_NOT_ALLOWED`, `GROUP_CLOSED`, `CHAT_SUSPENDED`, `BLOCKED` (spec 22), `RATE_LIMITED` |
| `DELETE /api/chat/messages/:id` | sender; group owner | none | 204 | `FORBIDDEN` |
| `POST /api/chat/conversations/:id/read` | members | none | 204 | none |
| `POST /api/chat/messages/:id/delivered` | recipient | none | 204 | none |
| `DELETE /api/chat/conversations/:id/members/:userId` | group owner | none | 204 | `FORBIDDEN` |
| `GET /api/chat/conversations/:id/members` | owners, admin of dept; members (current names only) | none | member list | `NOT_FOUND` |
| `POST /api/chat/conversations/:id/appeal` | removed member | text | 201 | `CONFLICT`, `NOT_FOUND` |
| `GET /api/chat/unread` | chat-enabled | none | `{ total, per_conversation }` | `STATE_NOT_ALLOWED` |
| `POST /api/admin/chat/members/:memberId/restore` | admin of dept | none | 200 | `NOT_FOUND`, `ALREADY_DECIDED` |

Sending is rate limited to 30 messages per minute per user.

## Jobs and events

- `message.new`, `message.status` via Socket.IO. Hooks: `onCrAssigned` (create group), `onEnrolmentAccepted` (add member), `onRoleEnded` (owner → member), `onRollover` (close old groups).

## Screens

Chat list (unread badges), Conversation view (messages, status ticks, delete), Person search, Group view (members list for owners, remove member), dashboard unread card. Read-only banner on closed groups.

## Acceptance tests

- [PRD] Given a `claim_pending` student who applied to CSE 2-II-A, when they message that section's CR, then it is delivered. When they message anyone else, then it is refused.
- [PRD] Given an `unconfirmed` student, when they send a one-to-one message, then it is delivered.
- CHT-03: search results have no section, phone or email keys.
- CHT-05: two "start chat" calls for the same pair return the same conversation.
- CHT-08: naming the first CR of 2-II-A in the current semester creates "CSE 2-II-A · <semester>". Accepting a student adds them.
- CHT-09: a teacher can't read a section group (`404`).
- CHT-12: after rollover, sending to the old group → `GROUP_CLOSED`, and reading still works.
- CHT-07: a deleted message returns "message deleted" with no body to both sides.
- CHT-19: no admin endpoint returns message bodies (route scan test).
- CHT-20: a socket asking to join a conversation it isn't a member of receives no events; a removed member stops receiving events at once; a teacher can't join a section group room.
- CHT-10: an owner of section A can't remove a member or delete a message in section B's group (`404`). A EEE admin can't restore a CSE member.
- CHT-10a: an appeal is filed once; a second one → `CONFLICT`; a restore re-opens read and send.
- Sending 31 messages in one minute → `RATE_LIMITED`. Two simultaneous 'start chat' calls for the same pair return one conversation (partial unique index).
- Every role (student, `claim_pending` student, CR, teacher, department admin, super admin) tries to read another pair's conversation → `404`.

## Decisions and open questions

- **Decision:** messages are sent by REST and Socket.IO only notifies. This is simpler to secure, rate-limit and test.
- **Decision:** no delivered/seen status in groups (CHT-13). The PRD mentions it only for one-to-one chats.

## Tasks

- [ ] Models + indexes
- [ ] Chat actions in `can()` (CHT-01, CHT-02a), shared by search, open, send and read
- [ ] People search
- [ ] Direct conversations + messages + delete + status
- [ ] Section group hooks (create, add, owner changes, close)
- [ ] Member removal, member list, appeal, admin restore (CHT-10, 10a, 10b)
- [ ] Socket room join/leave rules (CHT-20), events, unread endpoint
- [ ] Client: chat list with unread badges, dashboard unread card
- [ ] Client: conversation view (messages, status ticks, delete, older-message paging, closed-group banner)
- [ ] Client: person search and 'start chat' entry points (profile, roster, CR/DCR card)
- [ ] Client: group view (members list, remove member, appeal screen) and browser notification permission flow
- [ ] Translation keys, screen-reader labels for message status, 360 px layout check
- [ ] Tests incl. PRD criteria
