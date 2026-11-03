import { Router } from 'express';
import { getOutbox } from './transport.js';

// EML-11: development only (mounted in app.js when NODE_ENV is development). Lists the emails the
// dev transport wrote to the outbox, so the links in them can be clicked without a mail server.
export const devOutboxRouter = Router();

const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

/** Escape the text first, then turn plain http(s) links into anchors. */
const linked = (text) =>
  escapeHtml(text).replace(
    /(https?:\/\/[^\s<]+)/g,
    (url) => `<a href="${url}" rel="noopener">${url}</a>`,
  );

devOutboxRouter.get('/outbox', (_req, res) => {
  const items = [...getOutbox()]
    .reverse()
    .map(
      (m) => `<li class="mail">
  <h2>${escapeHtml(m.subject)}</h2>
  <p>To: ${escapeHtml(m.to ?? '')} · From: ${escapeHtml(m.from ?? '')}</p>
  <pre>${linked(m.text ?? '')}</pre>
</li>`,
    )
    .join('\n');
  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dev outbox</title>
<style>
body { font-family: system-ui, sans-serif; margin: 16px; color: #111; background: #fff; }
.mail { border-top: 1px solid #ccc; padding: 12px 0; }
pre { white-space: pre-wrap; word-break: break-word; }
</style>
</head>
<body>
<h1>Dev outbox</h1>
<p>${getOutbox().length} email(s), newest first. Development only.</p>
<ul style="list-style:none;padding:0">
${items || '<li>No emails yet.</li>'}
</ul>
</body>
</html>`);
});
