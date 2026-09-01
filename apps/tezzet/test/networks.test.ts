import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  NetworkConfigError,
  loadNetworkCatalog,
  movesRealMoney,
  parseNetworkCatalog,
  selectNetwork,
} from '../src/config/networks';

const VALID = {
  configVersion: 1,
  defaultNetworkId: 'shadownet',
  networks: [
    {
      id: 'shadownet',
      label: 'Shadownet',
      kind: 'test',
      beaconNetworkType: 'shadownet',
      rpcUrl: 'https://rpc.shadownet.teztnets.com',
      tzktApiUrl: 'https://api.shadownet.tzkt.io',
      explorerUrl: 'https://shadownet.tzkt.io',
    },
  ],
};

describe('parseNetworkCatalog', () => {
  it('aceita a configuração que o app entrega', () => {
    const shipped = JSON.parse(readFileSync('public/networks.json', 'utf8'));
    const catalog = parseNetworkCatalog(shipped);

    expect(catalog.networks.length).toBeGreaterThan(0);
    // A rede que abre por padrão não move dinheiro de verdade.
    expect(selectNetwork(catalog, catalog.defaultNetworkId).kind).toBe('test');
  });

  it('recusa rede sem endpoint — nada de default silencioso', () => {
    const { rpcUrl, ...semRpc } = VALID.networks[0]!;
    void rpcUrl;

    expect(() => parseNetworkCatalog({ ...VALID, networks: [semRpc] })).toThrow(NetworkConfigError);
    expect(() => parseNetworkCatalog({ ...VALID, networks: [semRpc] })).toThrow(/rpcUrl/);
  });

  it('recusa endpoint que não é URL', () => {
    const quebrada = { ...VALID.networks[0]!, tzktApiUrl: 'api.tzkt.io' };

    expect(() => parseNetworkCatalog({ ...VALID, networks: [quebrada] })).toThrow(/não é uma URL/);
  });

  it('recusa kind fora de main/test — é o que decide se a tela grita', () => {
    const quebrada = { ...VALID.networks[0]!, kind: 'testnet' };

    expect(() => parseNetworkCatalog({ ...VALID, networks: [quebrada] })).toThrow(/kind/);
  });

  it('recusa rede padrão que não está na lista', () => {
    expect(() => parseNetworkCatalog({ ...VALID, defaultNetworkId: 'ghostnet' })).toThrow(/ghostnet/);
  });

  it('recusa id repetido', () => {
    const duas = { ...VALID, networks: [VALID.networks[0], VALID.networks[0]] };

    expect(() => parseNetworkCatalog(duas)).toThrow(/duas vezes/);
  });

  it('recusa lista vazia', () => {
    expect(() => parseNetworkCatalog({ ...VALID, networks: [] })).toThrow(/pelo menos uma rede/);
  });
});

describe('loadNetworkCatalog', () => {
  it('levanta quando o arquivo não existe — o app não abre sem saber a rede', async () => {
    const fetchImpl = (async () => new Response('não encontrado', { status: 404 })) as typeof fetch;

    await expect(loadNetworkCatalog(fetchImpl)).rejects.toThrow(/HTTP 404/);
  });

  it('levanta quando o arquivo não é JSON', async () => {
    const fetchImpl = (async () => new Response('<html>', { status: 200 })) as typeof fetch;

    await expect(loadNetworkCatalog(fetchImpl)).rejects.toThrow(/não é JSON/);
  });
});

describe('movesRealMoney', () => {
  it('só a rede real move dinheiro — e é ela que pede confirmação para entrar', () => {
    const shipped = parseNetworkCatalog(JSON.parse(readFileSync('public/networks.json', 'utf8')));

    expect(movesRealMoney(selectNetwork(shipped, 'mainnet'))).toBe(true);
    expect(movesRealMoney(selectNetwork(shipped, 'shadownet'))).toBe(false);
  });
});

describe('selectNetwork', () => {
  it('levanta com a lista das redes conhecidas', () => {
    const catalog = parseNetworkCatalog(VALID);

    expect(() => selectNetwork(catalog, 'ghostnet')).toThrow(/shadownet/);
  });
});
