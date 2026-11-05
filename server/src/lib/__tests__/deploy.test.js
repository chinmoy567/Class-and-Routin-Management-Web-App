// OPS checks that read the deployment files: they run in CI with no Docker needed.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Every .js file under the given folders, without tests. */
function sourceFiles(dirs) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '__tests__' || e.name === 'node_modules') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) out.push(p);
    }
  };
  for (const d of dirs) walk(path.join(ROOT, d));
  return out;
}

describe('OPS-03 the app role covers every collection the code uses', () => {
  const init = read('deploy/mongo/init-users.js');
  const listed = new Set(
    [...init.match(/APP_COLLECTIONS = \[([\s\S]*?)\];/)[1].matchAll(/'([\w.]+)'/g)].map((m) => m[1]),
  );

  it('OPS-03 every literal collection or GridFS bucket in server code is in APP_COLLECTIONS', () => {
    const used = new Set();
    for (const file of sourceFiles(['server/src', 'server/scripts'])) {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(
        /(?:collection\(|collection:\s*|collectionName:\s*|collection\s*=\s*|bucketName:\s*)['"]([\w.]+)['"]/g,
      )) {
        const name = m[1];
        // A GridFS bucket is stored as <bucket>.files and <bucket>.chunks.
        if (text.includes(`bucketName: '${name}'`)) {
          used.add(`${name}.files`);
          used.add(`${name}.chunks`);
        } else {
          used.add(name);
        }
      }
    }
    // audit_log is granted on its own (find, insert, indexes only), so it is not in the list.
    const missing = [...used].filter((n) => n !== 'audit_log' && !listed.has(n));
    expect(missing).toEqual([]);
  });

  it('OPS-03 audit_log is never in the list, and the app cannot update or delete it', () => {
    expect(listed.has('audit_log')).toBe(false);
    const audit = init.match(/AUDIT_ACTIONS = \[([^\]]*)\]/)[1];
    expect(audit).not.toMatch(/update|remove|drop/);
  });

  it('OPS-03 the backup user only gets the built-in backup role', () => {
    expect(init).toMatch(/backupRoles = \[\{ role: 'backup', db: 'admin' \}\]/);
  });
});

describe('OPS-01 / OPS-02 / OPS-03 / OPS-05 the compose stack', () => {
  const compose = read('deploy/docker-compose.yml');
  const services = compose.split(/\n {2}(?=[a-z]+:\n)/).slice(1);
  const service = (name) => services.find((s) => s.startsWith(`${name}:`));

  it('OPS-03 MongoDB publishes no port and runs with auth and a keyfile', () => {
    const mongo = service('mongo');
    expect(mongo).not.toMatch(/\n\s+ports:/);
    expect(mongo).toMatch(/--auth/);
    expect(mongo).toMatch(/--keyFile/);
  });

  it('OPS-05 every service restarts automatically', () => {
    for (const name of ['caddy', 'server', 'mongo', 'clamav']) {
      expect(service(name), name).toMatch(/restart: unless-stopped/);
    }
  });

  it('OPS-05 the server and mongo have health checks, the server checks /api/health', () => {
    expect(service('server')).toMatch(/\/api\/health/);
    expect(service('mongo')).toMatch(/healthcheck:/);
    expect(service('clamav')).toMatch(/healthcheck:/);
  });

  it('OPS-12 container logs rotate (json-file, 14 files)', () => {
    expect(compose).toMatch(/max-file: "14"/);
  });

  it('OPS-02 Caddy sets HSTS and proxies /api and /socket.io (WebSocket included)', () => {
    const caddy = read('deploy/Caddyfile');
    expect(caddy).toMatch(/Strict-Transport-Security/);
    expect(caddy).toMatch(/handle \/api\/\*[\s\S]*reverse_proxy server:4000/);
    expect(caddy).toMatch(/handle \/socket\.io\/\*[\s\S]*reverse_proxy server:4000/);
  });

  it('OPS-01 the server image runs as a non-root user with a health check', () => {
    const dockerfile = read('server/Dockerfile');
    expect(dockerfile).toMatch(/USER node/);
    expect(dockerfile).toMatch(/HEALTHCHECK/);
  });
});

describe('OPS-04 / OPS-06 / OPS-08 scripts and CI', () => {
  it('OPS-08 the backup refuses to run without an off-site destination', () => {
    expect(read('deploy/backup/backup.sh')).toMatch(/: "\$\{BACKUP_REMOTE:\?/);
  });

  it('OPS-08 backups are encrypted before they leave the server', () => {
    const backup = read('deploy/backup/backup.sh');
    expect(backup).toMatch(/openssl enc -aes-256-cbc/);
    expect(backup.indexOf('openssl enc')).toBeLessThan(backup.indexOf('rclone copy'));
  });

  it('OPS-06 the image workflow lowercases the repository name for ghcr', () => {
    expect(read('.github/workflows/images.yml')).toMatch(/tr '\[:upper:\]' '\[:lower:\]'/);
  });

  it('OPS-04 the env template keeps secrets empty and git-ignores the real file', () => {
    const example = read('deploy/.env.production.example');
    expect(example).toMatch(/DATA_ENC_KEY=\n/);
    expect(read('deploy/.gitignore')).toMatch(/\.env\.production/);
  });
});
