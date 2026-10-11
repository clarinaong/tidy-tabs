import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyIconPixels } from '../lib/favicon.ts';

const pixels = (...values) => new Uint8ClampedArray(values.flat());
test('light icons receive contrast independently of their website', () => {
  assert.equal(
    classifyIconPixels(pixels([255, 255, 255, 255], [0, 0, 0, 0])),
    'light',
  );
  assert.equal(
    classifyIconPixels(pixels([245, 245, 245, 128], [0, 0, 0, 0])),
    'light',
  );
});
test('dark and multicolored icons retain their original tile', () => {
  assert.equal(classifyIconPixels(pixels([0, 0, 0, 255])), 'normal');
  assert.equal(
    classifyIconPixels(
      pixels([255, 0, 0, 255], [0, 0, 255, 255], [255, 255, 255, 255]),
    ),
    'normal',
  );
});
test('fully transparent icons fall back to initials', () => {
  assert.equal(classifyIconPixels(pixels([255, 255, 255, 0])), 'empty');
});
