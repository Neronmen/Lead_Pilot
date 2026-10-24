import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolveRequestId } from './logger.config';

describe('resolveRequestId', () => {
  function call(header?: string) {
    const req = { headers: header === undefined ? {} : { 'x-request-id': header } };
    const res = { setHeader: jest.fn() };
    const id = resolveRequestId(req as IncomingMessage, res as unknown as ServerResponse);
    return { id, res };
  }

  it('reuses a well-formed incoming request id and echoes it', () => {
    const { id, res } = call('req-123_abc.DEF');
    expect(id).toBe('req-123_abc.DEF');
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', 'req-123_abc.DEF');
  });

  it('generates a UUID when the header is missing', () => {
    expect(call().id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('ignores ids that could inject text into logs', () => {
    expect(call('abc\n{"level":"fatal"}').id).toMatch(/^[0-9a-f-]{36}$/);
    expect(call('x'.repeat(65)).id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
