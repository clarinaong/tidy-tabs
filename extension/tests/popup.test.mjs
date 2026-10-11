import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'wxt/browser')
      return {
        url: 'data:text/javascript,export const browser = { runtime: { getURL: path => `chrome-extension://test-extension${path}` } };',
        shortCircuit: true,
      };
    if (specifier === '../../lib/tabs')
      return next('../../lib/tabs.ts', context);
    if (specifier === '../../lib/favicon')
      return next('../../lib/favicon.ts', context);
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith('.tsx'))
      return {
        format: 'module',
        shortCircuit: true,
        source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
          compilerOptions: {
            jsx: ts.JsxEmit.ReactJSX,
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
          },
        }).outputText,
      };
    return next(url, context);
  },
});
const { PopupView } = await import('../entrypoints/popup/PopupView.tsx');
const tabs = [
  {
    id: 1,
    windowId: 1,
    title: 'Guide',
    url: 'https://example.com/private?secret=123',
  },
  { id: 2, windowId: 1, title: 'Reference', url: 'https://example.org' },
  { id: 3, windowId: 1, title: 'Weather', url: 'https://weather.example' },
];
const base = {
  tabs,
  skippedTabs: [
    { id: 4, windowId: 1, title: 'Extensions', url: 'chrome://extensions' },
  ],
  requested: false,
  loading: false,
  tabError: null,
  pending: false,
  suggestionError: null,
  result: null,
  stale: false,
  onSuggest() {},
  onRetryTabs() {},
};
const render = (props) =>
  renderToStaticMarkup(createElement(PopupView, { ...base, ...props }));
test('preview displays all assigned and ungrouped tabs, without duplicate initial list or URL details', () => {
  const html = render({
    result: {
      tabs,
      suggestion: {
        groups: [{ name: 'Actual project', tabIds: [1, 2] }],
        ungroupedTabIds: [3],
      },
    },
  });
  for (const text of [
    'Actual project',
    'Guide',
    'Reference',
    'Weather',
    'Ungrouped',
    'Refresh suggestions',
  ])
    assert.ok(html.includes(text));
  assert.ok(!html.includes('Tabs to organize'));
  assert.ok(!html.includes('/private') && !html.includes('secret=123'));
  assert.ok(!html.includes('google.com/s2/favicons'));
  for (const text of [
    'Apply groups',
    'Edit groups',
    'Auto-sort',
    'Last sorted',
  ])
    assert.ok(!html.includes(text));
});
test('loading replaces the action with a status message', () => {
  const html = render({ pending: true });
  assert.ok(!html.includes('class="suggest-button"'));
  assert.ok(html.includes('Generating suggestions…'));
  assert.ok(
    !html.includes('Guide') &&
      !html.includes('Reference') &&
      !html.includes('Weather'),
  );
});
test('empty, failure, and stale states explain the next action', () => {
  assert.ok(render({ tabs: [] }).includes('Open a website'));
  assert.ok(
    render({ suggestionError: 'Service unavailable' }).includes('role="alert"'),
  );
  assert.ok(render({ tabError: 'Read failed' }).includes('Try again'));
  assert.ok(
    render({
      result: { tabs, suggestion: { groups: [], ungroupedTabIds: [1, 2, 3] } },
      stale: true,
    }).includes('Your tabs have changed'),
  );
});

test('skipped explanation stays above results and sharing copy uses everyday language', () => {
  const html = render({
    requested: true,
    result: {
      tabs,
      suggestion: {
        groups: [{ name: 'Actual project', tabIds: [1, 2] }],
        ungroupedTabIds: [3],
      },
    },
  });
  assert.ok(
    html.indexOf('class="skipped-tabs"') < html.indexOf('class="group-card'),
  );
  assert.ok(html.includes('Extensions') && html.includes('blank pages'));
  assert.ok(
    html.includes('tab titles and website names go to Groq AI') &&
      html.includes('Titles may include searches or document names'),
  );
  assert.ok(
    !html.includes('snapshot of your request') &&
      !html.includes('website origins'),
  );
});

test('tab rows look up full page URLs only through Chrome and skip browser pages', () => {
  const html = render({});
  assert.ok(html.includes('chrome-extension://test-extension/_favicon/'));
  assert.ok(
    html.includes('pageUrl=https%3A%2F%2Fexample.com%2Fprivate%3Fsecret%3D123'),
  );
  assert.ok(!html.includes('pageUrl=chrome') && !html.includes('secret=123'));
  assert.ok(!html.includes('google.com/s2/favicons'));
});
