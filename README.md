# TidyTabs

TidyTabs is a Chrome extension being built to suggest tab groups based on shared projects, tasks, interests, and activities. Uncertain tabs stay ungrouped.

The extension displays open tabs and, when you click **Suggest groups**, requests group suggestions from a local Node.js and TypeScript backend using Groq. Suggestions are snapshots; Chrome tab groups are never changed.

## Local development

Running locally lets you test changes on your computer before publishing. These steps are for developing TidyTabs, not for people installing a published extension from the Chrome Web Store.

Requires Node.js 24 or later, npm, and Chrome.

### Extension

From the repository root:

```sh
cd extension
npm ci
cp .env.example .env
# Set WXT_BACKEND_BASE_URL=http://127.0.0.1:3000 in extension/.env
npm run dev
```

To build a version you can load in Chrome, run `npm run build`, open `chrome://extensions`, enable Developer mode, and select **Load unpacked** with the `extension/.output/chrome-mv3` folder.

### Backend

In a separate terminal, from the repository root:

```sh
cd backend
npm ci
cp .env.example .env
```

Copy the template only when first setting up; keep an existing `.env` file. Enter your Groq API key in `backend/.env` and set `GROQ_MODEL=openai/gpt-oss-20b`. Keep your key private; `.env` is ignored by Git.

```sh
npm run dev
```

The backend listens at `http://127.0.0.1:3000`. Its `POST /api/group-tabs` endpoint accepts a JSON object with a `tabs` array containing numeric `id`, `title`, and `url` fields. It returns `groups` and `ungroupedTabIds`. Restart the backend after changing `.env`.

Tab titles and sanitized URL origins are sent to Groq; webpage contents are not retrieved. The API returns suggestions and does not change Chrome tabs.

To check the backend:

```sh
npm test
npm run typecheck
npm run build
```

Tests use mocked responses and do not need a Groq API key. The backend currently runs locally and has no authentication or application-level rate limiting.

### Suggestions and checks

Requires Node.js 24 or later for the extension’s built-in Node test runner. From `extension`, run `npm test`, `npm run compile`, and `npm run build`. Tests mock browser APIs and fetch; they never contact Groq.

WXT exposes `WXT_` variables through `import.meta.env` ([environment variable documentation](https://wxt.dev/guide/essentials/config/environment-variables.html)). `WXT_BACKEND_BASE_URL` is public build configuration, not a secret. Restart development or rebuild and reload Chrome after changing it. Keep all credentials exclusively in `backend/.env`. The empty example files are templates, not working configurations.

Only `http://127.0.0.1/*` is added as a host permission. Chrome match patterns cannot restrict ports, so the permission covers this host’s HTTP ports while the configured URL selects port 3000. Before publication, change the base URL to the production HTTPS origin and replace the local host permission with that exact host’s permission. Public hosting is not included.

Suggest groups re-reads current tabs. Only HTTP(S) tabs with valid IDs are eligible; skipped tabs are counted. Missing titles become “Untitled tab”. Only URL protocol and host leave the extension, alongside titles and IDs. Requests over 100 eligible tabs, 65,536 UTF-8 bytes, 300 title characters, or 2,048 URL characters fail visibly without truncation. Responses are checked for valid names and unique known assignments; omitted IDs remain ungrouped. A 30-second extension timeout gives the backend’s 20-second provider timeout time to return an error.

### Manual local check

1. Start the backend and build/load the extension using the commands above.
2. Open the popup and verify the existing tab list. Opening the popup must not send a grouping request.
3. Only after explicitly choosing to share metadata with Groq, use a Chrome window containing synthetic test tabs and close other HTTP(S) tabs: the extension reads all windows. Click **Suggest groups**. Verify pending state, disabled action, actual suggested names, and ungrouped titles; Chrome groups must stay unchanged.
4. Include an internal Chrome page to verify the skipped-tab explanation. Navigate, rename, or close a tab during or after the request and verify the snapshot warning; request fresh suggestions.
5. Stop the backend and retry to verify the connection error. Clear the extension URL and rebuild to verify configuration guidance. With only internal tabs, verify the no-eligible-tabs message.

The manual Groq check shares titles and origins and requires your explicit authorization. Automated tests do not perform it.

The popup keeps its eligible-tab list and count current while open, without requesting AI suggestions automatically. Rows show a local title and hostname; GitHub repository rows show owner/repository, and Google search rows preserve the search text from the tab title, falling back to “Google Search” when no title is available. These display labels stay local: API requests still use the original titles and sanitized URL origins. While requesting, the suggestion button is hidden and replaced by loading feedback; it returns when the request finishes.

Suggestions prioritize distinct projects supported by tab titles, then group remaining tabs into shared activities such as Entertainment or Learning. Project research and tutorials can join their project instead of a broad category. Relevant framework/tool research can also join a project when the context strongly supports it; generic developer profiles and dashboards can form a Development fallback group without being assigned to an unsupported specific project. The AI groups by purpose across websites using original tab titles and URL origins. Generic YouTube, Netflix, and Disney+ pages default to Entertainment; clearly titled tutorials instead belong with learning or development tabs. Casual Discord Friends/gaming pages can join Entertainment, while work or study titles override that default. It does not inspect video or page contents; uncertain tabs remain ungrouped.

Before suggestions, “Tabs to organize” lists only eligible tabs. Excluded tab names appear in the expandable skipped-tab section and are never included in the request. “Ungrouped” results are eligible tabs that were sent but not assigned to a group.

The popup uses a misty blue layout with a scrollable preview and a persistent suggestion action. Search combines matching titles and domains into one local results list, with group labels after suggestions; it never changes the tabs sent for suggestions. Group cards can be collapsed individually or together. Titles and domains are displayed on separate lines, with favicons supplied through Chrome’s local favicon endpoint and initial badges as a fallback. The favicon permission enables these icons; no third-party favicon service is used. The supplied TidyTabs logo is bundled in the popup and Chrome icon sizes.

After suggestions arrive, **Edit groups** opens a local draft. Rename groups in their name fields or use the adjacent **Remove** button, create groups with **Create group**, move tabs by dragging onto a group card or using the **Move to** menu, select multiple tabs with **Select tabs** and move them together (including selections hidden by search), and remove groups after confirmation. Removed groups send their tabs to Ungrouped; empty and single-tab custom groups are allowed. Search only filters what is displayed. **Cancel** discards the draft; **Save changes** updates the edited preview without changing Chrome tabs or contacting Groq. Refresh is unavailable during editing. Browser changes keep the earlier-tab warning visible even after saving. Edits last only while the popup remains open.


### Applying a preview to Chrome

**Group tabs** applies the displayed preview, including saved manual edits, without requesting suggestions. Existing same-name destinations are reused within each window. Nonempty groups are blue; manually created single-tab groups work and empty groups are skipped. Ungrouped removes only preview tabs from existing Chrome groups, leaving excluded and outside-snapshot members untouched. Tabs remain in their windows.

Snapshot validation, conflicting-action locks, and repeat prevention accompany the application operation. Changes before application block it; changes or API failures during application stop further work and report uncertainty/partial completion without automatic retry. Reload the built extension at `extension/.output/chrome-mv3` to test.


### Reviewing a changed snapshot

Stale checks compare eligible tab IDs, titles, full URLs, window IDs, memberships, and referenced Chrome groups. Browser events alone, tab ordering, and favicon changes do not invalidate the snapshot. **Edit groups** reads current tabs without an AI request, preserves unaffected manual assignments, and puts new or changed pages in Ungrouped. Closed and ineligible tabs leave the draft. If tabs change while editing, **Update tabs** reviews them again; saving revalidates before creating a fresh preview.

### Existing-group-aware suggestions

Suggestion requests include existing Chrome group names, IDs, window IDs, and eligible member tab IDs alongside sanitized tab titles and website origins. The backend validates this context and only accepts references to supplied destinations with their exact names. Full URLs and excluded tab titles are not sent.

The AI is encouraged to reuse clearly relevant destinations and consolidate overlapping groups within one window, while leaving unrelated or uncertain tabs ungrouped. These are preferences, not guaranteed merges. New AI groups need at least two tabs per window; existing destinations can receive one. This minimum does not apply to manually saved groups. Grouping still keeps tabs in their current windows.
