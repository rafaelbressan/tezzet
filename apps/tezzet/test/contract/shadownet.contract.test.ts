import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { TzKTHttp } from '@tezos-suite/chain';
import { fetchAccount } from '../../src/chain/account';
import { fetchHistoryPage } from '../../src/chain/history';
import { parseNetworkCatalog, selectNetwork } from '../../src/config/networks';
import { MAX_INDEXER_LAG_BLOCKS } from '../../src/state/session';

/**
 * Teste de contrato: fala com a TzKT de verdade.
 *
 * Não roda no `npm test` — roda em `npm run test:contract`, antes de release e
 * na rotina diária. É o único teste capaz de reprovar quando a API remove um
 * campo: contra fixture, oito campos removidos continuaram sendo somados como
 * zero durante meses, e nada acusou.
 */
const catalog = parseNetworkCatalog(JSON.parse(readFileSync('public/networks.json', 'utf8')));
const shadownet = selectNetwork(catalog, 'shadownet');
const http = new TzKTHttp(shadownet.endpoints, { maxLagBlocks: MAX_INDEXER_LAG_BLOCKS });

const CONTA_ATIVA = 'tz1TfBtHD87eRJnSn4vvnsE1JGzKvpoKLJMj';

describe('Shadownet, de verdade', () => {
  it('lê o saldo com a divisão entre stake e delegação', async () => {
    const account = await fetchAccount(http, CONTA_ATIVA);

    expect(account.seenOnChain).toBe(true);
    expect(typeof account.total).toBe('bigint');
    expect(account.total).toBe(account.staked + account.delegated);
  }, 30_000);

  it('lê o histórico e pagina com cursor', async () => {
    const primeira = await fetchHistoryPage(http, CONTA_ATIVA, { limit: 5 });

    expect(primeira.entries.length).toBeGreaterThan(0);
    expect(primeira.indexerLevel).toBeGreaterThan(0);

    if (primeira.nextCursor !== null) {
      const segunda = await fetchHistoryPage(http, CONTA_ATIVA, {
        limit: 5,
        cursor: primeira.nextCursor,
      });
      const idsDaPrimeira = new Set(primeira.entries.map((entry) => entry.id));
      // Nenhuma linha se repete entre páginas: é o que `offset` não garante.
      for (const entry of segunda.entries) expect(idsDaPrimeira.has(entry.id)).toBe(false);
    }
  }, 30_000);

  it('conta que nunca existiu volta como ausência, não como saldo zero', async () => {
    const nunca = 'tz1Z6UdtPeERnMGj9tRZymjg2HH1voeuBUDg';
    const account = await fetchAccount(http, nunca);

    expect(account.seenOnChain).toBe(false);
  }, 30_000);
});
