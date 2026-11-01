import { Router } from 'express';
import { csrfToken } from '../../lib/csrf.js';

export const authRouter = Router();

// FND-28: hands the caller the token to send back in X-CSRF-Token.
authRouter.get('/csrf', (req, res) => {
  res.json({ data: { token: csrfToken(req) } });
});
