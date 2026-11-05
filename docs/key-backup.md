# Keys and secrets (OPS-04)

Stored on the server only in `deploy/.env.production` (mode 600, owned by root). Never in git or in an image.

Copy these into a password manager or a sealed envelope kept off the server:
- `DATA_ENC_KEY`: without it, encrypted emails, phone numbers and messages cannot be read.
- `EMAIL_HMAC_KEY`: without it, email lookups fail.
- `FILE_LINK_KEY`, `SESSION_SECRET`, the three Mongo passwords, SMTP credentials, `deploy/mongo-keyfile`, and the backup passphrase.

Check once per semester that the stored copy matches the server (do not paste keys into chat or tickets).
