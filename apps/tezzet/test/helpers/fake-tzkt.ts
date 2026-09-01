import { defineNetwork, TzKTHttp } from '@tezos-suite/chain';
import { MAX_INDEXER_LAG_BLOCKS } from '../../src/state/session';

export const TEST_NETWORK = defineNetwork({
  name: 'rede-de-teste',
  rpcUrl: 'https://rpc.exemplo.invalid',
  tzktApiUrl: 'https://api.exemplo.invalid',
});

export interface FakeResponse {
  readonly status?: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

/**
 * TzKT falso. Devolve as respostas na ordem e registra as URLs pedidas — é
 * como um teste de paginação prova que o cursor foi mesmo usado.
 */
export function fakeTzKT(responses: readonly FakeResponse[], maxLagBlocks = MAX_INDEXER_LAG_BLOCKS) {
  const calls: string[] = [];
  let index = 0;
  const fetchImpl: typeof fetch = async (input) => {
    calls.push(String(input));
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (!response) throw new Error('fakeTzKT: sem resposta configurada');
    const status = response.status ?? 200;
    const headers = new Headers({
      'tzkt-level': '100',
      'tzkt-known-level': '100',
      ...(response.headers ?? {}),
    });
    const body = response.body === undefined ? '' : JSON.stringify(response.body);
    return new Response(status === 204 ? null : body, { status, headers });
  };
  return { calls, http: new TzKTHttp(TEST_NETWORK, { fetchImpl, maxRetries: 0, maxLagBlocks }) };
}
