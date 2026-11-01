import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connectTestDb, disconnectTestDb } from '../../../../test/harness.js';
import { seedSuperAdmin, User, UserRole } from '../index.js';
import { isDomainAllowed } from '../../organisation/index.js';
import { list } from '../../audit/index.js';
import { emailHmac, hashToken } from '../../../lib/crypto.js';

beforeAll(connectTestDb);
afterAll(disconnectTestDb);

describe('seed super admin', () => {
  it('FND-36 creates the first super admin, the allowed domain, an audit entry and a reset link', async () => {
    const { userId, resetLink } = await seedSuperAdmin({
      email: 'Root@Baiust.ac.bd',
      name: 'Root',
      appUrl: 'http://localhost:5173',
    });
    const user = await User.findById(userId).select('+reset_token_hash');
    expect(user).toMatchObject({
      kind: 'staff',
      state: 'active',
      email_hmac: emailHmac('root@baiust.ac.bd'),
    });
    expect(user.email_verified_at).toBeInstanceOf(Date);
    expect(await UserRole.countDocuments({ user_id: userId, role: 'super_admin' })).toBe(1);
    expect(await isDomainAllowed('baiust.ac.bd')).toBe(true);

    const token = new URL(resetLink).searchParams.get('token');
    expect(resetLink).toMatch(/^http:\/\/localhost:5173\/reset-password\?token=/);
    expect(user.reset_token_hash).toBe(hashToken(token));
    expect(await list({ action: 'super_admin.create' })).toHaveLength(1);
  });

  it('FND-36 refuses to run twice and changes nothing', async () => {
    await expect(
      seedSuperAdmin({ email: 'second@baiust.ac.bd', name: 'Second', appUrl: 'http://x' }),
    ).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
    expect(await UserRole.countDocuments({ role: 'super_admin' })).toBe(1);
    expect(await User.countDocuments({})).toBe(1);
  });
});
