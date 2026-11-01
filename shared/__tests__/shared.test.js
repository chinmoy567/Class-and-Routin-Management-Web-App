import { describe, it, expect } from 'vitest';
import {
  ERROR_CODES,
  ACCOUNT_STATES,
  ROLES,
  SOCKET_EVENTS,
  INSTITUTION_TIMEZONE,
} from '../index.js';
import { objectIdString, dateString } from '../schemas/index.js';

describe('shared', () => {
  it('FND-11 every error code constant matches its table key and has an HTTP status', () => {
    for (const [key, v] of Object.entries(ERROR_CODES)) {
      expect(v.code).toBe(key);
      expect(v.status).toBeGreaterThanOrEqual(400);
    }
  });

  it('FND-01 enums list the PRD states, roles and push events', () => {
    expect(ACCOUNT_STATES).toEqual(
      expect.arrayContaining([
        'email_unverified',
        'claim_pending',
        'active',
        'unconfirmed',
        'graduated',
        'deactivated',
        'pending',
        'suspended',
      ]),
    );
    expect(ROLES).toEqual(['super_admin', 'dept_admin', 'teacher', 'cr', 'dcr']);
    expect(Object.values(SOCKET_EVENTS).sort()).toEqual([
      'booking.changed',
      'calendar.changed',
      'message.new',
      'message.status',
      'routine.changed',
    ]);
    expect(INSTITUTION_TIMEZONE).toBe('Asia/Dhaka');
  });

  it('FND-10 the shared schemas accept good ids and dates and reject bad ones', () => {
    expect(objectIdString.safeParse('507f1f77bcf86cd799439011').success).toBe(true);
    expect(objectIdString.safeParse('nope').success).toBe(false);
    expect(dateString.safeParse('2026-11-10').success).toBe(true);
    expect(dateString.safeParse('10/11/2026').success).toBe(false);
  });
});
