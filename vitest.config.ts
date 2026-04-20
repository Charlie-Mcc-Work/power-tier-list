import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Load fake-indexeddb so Dexie-backed code paths can be exercised in Node.
    setupFiles: ['fake-indexeddb/auto'],
  },
});
