# Plan: 21 Chat files

Source: `.claude/specs/21-chat-files.md` · PRD: Chat (Sharing files F10, Privacy and retention), Core features (F10), Account states and access (Share files) · Diagram: `DOCUMENTS/src/18-seq-chat-message.mmd`

## Goal

Users share study files in one-to-one chats and section groups. A file is checked by its real content type, refused if it is an SVG or a macro-enabled Office file, scanned by ClamAV in a background job before anyone can download it, kept in a private GridFS bucket, and downloaded only through a 5-minute signed link that is re-checked for membership at download time.

## Rules and acceptance criteria (checklist)

1. FIL-01 Allowed: PDF, DOC/DOCX, PPT/PPTX, XLS/XLSX, TXT, JPEG, PNG, GIF, WebP. Type from content (magic bytes; OOXML `[Content_Types].xml`). Anything else → `FILE_TYPE_NOT_ALLOWED`. Browser MIME and name are ignored.
2. FIL-02 Refused: SVG (even renamed), macro-enabled OOXML (`.docm`/`.xlsm`/`.pptm`, detected by content type and `vbaProject.bin`), legacy Office with a VBA project. Error: `FILE_TYPE_NOT_ALLOWED`.
3. FIL-03 Max 5 MB (`FILE_TOO_LARGE`). Enforced while the body streams (express.raw limit = 5 MB + multipart allowance); file part size checked again before storage. Nothing stored when refused.
4. FIL-04 Who may upload: `active` students and teachers in any conversation they can send in; `unconfirmed` students only in one-to-one chats. `claim_pending` and `graduated` → `STATE_NOT_ALLOWED`. The sender must pass the spec 20 send rules (member, not removed, group not closed).
5. FIL-05 Stored in GridFS `chat_files` with `scan_status: 'pending'`, message created with `file_id`. Recipients see name, size and "scanning" until done. `POST …/link` before the scan → `FILE_NOT_READY`.
6. FIL-06 `file.scan` job → ClamAV (`scanBuffer`). `clean` → `scan_status: 'clean'`, push `message.status` `file_ready`. `infected` → GridFS bytes deleted, push `message.status` `file_removed`, message shows "file removed". Scanner unreachable → job throws, Agenda retries, file stays pending.
7. FIL-07 Download only by current members (`chat.read`), including after a group closes. A removed member gets `NOT_FOUND` even with an unexpired link. No public link.
8. FIL-08 `POST /api/chat/files/:id/link` → `{ url, expires_at }`, HMAC-SHA256 with `FILE_LINK_KEY` over `fileId:userId:exp`, exp = now + 300 s. Download checks: session user equals the linked user (else `NOT_FOUND`), signature (else `NOT_FOUND`), expiry (`LINK_EXPIRED`), membership again, message not deleted, file clean. Headers: `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, detected `Content-Type`, `Cache-Control: private, no-store`.
9. FIL-09 Original name kept for display, sanitised: no path separators or `<>:"|?*`, no control characters, no leading dots, at most 120 characters (extension kept).
10. FIL-10 At most 20 uploads per hour per user → `RATE_LIMITED` with Retry-After.
11. FIL-11 Deleting the message (sender, or group owner) removes the file from view at once: the download refuses a deleted message. Byte erasure on message delete belongs to spec 22 (out of scope here).
12. Permissions table: upload = FIL-04 + send rule; link and download = current members.
13. Data: GridFS `chat_files` metadata `{ uploader_id, conversation_id, original_name, size, detected_type, scan_status, scanned_at }`; `message.file_id`.
14. API: three routes as in the spec (upload multipart `file` + optional `caption`; link; download with `u`, `exp`, `sig`).
15. Jobs: `file.scan`, retry via the existing `withRetry` (5 attempts).
16. Screens: attach button, upload progress, file bubble (name, size, scanning / ready / removed), download button that fetches a link and starts the download.
17. Acceptance tests: FIL-01 … FIL-08 as written in the spec, plus FIL-07 and FIL-11, EICAR, rate limit, cross-scope refusal for each role, and the 5 MB boundary.

## Blockers / open questions

- **Decision (spec, no blocker):** in-house magic-byte and OOXML check, no `file-type` library. Confirmed by the spec; no new dependency.
- **Multipart parsing:** no multipart library is in `tech-stack.md` (multer and busboy are not). The spec asks for multipart, so the plan writes a small parser (`lib/multipart.js`), fed by `express.raw`. Asking first would add a stop for a decision the spec already allows, so I proceed and call it out in the report.
- **Error codes not in `shared/errors.js`:** `FILE_NOT_READY` (409) and `LINK_EXPIRED` (410). The spec names them but not their status. Chosen: 409 and 410. Added to shared.
- **FIL-02 error code:** the spec does not name one. Uses `FILE_TYPE_NOT_ALLOWED`.
- **Caption limit:** spec says "optional caption" with no length. Uses the chat message limit (4,000 characters, same as spec 20).
- **Upload limit per hour:** counted from messages with `file_id` sent by the user in the last hour (refused uploads are not counted).
- **No open PRD question blocks this spec.**

## Files

Server (`server/src/`)
- `lib/zip.js` (new): read a zip's central directory and inflate named entries (no library).
- `lib/fileType.js` (new): `detectAllowedFile(buffer)` → `{ mime, detected_type }` or `null`. PDF, OOXML (docx/xlsx/pptx and their macro check), legacy OLE (doc/xls/ppt and VBA check), images (JPEG, PNG, GIF, WebP via `imageType.js`), text (UTF-8, no control bytes, no `<svg`), SVG refusal.
- `lib/fileName.js` (new): `sanitiseFileName(name)`.
- `lib/multipart.js` (new): `parseMultipart(buffer, contentType)` → `{ fields, files }`, bounded part count.
- `lib/gridfs.js`: `putChatFile`, `chatFileDoc`, `readChatFile`, `streamChatFile`, `setChatFileScan`, `deleteChatFile`, `ensureChatFileIndex`.
- `lib/errors.js`: no change (uses `AppError`, `rateLimited`, `notFound`).
- `lib/clamav.js`: no change (`scanBuffer` and `setScanner` reused).
- `lib/jobs.js`: no change.
- `server.js`: register chat file jobs and `ensureChatFileIndex`.
- `modules/chat/chat.model.js`: `file_id` on message, index `{ file_id: 1 }` (sparse).
- `modules/chat/chat.policy.js`: `chat.send_file` (FIL-04 states by conversation type).
- `modules/chat/chat.schemas.js`: `fileDownloadQuery`, `captionBody`.
- `modules/chat/chat.files.service.js` (new): upload, scan, view info, link, download, rate limit.
- `modules/chat/chat.files.jobs.js` (new): `defineJobs` for `file.scan`.
- `modules/chat/chat.messages.service.js`: extract `assertCanSend` (shared by text and file send), `viewMessage` gets `file`, list and send attach file views.
- `modules/chat/chat.controller.js`, `chat.routes.js`: three routes; upload body via `express.raw` with the 413 → `FILE_TOO_LARGE` mapping.
- `modules/chat/index.js`: export `defineChatFileJobs`.

Shared (`shared/`)
- `errors.js`: `FILE_NOT_READY`, `LINK_EXPIRED`.

Client (`client/src/`)
- `lib/api.js`: `uploadForm(path, formData, { onProgress })` (XHR, CSRF header, ApiError).
- `features/chat/api.js`: `uploadChatFile`, `fetchFileLink`.
- `features/chat/hooks.js`: `useUploadChatFile`, `useFileLink`.
- `features/chat/components/MessageBubble.jsx`: file bubble.
- `features/chat/components/FileComposer.jsx` (new): attach button, chosen file, progress.
- `routes/ConversationPage.jsx`: composer uses `FileComposer`.
- `i18n/en.json`: `chat.file.*` keys.
- Tests: `features/chat/__tests__/files.test.jsx`, `lib/__tests__/uploadForm.test.js`.

Specs
- `.claude/specs/21-chat-files.md`: status and task ticks at the end.

## Data model

- `message`: add `file_id` (ObjectId, optional), index `{ file_id: 1 }` (sparse, partial on existence).
- GridFS bucket `chat_files`: `chat_files.files` metadata as in the spec. Index on `metadata.conversation_id`, `metadata.uploader_id` is not needed.
- No transaction is needed for the upload: the file is stored first, then the message is created. If the message write fails, the stored file is deleted. A failed scan leaves a pending file, which is safe (not downloadable).

## API

| Route | can() | Zod | Notes |
|---|---|---|---|
| `POST /api/chat/conversations/:id/files` | `chat.read` (member, else 404), `chat.send` rules, `chat.send_file` (FIL-04), rate limit | params `idParam`; body multipart via `express.raw` | 201 message view with `file.status: 'scanning'` |
| `POST /api/chat/files/:id/link` | `chat.read` on the file's conversation | params `idParam` | `{ url, expires_at }`; `FILE_NOT_READY` if not clean |
| `GET /api/chat/files/:id/download` | session user = `u`; signature; expiry; `chat.read`; message not deleted | params `idParam`; query `fileDownloadQuery` | stream |

Audit: none required by the spec's auditability list. Chat messages are not audited.

## UI

- Composer: an "Attach file" button (hidden input, `accept` list). The chosen file shows its name and size with a Remove button. The text box becomes the caption. Send is disabled while uploading. A `<progress>` element with a label shows the upload. Errors use `FormError`.
- File bubble: file name, size, status text ("Scanning…" / "Ready" / "File removed (failed security check)"), a Download button when ready. Download calls the link endpoint, then navigates to the URL.
- All text in `en.json`. Mobile first at 360 px; buttons have text labels.

## Tests (each mapped to a checklist number)

Server unit
- Checklist 1, 2: `fileType.test.js` with fixtures built in the test (PDF, DOCX, XLSX, PPTX, legacy OLE with and without a VBA name, DOCM (macro type), XLSM (`vbaProject.bin`), SVG, GIF, PNG, JPEG, WebP, text, EXE-with-MZ, plain zip). A PDF renamed `.jpg` is detected as PDF (the name is not used). An EXE renamed `.pdf` is refused.
- Checklist 3 (part): zip parsing for a stored and a deflated entry; zip bomb limit on `[Content_Types].xml`.
- Checklist 9: `fileName.test.js`.
- `multipart.test.js`: file and caption parts, CRLF, missing boundary → error.

Server API (`chat.files.api.test.js`, Supertest, MongoMemoryReplSet, fake scanner via `setScanner`)
- FIL-01: a PDF renamed `.jpg` stored as PDF; `.exe` renamed `.pdf` → `FILE_TYPE_NOT_ALLOWED`, nothing stored.
- FIL-02: SVG → refused; `.docm` renamed `.docx` → refused.
- FIL-03: 5.1 MB → `FILE_TOO_LARGE`, nothing stored; exactly 5 MB accepted; 6 MB body rejected by the raw limit with `FILE_TOO_LARGE`.
- FIL-04: `claim_pending` student → `STATE_NOT_ALLOWED`; `unconfirmed` student in a section group → `STATE_NOT_ALLOWED`; `unconfirmed` in a direct chat → accepted; `graduated` → refused; teacher (`active`) accepted; a non-member → 404; removed member → refused; closed group → `GROUP_CLOSED`.
- FIL-05: link before scan → `FILE_NOT_READY`; message view shows `scanning`.
- FIL-06: EICAR-containing `.txt` → infected, GridFS bytes gone, status pushed; scanner throws → job rethrows and file stays pending.
- FIL-07: member removed from a group → link refused (404); member of a closed group → link allowed.
- FIL-08: link after 5 minutes → `LINK_EXPIRED`; user A's link used by user B → `NOT_FOUND`; bad signature → `NOT_FOUND`; response has `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`.
- FIL-09: name sanitised in the stored metadata.
- FIL-10: 21st upload within an hour → `RATE_LIMITED`.
- FIL-11: sender or owner deletes the message → download → `NOT_FOUND`.
- Cross-scope: each role (student, CR of another section, DCR, teacher, dept admin of another department, super admin) tries to link or download a file in a conversation they are not in → refused.

Client
- `files.test.jsx`: bubble shows scanning / ready / removed; attach shows the chosen file; upload progress; server error shown.
- `uploadForm.test.js`: sends the CSRF header, reports progress, maps the error body to ApiError.

## Build order

1. `shared/errors.js` codes.
2. `lib/zip.js`, `lib/fileType.js`, `lib/fileName.js`, `lib/multipart.js` with their unit tests.
3. `lib/gridfs.js` chat file functions.
4. Model field, policy, schemas.
5. `chat.messages.service.js` refactor (`assertCanSend`, `file` view) and tests still green.
6. `chat.files.service.js`: upload, then scan job, then link and download. Tests with each step.
7. Routes, controller, job registration in `server.js`.
8. API tests FIL-01 … FIL-11 and cross-scope.
9. Client api helper, hooks, bubble, composer, i18n, tests.
10. Spec status and ticks; run-checks.

## Out of scope

- Retention and byte erasure on message delete, and the nightly job (spec 22).
- Reporting and blocking files (spec 22).
- Real ClamAV in tests (tests use an injected scanner; the clamd client is unchanged from spec 16's photo work). A manual check against a running clamd is noted as not done.
- Bangla translations (the keys are added in English only).
- Commits (not requested).
