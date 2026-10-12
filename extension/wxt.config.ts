import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifestVersion: 3,
  manifest: {
    name: 'TidyTabs',
    description: 'Your tabs, intelligently organized.',
    permissions: ['tabs', 'favicon', 'tabGroups', 'storage', 'sidePanel'],
    host_permissions: [
      'https://api.groq.com/*',
      'https://api.openai.com/*',
      'https://generativelanguage.googleapis.com/*',
    ],
    minimum_chrome_version: '116',
    version: '0.8.0',
    version_name: '0.8.0 beta',
    action: {
      default_icon: {
        16: 'toolbar/tidytabs-rounded-16.png',
        32: 'toolbar/tidytabs-rounded-32.png',
        48: 'toolbar/tidytabs-rounded-48.png',
        128: 'toolbar/tidytabs-rounded-128.png',
      },
    },
  },
});

// manifest is Chrome's description of extension
// tabs permission lets extension read tab titles and urls
