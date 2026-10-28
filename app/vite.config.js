// The page, built into app/dist; `westmarch build` copies it over the stock page (app.json
// site.pages) and reads its tools for the card from app/dist/agent.js (site.agent).
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// onnxruntime's wasm loads from jsdelivr at runtime (transformers.js's default), but vite also
// emits a 25.6 MiB copy, over the Workers asset limit. Drop it, as westmarch's stock page does.
const noWasm = () => ({ name: 'no-local-ort-wasm', generateBundle(_, bundle) { for (const k of Object.keys(bundle)) if (k.endsWith('.wasm')) delete bundle[k]; } });
const at = (p) => fileURLToPath(new URL(p, import.meta.url));

export default {
  base: './',
  plugins: [react(), noWasm()],
  // transformers.js loads by dynamic import inside the worker; pre-bundling breaks that.
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
  worker: { format: 'es', plugins: () => [noWasm()] },
  build: {
    outDir: 'dist', emptyOutDir: true,
    rollupOptions: {
      input: { index: at('index.html'), agent: at('src/agent.ts') },
      // agent.js is imported by name in Node, so it keeps its exports and its name.
      preserveEntrySignatures: 'exports-only',
      output: { entryFileNames: (c) => (c.name === 'agent' ? 'agent.js' : 'assets/[name]-[hash].js') },
    },
  },
};
