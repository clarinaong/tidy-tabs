import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, request, type Server } from 'node:http';
import Groq from 'groq-sdk';
import { createHandler } from '../api/group-tabs.js';
import { suggestWithGroq } from '../src/groq.js';
import {
  HttpError,
  LIMITS,
  sanitizeUrl,
  validateSuggestion,
  validateTabs,
  validateExistingGroups,
} from '../src/validation.js';
const tabs = [
  { id: 1, title: 'Portfolio design', url: 'https://example.com' },
  { id: 2, title: 'Portfolio code', url: 'https://example.org' },
  { id: 3, title: 'Weather', url: 'https://example.net' },
];
const valid = {
  groups: [{ name: 'Personal Portfolio', tabIds: [1, 2] }],
  ungroupedTabIds: [3],
};
const servers: Server[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(
    servers
      .splice(0)
      .map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
  );
});
async function call(
  body: string,
  provider = vi.fn().mockResolvedValue(valid),
  options: { method?: string; contentType?: string; chunked?: boolean } = {},
) {
  const server = createServer(createHandler(provider));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('No port');
  return new Promise<{ status: number; body: any; allow: string | undefined }>(
    (resolve, reject) => {
      const req = request(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path: '/api/group-tabs',
          method: options.method ?? 'POST',
          headers: {
            'Content-Type': options.contentType ?? 'application/json',
            ...(options.chunked
              ? { 'Transfer-Encoding': 'chunked' }
              : { 'Content-Length': Buffer.byteLength(body) }),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () =>
            resolve({
              status: res.statusCode!,
              body: JSON.parse(data),
              allow: res.headers.allow,
            }),
          );
        },
      );
      req.on('error', reject);
      req.end(body);
    },
  );
}
describe('input and privacy', () => {
  it('strips all URL metadata except origin and never fetches pages', () => {
    expect(
      sanitizeUrl(
        'https://user:secret@example.com/private/email@example.com?q=token#secret',
      ),
    ).toBe('https://example.com');
    for (const url of [
      'file:///private/doc',
      'chrome://settings',
      'data:text/plain,secret',
    ])
      expect(sanitizeUrl(url)).toBe('');
  });
  it.each([
    null,
    {},
    { tabs: [] },
    { tabs: Array(101).fill(tabs[0]) },
    { tabs: [tabs[0], tabs[0]] },
    { tabs: [{ ...tabs[0], id: 1.5 }] },
    { tabs: [{ ...tabs[0], id: -1 }] },
    { tabs: [{ ...tabs[0], title: ' ' }] },
    { tabs: [{ ...tabs[0], title: 'x'.repeat(301) }] },
    { tabs: [{ ...tabs[0], url: 'x'.repeat(2049) }] },
    { tabs: [{ ...tabs[0], url: 'relative' }] },
    { tabs: [{ ...tabs[0], title: 'a\nb' }] },
  ])('rejects invalid tabs %#', (body) => {
    expect(() => validateTabs(body)).toThrow(HttpError);
  });
  it('accepts exact limits and safe integer IDs', () => {
    expect(
      validateTabs({
        tabs: Array.from({ length: 100 }, (_, id) => ({
          id,
          title: 'x'.repeat(300),
          url: 'https://example.com/' + 'a'.repeat(2028),
        })),
      }),
    ).toHaveLength(100);
  });
});
describe('AI validation', () => {
  it('accounts for omitted inputs', () =>
    expect(
      validateSuggestion({ groups: valid.groups, ungroupedTabIds: [] }, tabs),
    ).toEqual(valid));
  it.each([
    null,
    {},
    { groups: [], ungroupedTabIds: [999] },
    { groups: valid.groups, ungroupedTabIds: [1] },
    { groups: [{ name: 'Project', tabIds: [1, 1] }], ungroupedTabIds: [] },
    { groups: [{ name: ' ', tabIds: [1, 2] }], ungroupedTabIds: [] },
    { groups: [{ name: 'x'.repeat(81), tabIds: [1, 2] }], ungroupedTabIds: [] },
    { groups: [{ name: 'Project', tabIds: [1] }], ungroupedTabIds: [] },
    { groups: [], ungroupedTabIds: ['1'] },
    { ...valid, extra: true },
  ])('rejects malformed assignments %#', (value) =>
    expect(() => validateSuggestion(value, tabs)).toThrow(HttpError),
  );
});
describe('HTTP endpoint', () => {
  it('returns normalized suggestions and sanitized provider input', async () => {
    const provider = vi
      .fn()
      .mockResolvedValue({ groups: valid.groups, ungroupedTabIds: [] });
    const result = await call(
      JSON.stringify({
        tabs: tabs.map((t) => ({ ...t, url: t.url + '/secret?token=private' })),
      }),
      provider,
    );
    expect(result.status).toBe(200);
    expect(result.body).toEqual(valid);
    expect(provider).toHaveBeenCalledWith(tabs);
  });
  it('rejects other methods and media types', async () => {
    const result = await call('', undefined, { method: 'GET' });
    expect(result.status).toBe(405);
    expect(result.allow).toBe('POST');
    expect(
      (await call('{}', undefined, { contentType: 'text/plain' })).status,
    ).toBe(415);
  });
  it('rejects malformed JSON and invalid input before provider call', async () => {
    const provider = vi.fn();
    expect((await call('{', provider)).status).toBe(400);
    expect((await call('{"tabs":[]}', provider)).status).toBe(400);
    expect(provider).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    'enforces byte limit including chunked requests (%s)',
    async (chunked) => {
      const provider = vi.fn();
      expect(
        (await call(' '.repeat(LIMITS.bytes + 1), provider, { chunked }))
          .status,
      ).toBe(413);
      expect(provider).not.toHaveBeenCalled();
    },
  );
  it.each([503, 504, 429, 502])(
    'returns safe provider errors (%s)',
    async (status) => {
      const provider = vi
        .fn()
        .mockRejectedValue(new HttpError(status, 'SAFE_ERROR', 'Try again.'));
      expect((await call(JSON.stringify({ tabs }), provider)).status).toBe(
        status,
      );
    },
  );
  it('does not expose unexpected exception secrets', async () => {
    const result = await call(
      JSON.stringify({ tabs }),
      vi.fn().mockRejectedValue(Error('secret-api-key')),
    );
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toContain('secret');
  });
  it('rejects invalid provider results', async () =>
    expect(
      (
        await call(
          JSON.stringify({ tabs }),
          vi.fn().mockResolvedValue({ groups: [], ungroupedTabIds: [99] }),
        )
      ).status,
    ).toBe(502));
});
describe('mocked Groq SDK', () => {
  function mock(response?: unknown, error?: unknown) {
    vi.stubEnv('GROQ_API_KEY', 'fictional-test-key');
    vi.stubEnv('GROQ_MODEL', 'openai/gpt-oss-20b');
    const spy = vi.spyOn(Groq.Chat.Completions.prototype, 'create');
    if (error) spy.mockRejectedValue(error);
    else spy.mockResolvedValue(response as never);
    return spy;
  }
  it('requires configuration without calling Groq', async () => {
    vi.stubEnv('GROQ_API_KEY', '');
    vi.stubEnv('GROQ_MODEL', '');
    await expect(suggestWithGroq(tabs)).rejects.toMatchObject({ status: 503 });
  });
  it('rejects unsupported models without a network request', async () => {
    const spy = mock();
    vi.stubEnv('GROQ_MODEL', 'unsupported');
    await expect(suggestWithGroq(tabs)).rejects.toMatchObject({ status: 503 });
    expect(spy).not.toHaveBeenCalled();
  });
  it('requests strict JSON without tools', async () => {
    const spy = mock({
      choices: [
        { finish_reason: 'stop', message: { content: JSON.stringify(valid) } },
      ],
    });
    expect(await suggestWithGroq(tabs)).toEqual(valid);
    expect(spy.mock.calls[0]?.[0]).toMatchObject({
      response_format: { type: 'json_schema', json_schema: { strict: true } },
    });
    expect(spy.mock.calls[0]?.[0]).not.toHaveProperty('tools');
  });
  it.each(['not-json', null])(
    'rejects malformed/empty model content (%s)',
    async (content) => {
      mock({ choices: [{ finish_reason: 'stop', message: { content } }] });
      await expect(suggestWithGroq(tabs)).rejects.toMatchObject({
        status: 502,
        code: 'INVALID_AI_RESPONSE',
      });
    },
  );
  it('rejects truncated output', async () => {
    mock({
      choices: [{ finish_reason: 'length', message: { content: '{}' } }],
    });
    await expect(suggestWithGroq(tabs)).rejects.toMatchObject({ status: 502 });
  });
  it.each([
    [429, 429],
    [401, 503],
    [403, 503],
    [500, 502],
  ])('maps provider status %s to %s', async (providerStatus, status) => {
    mock(
      undefined,
      new Groq.APIError(
        providerStatus,
        { message: 'private provider detail' },
        'private',
        new Headers(),
      ),
    );
    await expect(suggestWithGroq(tabs)).rejects.toMatchObject({ status });
  });
  it('maps timeouts', async () => {
    mock(undefined, new Groq.APIConnectionTimeoutError());
    await expect(suggestWithGroq(tabs)).rejects.toMatchObject({ status: 504 });
  });
});

describe('existing Chrome group context', () => {
  const existingGroups = [{ id: 7, windowId: 10, name: 'Garden', tabIds: [1] }];
  it('passes validated context to the provider and accepts a single-tab existing destination', async () => {
    const value = { groups: [{ name: 'Garden', tabIds: [2], existingGroupId: 7 }], ungroupedTabIds: [1, 3] };
    const provider = vi.fn().mockResolvedValue(value);
    const result = await call(JSON.stringify({ tabs, existingGroups }), provider);
    expect(result.status).toBe(200); expect(result.body).toEqual(value);
    expect(provider).toHaveBeenCalledWith(tabs, existingGroups);
  });
  it('accepts null targets for new groups and rejects unknown or mismatched targets', () => {
    expect(validateSuggestion({ ...valid, groups: [{ ...valid.groups[0], existingGroupId: null }] }, tabs)).toEqual(valid);
    for (const group of [{ name: 'Garden', tabIds: [1], existingGroupId: 99 }, { name: 'Wrong', tabIds: [1], existingGroupId: 7 }])
      expect(() => validateSuggestion({ groups: [group], ungroupedTabIds: [2, 3] }, tabs, existingGroups)).toThrow(HttpError);
  });
  it('rejects invalid group metadata and member IDs before the provider is called', async () => {
    for (const groups of [[{ id: 7, windowId: 10, name: ' ' }], [...existingGroups, ...existingGroups], [{ ...existingGroups[0], tabIds: [99] }], [{ ...existingGroups[0], tabIds: [1, 1] }]]) {
      const provider = vi.fn();
      expect((await call(JSON.stringify({ tabs, existingGroups: groups }), provider)).status).toBe(400);
      expect(provider).not.toHaveBeenCalled();
      expect(() => validateExistingGroups({ tabs, existingGroups: groups })).toThrow(HttpError);
    }
  });
  it('includes existing destinations and clear documentation matching in the mocked AI request', async () => {
    vi.stubEnv('GROQ_API_KEY', 'fictional-test-key'); vi.stubEnv('GROQ_MODEL', 'openai/gpt-oss-20b');
    const spy = vi.spyOn(Groq.Chat.Completions.prototype, 'create').mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(valid) } }] } as never);
    await suggestWithGroq(tabs, existingGroups);
    const request = spy.mock.calls[0]![0];
    expect(JSON.parse(request.messages[1]!.content as string)).toEqual({ tabs, existingGroups });
    expect(request.messages[0]!.content).toContain('React, TypeScript');
    expect(request.messages[0]!.content).toContain('existingGroupId');
    expect(request.messages[0]!.content).toContain('Prefer reuse over fragmentation');
    expect(request.messages[0]!.content).toContain('same window');
    expect(request.messages[0]!.content).toContain('preference, not a rule to force merges');
    expect(request.messages[0]!.content).toContain('different windows are separate destinations');
    expect(request.messages[0]!.content).toContain('even when only one new tab fits');
    expect(request.messages[0]!.content).toContain('Evidence comes before reuse');
    expect(request.messages[0]!.content).toContain('Generic names');
    expect(request.messages[0]!.content).toMatch(/not\s+a supported destination for an unrelated tab/);
    expect(request.messages[0]!.content).toContain('Do not infer');
    expect(request.messages[0]!.content).toContain('never override accuracy');
  });
});
