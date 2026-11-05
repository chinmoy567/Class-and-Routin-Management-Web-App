import { describe, it, expect } from 'vitest';
import { sendRoomRequestBody, roomRequestDecisionBody } from '../schemas/roomRequests.js';
import { ERROR_CODES, ROOM_NOT_FREE, TOO_EARLY } from '../errors.js';

const ID = '64b000000000000000000001';
const base = {
  room_id: ID,
  date: '2026-11-11',
  start: 695, // 11:35
  end: 750, // 12:30
  note: 'Lab class for group G1',
  target_section_id: ID,
};

describe('BKG-02 request shape', () => {
  it('BKG-02 accepts a 5-minute aligned range of 30 min to 3 h between 08:00 and 18:00', () => {
    expect(sendRoomRequestBody.safeParse(base).success).toBe(true);
  });

  it('BKG-02 refuses a start or end that is not on a 5-minute boundary', () => {
    expect(sendRoomRequestBody.safeParse({ ...base, start: 697 }).success).toBe(false);
  });

  it('BKG-02 refuses a range shorter than 30 minutes', () => {
    expect(sendRoomRequestBody.safeParse({ ...base, start: 600, end: 610 }).success).toBe(false);
  });

  it('BKG-02 refuses a range longer than 3 hours', () => {
    expect(sendRoomRequestBody.safeParse({ ...base, start: 480, end: 670 }).success).toBe(false);
  });

  it('BKG-02 refuses times outside 08:00 to 18:00', () => {
    expect(sendRoomRequestBody.safeParse({ ...base, start: 470, end: 500 }).success).toBe(false);
    expect(sendRoomRequestBody.safeParse({ ...base, start: 1060, end: 1090 }).success).toBe(false);
  });

  it('BKG-02 requires a note of 5 to 300 characters', () => {
    expect(sendRoomRequestBody.safeParse({ ...base, note: 'abc' }).success).toBe(false);
    expect(sendRoomRequestBody.safeParse({ ...base, note: 'x'.repeat(301) }).success).toBe(false);
  });

  it('BKG-02 refuses unknown keys, so the requester cannot slip in extra fields', () => {
    expect(sendRoomRequestBody.safeParse({ ...base, requester_id: ID }).success).toBe(false);
  });
});

describe('BKG-14, BKG-15 decision shape', () => {
  it('BKG-14 accepts approve with no body note', () => {
    expect(roomRequestDecisionBody.safeParse({ decision: 'approve' }).success).toBe(true);
  });

  it('BKG-14 accepts reject with an optional note', () => {
    expect(roomRequestDecisionBody.safeParse({ decision: 'reject' }).success).toBe(true);
  });

  it('BKG-14 refuses an unknown decision', () => {
    expect(roomRequestDecisionBody.safeParse({ decision: 'maybe' }).success).toBe(false);
  });
});

describe('booking error codes', () => {
  it('BKG-04 ROOM_NOT_FREE is a 409', () => {
    expect(ERROR_CODES.ROOM_NOT_FREE).toEqual({ code: 'ROOM_NOT_FREE', status: 409 });
    expect(ROOM_NOT_FREE).toBe('ROOM_NOT_FREE');
  });

  it('BKG-23 TOO_EARLY is a 409', () => {
    expect(ERROR_CODES.TOO_EARLY.status).toBe(409);
    expect(TOO_EARLY).toBe('TOO_EARLY');
  });
});
