import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestSuggestions } from '../lib/api.ts';
import { PROVIDERS, validateAccess } from '../lib/providers.ts';
import { createAccessStore } from '../lib/providerAccess.ts';

const tabs = [
  {
    id: 1,
    windowId: 1,
    title: 'Synthetic example',
    url: 'https://user:password@example.org/path?private=yes#secret',
  },
];

const valid = { groups: [], ungroupedTabIds: [1] };

const access = (provider) => ({
  provider,
  model: PROVIDERS[provider].model,
  key: 'synthetic-test-key',
});

const envelope = (provider, content = JSON.stringify(valid), reason) =>
  provider === 'gemini'
    ? {
        candidates: [
          {
            finishReason: reason ?? 'STOP',
            content: { parts: [{ text: content }] },
          },
        ],
      }
    : { choices: [{ finish_reason: reason ?? 'stop', message: { content } }] };

for (const provider of Object.keys(PROVIDERS)) {
  test(`${provider}: fixed endpoint, header-only key, sanitized metadata, structured response`, async () => {
    let calls = 0;
    const result = await requestSuggestions(
      tabs,
      access(provider),
      async (url, options) => {
        calls++;
        assert.ok(url.startsWith(PROVIDERS[provider].endpoint));
        assert.ok(!url.includes(access(provider).key));
        assert.equal(
          options.headers[
            provider === 'gemini' ? 'x-goog-api-key' : 'Authorization'
          ],
          provider === 'gemini'
            ? access(provider).key
            : `Bearer ${access(provider).key}`,
        );
        assert.ok(!options.body.includes(access(provider).key));
        const body = JSON.parse(options.body);
        const data = JSON.parse(
          provider === 'gemini'
            ? body.contents[0].parts[0].text
            : body.messages[1].content,
        );
        assert.deepEqual(data, {
          tabs: [
            { id: 1, title: 'Synthetic example', url: 'https://example.org' },
          ],
        });
        if (provider === 'gemini')
          assert.equal(
            body.generationConfig.responseMimeType,
            'application/json',
          );
        else assert.equal(body.response_format.json_schema.strict, true);
        if (provider === 'openai') assert.equal(body.store, false);
        assert.equal(options.redirect, 'error');
        return new Response(JSON.stringify(envelope(provider)));
      },
    );
    assert.deepEqual(result.suggestion, valid);
    assert.equal(calls, 1);
  });
  test(`${provider}: failures, refusals, truncation, key echoes, oversized or unknown-ID results stay private`, async () => {
    for (const status of [400, 401, 403, 404, 429, 500, 503]) {
      let calls = 0;
      await assert.rejects(
        requestSuggestions(tabs, access(provider), async () => {
          calls++;
          return new Response(access(provider).key, { status });
        }),
        (error) => !error.message.includes(access(provider).key),
      );
      assert.equal(calls, 1);
    }
    for (const value of [
      envelope(provider, JSON.stringify(valid), 'length'),
      envelope(provider, access(provider).key),
      envelope(provider, JSON.stringify({ groups: [], ungroupedTabIds: [99] })),
      {},
      envelope(provider, 'x'.repeat(65537)),
    ])
      await assert.rejects(
        requestSuggestions(
          tabs,
          access(provider),
          async () => new Response(JSON.stringify(value)),
        ),
        /unreadable|invalid tab groups|output space|completed suggestion|Couldn’t read/,
      );
    const controller = new AbortController();
    await assert.rejects(
      requestSuggestions(
        tabs,
        access(provider),
        async () => {
          controller.abort();
          return new Response(JSON.stringify(envelope(provider)));
        },
        undefined,
        [],
        controller.signal,
      ),
      /cancelled/,
    );
  });
}

test('provider configuration cannot redirect keys to arbitrary hosts or inject model paths', () => {
  for (const value of [
    { ...access('groq'), provider: 'https://evil.test' },
    { ...access('gemini'), model: '../secret' },
    { ...access('groq'), key: 'key\nheader' },
    { ...access('groq'), provider: 'toString' },
  ])
    assert.throws(() => validateAccess(value), /valid API key/);
});

test('fresh browser session has no key; status never returns credentials', async () => {
  const make = () => {
    const data = {};
    return {
      setAccessLevel: async () => {},
      get: async (key) => ({ [key]: data[key] }),
      set: async (v) => Object.assign(data, v),
      remove: async (key) => {
        delete data[key];
      },
    };
  };
  const session = make();
  await createAccessStore(session).set(access('groq'));
  assert.deepEqual(await createAccessStore(session).status(), {
    hasAccess: true,
  });
  assert.deepEqual(await createAccessStore(make()).status(), {
    hasAccess: false,
  });
});
