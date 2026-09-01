import {
  HttpRpcSource,
  ProtocolConstantsProvider,
  TzKTHeadSource,
  TzKTHttp,
} from '@tezos-suite/chain';
import type { TezzetNetwork } from '../config/networks';
import { boundFetch } from '../lib/http';
import { BeaconWalletPort, type WalletPort } from '../wallet/beacon';

/**
 * Quantos blocos de atraso do indexador ainda são aceitáveis.
 *
 * Não é constante de protocolo — é política de produto: a TzKT responde 200
 * com dado velho quando está atrás do nó, e um saldo de dez minutos atrás
 * parece um saldo de agora. Acima deste atraso o app prefere dizer que não
 * sabe.
 */
export const MAX_INDEXER_LAG_BLOCKS = 60;

export interface ChainSession {
  readonly network: TezzetNetwork;
  readonly http: TzKTHttp;
  readonly head: TzKTHeadSource;
  readonly constants: ProtocolConstantsProvider;
  readonly wallet: WalletPort;
}

export function createChainSession(
  network: TezzetNetwork,
  walletFactory: (network: TezzetNetwork) => WalletPort = (n) => new BeaconWalletPort(n),
): ChainSession {
  // `boundFetch` em toda construção: a camada de cadeia chama o `fetch` como
  // método de si mesma, e o navegador recusa isso. Ver `lib/http.ts`.
  const http = new TzKTHttp(network.endpoints, {
    maxLagBlocks: MAX_INDEXER_LAG_BLOCKS,
    concurrency: 2,
    fetchImpl: boundFetch,
  });
  return {
    network,
    http,
    head: new TzKTHeadSource(http),
    constants: new ProtocolConstantsProvider(
      new HttpRpcSource(network.endpoints, { fetchImpl: boundFetch }),
    ),
    wallet: walletFactory(network),
  };
}
