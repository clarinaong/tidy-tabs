# TidyTabs

TidyTabs is a Chrome extension being built to suggest tab groups based on shared projects and tasks. Uncertain tabs stay ungrouped.

Currently, the extension displays open tabs. A separate Node.js and TypeScript backend uses Groq to generate grouping suggestions; the extension is not yet connected to it.

## Local development

Running locally lets you test changes on your computer before publishing. These steps are for developing TidyTabs, not for people installing a published extension from the Chrome Web Store.

Requires Node.js 24 or later, npm, and Chrome.

### Extension

From the repository root:

```sh
cd extension
npm ci
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
