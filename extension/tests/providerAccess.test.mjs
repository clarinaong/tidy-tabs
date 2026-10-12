import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAccessStore,
  ACCESS_SLOT,
  isTrustedPage,
} from '../lib/providerAccess.ts';
import { requestSuggestions } from '../lib/api.ts';

const invite = {
  provider: 'groq',
  model: 'openai/gpt-oss-20b',
  key: 'synthetic-test-key',
};

function storage() {
  const data = {};
  const access = [];
  return {
    data,
    access,
    setAccessLevel: async (value) => access.push(value.accessLevel),
    get: async (key) => ({ [key]: data[key] }),
    set: async (values) => Object.assign(data, values),
    remove: async (key) => {
      delete data[key];
    },
  };
}

test('provider credentials save only to supplied session store; replies show presence; worker recreation retains it', async () => {
  const local = storage();
  let store = createAccessStore(local);
  assert.deepEqual(await store.status(), { hasAccess: false });
  assert.deepEqual(await store.set(invite), { hasAccess: true });
  assert.deepEqual(local.data[ACCESS_SLOT], invite);
  store = createAccessStore(local); // Simulated worker restart with the same session storage.
  assert.deepEqual(await store.status(), { hasAccess: true });
  assert.ok(local.access.every((value) => value === 'TRUSTED_CONTEXTS'));
  assert.deepEqual(await store.clear(), { hasAccess: false });
  assert.equal(local.data[ACCESS_SLOT], undefined);
});

test('malformed credentials and storage permission failures never echo input/errors', async () => {
  const local = storage(),
    store = createAccessStore(local);
  for (const value of [
    null,
    '',
    'https://private.test',
    'bad\ninvite',
    'x'.repeat(129),
  ])
    await assert.rejects(store.set(value), /valid API key/);
  local.setAccessLevel = async () => {
    throw new Error(invite.key);
  };
  await assert.rejects(
    store.set(invite),
    (error) =>
      !error.message.includes(invite.key) && /storage/.test(error.message),
  );
  assert.deepEqual(local.data, {});
});

test('clearing aborts active request and rejects late success; concurrent calls/replacement cannot send', async () => {
  const store = createAccessStore(storage());
  await store.set(invite);
  let finish, start;
  const began = new Promise((resolve) => {
    start = resolve;
  });
  const pending = store.run(async (value, signal) => {
    assert.deepEqual(value, invite);
    start(signal);
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const signal = await began;
  await assert.rejects(
    store.run(async () => assert.fail('second request')),
    /already running/,
  );
  await assert.rejects(store.set(invite), /Wait/);
  await store.clear();
  assert.equal(signal.aborted, true);
  finish('late preview');
  await assert.rejects(pending, /cancelled/);
  await assert.rejects(
    store.run(async () => assert.fail('missing credentials must not send')),
    /valid API key/,
  );
});

test('only popup and side panel messages are trusted; content scripts and arbitrary pages rejected', () => {
  const origin = 'chrome-extension://test/';
  for (const page of ['popup.html', 'sidepanel.html'])
    assert.equal(
      isTrustedPage({ id: 'test', url: origin + page }, 'test', origin),
      true,
    );
  for (const sender of [
    { id: 'other', url: origin + 'popup.html' },
    { id: 'test', url: origin + 'popup.html', tab: {} },
    { id: 'test', url: 'https://example.org/' },
    { id: 'test', url: origin + 'other.html' },
    { id: 'test' },
  ])
    assert.equal(isTrustedPage(sender, 'test', origin), false);
});

test('saving publishes credentials and setup flag together before storage-change observers refresh; clearing preserves setup', async () => {
  const session = storage();
  const writes = [];
  const original = session.set;
  session.set = async (values) => {
    writes.push(values);
    await original(values);
  };
  const store = createAccessStore(session);
  await store.set(invite);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].tidytabsAIConfigured, true);
  assert.deepEqual(writes[0][ACCESS_SLOT], invite);
  await store.clear();
  assert.equal(session.data.tidytabsAIConfigured, true);
  assert.deepEqual(await store.status(), { hasAccess: false });
});
