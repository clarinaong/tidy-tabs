import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptSessionResponse } from '../lib/sessionResponses.ts';
const preview = { id: 'synthetic-preview', tabs: [], suggestion: { groups: [], ungroupedTabIds: [] } };
const state = (revision, result = preview, resetToken = undefined) => ({ revision, preview: result, resetToken, skipped: [], pending: false, applying: false, consumed: false, outcome: null, error: null });
test('a delayed starting-page get cannot overwrite a successful suggestion response', () => {
  let current = acceptSessionResponse(null, state(1, null));
  const delayedGet = state(1, null);
  current = acceptSessionResponse(current, state(2));
  assert.equal(acceptSessionResponse(current, delayedGet), current);
});
test('an earlier mutation response is accepted even if a later get was issued while it was pending', () => {
  const pending = { ...state(3, null), pending: true };
  let current = acceptSessionResponse(null, pending);
  current = acceptSessionResponse(current, state(4));
  current = acceptSessionResponse(current, pending);
  assert.equal(current.preview.id, preview.id); assert.equal(current.pending, false);
});
test('delayed edit or save replies cannot roll back the saved preview or reset token', () => {
  const edited = { ...state(6, { ...preview, id: 'saved-edits' }, 'reset-1') };
  const old = { ...state(5, preview, 'reset-1'), editor: preview };
  assert.equal(acceptSessionResponse(edited, old), edited);
  assert.equal(acceptSessionResponse(edited, state(6, null, 'reset-1')), edited);
});
test('only explicit reset returns to the starting page and old replies cannot revive it', () => {
  const current = state(7, preview, 'reset-1');
  const reset = state(8, null, 'reset-2');
  assert.equal(acceptSessionResponse(current, reset), reset);
  assert.equal(acceptSessionResponse(reset, current), reset);
});
test('invalid or missing responses leave the caller current session intact with a visible error', () => {
  const current = state(4);
  for (const incoming of [undefined, null, {}]) assert.throws(() => acceptSessionResponse(current, incoming), /current view was kept/);
  assert.equal(current.preview.id, preview.id);
});
