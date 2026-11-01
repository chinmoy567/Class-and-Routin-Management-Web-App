import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, mockApi, meResponse, ok, renderApp } from '@/test/mockApi.jsx';

afterEach(() => vi.unstubAllGlobals());

const studentProfile = (over = {}) => ({
  id: 'u1',
  full_name: 'Rafi Ahmed',
  email: 'rafi@baiust.ac.bd',
  phone: '+8801712345678',
  kind: 'student',
  state: 'active',
  email_bouncing: false,
  photo: { url: null, status: 'none' },
  roles: [{ role: 'cr', label: 'cr' }],
  student: {
    department_id: null,
    level: null,
    term: null,
    section: null,
    group: null,
    confirmed_semester: null,
  },
  ...over,
});

const base = (profile = studentProfile(), extra = {}) => ({
  'GET /api/auth/me': meResponse('dashboard'),
  'GET /api/me/profile': ok(profile),
  ...extra,
});

const sent = (calls, method, url) => calls.filter((c) => c.method === method && c.url === url);

describe('my profile (PRF-01)', () => {
  it('PRF-01 a student sees their name, email, phone and roles', async () => {
    mockApi(base());
    renderApp('/profile');
    expect(await screen.findByRole('heading', { name: 'Rafi Ahmed' })).toBeInTheDocument();
    expect(screen.getByText('rafi@baiust.ac.bd')).toBeInTheDocument();
    expect(screen.getByText('+8801712345678')).toBeInTheDocument();
    expect(screen.getByText('CR')).toBeInTheDocument();
    expect(screen.getByText('Sessional group')).toBeInTheDocument();
  });

  it('PRF-01 the semester badge shows when a student was last confirmed', async () => {
    mockApi(
      base(
        studentProfile({
          student: {
            department_id: 'd1',
            level: 2,
            term: 'II',
            section: 'A',
            group: 'A1',
            confirmed_semester: 'Fall 2026',
          },
        }),
      ),
    );
    renderApp('/profile');
    expect(await screen.findByText('Fall 2026 confirmed')).toBeInTheDocument();
  });

  it('PRF-01 a teacher with no short code link sees "Not linked yet"', async () => {
    mockApi(
      base({
        ...studentProfile({ kind: 'teacher', roles: [] }),
        student: undefined,
        teacher: { department_id: 'd1', short_code: null, linked: false },
      }),
    );
    renderApp('/profile');
    expect(await screen.findByText('Not linked yet')).toBeInTheDocument();
    expect(screen.queryByText('Sessional group')).not.toBeInTheDocument();
  });

  it('PRF-02 the name cannot be edited here: there is no name field, only a hint', async () => {
    mockApi(base());
    renderApp('/profile');
    await screen.findByRole('heading', { name: 'Rafi Ahmed' });
    expect(screen.queryByLabelText('Full name')).not.toBeInTheDocument();
    expect(screen.getByText('Only a department admin can change your name.')).toBeInTheDocument();
  });

  it('PRF-09 a refused state shows the "cannot use this yet" message', async () => {
    mockApi({
      'GET /api/auth/me': meResponse('dashboard'),
      'GET /api/me/profile': fail(403, 'STATE_NOT_ALLOWED'),
    });
    renderApp('/profile');
    expect(await screen.findByRole('alert')).toHaveTextContent('Your account cannot use this yet.');
  });
});

describe('phone form (PRF-03)', () => {
  it('PRF-03 12345 shows a message and nothing is sent', async () => {
    const calls = mockApi(base());
    renderApp('/profile');
    const user = userEvent.setup();
    const box = await screen.findByLabelText('Phone number');
    await user.clear(box);
    await user.type(box, '12345');
    await user.click(screen.getByRole('button', { name: 'Save phone' }));
    expect(await screen.findByText(/Enter a Bangladeshi mobile number/)).toBeInTheDocument();
    expect(sent(calls, 'PATCH', '/api/me/profile')).toHaveLength(0);
  });

  it('PRF-03 01712345678 is sent normalised as +8801712345678', async () => {
    const calls = mockApi(
      base(studentProfile({ phone: null }), {
        'PATCH /api/me/profile': ok(studentProfile({ phone: '+8801712345678' })),
      }),
    );
    renderApp('/profile');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Phone number'), '01712345678');
    await user.click(screen.getByRole('button', { name: 'Save phone' }));
    expect(await screen.findByText('Your phone number was saved.')).toBeInTheDocument();
    expect(sent(calls, 'PATCH', '/api/me/profile')[0].body).toEqual({ phone: '+8801712345678' });
  });

  it('PRF-03 an empty box clears the phone (null)', async () => {
    const calls = mockApi(
      base(studentProfile(), {
        'PATCH /api/me/profile': ok(studentProfile({ phone: null })),
      }),
    );
    renderApp('/profile');
    const user = userEvent.setup();
    await user.clear(await screen.findByLabelText('Phone number'));
    await user.click(screen.getByRole('button', { name: 'Save phone' }));
    await waitFor(() => expect(sent(calls, 'PATCH', '/api/me/profile')).toHaveLength(1));
    expect(sent(calls, 'PATCH', '/api/me/profile')[0].body).toEqual({ phone: null });
  });
});

describe('photo (PRF-04)', () => {
  const file = (name, type, size = 1000) => {
    const f = new File(['x'], name, { type });
    Object.defineProperty(f, 'size', { value: size });
    return f;
  };

  it('PRF-04 a PDF is refused in the browser and nothing is sent', async () => {
    const calls = mockApi(base());
    renderApp('/profile');
    const user = userEvent.setup({ applyAccept: false });
    await user.upload(
      await screen.findByLabelText('Add a photo'),
      file('cv.pdf', 'application/pdf'),
    );
    expect(await screen.findByText('Use a JPEG, PNG or WebP image.')).toBeInTheDocument();
    expect(sent(calls, 'PUT', '/api/me/photo')).toHaveLength(0);
  });

  it('PRF-04 a photo over 2 MB is refused in the browser', async () => {
    const calls = mockApi(base());
    renderApp('/profile');
    const user = userEvent.setup();
    await user.upload(
      await screen.findByLabelText('Add a photo'),
      file('big.png', 'image/png', 2.1 * 1024 * 1024),
    );
    expect(await screen.findByText('The photo must be 2 MB or smaller.')).toBeInTheDocument();
    expect(sent(calls, 'PUT', '/api/me/photo')).toHaveLength(0);
  });

  it('PRF-04 a good photo is sent as the file itself', async () => {
    const calls = mockApi(
      base(studentProfile(), { 'PUT /api/me/photo': ok({ scan_status: 'pending' }) }),
    );
    renderApp('/profile');
    const user = userEvent.setup();
    await user.upload(await screen.findByLabelText('Add a photo'), file('me.png', 'image/png'));
    await waitFor(() => expect(sent(calls, 'PUT', '/api/me/photo')).toHaveLength(1));
    expect(sent(calls, 'PUT', '/api/me/photo')[0].body).toBeInstanceOf(Blob);
  });

  it('PRF-04 while the scan runs the screen says so; a failed scan tells the user', async () => {
    mockApi(base(studentProfile({ photo: { url: null, status: 'pending' } })));
    const { unmount } = renderApp('/profile');
    expect(await screen.findByRole('status')).toHaveTextContent('Checking your photo');
    unmount();
    mockApi(base(studentProfile({ photo: { url: null, status: 'rejected' } })));
    renderApp('/profile');
    expect(await screen.findByText(/did not pass the safety check/)).toBeInTheDocument();
  });

  it('PRF-04 the server refusing the type shows the translated message', async () => {
    mockApi(base(studentProfile(), { 'PUT /api/me/photo': fail(415, 'FILE_TYPE_NOT_ALLOWED') }));
    renderApp('/profile');
    const user = userEvent.setup();
    await user.upload(await screen.findByLabelText('Add a photo'), file('me.png', 'image/png'));
    expect(await screen.findByText('Use a JPEG, PNG or WebP image.')).toBeInTheDocument();
  });
});

describe('change email (PRF-05)', () => {
  it('PRF-05 sending a new address tells the person to check it', async () => {
    const calls = mockApi(
      base(studentProfile(), {
        'POST /api/me/email': () => ({ ...ok({ accepted: true }), status: 202 }),
      }),
    );
    renderApp('/profile');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('New university email'), 'New@Baiust.ac.bd');
    await user.click(screen.getByRole('button', { name: 'Send the link' }));
    expect(await screen.findByText(/We sent a link to the new address/)).toBeInTheDocument();
    expect(sent(calls, 'POST', '/api/me/email')[0].body).toEqual({ new_email: 'new@baiust.ac.bd' });
  });

  it('PRF-05 a bad address shows a message and nothing is sent', async () => {
    const calls = mockApi(base());
    renderApp('/profile');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('New university email'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Send the link' }));
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(sent(calls, 'POST', '/api/me/email')).toHaveLength(0);
  });

  it('PRF-05 an address already in use shows the conflict message', async () => {
    mockApi(base(studentProfile(), { 'POST /api/me/email': fail(409, 'CONFLICT') }));
    renderApp('/profile');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('New university email'), 'taken@baiust.ac.bd');
    await user.click(screen.getByRole('button', { name: 'Send the link' }));
    expect(await screen.findByText(/already exists/)).toBeInTheDocument();
  });
});

describe('email confirmation page (PRF-05)', () => {
  it('PRF-05 a good link sends the token once and says the email changed', async () => {
    const calls = mockApi({
      'GET /api/auth/me': meResponse('dashboard'),
      'POST /api/me/email/confirm': ok({ ok: true }),
    });
    renderApp('/confirm-email?token=abcdefghijklmnop');
    expect(await screen.findByText(/Your email was changed/)).toBeInTheDocument();
    expect(sent(calls, 'POST', '/api/me/email/confirm')).toHaveLength(1);
    expect(sent(calls, 'POST', '/api/me/email/confirm')[0].body).toEqual({
      token: 'abcdefghijklmnop',
    });
  });

  it.each([
    ['TOKEN_INVALID', 400, 'This link has expired or was already used.'],
    ['CONFLICT', 409, 'already exists'],
  ])('PRF-05 %s is explained', async (code, status, text) => {
    mockApi({
      'GET /api/auth/me': fail(401, 'UNAUTHENTICATED'),
      'POST /api/me/email/confirm': fail(status, code),
    });
    renderApp('/confirm-email?token=abcdefghijklmnop');
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
  });

  it('PRF-05 a link with no token is not sent anywhere', async () => {
    const calls = mockApi({ 'GET /api/auth/me': fail(401, 'UNAUTHENTICATED') });
    renderApp('/confirm-email');
    expect(await screen.findByText('This link is not valid')).toBeInTheDocument();
    expect(sent(calls, 'POST', '/api/me/email/confirm')).toHaveLength(0);
  });
});

describe('bouncing email banner (PRF-06)', () => {
  it('PRF-06 the banner shows while email_action_required is true', async () => {
    mockApi(
      base(studentProfile(), {
        'GET /api/auth/me': meResponse('dashboard', { email_action_required: true }),
      }),
    );
    renderApp('/');
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent('Your email address is not working');
    expect(within(banner).getByRole('link', { name: 'Change my email' })).toHaveAttribute(
      'href',
      '/profile#email',
    );
  });

  it('PRF-06 no banner when the email is fine', async () => {
    mockApi(base());
    renderApp('/');
    await screen.findByRole('heading', { name: 'Welcome' });
    expect(screen.queryByText('Your email address is not working')).not.toBeInTheDocument();
  });
});

describe('public profile (PRF-07)', () => {
  it('PRF-07 shows the name and role labels and nothing private', async () => {
    mockApi({
      'GET /api/auth/me': meResponse('dashboard'),
      'GET /api/users/u2': ok({
        id: 'u2',
        full_name: 'Nila Rahman',
        photo_url: null,
        department_id: 'd1',
        roles: ['student', 'cr'],
      }),
    });
    renderApp('/users/u2');
    expect(await screen.findByRole('heading', { name: 'Nila Rahman' })).toBeInTheDocument();
    const roles = screen.getByRole('list', { name: 'Roles' });
    expect(within(roles).getByText('Student')).toBeInTheDocument();
    expect(within(roles).getByText('CR')).toBeInTheDocument();
    for (const word of ['Email', 'Phone', 'Level', 'Section', 'Sessional group'])
      expect(screen.queryByText(word)).not.toBeInTheDocument();
  });

  it('PRF-07 an unknown person shows the not-found message', async () => {
    mockApi({
      'GET /api/auth/me': meResponse('dashboard'),
      'GET /api/users/zz': fail(404, 'NOT_FOUND'),
    });
    renderApp('/users/zz');
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not find that.');
  });
});
