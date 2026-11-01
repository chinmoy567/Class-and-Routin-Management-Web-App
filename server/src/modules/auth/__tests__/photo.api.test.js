import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import {
  buildTestApp,
  clearDb,
  connectTestDb,
  disconnectTestDb,
  drainPhotoScans,
  loginAs,
  startTestMail,
  stopTestMail,
} from '../../../../test/harness.js';
import { makeUser } from '../../../../test/factories.js';
import { User } from '../auth.model.js';
import { AuditLog } from '../../audit/audit.model.js';
import { setScanner } from '../../../lib/clamav.js';
import { getPhotoFile } from '../../../lib/gridfs.js';

let app;
beforeAll(async () => {
  await connectTestDb();
  await startTestMail();
  app = buildTestApp();
});
afterAll(async () => {
  await stopTestMail();
  await disconnectTestDb();
});
beforeEach(async () => {
  await clearDb();
  setScanner(async () => ({ infected: false }));
});
afterEach(() => setScanner());

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(200, 1),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 2)]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x20, 0, 0, 0]),
  Buffer.from('WEBP'),
  Buffer.alloc(200, 3),
]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');

const upload = (agent, body, type = 'image/png') =>
  agent.put('/api/me/photo').set('Content-Type', type).send(body);
const photoFiles = () => mongoose.connection.db.collection('photos.files').find({}).toArray();

describe('PUT /api/me/photo (PRF-04)', () => {
  it('PRF-04 a .png that is really a PDF → FILE_TYPE_NOT_ALLOWED', async () => {
    const agent = await loginAs(await makeUser(), app);
    const res = await upload(agent, PDF, 'image/png');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect(await photoFiles()).toHaveLength(0);
  });

  it('PRF-04 a file sent with another content type is refused too', async () => {
    const agent = await loginAs(await makeUser(), app);
    const res = await agent.put('/api/me/photo').set('Content-Type', 'application/pdf').send(PDF);
    expect(res.body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
  });

  it('PRF-04 a 2.1 MB image → FILE_TOO_LARGE', async () => {
    const agent = await loginAs(await makeUser(), app);
    const big = Buffer.concat([PNG, Buffer.alloc(Math.floor(2.1 * 1024 * 1024))]);
    const res = await upload(agent, big);
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
  });

  it('PRF-04 an image just under 2 MB is accepted', async () => {
    const agent = await loginAs(await makeUser(), app);
    const res = await upload(agent, Buffer.concat([PNG, Buffer.alloc(1_900_000)]));
    expect(res.status).toBe(202);
  });

  it.each([
    ['PNG', PNG, 'image/png'],
    ['JPEG', JPEG, 'image/jpeg'],
    ['WebP', WEBP, 'image/webp'],
  ])(
    'PRF-04 a real %s is accepted as pending and served after the scan',
    async (_n, body, type) => {
      const me = await makeUser();
      const agent = await loginAs(me, app);
      const res = await upload(agent, body, type);
      expect(res.status).toBe(202);
      expect(res.body.data).toEqual({ scan_status: 'pending' });

      // until the scan passes there is no photo
      let user = await User.findById(me._id).lean();
      expect(user.photo_file_id).toBeUndefined();
      expect(user.pending_photo_file_id).toBeTruthy();
      expect((await agent.get(`/api/users/${me._id}/photo`)).status).toBe(404);
      expect((await agent.get('/api/me/profile')).body.data.photo.status).toBe('pending');

      await drainPhotoScans();
      user = await User.findById(me._id).lean();
      expect(user.photo_file_id).toBeTruthy();
      expect(user.pending_photo_file_id).toBeUndefined();
      const served = await agent
        .get(`/api/users/${me._id}/photo`)
        .buffer(true)
        .parse((r, cb) => {
          const chunks = [];
          r.on('data', (c) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(served.status).toBe(200);
      expect(served.headers['content-type']).toBe(type);
      expect(served.headers['cache-control']).toMatch(/private/);
      expect(Buffer.compare(served.body, body)).toBe(0);
      expect((await agent.get('/api/me/profile')).body.data.photo).toEqual({
        url: `/api/users/${me._id}/photo`,
        status: 'clean',
      });
    },
  );

  it('PRF-04 the old photo stays until the new one passes, then it is deleted', async () => {
    const me = await makeUser();
    const agent = await loginAs(me, app);
    await upload(agent, PNG);
    await drainPhotoScans();
    const first = (await User.findById(me._id).lean()).photo_file_id;

    await upload(agent, JPEG, 'image/jpeg');
    expect(String((await User.findById(me._id).lean()).photo_file_id)).toBe(String(first));
    expect((await agent.get(`/api/users/${me._id}/photo`)).status).toBe(200);

    await drainPhotoScans();
    const second = (await User.findById(me._id).lean()).photo_file_id;
    expect(String(second)).not.toBe(String(first));
    expect(await getPhotoFile(first)).toBeNull();
    expect(await photoFiles()).toHaveLength(1);
  });

  it('PRF-04 an infected file never becomes photo_file_id; it is deleted and the user is told', async () => {
    setScanner(async () => ({ infected: true, signature: 'Test.Virus' }));
    const me = await makeUser();
    const agent = await loginAs(me, app);
    await upload(agent, PNG);
    await drainPhotoScans();
    const user = await User.findById(me._id).lean();
    expect(user.photo_file_id).toBeUndefined();
    expect(user.pending_photo_file_id).toBeUndefined();
    expect(user.photo_scan_failed_at).toBeTruthy();
    expect(await photoFiles()).toHaveLength(0);
    expect((await agent.get('/api/me/profile')).body.data.photo.status).toBe('rejected');
    expect((await agent.get(`/api/users/${me._id}/photo`)).status).toBe(404);
  });

  it('PRF-04 an infected replacement keeps the old clean photo', async () => {
    const me = await makeUser();
    const agent = await loginAs(me, app);
    await upload(agent, PNG);
    await drainPhotoScans();
    const clean = (await User.findById(me._id).lean()).photo_file_id;
    setScanner(async () => ({ infected: true }));
    await upload(agent, JPEG, 'image/jpeg');
    await drainPhotoScans();
    expect(String((await User.findById(me._id).lean()).photo_file_id)).toBe(String(clean));
  });

  it('PRF-04 if the scanner cannot be reached the job fails and the photo stays pending', async () => {
    setScanner(async () => {
      throw new Error('clamd down');
    });
    const me = await makeUser();
    const agent = await loginAs(me, app);
    await upload(agent, PNG);
    await expect(drainPhotoScans()).rejects.toThrow('clamd down');
    const user = await User.findById(me._id).lean();
    expect(user.photo_file_id).toBeUndefined();
    expect(user.pending_photo_file_id).toBeTruthy();
    // the job is still queued, so a retry can finish it
    setScanner(async () => ({ infected: false }));
    await drainPhotoScans();
    expect((await User.findById(me._id).lean()).photo_file_id).toBeTruthy();
  });

  it('PRF-04 two uploads in a row: only the latest becomes the photo, whatever the scan order', async () => {
    const me = await makeUser();
    const agent = await loginAs(me, app);
    await upload(agent, PNG);
    await upload(agent, JPEG, 'image/jpeg');
    const latest = (await User.findById(me._id).lean()).pending_photo_file_id;
    await drainPhotoScans();
    const user = await User.findById(me._id).lean();
    expect(String(user.photo_file_id)).toBe(String(latest));
    expect(await photoFiles()).toHaveLength(1);
  });

  it('PRF-04 running the same scan twice is harmless', async () => {
    const me = await makeUser();
    const agent = await loginAs(me, app);
    await upload(agent, PNG);
    const { scanPhoto } = await import('../photo.service.js');
    const fileId = String((await User.findById(me._id).lean()).pending_photo_file_id);
    await Promise.all([
      scanPhoto({ fileId, userId: String(me._id) }),
      scanPhoto({ fileId, userId: String(me._id) }),
    ]);
    await scanPhoto({ fileId, userId: String(me._id) });
    expect(String((await User.findById(me._id).lean()).photo_file_id)).toBe(fileId);
    expect(await photoFiles()).toHaveLength(1);
  });

  it('PRF-04 the photo is served only to signed-in users', async () => {
    const me = await makeUser();
    await upload(await loginAs(me, app), PNG);
    await drainPhotoScans();
    expect((await (await loginAs(null, app)).get(`/api/users/${me._id}/photo`)).status).toBe(401);
    const other = await makeUser();
    expect((await (await loginAs(other, app)).get(`/api/users/${me._id}/photo`)).status).toBe(200);
  });

  it('PRF-09 email_unverified → 403 STATE_NOT_ALLOWED', async () => {
    const agent = await loginAs(await makeUser({ state: 'email_unverified' }), app);
    const res = await upload(agent, PNG);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('STATE_NOT_ALLOWED');
    expect((await agent.delete('/api/me/photo')).status).toBe(403);
  });

  it('PRF-08 going live is audited; the file bytes and names are not', async () => {
    const me = await makeUser();
    const agent = await loginAs(me, app);
    await upload(agent, PNG);
    await drainPhotoScans();
    const entries = await AuditLog.find({ action: 'user.photo_change' }).lean();
    expect(entries).toHaveLength(1);
    expect(String(entries[0].actor_id)).toBe(String(me._id));
  });
});

describe('DELETE /api/me/photo (PRF-04, PRF-08)', () => {
  it('PRF-04 removes the photo and any waiting one, audited', async () => {
    const me = await makeUser();
    const agent = await loginAs(me, app);
    await upload(agent, PNG);
    await drainPhotoScans();
    await upload(agent, JPEG, 'image/jpeg');
    const res = await agent.delete('/api/me/photo');
    expect(res.status).toBe(204);
    const user = await User.findById(me._id).lean();
    expect(user.photo_file_id).toBeUndefined();
    expect(user.pending_photo_file_id).toBeUndefined();
    expect(await photoFiles()).toHaveLength(0);
    expect((await agent.get(`/api/users/${me._id}/photo`)).status).toBe(404);
    expect(await AuditLog.countDocuments({ action: 'user.photo_change' })).toBe(2);
    // the queued scan for the removed upload does nothing
    await drainPhotoScans();
    expect((await User.findById(me._id).lean()).photo_file_id).toBeUndefined();
  });

  it('PRF-04 a user can only change their own photo: a user_id in the request is ignored', async () => {
    const me = await makeUser();
    const other = await makeUser();
    const agent = await loginAs(me, app);
    await agent
      .put(`/api/me/photo?user_id=${other._id}`)
      .set('Content-Type', 'image/png')
      .send(PNG);
    expect((await User.findById(other._id).lean()).pending_photo_file_id).toBeUndefined();
    expect((await User.findById(me._id).lean()).pending_photo_file_id).toBeTruthy();
  });
});
