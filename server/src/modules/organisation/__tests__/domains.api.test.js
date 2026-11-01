import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import {
  buildTestApp,
  clearDb,
  connectTestDb,
  disconnectTestDb,
  loginAs,
  signIn,
} from '../../../../test/harness.js';
import { TEST_PASSWORD, makeDepartment, makeUser } from '../../../../test/factories.js';
import { AllowedDomain } from '../organisation.model.js';
import { addAllowedDomain, isDomainAllowed } from '../index.js';
import { list as auditList } from '../../audit/index.js';

let app;
beforeAll(async () => {
  await connectTestDb();
  app = buildTestApp();
});
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearDb();
  await addAllowedDomain('baiust.ac.bd');
});

const superAdmin = () => makeUser({ kind: 'staff', roles: [{ role: 'super_admin' }] });
const domains = async () => (await AllowedDomain.find().lean()).map((d) => d.domain).sort();

describe('allowed email domains (AUTH-28)', () => {
  it('AUTH-28 a super admin lists, adds and removes domains', async () => {
    const agent = await loginAs(await superAdmin(), app);
    const list = await agent.get('/api/admin/email-domains');
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([{ domain: 'baiust.ac.bd' }]);

    const added = await agent.post('/api/admin/email-domains').send({ domain: 'Example.AC.bd ' });
    expect(added.status).toBe(201);
    expect(added.body.data).toEqual({ domain: 'example.ac.bd' });
    expect(await domains()).toEqual(['baiust.ac.bd', 'example.ac.bd']);

    const removed = await agent.delete('/api/admin/email-domains/example.ac.bd');
    expect(removed.status).toBe(204);
    expect(await domains()).toEqual(['baiust.ac.bd']);
  });

  it('AUTH-28 adding a domain that is already there is a CONFLICT, even when added together', async () => {
    const agent = await loginAs(await superAdmin(), app);
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        agent.post('/api/admin/email-domains').send({ domain: 'twice.ac.bd' }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.body.error?.code === 'CONFLICT')).toHaveLength(3);
    expect(await AllowedDomain.countDocuments({ domain: 'twice.ac.bd' })).toBe(1);
  });

  it('AUTH-28 a bad domain is a validation error', async () => {
    const agent = await loginAs(await superAdmin(), app);
    for (const domain of ['', 'nodots', 'has space.com', '@baiust.ac.bd']) {
      const res = await agent.post('/api/admin/email-domains').send({ domain });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('AUTH-28 at least one domain must remain', async () => {
    const agent = await loginAs(await superAdmin(), app);
    const res = await agent.delete('/api/admin/email-domains/baiust.ac.bd');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LAST_DOMAIN');
    expect(await domains()).toEqual(['baiust.ac.bd']);
  });

  it('AUTH-28 removing the last two domains at the same moment still leaves one', async () => {
    const agent = await loginAs(await superAdmin(), app);
    for (let round = 0; round < 3; round++) {
      await AllowedDomain.deleteMany({});
      await addAllowedDomain('baiust.ac.bd');
      await addAllowedDomain('second.ac.bd');
      const results = await Promise.all([
        agent.delete('/api/admin/email-domains/baiust.ac.bd'),
        agent.delete('/api/admin/email-domains/second.ac.bd'),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([204, 409]);
      expect(await AllowedDomain.countDocuments()).toBe(1);
    }
  });

  it('AUTH-28 removing a domain that is not on the list is NOT_FOUND', async () => {
    await addAllowedDomain('second.ac.bd');
    const agent = await loginAs(await superAdmin(), app);
    const res = await agent.delete('/api/admin/email-domains/missing.ac.bd');
    expect(res.status).toBe(404);
  });

  it('AUTH-28 each change is audited with who, what and the old or new value', async () => {
    const admin = await superAdmin();
    const agent = await loginAs(admin, app);
    await agent.post('/api/admin/email-domains').send({ domain: 'example.ac.bd' });
    await agent.delete('/api/admin/email-domains/example.ac.bd');
    const [removed] = await auditList({ action: 'allowed_domain.remove' });
    const [added] = await auditList({ action: 'allowed_domain.add' });
    expect(String(added.actor_id)).toBe(String(admin._id));
    expect(added).toMatchObject({ target_type: 'allowed_domain', target_id: 'example.ac.bd' });
    expect(added.new_value).toEqual({ domain: 'example.ac.bd' });
    expect(removed.old_value).toEqual({ domain: 'example.ac.bd' });
    expect(added.actor_roles).toEqual([{ role: 'super_admin' }]);
  });

  it('AUTH-28 a failed change leaves no audit entry', async () => {
    const agent = await loginAs(await superAdmin(), app);
    await agent.delete('/api/admin/email-domains/baiust.ac.bd'); // LAST_DOMAIN
    await agent.post('/api/admin/email-domains').send({ domain: 'baiust.ac.bd' }); // CONFLICT
    expect(await auditList({ action: /^allowed_domain\./ })).toHaveLength(0);
  });

  it('AUTH-05 AUTH-28 sign-up follows the list: an added domain is accepted, a removed one is refused', async () => {
    const agent = await loginAs(await superAdmin(), app);
    const anon = await loginAs(null, app);
    const signup = (email) =>
      anon
        .post('/api/auth/signup')
        .send({ kind: 'student', full_name: 'Sam Roy', email, password: 'secret-pass-1' });
    expect((await signup('a@new.ac.bd')).body.error.code).toBe('EMAIL_DOMAIN_NOT_ALLOWED');
    await agent.post('/api/admin/email-domains').send({ domain: 'new.ac.bd' });
    expect(await isDomainAllowed('new.ac.bd')).toBe(true);
    // (the global rate limit is per IP, so use a fresh agent for each sign-up)
    expect((await signup('a@new.ac.bd')).status).not.toBe(400);
    await agent.delete('/api/admin/email-domains/new.ac.bd');
    expect((await signup('b@new.ac.bd')).body.error.code).toBe('EMAIL_DOMAIN_NOT_ALLOWED');
  });
});

describe('who may manage domains (cross-scope refusals)', () => {
  const calls = [
    (a) => a.get('/api/admin/email-domains'),
    (a) => a.post('/api/admin/email-domains').send({ domain: 'evil.ac.bd' }),
    (a) => a.delete('/api/admin/email-domains/baiust.ac.bd'),
  ];

  it.each([
    ['a student', { kind: 'student', state: 'active' }],
    ['a CR', { kind: 'student', state: 'active', roles: [{ role: 'cr' }] }],
    ['a teacher', { kind: 'teacher', state: 'active', roles: [{ role: 'teacher' }] }],
    ['a pending teacher', { kind: 'teacher', state: 'pending' }],
    ['an unconfirmed student', { kind: 'student', state: 'unconfirmed' }],
  ])('AUTH-28 %s is refused', async (_label, spec) => {
    const agent = await loginAs(await makeUser(spec), app);
    for (const call of calls) {
      const res = await call(agent);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    expect(await domains()).toEqual(['baiust.ac.bd']);
  });

  it('AUTH-28 a department admin is refused, for their own department and for any other', async () => {
    const own = makeDepartment();
    const admin = await makeUser({
      kind: 'teacher',
      roles: [{ role: 'teacher' }, { role: 'dept_admin', department_id: own._id }],
    });
    const agent = await loginAs(admin, app);
    for (const call of calls) expect((await call(agent)).status).toBe(403);
    expect(await domains()).toEqual(['baiust.ac.bd']);
  });

  it('AUTH-28 a super admin who has not passed the second step gets SECOND_STEP_REQUIRED', async () => {
    const admin = await makeUser({
      kind: 'staff',
      roles: [{ role: 'super_admin' }],
      password: TEST_PASSWORD,
      totp: true,
    });
    const { agent } = await signIn(app, admin.email, TEST_PASSWORD);
    for (const call of calls) {
      const res = await call(agent);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('SECOND_STEP_REQUIRED');
    }
    expect(await domains()).toEqual(['baiust.ac.bd']);
  });

  it('AUTH-28 a deactivated super admin is refused', async () => {
    const admin = await makeUser({
      kind: 'staff',
      state: 'deactivated',
      roles: [{ role: 'super_admin' }],
    });
    const agent = await loginAs(admin, app);
    for (const call of calls) expect((await call(agent)).status).toBe(401);
  });

  it('AUTH-28 a signed-out caller is refused', async () => {
    const agent = await loginAs(null, app);
    for (const call of calls) {
      const res = await call(agent);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('AUTH-28 a change without a CSRF token is refused', async () => {
    const admin = await superAdmin();
    const agent = request.agent(app);
    await agent.get('/api/__test__/login').query({ userId: String(admin._id) });
    const res = await agent.post('/api/admin/email-domains').send({ domain: 'evil.ac.bd' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_FAILED');
  });
});
