import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, ok, fail } from '@/test/mockApi.jsx';
import { uploadForm, ApiError } from '@/lib/api.js';
import { fetchFileLink, uploadChatFile } from '../api.js';
import { MessageBubble } from '../components/MessageBubble.jsx';
import { FileComposer, fileProblem, FILE_MAX_BYTES } from '../components/FileComposer.jsx';

afterEach(() => {
  vi.unstubAllGlobals();
});

const base = {
  id: 'm1',
  mine: false,
  deleted: false,
  body: null,
  status: null,
  created_at: '2026-11-05T04:00:00.000Z',
};
const fileOf = (status, over = {}) => ({
  id: 'f1',
  name: 'slides.pdf',
  size: 2048,
  type: 'application/pdf',
  status,
  ...over,
});

describe('FIL-05, FIL-06 the file bubble', () => {
  it('FIL-05 a file that is still being scanned shows "scanning" and no download button', () => {
    render(
      <ul>
        <MessageBubble message={{ ...base, file: fileOf('scanning') }} />
      </ul>,
    );
    expect(screen.getByText('slides.pdf')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/scanning/i);
    expect(screen.queryByRole('button', { name: /download/i })).not.toBeInTheDocument();
  });

  it('FIL-08 a clean file shows its size and a download button that passes the file id', async () => {
    const onDownload = vi.fn();
    render(
      <ul>
        <MessageBubble message={{ ...base, file: fileOf('ready') }} onDownload={onDownload} />
      </ul>,
    );
    expect(screen.getByText('2 KB')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Download slides.pdf' }));
    expect(onDownload).toHaveBeenCalledWith('f1');
  });

  it('FIL-06 an infected file reads "File removed (failed security check)" and never shows a name', () => {
    render(
      <ul>
        <MessageBubble message={{ ...base, file: fileOf('removed', { name: null, size: null }) }} />
      </ul>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('File removed (failed security check)');
    expect(screen.queryByRole('button', { name: /download/i })).not.toBeInTheDocument();
  });

  it('FIL-05 a caption is shown with the file', () => {
    render(
      <ul>
        <MessageBubble message={{ ...base, body: 'Week 4', file: fileOf('scanning') }} />
      </ul>,
    );
    expect(screen.getByText('Week 4')).toBeInTheDocument();
  });
});

describe('FIL-01, FIL-03 the composer checks a chosen file early', () => {
  it('FIL-03 a file over 5 MB is refused in the composer', () => {
    const big = new File(['x'], 'big.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: FILE_MAX_BYTES + 1 });
    expect(fileProblem(big)).toBe('A file can be 5 MB or smaller.');
  });

  it('FIL-01 a file with a type that is not on the list is refused in the composer', () => {
    expect(fileProblem(new File(['x'], 'setup.exe'))).toMatch(/not allowed/);
  });

  it('FIL-01 an allowed file passes the early check (the server checks its content)', () => {
    expect(fileProblem(new File(['x'], 'notes.docx'))).toBeNull();
    expect(fileProblem(new File(['x'], 'photo.JPG'))).toBeNull();
  });

  it('shows the chosen file, and hands it up when it is removed', async () => {
    const onChange = vi.fn();
    render(
      <FileComposer
        file={new File(['x'], 'notes.pdf')}
        onChange={onChange}
        error={null}
        progress={0}
        uploading={false}
      />,
    );
    expect(screen.getByText('notes.pdf')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove notes.pdf' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('shows upload progress with a label while the file goes up', () => {
    render(<FileComposer file={null} onChange={() => {}} error={null} progress={0.5} uploading />);
    expect(screen.getByRole('progressbar', { name: 'Upload progress' })).toHaveAttribute(
      'value',
      '50',
    );
    expect(screen.getByText('Uploading… 50%')).toBeInTheDocument();
  });
});

/** A stand-in XMLHttpRequest: reports one progress step and then answers with `reply`. */
function stubXhr(reply) {
  const sent = {};
  class FakeXhr {
    constructor() {
      this.upload = {};
      this.headers = {};
      sent.xhr = this;
    }
    open(method, url) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(name, value) {
      this.headers[name] = value;
    }
    getResponseHeader() {
      return null;
    }
    send(body) {
      sent.body = body;
      queueMicrotask(() => {
        this.upload.onprogress?.({ lengthComputable: true, loaded: 25, total: 100 });
        this.status = reply.status;
        this.responseText = JSON.stringify(reply.body);
        this.onload();
      });
    }
  }
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  return sent;
}

describe('FIL-05 upload: the request and its answers', () => {
  it('sends the file with the CSRF header, reports progress, and returns the message', async () => {
    mockApi({ 'GET /api/auth/csrf': ok({ token: 'csrf-token' }) });
    const sent = stubXhr({
      status: 201,
      body: { data: { id: 'm9', file: { status: 'scanning' } } },
    });
    const onProgress = vi.fn();
    const file = new File(['%PDF-1.4'], 'notes.pdf', { type: 'application/pdf' });
    const data = await uploadChatFile({
      conversationId: 'c1',
      file,
      caption: 'Week 4',
      onProgress,
    });
    expect(data).toEqual({ id: 'm9', file: { status: 'scanning' } });
    expect(sent.xhr.method).toBe('POST');
    expect(sent.xhr.url).toBe('/api/chat/conversations/c1/files');
    expect(sent.xhr.headers['X-CSRF-Token']).toBe('csrf-token');
    expect(sent.body.get('file').name).toBe('notes.pdf');
    expect(sent.body.get('caption')).toBe('Week 4');
    expect(onProgress).toHaveBeenCalledWith(0.25);
  });

  it('FIL-03 a refused upload becomes an ApiError with the server code', async () => {
    mockApi({ 'GET /api/auth/csrf': ok({ token: 'csrf-token' }) });
    stubXhr({ status: 413, body: { error: { code: 'FILE_TOO_LARGE', message: 'Too big.' } } });
    const err = await uploadForm('/chat/conversations/c1/files', new FormData()).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('FILE_TOO_LARGE');
    expect(err.status).toBe(413);
  });

  it('FIL-08 asking for a link posts to the link endpoint and returns the URL and expiry', async () => {
    const calls = mockApi({
      'GET /api/auth/csrf': ok({ token: 'csrf-token' }),
      'POST /api/chat/files/f1/link': ok({
        url: '/api/chat/files/f1/download?u=u1&exp=1&sig=abc',
        expires_at: '2026-11-05T04:05:00.000Z',
      }),
    });
    const link = await fetchFileLink('f1');
    expect(link.url).toContain('/download?u=u1');
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/chat/files/f1/link')).toBe(
      true,
    );
  });

  it('FIL-05 a link before the scan is FILE_NOT_READY', async () => {
    mockApi({
      'GET /api/auth/csrf': ok({ token: 'csrf-token' }),
      'POST /api/chat/files/f1/link': fail(409, 'FILE_NOT_READY'),
    });
    await expect(fetchFileLink('f1')).rejects.toMatchObject({ code: 'FILE_NOT_READY' });
  });
});
