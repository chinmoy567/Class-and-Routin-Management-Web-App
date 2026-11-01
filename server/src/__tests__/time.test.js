import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  clock,
  institutionNow,
  toInstitutionDate,
  minutesOfDay,
  instantFrom,
  weekStart,
  weekdayOf,
  addDays,
} from '../lib/time.js';

afterEach(() => clock.reset());

describe('time', () => {
  it('FND-12 17:34Z is 23:34 on 2026-11-10 in Dhaka', () => {
    clock.set('2026-11-10T17:34:00Z');
    expect(toInstitutionDate(institutionNow())).toBe('2026-11-10');
    expect(minutesOfDay(institutionNow())).toBe(1414);
  });

  it('FND-12 18:05Z is already 2026-11-11 in Dhaka', () => {
    clock.set('2026-11-10T18:05:00Z');
    expect(toInstitutionDate(institutionNow())).toBe('2026-11-11');
  });

  it('FND-12 weekStart of a Monday is the Sunday before', () => {
    expect(weekStart('2026-11-09')).toBe('2026-11-08');
    expect(weekStart('2026-11-08')).toBe('2026-11-08');
    expect(weekdayOf('2026-11-08')).toBe(0);
  });

  it('FND-12 addDays crosses month ends', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('FND-12 instantFrom turns an institution date and minutes into UTC', () => {
    expect(instantFrom('2026-11-11', 695).toISOString()).toBe('2026-11-11T05:35:00.000Z');
    expect(instantFrom('2026-11-11', 0).toISOString()).toBe('2026-11-10T18:00:00.000Z');
  });

  it('FND-13 no new Date() or Date.now() in server/src outside lib/time.js and tests', () => {
    const root = path.resolve(import.meta.dirname, '..');
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') walk(full);
        } else if (entry.name.endsWith('.js') && !full.endsWith(path.join('lib', 'time.js'))) {
          const text = fs.readFileSync(full, 'utf8');
          if (/new Date\(\s*\)|Date\.now\(/.test(text)) offenders.push(full);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
