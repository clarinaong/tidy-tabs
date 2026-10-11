import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifestVersion: 3,
  manifest: {
    name: 'TidyTabs',
    description: 'Your tabs, intelligently organized.',
    permissions: ['tabs'],
    host_permissions: ['http://127.0.0.1/*'],
  },
});

// manifest is Chrome's description of extension
// tabs permission lets extension read tab titles and urls