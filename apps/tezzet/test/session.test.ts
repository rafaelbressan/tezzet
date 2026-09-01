import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseNetworkCatalog, selectNetwork } from '../src/config/networks';
import { createChainSession } from '../src/state/session';
import type { WalletPort } from '../src/wallet/beacon';

/**
 * O navegador recusa `fetch` chamado como método de outro objeto. A camada de
 * cadeia faz exatamente isso — `this.fetchImpl(url, init)` — e o app quebrava
 * em **toda** leitura, do saldo ao envio, com "A rede não respondeu".
 *
 * Nada acusava: o `fetch` do undici (Node e jsdom) não confere o receptor, e
 * os testes passavam verdes com o app incapaz de ler a cadeia num navegador.
 * Este teste põe a regra do navegador no lugar do `fetch` global.
 */
const catalogo = parseNetworkCatalog({
  defaultNetworkId: 'shadownet',
  networks: [
    {
      id: 'shadownet',
      label: 'Shadownet',
      kind: 'test',
      beaconNetworkType: 'shadownet',
      rpcUrl: 'https://rpc.exemplo',
      tzktApiUrl: 'https://api.exemplo',
      explorerUrl: 'https://explorer.exemplo',
    },
  ],
});

/**
 * O recorte de `/context/constants` que a camada de cadeia exige. Ela recusa
 * substituir campo ausente por padrão, então o teste manda todos — os valores
 * são os da Shadownet.
 */
const CONSTANTES_DA_SHADOWNET = {
  blocks_per_cycle: 14400,
  minimal_block_delay: '6',
  delay_increment_per_round: '2',
  consensus_rights_delay: 2,
  blocks_preservation_cycles: 1,
  consensus_committee_size: 7000,
  consensus_threshold_size: 4667,
  hard_gas_limit_per_operation: '1040000',
  hard_gas_limit_per_block: '1386666',
  hard_storage_limit_per_operation: '60000',
  max_operation_data_length: 32768,
  max_operations_time_to_live: 600,
  cost_per_byte: '250',
  origination_size: 257,
  edge_of_staking_over_delegation: 2,
  minimal_stake: '6000000000',
  denunciation_period: 1,
  slashing_delay: 1,
};

const carteiraQueNaoFazNada = (): WalletPort => ({
  connect: async () => 'tz1',
  disconnect: async () => undefined,
  activeAddress: async () => null,
  estimateTransfer: async () => {
    throw new Error('não usado');
  },
  sendTransfer: async () => {
    throw new Error('não usado');
  },
});

/** Como o Chromium: `fetch` só aceita ser chamado solto ou como `window.fetch`. */
function fetchComRegraDeNavegador(rotas: Record<string, { corpo: unknown; headers?: Record<string, string> }>) {
  return function (this: unknown, input: RequestInfo | URL): Promise<Response> {
    if (this !== undefined && this !== globalThis) {
      throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    }
    const url = String(input);
    const rota = Object.entries(rotas).find(([sufixo]) => url.endsWith(sufixo))?.[1];
    if (!rota) return Promise.resolve(new Response('sem rota', { status: 404 }));
    return Promise.resolve(
      new Response(JSON.stringify(rota.corpo), {
        status: 200,
        headers: { 'content-type': 'application/json', ...rota.headers },
      }),
    );
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a sessão de cadeia num navegador de verdade', () => {
  it('lê a TzKT sem cair em "Illegal invocation"', async () => {
    vi.stubGlobal(
      'fetch',
      fetchComRegraDeNavegador({
        '/v1/head': {
          corpo: { level: 10, knownLevel: 10, cycle: 1, chainId: 'NetX', protocol: 'Ps' },
          headers: { 'tzkt-level': '10', 'tzkt-known-level': '10' },
        },
      }),
    );
    const session = createChainSession(selectNetwork(catalogo, 'shadownet'), carteiraQueNaoFazNada);

    await expect(session.head.getHeadLevel()).resolves.toBe(10);
  });

  it('lê as constantes do nó sem cair em "Illegal invocation"', async () => {
    vi.stubGlobal(
      'fetch',
      fetchComRegraDeNavegador({
        '/chains/main/chain_id': { corpo: 'NetXsqzbfFenSTS' },
        '/blocks/head/protocols': { corpo: { protocol: 'PsUshuai', next_protocol: 'PsUshuai' } },
        '/blocks/head/header': { corpo: { level: 10 } },
        '/context/constants': { corpo: CONSTANTES_DA_SHADOWNET },
      }),
    );
    const session = createChainSession(selectNetwork(catalogo, 'shadownet'), carteiraQueNaoFazNada);

    const constants = await session.constants.get();
    expect(constants.maxOperationsTimeToLive).toBe(600);
  });
});
