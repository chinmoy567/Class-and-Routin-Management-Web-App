import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, mockApi, meResponse, ok, renderApp } from '@/test/mockApi.jsx';

afterEach(() => vi.unstubAllGlobals());

const signedOut = { 'GET /api/auth/me': fail(401, 'UNAUTHENTICATED') };
const posts = (calls, url) => calls.filter((c) => c.method === 'POST' && c.url === url);

describe('sign-up form', () => {
  it('AUTH-06 a weak password shows a message and nothing is sent', async () => {
    const calls = mockApi(signedOut);
    renderApp('/signup');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Full name'), 'Rafi Ahmed');
    await user.type(screen.getByLabelText('University email'), 'rafi@baiust.ac.bd');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(
      await screen.findByText('Use 8 to 128 characters with at least one letter and one number.'),
    ).toBeInTheDocument();
    expect(posts(calls, '/api/auth/signup')).toHaveLength(0);
  });

  it('AUTH-04 teacher-only fields appear for a teacher and not for a student', async () => {
    mockApi({ ...signedOut, 'GET /api/departments': ok([{ id: 'd1', name: 'CSE' }]) });
    renderApp('/signup');
    const user = userEvent.setup();
    await screen.findByLabelText('Full name');
    expect(screen.queryByLabelText('Short code')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('Teacher'));
    expect(await screen.findByLabelText('Short code')).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: 'CSE' })).toBeInTheDocument();
  });

  it('AUTH-04 a teacher must pick a department and give a short code', async () => {
    const calls = mockApi({ ...signedOut, 'GET /api/departments': ok([]) });
    renderApp('/signup');
    const user = userEvent.setup();
    await user.click(await screen.findByLabelText('Teacher'));
    await user.type(screen.getByLabelText('Full name'), 'Dr Salma');
    await user.type(screen.getByLabelText('University email'), 'salma@baiust.ac.bd');
    await user.type(screen.getByLabelText('Password'), 'secret-pass-1');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Choose your department.')).toBeInTheDocument();
    expect(posts(calls, '/api/auth/signup')).toHaveLength(0);
  });

  it('AUTH-07 a good form is sent and the person is told to check their email', async () => {
    const calls = mockApi({
      ...signedOut,
      'POST /api/auth/signup': () => ({ ...ok({ accepted: true }), status: 202 }),
    });
    renderApp('/signup');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Full name'), 'Rafi Ahmed');
    await user.type(screen.getByLabelText('University email'), 'Rafi@Baiust.ac.bd');
    await user.type(screen.getByLabelText('Password'), 'secret-pass-1');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(posts(calls, '/api/auth/signup')[0].body).toEqual({
      kind: 'student',
      full_name: 'Rafi Ahmed',
      email: 'rafi@baiust.ac.bd',
      password: 'secret-pass-1',
    });
  });

  it('AUTH-05 a refused email domain shows the translated message', async () => {
    mockApi({ ...signedOut, 'POST /api/auth/signup': fail(400, 'EMAIL_DOMAIN_NOT_ALLOWED') });
    renderApp('/signup');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Full name'), 'Rafi Ahmed');
    await user.type(screen.getByLabelText('University email'), 'rafi@gmail.com');
    await user.type(screen.getByLabelText('Password'), 'secret-pass-1');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Use your university email address (for example name@baiust.ac.bd).',
    );
  });
});

describe('sign-in form', () => {
  const fill = async (user, password = 'secret-pass-1') => {
    await user.type(await screen.findByLabelText('University email'), 'rafi@baiust.ac.bd');
    await user.type(screen.getByLabelText('Password'), password);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
  };

  it('AUTH-12 a wrong password shows one message', async () => {
    mockApi({ ...signedOut, 'POST /api/auth/login': fail(401, 'INVALID_CREDENTIALS') });
    renderApp('/login');
    await fill(userEvent.setup());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The email or password is not correct.',
    );
  });

  it('AUTH-13 a disabled account is told only that it cannot sign in', async () => {
    mockApi({ ...signedOut, 'POST /api/auth/login': fail(403, 'ACCOUNT_DISABLED') });
    renderApp('/login');
    await fill(userEvent.setup());
    expect(await screen.findByRole('alert')).toHaveTextContent('This account cannot sign in.');
  });

  it('AUTH-14 a throttled try shows how many seconds to wait', async () => {
    mockApi({
      ...signedOut,
      'POST /api/auth/login': fail(429, 'RATE_LIMITED', {}, { 'Retry-After': '4' }),
    });
    renderApp('/login');
    await fill(userEvent.setup());
    expect(await screen.findByRole('alert')).toHaveTextContent('try again in 4 seconds');
  });

  it('AUTH-14 when a CAPTCHA is required it is solved automatically and the sign-in retried', async () => {
    const calls = mockApi({
      'GET /api/auth/me': meResponse('dashboard'), // read only after sign-in: the login page does not call it
      'GET /api/auth/captcha': ok({ id: 'c1', prefix: 'pfx', bits: 8 }),
      'POST /api/auth/login': [fail(403, 'CAPTCHA_REQUIRED'), ok({ next: 'dashboard' })],
    });
    renderApp('/login');
    await fill(userEvent.setup());
    expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
    const logins = posts(calls, '/api/auth/login');
    expect(logins).toHaveLength(2);
    expect(logins[0].body.captcha).toBeUndefined();
    expect(logins[1].body.captcha).toMatchObject({ id: 'c1' });
    expect(logins[1].body.captcha.solution).toMatch(/^\d+$/);
  });

  it('AUTH-29 after sign-in the person goes where the server says', async () => {
    mockApi({
      'GET /api/auth/me': meResponse('second-step'),
      'POST /api/auth/login': ok({ next: 'second-step' }),
    });
    renderApp('/login');
    await fill(userEvent.setup());
    expect(await screen.findByRole('heading', { name: 'Second step' })).toBeInTheDocument();
  });
});

describe('second step and authenticator setup', () => {
  it('AUTH-17 a 6 digit code is required and sent', async () => {
    const calls = mockApi({
      'GET /api/auth/me': [meResponse('second-step'), meResponse('dashboard')],
      'POST /api/auth/second-step': ok({ next: 'dashboard' }),
    });
    renderApp('/second-step');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('6 digit code'), '12');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText('Enter the 6 digit code.')).toBeInTheDocument();
    expect(posts(calls, '/api/auth/second-step')).toHaveLength(0);

    await user.clear(screen.getByLabelText('6 digit code'));
    await user.type(screen.getByLabelText('6 digit code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
    expect(posts(calls, '/api/auth/second-step')[0].body).toEqual({ code: '123456' });
  });

  it('AUTH-19 "email me a code" asks the server and says so', async () => {
    const calls = mockApi({
      'GET /api/auth/me': meResponse('second-step'),
      'POST /api/auth/second-step/email-code': ok({ accepted: true }),
    });
    renderApp('/second-step');
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Email me a code instead' }));
    expect(await screen.findByRole('status')).toHaveTextContent('We emailed you a code.');
    expect(posts(calls, '/api/auth/second-step/email-code')).toHaveLength(1);
  });

  it('AUTH-20 a wrong code shows a message, and a ended session disables the form', async () => {
    mockApi({
      'GET /api/auth/me': meResponse('second-step'),
      'POST /api/auth/second-step': [fail(400, 'CODE_INVALID'), fail(401, 'UNAUTHENTICATED')],
    });
    renderApp('/second-step');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('6 digit code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That code is not valid or has expired.',
    );
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Verify' })).toBeDisabled());
  });

  it('AUTH-18 the setup screen shows the QR code and the manual key, and confirms with a code', async () => {
    const calls = mockApi({
      'GET /api/auth/me': [meResponse('setup-totp'), meResponse('dashboard')],
      'POST /api/auth/totp/setup': ok({
        otpauth_url: 'otpauth://totp/Test:a%40b.c?secret=JBSWY3DPEHPK3PXP&issuer=Test',
        secret: 'JBSWY3DPEHPK3PXP',
      }),
      'POST /api/auth/totp/confirm': ok({ next: 'dashboard' }),
    });
    renderApp('/setup-totp');
    const user = userEvent.setup();
    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
    expect(await screen.findByAltText('QR code for your authenticator app')).toHaveAttribute(
      'src',
      expect.stringMatching(/^data:image\/png;base64,/),
    );
    await user.type(screen.getByLabelText('6 digit code'), '654321');
    await user.click(screen.getByRole('button', { name: 'Confirm and continue' }));
    expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
    expect(posts(calls, '/api/auth/totp/confirm')[0].body).toEqual({ code: '654321' });
  });
});

describe('verify, recovery and password change', () => {
  it('AUTH-10 the link in the email is sent once and success points to sign-in', async () => {
    const calls = mockApi({
      ...signedOut,
      'POST /api/auth/verify': ok({ next: 'join-form' }),
    });
    renderApp('/verify?token=abcdefghij1234567890');
    expect(await screen.findByText('Your email is confirmed.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in to continue' })).toHaveAttribute(
      'href',
      '/login',
    );
    expect(posts(calls, '/api/auth/verify')).toEqual([
      { method: 'POST', url: '/api/auth/verify', body: { token: 'abcdefghij1234567890' } },
    ]);
  });

  it('AUTH-10 an expired link offers a new one', async () => {
    const calls = mockApi({
      ...signedOut,
      'POST /api/auth/verify': fail(400, 'TOKEN_INVALID'),
      'POST /api/auth/verify/resend': ok({ accepted: true }),
    });
    renderApp('/verify?token=abcdefghij1234567890');
    const user = userEvent.setup();
    expect(
      await screen.findByRole('heading', { name: 'This link has expired' }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText('University email'), 'rafi@baiust.ac.bd');
    await user.click(screen.getByRole('button', { name: 'Send a new link' }));
    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(posts(calls, '/api/auth/verify/resend')[0].body).toEqual({ email: 'rafi@baiust.ac.bd' });
  });

  it('AUTH-25 forgot password shows the same message whatever the address', async () => {
    mockApi({ ...signedOut, 'POST /api/auth/reset/request': ok({ accepted: true }) });
    renderApp('/forgot-password');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('University email'), 'anyone@baiust.ac.bd');
    await user.click(screen.getByRole('button', { name: 'Send the link' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'If the account exists, we sent a link.',
    );
  });

  it('AUTH-26 the reset page sends the token from the link with the new password', async () => {
    const calls = mockApi({ ...signedOut, 'POST /api/auth/reset/confirm': ok({ ok: true }) });
    renderApp('/reset-password?token=abcdefghij1234567890');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('New password'), 'brand-new-pass-7');
    await user.click(screen.getByRole('button', { name: 'Save password' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Your password was changed.');
    expect(posts(calls, '/api/auth/reset/confirm')[0].body).toEqual({
      token: 'abcdefghij1234567890',
      password: 'brand-new-pass-7',
    });
  });

  it('AUTH-26 a reset page without a token says the link is not valid', async () => {
    mockApi(signedOut);
    renderApp('/reset-password');
    expect(
      await screen.findByText('This reset link is not valid. Ask for a new one.'),
    ).toBeInTheDocument();
  });

  it('AUTH-27 change password sends both passwords and shows the result', async () => {
    const calls = mockApi({
      'GET /api/auth/me': meResponse('dashboard'),
      'POST /api/me/password': ok({ ok: true }),
    });
    renderApp('/account/password');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Current password'), 'old-password-1');
    await user.type(screen.getByLabelText('New password'), 'brand-new-pass-7');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Other devices were signed out.');
    expect(posts(calls, '/api/me/password')[0].body).toEqual({
      current_password: 'old-password-1',
      new_password: 'brand-new-pass-7',
    });
  });

  it('AUTH-27 a wrong current password is shown as such', async () => {
    mockApi({
      'GET /api/auth/me': meResponse('dashboard'),
      'POST /api/me/password': fail(401, 'INVALID_CREDENTIALS'),
    });
    renderApp('/account/password');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Current password'), 'wrong-password-1');
    await user.type(screen.getByLabelText('New password'), 'brand-new-pass-7');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The email or password is not correct.',
    );
  });

  it('AUTH-23 signing out returns to the sign-in page', async () => {
    const calls = mockApi({
      'GET /api/auth/me': meResponse('dashboard'),
      'POST /api/auth/logout': () => ({ ...ok(null), status: 204 }),
    });
    renderApp('/account/password');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(posts(calls, '/api/auth/logout')).toHaveLength(1);
  });
});
