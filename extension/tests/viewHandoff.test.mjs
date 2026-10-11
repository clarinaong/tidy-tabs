import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createViewHandoff } from '../lib/viewHandoff.ts';
const setup = (overrides = {}) => {
  const events = [];
  return { events, switchView: createViewHandoff({ openPanel: async () => { events.push('open panel'); }, closePopup: () => { events.push('close popup'); }, openPopup: async () => { events.push('open popup'); }, closePanel: async () => { events.push('close panel'); }, ...overrides }) };
};
test('Keep open opens the panel then closes the popup without resetting session', async () => {
  const { events, switchView } = setup(); await switchView('panel'); assert.deepEqual(events, ['open panel', 'close popup']);
});
test('return closes the panel before opening the popup', async () => {
  const { events, switchView } = setup(); await switchView('popup'); assert.deepEqual(events, ['close panel', 'open popup']);
});
test('failed opens never close the popup and popup-return failures are reported', async () => {
  for (const destination of ['panel', 'popup']) {
    const { events, switchView } = setup({ [destination === 'panel' ? 'openPanel' : 'openPopup']: async () => { throw Error('Synthetic open failure'); } });
    await assert.rejects(switchView(destination), /Synthetic/); assert.deepEqual(events, destination === 'panel' ? [] : ['close panel']);
  }
});
test('duplicate switches cannot open both destinations concurrently', async () => {
  let finish; const { events, switchView } = setup({ openPanel: () => new Promise(resolve => { finish = resolve; }) });
  const first = switchView('panel'); await switchView('popup'); finish(); await first; assert.deepEqual(events, ['close popup']);
});
test('unsupported close API does not open an overlapping popup', async () => {
  const { events, switchView } = setup({ closePanel: undefined }); await assert.rejects(switchView('popup'), /Chrome 141/); assert.deepEqual(events, []);
});
test('close failure is reported and does not retry automatically', async () => {
  const { events, switchView } = setup({ closePanel: async () => { throw Error('Synthetic close failure'); } });
  await assert.rejects(switchView('popup'), /Synthetic close/); assert.deepEqual(events, []);
});

test('side-panel caller delegates the whole return to the surviving background worker', async () => {
  const { events, switchView } = setup({ returnToPopup: async () => { events.push('background return'); } });
  await switchView('popup'); assert.deepEqual(events, ['background return']);
});
