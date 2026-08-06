import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { minify } from 'terser';
import { defineConfig, type Plugin } from 'vite';
import dts from 'vite-plugin-dts';

/**
 * Minifies the emitted chunks with Terser.
 *
 * Vite's own `build.minify` does not fully minify library builds — its esbuild
 * pass mangles identifiers but leaves the whitespace in, and setting
 * `minify: 'terser'` silently produces unminified output here. Running Terser
 * from `renderChunk` makes it explicit and verifiable.
 */
function minifyChunks(): Plugin {
  return {
    name: 'rsu:minify',
    enforce: 'post',
    apply: 'build',
    async renderChunk(code, _chunk, options) {
      const isEsm = options.format === 'es';

      const result = await minify(code, {
        // Top-level mangling is only safe once the module system is known;
        // Terser preserves the export bindings themselves either way.
        module: isEsm,
        toplevel: isEsm,
        compress: { passes: 2 },
        mangle: true,
        format: { comments: false },
        sourceMap: true,
      });

      if (!result.code) return null;
      return { code: result.code, map: (result.map as never) ?? null };
    },
  };
}

export default defineConfig(({ mode }) => {
  const isDemo = mode === 'demo';

  if (isDemo) {
    return {
      root: resolve(__dirname, 'demo'),
      plugins: [react()],
      build: { outDir: resolve(__dirname, 'demo-dist'), emptyOutDir: true },
    };
  }

  return {
    plugins: [
      react(),
      dts({
        include: ['src'],
        exclude: ['src/**/__tests__/**', 'src/**/*.test.ts', 'src/**/*.test.tsx'],
        rollupTypes: false,
      }),
      minifyChunks(),
    ],
    build: {
      lib: {
        entry: resolve(__dirname, 'src/index.ts'),
        name: 'ReactSheetUploader',
        formats: ['es', 'cjs'],
        fileName: (format) => (format === 'es' ? 'index.js' : 'index.cjs'),
        // Must match the `./styles.css` subpath in package.json exports.
        cssFileName: 'style',
      },
      rollupOptions: {
        external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'],
        output: {
          globals: { react: 'React', 'react-dom': 'ReactDOM' },
          // The default export exists for drop-in Dromo compatibility; `named`
          // keeps the named exports first-class in CommonJS.
          exports: 'named',
        },
      },
      // Handled by `minifyChunks` above; source maps ship alongside so consumers
      // can still step through readable code in devtools.
      minify: false,
      cssMinify: true,
      sourcemap: true,
      target: 'es2020',
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./vitest.setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
    },
  };
});
