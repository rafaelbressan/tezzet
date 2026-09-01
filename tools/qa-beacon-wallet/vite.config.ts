import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Um teste só, e ele fala com a Shadownet de verdade — com a torneira, com o
 * nó e com a TzKT. Não roda no `npm test` do app: ele depende de serviço
 * externo de pé, e depende de um `dist/` construído.
 *
 * `@tezos-suite/chain` é o mesmo `vendor/` que o app usa. Uma segunda cópia da
 * confirmação Tenderbake aqui deixaria o harness aprovar um critério que o
 * produto não usa.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@tezos-suite/chain': fileURLToPath(
        new URL('../../apps/tezzet/vendor/tezos-chain/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.e2e.test.ts'],
    // A jornada tem prova de trabalho (~20 s), dois blocos de Tenderbake e o
    // atraso do indexador. Um teto curto reprovaria a rede, não o app.
    testTimeout: 900_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
