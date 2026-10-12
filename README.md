# TidyTabs

A downloadable unpacked Chrome extension that suggests useful tab groups. Preview and edit suggestions before choosing **Group tabs**.

## Install

Unzip the 0.8.0 extension archive, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the folder containing `manifest.json`. Use Chrome 116 or later. To update, replace the unpacked files and reload the extension.

Choose Groq, OpenAI, or Google Gemini, select a model and enter your own API key, then choose **Use key for this session**. No TidyTabs backend, database, hosting, or invite is required. OpenAI uses the API, not a ChatGPT login/subscription. Provider billing and quotas apply; model availability depends on your account. Defaults are Groq `openai/gpt-oss-20b`, OpenAI `gpt-4.1-mini`, and Gemini `gemini-3.5-flash-lite`. The model dropdown changes with the provider and lists compatible structured-output models. The eye button shows or hides the key while entering it; it starts hidden and resets to hidden on provider change or save.

Keys stay in memory-only `chrome.storage.session`, restricted to trusted extension contexts. They survive popup closure and worker suspension, but clear on browser restart, extension reload/update/disable, or **Clear API key**. This is not encrypted vault storage; extension code or someone controlling your browser can access the key. Keys are never written to local/sync storage or returned in status messages. Saving sends nothing.

**Suggest groups** sends titles, sanitized URL origins (no paths, queries, fragments, or URL credentials), and existing group context directly to the selected provider. Titles can contain sensitive searches or document names. No webpage content is fetched. Clearing a key cancels local requests but cannot recall sent metadata or guarantee stopping provider charges. Requests are never retried automatically. Only **Group tabs** changes your Chrome groups.

## Development

From `extension`, run `npm install`, `npm test`, `npm run compile`, and `npm run build`. Production files are in `extension/.output/chrome-mv3`; package only that folder's contents. No environment variables are needed. Provider adapters and fixed endpoints are in `extension/lib/providers.ts` and `extension/lib/api.ts`. No arbitrary endpoint is accepted.

The original local `backend/` prototype is unused and excluded from the extension package. The abandoned invite service, database adapters, database dependencies, and hosting configuration have been removed. Older 0.7.0 review ZIPs use the abandoned hosted-invite architecture and must not be distributed as this release.

Manual checks still needed: load in Chrome; save/reopen popup and side panel; restart/reload and confirm key is gone; test a synthetic request with each provider using your own account; clear during a request; preview/edit/apply grouping. Automated tests mock providers and never use real keys or browsing data.
