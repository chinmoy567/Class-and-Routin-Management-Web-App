# 02: Profile

R1 · Status: Draft · Depends on: 01 · PRD: Core features (F1), Authentication & onboarding (Required university email), Non-functional requirements (Privacy), Chat (What others see on a profile) · Diagrams: 24-sitemap

## Goal

Every user has one profile page where they can see their details and edit their phone, photo and email. Other people see only a small public profile.

## Scope

**In:** viewing your own profile, editing phone and photo, changing your email (with verification), the "email is bouncing" prompt, the public profile others see, showing roles and CR/DCR status.

**Out:** the join form fields (level, term, section, group), which change only through a join request (spec 10) or a CR/DCR or admin action. Password change is in spec 01.

## Requirements

- **PRF-01** Your own profile shows: full name, email (decrypted, yours only), phone (yours only), photo, kind, roles (including "CR of CSE 2-II-A · Fall 2026"), and for a student the department, level, term, section and group accepted for the current semester, plus the semester it was last confirmed for ("Fall 2026 confirmed"). For a teacher it shows the linked department and short code, or "not linked yet".
- **PRF-02** Full name can be edited only by an admin of the user's department. Students and teachers can't rename themselves, because the CR/DCR and admin identify people by name.
- **PRF-03** Phone is optional, stored encrypted, and accepted only in Bangladeshi mobile format (`01XXXXXXXXX`, or with `+880`). It is stored normalised as `+8801XXXXXXXXX`.
- **PRF-04** Photo: JPEG, PNG or WebP only (checked from the file's content, not its name), at most 2 MB. It is stored in GridFS, scanned by ClamAV before use, and served only to signed-in users. Until the scan passes, the old photo (or initials) is shown. A failed scan deletes the file and tells the user.
- **PRF-05** Changing email: the new address must be on an allowed domain and not used by another account. A link sent to the **new** address (24 hours, single use) completes the change. Until then the old email stays in use. When it completes, `email_hmac` and `email_enc` are replaced, `email_bouncing` is cleared, and the old address gets a "your email was changed" notice.
- **PRF-06** If the user's email is marked bouncing (spec 15), `/api/auth/me` returns `email_action_required: true` and the client shows a banner asking for a new email at every sign-in until it is changed.
- **PRF-07** The **public profile** (`GET /api/users/:id`) shows only name, photo, department and role labels (student, teacher, CR, DCR). Never level, term, section, group, phone or email. It is available to any account allowed to use chat (spec 20), and to admins of the user's department.
- **PRF-08** Every profile change is recorded in `audit_log` (`user.phone_change`, `user.photo_change`, `user.email_change`, `user.name_change`) without storing the phone or email values.
- **PRF-09** Edit-own-profile is allowed in every state that can sign in, except `email_unverified` (spec 01 state table).

## Permissions

| Action | Who | States |
|---|---|---|
| View and edit own phone and photo | the owner | all signed-in states except `email_unverified` |
| Change own email | the owner | same |
| Change full name | admin of the user's department | n/a |
| View a public profile | chat-enabled accounts; admins of that department | per the chat rules |

## Data

Uses `user` (spec 01). Photos in GridFS bucket `photos` with metadata `{ owner_id, scan_status: 'pending' | 'clean' | 'infected', content_type }`. `user.photo_file_id` points to the latest **clean** photo, and `user.pending_photo_file_id` holds one waiting for its scan.

## API

| Method and path | Who | Body | Success | Errors |
|---|---|---|---|---|
| `GET /api/me/profile` | owner | none | full own profile | none |
| `PATCH /api/me/profile` | owner | phone (or null) | updated profile | `VALIDATION_ERROR` |
| `PUT /api/me/photo` | owner | multipart `photo` | 202 `{ scan_status: 'pending' }` | `FILE_TYPE_NOT_ALLOWED`, `FILE_TOO_LARGE` |
| `DELETE /api/me/photo` | owner | none | 204 | none |
| `POST /api/me/email` | owner | new_email | 202 | `EMAIL_DOMAIN_NOT_ALLOWED`, `CONFLICT` (taken), `RATE_LIMITED` |
| `POST /api/me/email/confirm` | anyone with the link | token | 200 | `TOKEN_INVALID`, `CONFLICT` (taken since) |
| `GET /api/users/:id` | see PRF-07 | none | public profile | `NOT_FOUND` |
| `GET /api/users/:id/photo` | signed in | none | image (`Cache-Control: private`) | `NOT_FOUND` |
| `PATCH /api/admin/users/:id/name` | admin of user's dept | full_name | 200 | `FORBIDDEN` |

## Jobs and events

- `photo.scan`: scans a pending photo with ClamAV, then promotes it to `photo_file_id` and deletes the previous photo, or deletes it if infected.

## Screens

My profile (view + edit phone, photo, email; shows roles, semester badge, group notice), Public profile (a card or page), Email-change confirmation landing.

## Acceptance tests

- PRF-03: `01712345678` is stored as `+8801712345678`. `12345` → `VALIDATION_ERROR`.
- PRF-04: a `.png` that is really a PDF → `FILE_TYPE_NOT_ALLOWED`. A 2.1 MB image → `FILE_TOO_LARGE`. An infected file never becomes `photo_file_id`.
- PRF-05: after requesting a change, signing in with the old email still works. After confirming, only the new email works, and the old address received a notice.
- PRF-05: if another account took the new email before the link is used → `CONFLICT`.
- PRF-07: a teacher viewing a student's public profile gets no `level`, `section`, `phone` or `email` keys in the response.
- PRF-09: an `email_unverified` user calling `PATCH /api/me/profile` → `403 STATE_NOT_ALLOWED`.

## Decisions and open questions

- **Decision:** 2 MB photo limit and JPEG/PNG/WebP only. The PRD gives no limit for photos (only 5 MB for chat files). Photos are not resized, because no image library is in the stack.
- **Decision:** users can't change their own name (PRF-02). The PRD lists only phone and photo as editable.
- **Decision:** phone accepts Bangladeshi mobile numbers only.

## Tasks

- [ ] Profile read and update service, public-profile serializer (`toPublic`)
- [ ] Phone normalisation + encryption
- [ ] Photo upload: content sniffing, GridFS, `photo.scan` job, serving endpoint
- [ ] Email change request + confirmation + old-address notice
- [ ] Bouncing-email flag in `/me` and the banner
- [ ] Admin rename endpoint + audit
- [ ] Profile screens
- [ ] Tests for every PRF requirement
