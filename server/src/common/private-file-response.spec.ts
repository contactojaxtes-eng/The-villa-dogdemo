import { privateFileEtag, sendPrivateFileResponse } from './private-file-response';

function responseMock() {
  const headers = new Map<string, string>();
  const response: any = {
    setHeader: jest.fn((name: string, value: string) => headers.set(name, String(value))),
    status: jest.fn(function status(code: number) {
      response.statusCode = code;
      return response;
    }),
    end: jest.fn(),
  };
  return { response, headers };
}

describe('sendPrivateFileResponse', () => {
  it('keeps authenticated files private and sends their bytes on the first request', () => {
    const { response, headers } = responseMock();
    const buffer = Buffer.from('receipt');

    sendPrivateFileResponse(response, {
      buffer,
      contentType: 'image/jpeg',
      resourceKey: 'transfer-proof:proof-1',
    });

    expect(headers.get('Cache-Control')).toBe('private, no-cache, max-age=0, must-revalidate');
    expect(headers.get('Vary')).toBe('Authorization');
    expect(headers.get('Content-Type')).toBe('image/jpeg');
    expect(headers.get('Content-Length')).toBe(String(buffer.length));
    expect(response.end).toHaveBeenCalledWith(buffer);
  });

  it('returns 304 without retransferring bytes when the private cached file is unchanged', () => {
    const { response } = responseMock();
    const resourceKey = 'transfer-proof:proof-1';

    sendPrivateFileResponse(response, {
      buffer: Buffer.from('receipt'),
      contentType: 'image/jpeg',
      resourceKey,
      ifNoneMatch: `W/${privateFileEtag(resourceKey)}`,
    });

    expect(response.status).toHaveBeenCalledWith(304);
    expect(response.end).toHaveBeenCalledWith();
    expect(response.end).not.toHaveBeenCalledWith(expect.any(Buffer));
  });
});
