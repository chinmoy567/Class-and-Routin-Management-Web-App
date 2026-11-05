# Email domain setup (OPS-15)

The sender is `MAIL_FROM`, on a domain the university approves. The provider (Brevo, SES or Postmark) is an open decision (PRD open question 1).

Records to publish for the sender domain, from the provider's dashboard:
- **SPF:** a TXT record listing the provider's sending servers.
- **DKIM:** the TXT record(s) the provider gives for its selector.
- **DMARC:** start with `v=DMARC1; p=none; rua=mailto:<dmarc inbox>` and tighten after two weeks of clean reports.

Test: send one email to a real `@baiust.ac.bd` mailbox and check it lands in the inbox, not spam, and that the headers show SPF, DKIM and DMARC pass.
