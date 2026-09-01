import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Testes que falam com a rede. Ficam fora do `npm test` de propósito: eles
 * dependem de um serviço externo estar de pé, e um teste que reprova por
 * causa da rede alheia deixa de ser sinal.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@tezos-suite/chain': fileURLToPath(new URL('./vendor/tezos-chain/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['test/contract/**/*.contract.test.ts'],
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
