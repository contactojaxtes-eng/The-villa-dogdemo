import { createHash } from 'crypto';
import type { Response } from 'express';

type PrivateFileResponse = {
  buffer: Buffer;
  contentType: string;
  resourceKey: string;
  ifNoneMatch?: string;
  attachment?: boolean;
  cacheControl?: string;
};

export function privateFileEtag(resourceKey: string): string {
  const digest = createHash('sha256').update(resourceKey).digest('base64url').slice(0, 24);
  return `"private-${digest}"`;
}

function matchesEtag(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch
    .split(',')
    .map(value => value.trim().replace(/^W\//, ''))
    .some(value => value === '*' || value === etag);
}

/**
 * Allows the browser to retain an authenticated file only in its private cache,
 * while forcing an authorization check on every later use. When the resource did
 * not change, the response is a body-less 304 instead of transferring the image
 * again through Railway.
 */
export function sendPrivateFileResponse(res: Response, file: PrivateFileResponse) {
  const etag = privateFileEtag(file.resourceKey);
  res.setHeader('Cache-Control', file.cacheControl || 'private, no-cache, max-age=0, must-revalidate');
  res.setHeader('Vary', 'Authorization');
  res.setHeader('ETag', etag);
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (matchesEtag(file.ifNoneMatch, etag)) {
    return res.status(304).end();
  }

  res.setHeader('Content-Type', file.contentType);
  if (file.attachment) res.setHeader('Content-Disposition', 'attachment');
  res.setHeader('Content-Length', String(file.buffer.length));
  return res.end(file.buffer);
}
