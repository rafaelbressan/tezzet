import { defineNetwork, type NetworkConfig } from '@tezos-suite/chain';

/**
 * Rede é configuração, nunca código.
 *
 * O app não tem lista embutida: ele lê `networks.json` em execução e **recusa
 * subir** se o arquivo faltar, estiver malformado ou trouxer uma rede
 * incompleta. Foi assim que a Ghostnet sobreviveu por meses em código de
 * carteira depois de desligada — uma lista escrita na fonte não tem como
 * saber que uma rede morreu.
 *
 * Nenhuma constante de protocolo mora aqui. `blocks_per_cycle` é 14400 em
 * mainnet e Shadownet e 3600 em Bakingnet: um número ao lado da URL erra por
 * 4× e erra calado.
 */

/** `main` = move dinheiro de verdade. `test` = não move. A interface grita a diferença. */
export type NetworkKind = 'main' | 'test';

export interface TezzetNetwork {
  readonly id: string;
  /** Nome que aparece na tela. Vem da configuração, nunca de uma constante. */
  readonly label: string;
  readonly kind: NetworkKind;
  /** Valor de `NetworkType` do Beacon. Conferido contra o SDK em `beacon.ts`. */
  readonly beaconNetworkType: string;
  /** RPC + TzKT, no formato que a camada de cadeia da suíte consome. */
  readonly endpoints: NetworkConfig;
  /** Base do explorador. Todo hash de operação vira link com esta base. */
  readonly explorerUrl: string;
}

export interface NetworkCatalog {
  readonly networks: readonly TezzetNetwork[];
  readonly defaultNetworkId: string;
}

export class NetworkConfigError extends Error {
  constructor(message: string) {
    super(`networks.json: ${message}`);
    this.name = 'NetworkConfigError';
  }
}

function requireString(source: Record<string, unknown>, field: string, where: string): string {
  const value = source[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new NetworkConfigError(`${where}.${field} precisa ser texto não vazio, veio ${JSON.stringify(value)}`);
  }
  return value.trim();
}

function requireUrl(source: Record<string, unknown>, field: string, where: string): string {
  const value = requireString(source, field, where);
  try {
    new URL(value);
  } catch {
    throw new NetworkConfigError(`${where}.${field} não é uma URL: ${JSON.stringify(value)}`);
  }
  return value.replace(/\/+$/, '');
}

function requireKind(source: Record<string, unknown>, where: string): NetworkKind {
  const value = requireString(source, 'kind', where);
  if (value !== 'main' && value !== 'test') {
    throw new NetworkConfigError(
      `${where}.kind precisa ser "main" ou "test", veio ${JSON.stringify(value)} — ` +
        'é o que decide se a tela grita ou fica quieta',
    );
  }
  return value;
}

function parseNetwork(raw: unknown, index: number): TezzetNetwork {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new NetworkConfigError(`networks[${index}] precisa ser um objeto, veio ${JSON.stringify(raw)}`);
  }
  const source = raw as Record<string, unknown>;
  const where = `networks[${index}]`;
  return {
    id: requireString(source, 'id', where),
    label: requireString(source, 'label', where),
    kind: requireKind(source, where),
    beaconNetworkType: requireString(source, 'beaconNetworkType', where),
    endpoints: defineNetwork({
      name: requireString(source, 'id', where),
      rpcUrl: requireUrl(source, 'rpcUrl', where),
      tzktApiUrl: requireUrl(source, 'tzktApiUrl', where),
    }),
    explorerUrl: requireUrl(source, 'explorerUrl', where),
  };
}

export function parseNetworkCatalog(raw: unknown): NetworkCatalog {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new NetworkConfigError(`a raiz precisa ser um objeto, veio ${JSON.stringify(raw)}`);
  }
  const source = raw as Record<string, unknown>;
  const list = source['networks'];
  if (!Array.isArray(list) || list.length === 0) {
    throw new NetworkConfigError('"networks" precisa ser uma lista com pelo menos uma rede');
  }
  const networks = list.map(parseNetwork);

  const seen = new Set<string>();
  for (const network of networks) {
    if (seen.has(network.id)) {
      throw new NetworkConfigError(`o id "${network.id}" aparece duas vezes`);
    }
    seen.add(network.id);
  }

  const defaultNetworkId = requireString(source, 'defaultNetworkId', 'raiz');
  if (!seen.has(defaultNetworkId)) {
    throw new NetworkConfigError(
      `defaultNetworkId "${defaultNetworkId}" não está entre as ${networks.length} redes configuradas ` +
        `(${networks.map((n) => n.id).join(', ')})`,
    );
  }

  return { networks, defaultNetworkId };
}

/**
 * Carrega o catálogo de `networks.json`. Sem catálogo válido o app não abre —
 * uma carteira que não sabe em que rede está é pior do que uma que não abre.
 */
export async function loadNetworkCatalog(
  fetchImpl: typeof fetch = fetch,
  url = 'networks.json',
): Promise<NetworkCatalog> {
  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch (cause) {
    throw new NetworkConfigError(`não foi possível ler ${url}: ${String(cause)}`);
  }
  if (!response.ok) {
    throw new NetworkConfigError(`${url} respondeu HTTP ${response.status}`);
  }
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new NetworkConfigError(`${url} não é JSON válido: ${String(cause)}`);
  }
  return parseNetworkCatalog(parsed);
}

/**
 * Trocar para uma rede que move dinheiro de verdade é decisão, e ela é pedida
 * toda vez — nunca presumida por lembrar da última escolha.
 */
export function movesRealMoney(network: TezzetNetwork): boolean {
  return network.kind === 'main';
}

export function selectNetwork(catalog: NetworkCatalog, id: string): TezzetNetwork {
  const found = catalog.networks.find((network) => network.id === id);
  if (!found) {
    throw new NetworkConfigError(
      `rede "${id}" não está configurada (${catalog.networks.map((n) => n.id).join(', ')})`,
    );
  }
  return found;
}
