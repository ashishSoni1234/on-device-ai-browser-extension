import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    rollupOptions: {
      output: {
        // Give content script a clean filename without the .ts extension in the name
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'content.ts') return 'assets/content.js';
          if (chunkInfo.name === 'background.ts') return 'assets/background.js';
          return 'assets/[name]-[hash].js';
        },
      },
    },
  },
});
