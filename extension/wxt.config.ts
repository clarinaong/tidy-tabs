import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifestVersion: 3,
  manifest: {
    name: 'TidyTabs',
    description: 'Your tabs, intelligently organized.',
    permissions: ['tabs'],
    host_permissions: ['http://127.0.0.1/*'],
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