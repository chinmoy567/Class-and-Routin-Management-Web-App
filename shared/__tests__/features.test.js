import { describe, it, expect } from 'vitest';
import { isReleased, FEATURE_RELEASE, CURRENT_RELEASE } from '../features.js';

describe('DSH-02 release flags', () => {
  it('DSH-02 the current release is R1', () => {
    expect(CURRENT_RELEASE).toBe('R1');
  });

  it('DSH-02 with R1 live, the messages card (R3) is not released', () => {
    expect(isReleased('dashboard.student.messages', 'R1')).toBe(false);
    expect(isReleased('dashboard.student.messages', 'R3')).toBe(true);
  });

  it('DSH-02 R1 cards are released at R1', () => {
    expect(isReleased('dashboard.student.routine', 'R1')).toBe(true);
    expect(isReleased('dashboard.teacher.students', 'R1')).toBe(true);
  });

  it('DSH-02 later-release cards stay hidden until LATER', () => {
    expect(isReleased('dashboard.teacher.announcements', 'R3')).toBe(false);
    expect(isReleased('dashboard.teacher.announcements', 'LATER')).toBe(true);
  });

  it('DSH-02 uses the current release by default', () => {
    expect(isReleased('dashboard.student.messages')).toBe(false);
    expect(isReleased('dashboard.student.routine')).toBe(true);
  });

  it('DSH-02 rejects unknown feature flags and releases', () => {
    expect(() => isReleased('dashboard.nope')).toThrow(/Unknown feature flag/);
    expect(() => isReleased('dashboard.student.routine', 'R9')).toThrow(/Unknown release/);
  });

  it('DSH-02 every flag names a valid release', () => {
    for (const r of Object.values(FEATURE_RELEASE))
      expect(['R1', 'R2', 'R3', 'LATER']).toContain(r);
  });
});
