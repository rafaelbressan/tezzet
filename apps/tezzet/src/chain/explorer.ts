import type { TezzetNetwork } from '../config/networks';

/**
 * Link para o explorador da rede em que a operação aconteceu.
 *
 * A base vem da configuração da rede escolhida, nunca de uma constante: um
 * hash de Shadownet apontando para tzkt.io leva a uma página vazia, e uma
 * página vazia parece "a operação não existe" quando o que houve foi o link
 * errado.
 */
export function explorerOperationUrl(network: TezzetNetwork, hash: string): string {
  return `${network.explorerUrl}/${encodeURIComponent(hash)}`;
}

export function explorerAccountUrl(network: TezzetNetwork, address: string): string {
  return `${network.explorerUrl}/${encodeURIComponent(address)}`;
}
