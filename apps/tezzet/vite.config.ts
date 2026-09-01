import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * `@tezos-suite/chain` é a camada de cadeia da suíte (SPEC-0002). Ela é
 * buscada por commit fixo em `vendor/` por `scripts/fetch-chain.mjs`, e
 * entra no bundle como fonte TypeScript — não há uma segunda cópia da
 * aritmética de dinheiro dentro deste app.
 */
const chainSource = fileURLToPath(new URL('./vendor/tezos-chain/src/index.ts', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@tezos-suite/chain': chainSource },
  },
  // O Tauri serve o frontend em porta fixa e falha se ela estiver ocupada:
  // um servidor em outra porta seria uma janela apontando para outra coisa.
  server: { port: 1420, strictPort: true },
  build: { target: 'es2022', sourcemap: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    // Os de contrato falam com a TzKT de verdade e rodam em `npm run test:contract`.
    exclude: ['test/contract/**'],
  },
});
