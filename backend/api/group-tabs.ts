import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  HttpError,
  LIMITS,
  validateSuggestion,
  validateTabs,
  validateExistingGroups,
} from '../src/validation.js';
import { suggestWithGroq, type Provider } from '../src/groq.js';

export function createHandler(provider: Provider = suggestWithGroq) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use POST.');
      }
      if (
        req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !==
        'application/json'
      )
        throw new HttpError(
          415,
          'UNSUPPORTED_MEDIA_TYPE',
          'Use application/json.',
        );
      if (Number(req.headers['content-length']) > LIMITS.bytes)
        throw new HttpError(
          413,
          'REQUEST_TOO_LARGE',
          'Request limit is 65536 bytes.',
        );
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > LIMITS.bytes)
          throw new HttpError(
            413,
            'REQUEST_TOO_LARGE',
            'Request limit is 65536 bytes.',
          );
        chunks.push(buffer);
      }
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        throw new HttpError(400, 'INVALID_JSON', 'Body must be valid JSON.');
      }
      const tabs = validateTabs(body);
      const existingGroups = validateExistingGroups(body);
      const response = existingGroups.length ? await provider(tabs, existingGroups) : await provider(tabs);
      const suggestions = validateSuggestion(response, tabs, existingGroups);
      res.statusCode = 200;
      res.end(JSON.stringify(suggestions));
    } catch (error) {
      const safe =
        error instanceof HttpError
          ? error
          : new HttpError(
              500,
              'INTERNAL_ERROR',
              'Could not process the request.',
            );
      res.statusCode = safe.status;
      res.end(
        JSON.stringify({ error: { code: safe.code, message: safe.message } }),
      );
    }
  };
}
export default createHandler();

// handles POST api/group-tabs: checks request, asks Groq for suggestions, checks suggestions, and sends results back
