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
    if (specifier === '../../lib/groupChange')
      return next('../../lib/groupChange.ts', context);
    if (specifier === '../../lib/tabs')
      return next('../../lib/tabs.ts', context);
    if (specifier === './GroupEditor')
      return next('./GroupEditor.tsx', context);
    if (specifier === './PopupView') return next('./PopupView.tsx', context);
    if (specifier === '../../lib/editing')
      return next('../../lib/editing.ts', context);
    if (specifier === '../../lib/preview')
      return next('../../lib/preview.ts', context);
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
  for (const text of ['Apply groups', 'Auto-sort', 'Last sorted'])
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
    html.includes(
      'tab titles and sanitized website origins go through the TidyTabs service to Groq AI',
    ) &&
      html.includes('existing group names, group and window IDs') &&
      html.includes('which eligible tabs belong to each group') &&
      html.includes('Titles may include searches or document names'),
  );
  assert.ok(!html.includes('snapshot of your request'));
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

const { GroupEditor } = await import('../entrypoints/popup/GroupEditor.tsx');

test('editor exposes accessible move and rename controls, stale guidance, and local footer actions', () => {
  const html = renderToStaticMarkup(
    createElement(GroupEditor, {
      tabs,
      suggestion: {
        groups: [
          { name: 'Garden project', tabIds: [1, 2] },
          { name: '', tabIds: [] },
        ],
        ungroupedTabIds: [3],
      },
      query: 'Guide',
      stale: true,
      onCancel() {},
      onSave() {},
    }),
  );
  for (const text of [
    'Organize your groups',
    'Select tabs',
    'Create group',
    'Group name',
    'Move Guide to group',
    'Your tabs have changed',
    'Update tabs to review new and changed pages',
    'Save changes',
    'Cancel',
    'Remove Unnamed group',
    'Enter a group name.',
    'aria-invalid="true"',
  ])
    assert.ok(html.includes(text), text);
  assert.ok(!html.includes('Refresh suggestions'));
  assert.ok(!html.includes('New group name'));
  assert.ok(!html.includes('draggable=') && !html.includes('Drag tabs'));
  assert.ok(!html.includes('Reference') && !html.includes('Weather'));
  assert.ok(html.includes('Search results'));
  assert.match(html, /disabled=""[^>]*>Save changes/);
});

test('editing is available only for completed suggestions', () => {
  assert.ok(!render({}).includes('Edit groups'));
  assert.ok(!render({ pending: true }).includes('Edit groups'));
  assert.ok(
    render({
      result: { tabs, suggestion: { groups: [], ungroupedTabIds: [1, 2, 3] } },
    }).includes('Edit groups'),
  );
});

test('search combines matches from groups and Ungrouped into one results list', () => {
  const html = render({
    result: {
      tabs,
      suggestion: {
        groups: [{ name: 'Garden project', tabIds: [1, 2] }],
        ungroupedTabIds: [3],
      },
    },
  });
  assert.ok(html.includes('Garden project'));
  const editor = renderToStaticMarkup(
    createElement(GroupEditor, {
      tabs,
      suggestion: {
        groups: [{ name: 'Garden project', tabIds: [1, 2] }],
        ungroupedTabIds: [3],
      },
      query: 'example',
      stale: false,
      onCancel() {},
      onSave() {},
    }),
  );
  assert.equal((editor.match(/aria-label="Search results"/g) ?? []).length, 1);
  for (const title of ['Guide', 'Reference', 'Weather'])
    assert.ok(editor.includes(`class="tab-title">${title}</span>`));
  assert.ok(!editor.includes('class="group-heading"'));
  assert.ok(editor.includes('Garden project') && editor.includes('Ungrouped'));
});

test('application UI exposes Group tabs beneath compact secondary actions and updated preview-only copy', () => {
  const html = render({
    result: {
      tabs,
      suggestion: {
        groups: [{ name: 'Synthetic topic', tabIds: [1, 2] }],
        ungroupedTabIds: [3],
      },
    },
    onApply: async () => ({
      kind: 'success',
      consumed: true,
      message: 'Applied',
    }),
  });
  assert.ok(html.indexOf('Edit groups') < html.indexOf('Group tabs</button>'));
  assert.ok(
    html.indexOf('Refresh suggestions') < html.indexOf('Group tabs</button>'),
  );
  assert.match(html, /Editing and saving only update the preview/);
});

test('stale application UI disables Group tabs', () => {
  const html = render({
    stale: true,
    result: { tabs, suggestion: { groups: [], ungroupedTabIds: [1, 2, 3] } },
    onApply: async () => ({
      kind: 'success',
      consumed: true,
      message: 'Applied',
    }),
  });
  assert.match(html, /group-tabs-button" disabled=""/);
});

test('stale editor exposes Update tabs and disables saving until reviewed', () => {
  const html = renderToStaticMarkup(
    createElement(GroupEditor, {
      tabs,
      suggestion: { groups: [], ungroupedTabIds: [1, 2, 3] },
      query: '',
      stale: true,
      onCancel() {},
      onSave() {},
      onUpdateTabs: async (draft) => draft,
    }),
  );
  assert.match(html, /Update tabs<\/button>/);
  assert.match(html, /disabled="">Save changes/);
  assert.match(html, /Your manual edits are kept/);
});

test('suggested preview labels same-name existing destinations by window and group', () => {
  const groupedTabs = [
    { ...tabs[0], windowId: 10 },
    { ...tabs[1], windowId: 10 },
    { ...tabs[2], windowId: 20 },
  ];
  const html = renderToStaticMarkup(
    createElement(PopupView, {
      ...base,
      tabs: groupedTabs,
      skippedTabs: [],
      result: {
        tabs: groupedTabs,
        existingGroups: [
          { id: 30, name: 'React', windowId: 10 },
          { id: 31, name: 'React', windowId: 10 },
          { id: 32, name: 'React', windowId: 20 },
        ],
        suggestion: {
          groups: [
            { name: 'React', existingGroupId: 30, tabIds: [1] },
            { name: 'React', existingGroupId: 31, tabIds: [2] },
            { name: 'React', existingGroupId: 32, tabIds: [3] },
          ],
          ungroupedTabIds: [],
        },
      },
    }),
  );
  assert.match(
    html,
    /Will organize tabs into 3 separate groups across 2 windows/,
  );
  assert.match(html, /tab-group-label">Window 1/);
  assert.match(html, /tab-group-label">Window 2/);
});

test('single-window cards label their window when several windows are open', () => {
  const current = [
    { id: 40, name: 'Work', windowId: 10 },
    { id: 41, name: 'Reading', windowId: 10 },
    { id: 42, name: 'Other', windowId: 20 },
  ];
  const snapshot = [
    { ...tabs[0], windowId: 10, groupId: 40 },
    { ...tabs[1], windowId: 10, groupId: 41 },
    { ...tabs[2], windowId: 20, groupId: 42 },
  ];
  const html = renderToStaticMarkup(
    createElement(PopupView, {
      ...base,
      tabs: snapshot,
      skippedTabs: [],
      existingGroups: current,
      result: {
        tabs: snapshot,
        existingGroups: current,
        suggestion: {
          groups: current.map((group, index) => ({
            name: group.name,
            existingGroupId: group.id,
            tabIds: [index + 1],
          })),
          ungroupedTabIds: [],
        },
      },
    }),
  );
  assert.match(html, /Window 1/);
  assert.match(html, /Window 2/);
  assert.doesNotMatch(html, /Group \d/);
  assert.ok(html.includes('Current Chrome group'));
  assert.ok(html.includes('Keeps tabs in existing group'));
});

test('same-name groups confined to one window use group numbers without window labels', () => {
  const current = [
    { id: 50, name: 'React', windowId: 10 },
    { id: 51, name: 'React', windowId: 10 },
  ];
  const snapshot = tabs.map((tab) => ({ ...tab, windowId: 10 }));
  const html = renderToStaticMarkup(
    createElement(PopupView, {
      ...base,
      tabs: snapshot,
      skippedTabs: [],
      existingGroups: current,
      result: {
        tabs: snapshot,
        existingGroups: current,
        suggestion: {
          groups: current.map((group, index) => ({
            name: group.name,
            existingGroupId: group.id,
            tabIds: [index + 1],
          })),
          ungroupedTabIds: [3],
        },
      },
    }),
  );
  assert.doesNotMatch(html, /Window \d/);
  for (const number of [1, 2]) {
    assert.ok(html.includes(`Current Chrome group · Group ${number}`));
    assert.ok(html.includes(`Existing Chrome group · Group ${number}`));
  }
});

test('current groups include internal Chrome tabs without adding them to suggestions', () => {
  const internal = {
    id: 90,
    windowId: 1,
    groupId: 50,
    title: 'Synthetic Extensions',
    url: 'chrome://extensions',
  };
  const html = renderToStaticMarkup(
    createElement(PopupView, {
      ...base,
      skippedTabs: [internal],
      currentTabs: [...tabs, internal],
      existingGroups: [{ id: 50, name: 'Settings', windowId: 1 }],
    }),
  );
  assert.match(html, /Synthetic Extensions/);
  assert.doesNotMatch(html, /No tabs here/);
  assert.match(html, /3 TABS TO ORGANIZE/);
});

test('current and preview cards sort by window and same-name group number without mutating assignments', () => {
  const current = [
    { id: 32, name: 'Project', windowId: 20 },
    { id: 31, name: 'Project', windowId: 10 },
    { id: 30, name: 'Project', windowId: 10 },
  ];
  const snapshot = tabs.map((tab, index) => ({
    ...tab,
    windowId: current[index].windowId,
    groupId: current[index].id,
  }));
  const suggestion = {
    groups: current.map((group, index) => ({
      name: group.name,
      existingGroupId: group.id,
      tabIds: [index + 1],
    })),
    ungroupedTabIds: [],
  };
  const original = JSON.stringify(suggestion);
  const html = renderToStaticMarkup(
    createElement(PopupView, {
      ...base,
      tabs: snapshot,
      skippedTabs: [],
      currentTabs: snapshot,
      existingGroups: current,
      result: { tabs: snapshot, existingGroups: current, suggestion },
    }),
  );
  for (const prefix of ['Current Chrome group']) {
    const positions = [
      'Window 1 · Group 1',
      'Window 1 · Group 2',
      'Window 2',
    ].map((label) => html.indexOf(`${prefix} · ${label}`));
    assert.ok(
      positions[0] >= 0 &&
        positions[0] < positions[1] &&
        positions[1] < positions[2],
    );
  }
  assert.equal(JSON.stringify(suggestion), original);
  assert.deepEqual(
    current.map((group) => group.id),
    [32, 31, 30],
  );
});

test('preview labels only windows receiving tabs and distinguishes creation from reuse', () => {
  const snapshot = [
    { ...tabs[0], windowId: 20 },
    { ...tabs[1], windowId: 10 },
  ];
  const existingGroups = [{ id: 30, name: 'Cooking', windowId: 10 }];
  const display = (ids) =>
    renderToStaticMarkup(
      createElement(PopupView, {
        ...base,
        tabs: snapshot,
        skippedTabs: [],
        result: {
          tabs: snapshot,
          existingGroups,
          suggestion: {
            groups: [{ name: 'Cooking', existingGroupId: 30, tabIds: ids }],
            ungroupedTabIds: [1, 2].filter((id) => !ids.includes(id)),
          },
        },
      }),
    );
  const remote = display([1]);
  assert.match(remote, /Window 2/);
  assert.doesNotMatch(remote, /Existing Chrome group/);
  const both = display([1, 2]);
  assert.match(
    both,
    /Will organize tabs into 2 separate groups across 2 windows/,
  );
  assert.doesNotMatch(both, /Existing Chrome group · Window 1/);
  const cards = both.match(/<article class="group-card">[\s\S]*?<\/article>/g);
  assert.equal(cards.length, 1);
  assert.ok(cards[0].includes('Reference') && cards[0].includes('Guide'));
  assert.ok(cards[0].indexOf('Reference') < cards[0].indexOf('Guide'));
});

test('editor keeps distinct card headings but consolidates same-name move options', () => {
  const suggestion = {
    groups: [
      { name: 'Project', tabIds: [1] },
      { name: 'Project', tabIds: [2] },
    ],
    ungroupedTabIds: [3],
  };
  const html = renderToStaticMarkup(
    createElement(GroupEditor, {
      tabs,
      suggestion,
      query: '',
      stale: false,
      destinationLabel: (group, index) => `${group.name} · Group ${index + 1}`,
      onCancel() {},
      onSave() {},
    }),
  );
  assert.match(html, /Project · Group 1/);
  assert.match(html, /Project · Group 2/);
  assert.match(html, /<option value="0">Project<\/option>/);
  assert.doesNotMatch(html, /<option value="1">Project/);
  assert.doesNotMatch(html, /draggable=|Drag tabs|drag tabs/);
  assert.equal(suggestion.groups[0].name, 'Project');
});

test('duplicate groups in one window consistently show the window and Ungrouped tabs identify their windows', () => {
  const current = [
    { id: 30, name: 'React', windowId: 10 },
    { id: 31, name: 'React', windowId: 10 },
  ];
  const snapshot = [
    { ...tabs[0], windowId: 10 },
    { ...tabs[1], windowId: 10 },
    { ...tabs[2], windowId: 20 },
  ];
  const html = render({
    tabs: snapshot,
    skippedTabs: [],
    existingGroups: current,
    result: {
      tabs: snapshot,
      existingGroups: current,
      suggestion: {
        groups: [
          { name: 'React', existingGroupId: 30, tabIds: [1] },
          { name: 'React', existingGroupId: 31, tabIds: [2] },
        ],
        ungroupedTabIds: [3],
      },
    },
  });
  assert.match(html, /Existing Chrome group · Window 1 · Group 1/);
  assert.match(html, /Existing Chrome group · Window 1 · Group 2/);
  assert.match(html, /tab-group-label">Window 2/);
});

test('unique new groups show window labels without creation copy', () => {
  const snapshot = [
    { ...tabs[0], windowId: 10 },
    { ...tabs[1], windowId: 20 },
  ];
  const html = render({
    tabs: snapshot,
    skippedTabs: [],
    result: {
      tabs: snapshot,
      suggestion: {
        groups: [
          { name: 'Notes', tabIds: [1] },
          { name: 'Reading', tabIds: [2] },
        ],
        ungroupedTabIds: [],
      },
    },
  });
  assert.doesNotMatch(html, /Will create|Will add|Will remove/);
  assert.match(html, /Notes<span class="existing-group-label">Window 1/);
  assert.match(html, /Reading<span class="existing-group-label">Window 2/);
});

test('same-name new groups across windows show only their window identifiers', () => {
  const snapshot = [
    { ...tabs[0], windowId: 10 },
    { ...tabs[1], windowId: 20 },
  ];
  const html = render({
    tabs: snapshot,
    skippedTabs: [],
    result: {
      tabs: snapshot,
      suggestion: {
        groups: [
          { name: 'Notes', tabIds: [1] },
          { name: 'Notes', tabIds: [2] },
        ],
        ungroupedTabIds: [],
      },
    },
  });
  assert.match(
    html,
    /Notes<span class="existing-group-label">Will organize tabs into 2 separate groups across 2 windows/,
  );
  assert.match(html, /tab-group-label">Window 1/);
  assert.match(html, /tab-group-label">Window 2/);
  assert.doesNotMatch(html, /Will create/);
});

test('renaming one duplicate removes old group numbers from preview cards', () => {
  const current = [
    { id: 30, name: 'Project', windowId: 10 },
    { id: 31, name: 'Project', windowId: 10 },
    { id: 32, name: 'Project', windowId: 20 },
  ];
  const snapshot = [
    { ...tabs[0], windowId: 10, groupId: 30 },
    { ...tabs[1], windowId: 10, groupId: 31 },
    { ...tabs[2], windowId: 20, groupId: 32 },
  ];
  const html = render({
    tabs: snapshot,
    skippedTabs: [],
    result: {
      tabs: snapshot,
      existingGroups: current,
      suggestion: {
        groups: [
          { name: 'Study', existingGroupId: 30, tabIds: [1] },
          { name: 'Project', existingGroupId: 31, tabIds: [2] },
        ],
        ungroupedTabIds: [3],
      },
    },
  });
  assert.match(
    html,
    /Study<span class="existing-group-label">Existing Chrome group · Window 1<\/span>/,
  );
  assert.match(
    html,
    /Project<span class="existing-group-label">Keeps tabs in existing group · Window 1<\/span>/,
  );
  assert.doesNotMatch(html, /Group [12]/);
});

test('editor destination labels receive the current draft for recalculating duplicate names', () => {
  const suggestion = {
    groups: [
      { name: 'Study', existingGroupId: 30, tabIds: [1] },
      { name: 'Project', existingGroupId: 31, tabIds: [2] },
    ],
    ungroupedTabIds: [3],
  };
  const names = [];
  renderToStaticMarkup(
    createElement(GroupEditor, {
      tabs,
      suggestion,
      query: '',
      stale: false,
      destinationLabel: (group, index, draft) => {
        names.push(draft.groups.map((group) => group.name));
        return group.name;
      },
      onCancel() {},
      onSave() {},
    }),
  );
  assert.deepEqual(names, [
    ['Study', 'Project'],
    ['Study', 'Project'],
  ]);
});

test('saved preview explains the separate groups for a cross-window assignment', () => {
  const snapshot = [tabs[0], { ...tabs[1], windowId: 2 }, tabs[2]];
  const suggestion = {
    groups: [{ name: 'Research', tabIds: [1, 2] }],
    ungroupedTabIds: [3],
  };
  const html = render({
    tabs: snapshot,
    result: { tabs: snapshot, suggestion },
  });
  assert.equal(
    (
      html.match(
        /Will organize tabs into 2 separate groups across 2 windows/g,
      ) ?? []
    ).length,
    1,
  );
  assert.match(html, /Tabs stay in their current windows/);
  assert.doesNotMatch(html, /Will create new Chrome group/);
});

test('editor explains cross-window groups even when searching hides their cards', () => {
  const snapshot = [tabs[0], { ...tabs[1], windowId: 2 }, tabs[2]];
  const suggestion = {
    groups: [{ name: 'Research', tabIds: [1, 2] }],
    ungroupedTabIds: [3],
  };
  for (const query of ['', 'Guide']) {
    const html = renderToStaticMarkup(
      createElement(GroupEditor, {
        tabs: snapshot,
        suggestion,
        query,
        stale: false,
        onCancel() {},
        onSave() {},
      }),
    );
    assert.match(
      html,
      /Will organize tabs into 2 separate groups across 2 windows/,
    );
  }
  const html = renderToStaticMarkup(
    createElement(GroupEditor, {
      tabs,
      suggestion,
      query: '',
      stale: false,
      onCancel() {},
      onSave() {},
    }),
  );
  assert.doesNotMatch(html, /separate groups across/);
});

test('cross-window summary replaces combine details while single-window combinations keep them', () => {
  const groups = [
    { id: 10, name: 'Research', windowId: 1 },
    { id: 20, name: 'Research', windowId: 1 },
  ];
  const snapshot = [
    { ...tabs[0], groupId: 10 },
    { ...tabs[1], groupId: 20 },
    { ...tabs[2], windowId: 2, groupId: -1 },
  ];
  const suggestion = {
    groups: [{ name: 'Research', existingGroupId: 20, tabIds: [1, 2, 3] }],
    ungroupedTabIds: [],
  };
  const html = render({
    tabs: snapshot,
    currentTabs: snapshot,
    result: { tabs: snapshot, existingGroups: groups, suggestion },
  });
  assert.match(
    html,
    /Will organize tabs into 2 separate groups across 2 windows/,
  );
  assert.doesNotMatch(html, /Will combine|Keeps tabs in existing group/);
  const single = {
    ...suggestion,
    groups: [{ ...suggestion.groups[0], tabIds: [1, 2] }],
    ungroupedTabIds: [3],
  };
  const singleHtml = render({
    tabs: snapshot,
    currentTabs: snapshot,
    result: { tabs: snapshot, existingGroups: groups, suggestion: single },
  });
  assert.match(singleHtml, /Will combine Group 1 into Group 2/);
  assert.doesNotMatch(singleHtml, /separate groups across/);
});

test('one cross-window preview card shows its summary once and identifies each tab window', () => {
  const snapshot = [tabs[0], { ...tabs[1], windowId: 2 }];
  const html = render({
    tabs: snapshot,
    result: {
      tabs: snapshot,
      suggestion: {
        groups: [{ name: 'Research', tabIds: [1, 2] }],
        ungroupedTabIds: [],
      },
    },
  });
  assert.match(html, /tab-group-label">Window 1/);
  assert.match(html, /tab-group-label">Window 2/);
  assert.doesNotMatch(html, /Window [12] · Will organize/);
});

test('editor identifies identical tabs across windows in cards, search and accessible controls', () => {
  const snapshot = [
    { ...tabs[0], windowId: 10 },
    { ...tabs[0], id: 2, windowId: 20 },
  ];
  const suggestion = {
    groups: [{ name: 'Research', tabIds: [1] }],
    ungroupedTabIds: [2],
  };
  for (const query of ['', 'Guide']) {
    const html = renderToStaticMarkup(
      createElement(GroupEditor, {
        tabs: snapshot,
        suggestion,
        query,
        stale: false,
        onCancel() {},
        onSave() {},
      }),
    );
    assert.match(html, /tab-group-label">Window 1/);
    assert.match(html, /tab-group-label">Window 2/);
    assert.match(html, /Move Guide · Window 1 to group/);
    assert.match(html, /Move Guide · Window 2 to group/);
  }
  const html = renderToStaticMarkup(
    createElement(GroupEditor, {
      tabs,
      suggestion,
      query: '',
      stale: false,
      onCancel() {},
      onSave() {},
    }),
  );
  assert.doesNotMatch(html, /tab-group-label">Window/);
});

test('restored consumed and applying states disable conflicting actions', () => {
  const result = {
    tabs,
    suggestion: { groups: [], ungroupedTabIds: [1, 2, 3] },
  };
  const busy = render({ result, applying: true });
  assert.match(busy, /disabled=""[^>]*>Edit groups/);
  assert.match(busy, /disabled=""[^>]*>Grouping tabs/);
  const applied = render({
    result,
    applyOutcome: { kind: 'success', consumed: true, message: 'Applied once' },
  });
  assert.match(applied, /disabled=""[^>]*>Preview applied/);
  assert.ok(applied.includes('Applied once'));
});

test('Reset preview is available on the starting page and explains that Chrome stays unchanged', () => {
  const html = render({ async onReset() {} });
  assert.ok(html.includes('aria-label="Close popup and restart TidyTabs"'));
  assert.ok(html.includes('<span aria-hidden="true">×</span>'));
  assert.ok(!html.includes('Reset preview</button>'));
  assert.ok(html.includes('Chrome tabs and groups stay unchanged'));
  for (const state of [
    { pending: true },
    { applying: true },
    { loading: true },
  ]) {
    assert.match(
      render({ ...state, async onReset() {} }),
      /class="reset-preview-button"[^>]*disabled=""/,
    );
  }
});

test('shows current Chrome groups independently of AI destinations across windows', () => {
  const html = renderToStaticMarkup(
    createElement(PopupView, {
      ...base,
      tabs: [
        { ...tabs[0], groupId: 20 },
        { ...tabs[1], windowId: 2, groupId: 21 },
        tabs[2],
      ],
      existingGroups: [
        { id: 20, windowId: 1, name: 'Current work' },
        { id: 21, windowId: 2, name: 'Current reading' },
      ],
      result: { tabs, suggestion: { groups: [], ungroupedTabIds: [1, 2, 3] } },
    }),
  );
  assert.match(html, /Current Chrome groups \(2\)/);
  assert.match(html, /Current work/);
  assert.match(html, /Current reading/);
  assert.match(html, /Current Chrome group · Window 1/);
  assert.match(html, /Current Chrome group · Window 2/);
  assert.match(html, /AI returned no named groups/);
});

test('side panel shows a return-to-popup control instead of Keep open', () => {
  const html = render({ onOpenPopup: async () => {} });
  assert.match(html, /Open popup ↗/);
  assert.match(html, /Open the popup and close this side panel/);
  assert.doesNotMatch(html, /Keep open ↗/);
});

test('Ungrouped is one card across windows with per-tab window labels', () => {
  const snapshot = [
    { ...tabs[0], windowId: 10 },
    { ...tabs[1], windowId: 20 },
  ];
  const html = render({
    tabs: snapshot,
    skippedTabs: [],
    result: {
      tabs: snapshot,
      suggestion: { groups: [], ungroupedTabIds: [1, 2] },
    },
  });
  assert.equal((html.match(/<h3>Ungrouped/g) ?? []).length, 1);
  assert.match(html, /tab-group-label">Window 1/);
  assert.match(html, /tab-group-label">Window 2/);
  const single = render({
    tabs,
    skippedTabs: [],
    result: { tabs, suggestion: { groups: [], ungroupedTabIds: [1, 2, 3] } },
  });
  assert.doesNotMatch(single, /tab-group-label">Window/);
});

const { ProviderAccessPanel } =
  await import('../entrypoints/popup/ProviderAccessPanel.tsx');

test('beta entry is masked, explains consent and persistence, and does not expose an invite', () => {
  const html = renderToStaticMarkup(
    createElement(ProviderAccessPanel, {
      hasAccess: false,
      connected: true,
      busy: false,
      onSave() {},
      onClear() {},
    }),
  );
  assert.ok(
    html.includes('type="password"') && html.includes('autoComplete="off"'),
  );
  assert.ok(
    html.includes('Saving sends nothing') &&
      html.includes('tab titles') &&
      html.includes('sanitized URL origins'),
  );
  assert.ok(
    html.includes('memory-only Chrome session storage') &&
      html.includes('Chrome restarts'),
  );
  const ready = renderToStaticMarkup(
    createElement(ProviderAccessPanel, {
      hasAccess: true,
      connected: true,
      busy: true,
      onSave() {},
      onClear() {},
    }),
  );
  assert.ok(
    ready.includes('Clear API key') && !ready.includes('type="password"'),
  );
  assert.ok(!ready.includes('disabled=""')); // Clearing remains available during a request.
  assert.ok(ready.includes('cannot recall metadata already sent'));
});

test('missing API key disables suggestions', () => {
  const panel = createElement(ProviderAccessPanel, {
    hasAccess: false,
    connected: false,
    busy: false,
    onSave() {},
    onClear() {},
  });
  const html = render({ accessRequired: true, accessPanel: panel });
  assert.ok(
    html.includes('Paste your API key') &&
      html.includes('CONNECT YOUR AI PROVIDER'),
  );
  assert.ok(html.includes('Set up AI to get suggestions.'));
  assert.ok(html.includes('Open AI settings'));
  assert.ok(!html.includes('>Suggest groups<'));
});

test('provider form has populated model selectors and an accessible non-submit visibility control', () => {
  const html = renderToStaticMarkup(
    createElement(ProviderAccessPanel, {
      hasAccess: false,
      busy: false,
      onSave() {},
      onClear() {},
    }),
  );
  assert.match(html, /<select id="ai-model"/);
  assert.match(html, /value="openai\/gpt-oss-20b" selected=""/);
  assert.match(html, />GPT OSS 120B<\/option>/);
  assert.doesNotMatch(html, /<input id="ai-model"/);
  assert.match(html, /type="button" aria-label="Show API key"/);
  assert.match(html, /aria-controls="api-key" aria-pressed="false"/);
});

test('disconnected AI keeps the tabs and footer visible with suggestions disabled', () => {
  const html = render({ tabs, accessRequired: true });
  assert.ok(html.includes(tabs[0].title));
  assert.ok(html.includes('Set up AI to get suggestions.'));
  assert.ok(html.includes('Open AI settings'));
  assert.ok(!html.includes('>Suggest groups<'));
});

test('first-use setup stays separate from tab content while disconnected returning users keep it', () => {
  const setup = render({
    tabs,
    accessRequired: true,
    setupOnly: true,
    accessPanel: createElement('p', null, 'Provider setup'),
  });
  assert.ok(setup.includes('Provider setup'));
  assert.ok(!setup.includes('Suggest groups'));
  assert.ok(!setup.includes(tabs[0].title));
  const returning = render({ tabs, accessRequired: true, setupOnly: false });
  assert.ok(
    returning.includes('Open AI settings') && returning.includes(tabs[0].title),
  );
});

test('disconnected preview keeps grouping available and replaces refreshing with setup guidance', () => {
  const html = render({
    tabs,
    accessRequired: true,
    result: {
      tabs,
      suggestion: {
        groups: [{ name: 'Example', tabIds: [1, 2] }],
        ungroupedTabIds: [3],
      },
    },
  });
  assert.ok(html.includes('Set up AI to get suggestions.'));
  assert.ok(html.includes('Open AI settings'));
  assert.ok(html.includes('group-tabs-button'));
  assert.ok(!html.includes('Refresh suggestions'));
});
