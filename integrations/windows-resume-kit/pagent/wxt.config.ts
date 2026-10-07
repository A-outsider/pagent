import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';
import { resolve } from 'node:path';

export default defineConfig({
  srcDir: 'src',
  outDir: 'dist',
  outDirTemplate: '.',
  modules: ['@wxt-dev/module-react'],
  alias: {
    '@': resolve('src'),
  },
  vite: () => ({
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@': resolve('src'),
        'node:fs': resolve('src/shims/node-fs.ts'),
        'node:path': resolve('src/shims/node-path.ts'),
      },
    },
  }),
  manifest: {
    name: 'Pagent',
    description: '页面内浏览器 Agent，可观测并操作当前网页',
    minimum_chrome_version: '125',
    permissions: ['storage', 'unlimitedStorage', 'scripting', 'activeTab', 'debugger'] as unknown as (
      | 'storage'
      | 'unlimitedStorage'
      | 'scripting'
      | 'activeTab'
    )[],
    optional_permissions: ['tabs', 'downloads', 'tabGroups'],
    optional_host_permissions: [
      'https://api.openai.com/*',
      'https://api.anthropic.com/*',
      'https://generativelanguage.googleapis.com/*',
      'https://api.deepseek.com/*',
      'https://api.moonshot.cn/*',
      'https://open.bigmodel.cn/*',
      'https://dashscope.aliyuncs.com/*',
      'https://ark.cn-beijing.volces.com/*',
      'https://api.x.ai/*',
      'https://api.siliconflow.cn/*',
      'http://localhost:11434/*',
      'http://127.0.0.1:11434/*',
    ],
    // captureVisibleTab only accepts the literal <all_urls> host permission
    // when the call is initiated from the in-page UI (which does not grant activeTab).
    host_permissions: ['<all_urls>'],
    icons: {
      16: 'icon-16.png',
      32: 'icon-32.png',
      48: 'icon-48.png',
      96: 'icon-96.png',
      128: 'icon-128.png',
    },
    action: {
      default_title: 'Pagent',
      default_icon: {
        16: 'icon-16.png',
        32: 'icon-32.png',
        48: 'icon-48.png',
        96: 'icon-96.png',
        128: 'icon-128.png',
      },
    },
    options_ui: {
      open_in_tab: true,
    },
    commands: {
      'toggle-pagent': {
        suggested_key: {
          default: 'Alt+P',
          mac: 'Alt+P',
        },
        description: '显示或隐藏 Pagent',
      },
    },
  },
});
