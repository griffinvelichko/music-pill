import { defineConfig, type LibraryOptions } from 'vite';

// Two library builds share this file:
//   `vite build`             -> dist/index.js + dist/resolve.js (SSR-safe entries)
//   `vite build --mode auto` -> dist/auto.js, a single self-contained file for
//                               <script type="module"> / CDN use.
export default defineConfig(({ mode }) => {
  const auto = mode === 'auto';
  return {
    build: {
      target: 'es2022',
      outDir: 'dist',
      emptyOutDir: false,
      minify: auto,
      sourcemap: true,
      lib: {
        entry: (auto
          ? { auto: 'src/auto.ts' }
          : { index: 'src/index.ts', resolve: 'src/resolve.ts' }) as Record<string, string>,
        formats: ['es'],
      } satisfies LibraryOptions,
      rollupOptions: {
        output: { entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js' },
      },
    },
  };
});
