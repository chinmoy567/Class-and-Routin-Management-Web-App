import { describe, it, expect, vi, beforeEach } from 'vitest';

const sockets = [];
vi.mock('socket.io-client', () => ({
  io: vi.fn((opts) => {
    const s = { opts, on: vi.fn(), off: vi.fn(), disconnect: vi.fn() };
    sockets.push(s);
    return s;
  }),
}));

const { connectSocket, disconnectSocket, onEvent } = await import('../socket.js');

describe('socket client', () => {
  beforeEach(() => {
    disconnectSocket();
    sockets.length = 0;
  });

  it('FND-31 connects once with credentials and reuses the connection', () => {
    const a = connectSocket();
    const b = connectSocket();
    expect(a).toBe(b);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].opts.withCredentials).toBe(true);
  });

  it('FND-31 onEvent subscribes and returns an unsubscribe function', () => {
    const handler = vi.fn();
    const off = onEvent('routine.changed', handler);
    expect(sockets[0].on).toHaveBeenCalledWith('routine.changed', handler);
    off();
    expect(sockets[0].off).toHaveBeenCalledWith('routine.changed', handler);
  });

  it('FND-31 disconnect closes the socket and the next connect makes a new one', () => {
    const first = connectSocket();
    disconnectSocket();
    expect(first.disconnect).toHaveBeenCalled();
    expect(connectSocket()).not.toBe(first);
  });
});
