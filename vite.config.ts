import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  plugins: [tailwindcss()],
  build: {
    target: 'chrome140',
    rolldownOptions: {
      input: { panel: 'index.html', background: 'src/background.ts' },
      output: { entryFileNames: '[name].js' },
    },
  },
  test: {
    include: ['src/**/__tests__/*.spec.ts'],
    exclude: ['src/**/__tests__/*.e2e.spec.ts'],
  },
});
