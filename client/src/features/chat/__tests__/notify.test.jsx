import { describe, it, expect, afterEach, vi } from 'vitest';
import { notifyIfHidden } from '../hooks.js';

// CHT-16: a browser notification only when the tab is hidden and the user allowed it. The text
// is generic: no sender name and no message text.

const setHidden = (hidden) =>
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });

afterEach(() => {
  vi.unstubAllGlobals();
  setHidden(false);
});

describe('CHT-16 browser notifications', () => {
  it('CHT-16 shows a generic notification only when the tab is hidden and permission is granted', () => {
    const shown = vi.fn();
    vi.stubGlobal(
      'Notification',
      Object.assign(
        function Notification(title, options) {
          shown(title, options);
        },
        { permission: 'granted' },
      ),
    );

    setHidden(true);
    notifyIfHidden();
    expect(shown).toHaveBeenCalledTimes(1);
    expect(shown).toHaveBeenCalledWith('New chat message', {
      body: 'Open Class & Routine to read it.',
    });

    setHidden(false);
    notifyIfHidden();
    expect(shown).toHaveBeenCalledTimes(1);
  });

  it('CHT-16 shows nothing when the user has not allowed notifications', () => {
    const shown = vi.fn();
    vi.stubGlobal(
      'Notification',
      Object.assign(
        function Notification() {
          shown();
        },
        { permission: 'default' },
      ),
    );
    setHidden(true);
    notifyIfHidden();
    expect(shown).not.toHaveBeenCalled();
  });
});
