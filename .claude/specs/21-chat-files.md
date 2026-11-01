# 21: Chat files

R3 · Status: Draft · Depends on: 20 · PRD: Chat (Sharing files F10, Privacy and retention), Core features (F10), Account states and access (Share files) · Diagrams: 18-seq-chat-message

## Goal

Users share study files in one-to-one chats and section groups. Files are type-checked by content, scanned for malware before anyone can download them, kept private, and downloaded only through short-lived links.

## Scope

**In:** upload, type and size checks, ClamAV scanning, attaching to a message, private download through 5-minute signed links, files in closed groups.

**Out:** retention and deletion of files (spec 22).

## Requirements

- **FIL-01** Allowed types: PDF, Word (`.doc`, `.docx`), PowerPoint (`.ppt`, `.pptx`), Excel (`.xls`, `.xlsx`), plain text (`.txt`) and images (JPEG, PNG, GIF, WebP). The real type is detected from the file's content (magic bytes and, for Office files, the container's content types), not from the name or the browser's MIME type. Anything else → `FILE_TYPE_NOT_ALLOWED`.
- **FIL-02** Always refused: SVG images and macro-enabled Office files (`.docm`, `.xlsm`, `.pptm`, and legacy Office files containing macros), even if renamed.
- **FIL-03** Maximum 5 MB per file (`FILE_TOO_LARGE`), enforced while streaming the upload (the server stops reading past the limit).
- **FIL-04** Who can share follows the state table: `active` students, `unconfirmed` students (in one-to-one chats only), and `active` teachers. Not `claim_pending` or `graduated` students (`STATE_NOT_ALLOWED`). The sender must be able to send in that conversation (spec 20).
- **FIL-05** An upload is stored in GridFS bucket `chat_files` with `scan_status: 'pending'`, and a message with the file is created. Recipients see the file name, size and "scanning…" until the scan finishes. They can't download it before then.
- **FIL-06** A `file.scan` job sends the file to ClamAV. `clean` → the file becomes downloadable and `message.status` (file ready) is pushed. `infected` → the file's bytes are deleted, the message shows "file removed (failed security check)", and the sender is told. If the scanner is unreachable, the job retries, and the file stays unavailable.
- **FIL-07** A file can be downloaded only by current members of its conversation (for groups, members who aren't removed, including after the group closes). There is never a public link.
- **FIL-08** Download: `POST /api/chat/files/:id/link` returns a signed URL valid for 5 minutes (HMAC with `FILE_LINK_KEY` over file id, user id and expiry). The download endpoint checks the signature and expiry **and** membership again, and serves the file with `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` and the detected content type. Files are never shown inline.
- **FIL-09** The original file name is kept for display but sanitised (no path characters, at most 120 characters).
- **FIL-10** Uploads are limited to 20 per hour per user.
- **FIL-11** Deleting the message (by the sender or a group owner) removes the file from view at once (bytes erased per spec 22).

## Permissions

| Action | Who |
|---|---|
| Upload in a conversation | FIL-04 states, and can send in that conversation |
| Get a link, download | current members of the conversation |

## Data

- GridFS `chat_files` with metadata `{ uploader_id, conversation_id, original_name, size, detected_type, scan_status: 'pending' | 'clean' | 'infected', scanned_at }`.
- `message.file_id` (spec 20).

## API

| Method and path | Who | Body | Success | Errors |
|---|---|---|---|---|
| `POST /api/chat/conversations/:id/files` | FIL-04 | multipart `file`, optional caption | 201 message with `scan_status: 'pending'` | `FILE_TYPE_NOT_ALLOWED`, `FILE_TOO_LARGE`, `STATE_NOT_ALLOWED`, `RATE_LIMITED`, chat send errors |
| `POST /api/chat/files/:id/link` | members | none | `{ url, expires_at }` | `NOT_FOUND`, `FILE_NOT_READY` |
| `GET /api/chat/files/:id/download?u=&exp=&sig=` | the linked user | none | file stream | `LINK_EXPIRED`, `NOT_FOUND` |

## Jobs and events

- `file.scan` (retries while ClamAV is down). `message.status` when the file is ready or removed.

## Screens

Attach button in the conversation composer, upload progress, a file bubble (name, size, scanning / ready / removed), and a download button that fetches a link and starts the download.

## Acceptance tests

- FIL-01: a PDF renamed to `.jpg` is stored as a PDF type, and an `.exe` renamed to `.pdf` → `FILE_TYPE_NOT_ALLOWED`.
- FIL-02: an SVG → refused. A `.docm` renamed to `.docx` → refused.
- FIL-03: a 5.1 MB file → `FILE_TOO_LARGE`, and nothing is stored.
- FIL-04: a `claim_pending` student uploading → `STATE_NOT_ALLOWED`. An `unconfirmed` student uploading in a section group → refused.
- FIL-05: asking for a link before the scan → `FILE_NOT_READY`.
- FIL-06: the EICAR test file is marked infected and its bytes are gone.
- FIL-08: a link used after 5 minutes → `LINK_EXPIRED`. A link made for user A used by user B → `NOT_FOUND`. The response has `Content-Disposition: attachment`.
- FIL-07: a member removed from a group can't get a link.

## Decisions and open questions

- **Decision:** type detection uses a small magic-byte check written in-house, plus reading the OOXML `[Content_Types].xml` for Office files. If a library such as `file-type` is preferred, it isn't in `tech-stack.md`, so confirm first.

## Tasks

- [ ] Streaming upload with size cap into GridFS
- [ ] Content type detection + macro and SVG rejection (unit-tested with fixture files)
- [ ] `file.scan` job with ClamAV (clamd TCP)
- [ ] Signed link creation + download endpoint with re-check
- [ ] Composer attach UI + file bubble
- [ ] Tests incl. EICAR
