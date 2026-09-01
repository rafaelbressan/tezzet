// Antes de qualquer import do Beacon: o SDK toca `Buffer` no carregamento.
import '../polyfills';
import { NetworkType } from '@ecadlabs/beacon-dapp';
import { BeaconWallet } from '@taquito/beacon-wallet';
import { TezosToolkit } from '@taquito/taquito';
import { mutezToTaquitoAmount } from '@tezos-suite/chain';
import type { TezzetNetwork } from '../config/networks';
import type { TransferEstimate } from './transfer';

/**
 * Conexão com a carteira do usuário via Beacon (TZIP-10).
 *
 * **Nenhuma chave privada, semente ou frase passa por aqui.** O Tezzet monta a
 * operação, a carteira que o usuário já usa assina, e o Tezzet injeta o que
 * voltou assinado. É o critério que define esta onda: se aparecer material de
 * chave neste arquivo, a onda está errada.
 */

export interface WalletPort {
  connect(): Promise<string>;
  disconnect(): Promise<void>;
  activeAddress(): Promise<string | null>;
  estimateTransfer(destination: string, amountMutez: bigint, source: string): Promise<TransferEstimate>;
  sendTransfer(destination: string, amountMutez: bigint): Promise<string>;
}

export class BeaconNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BeaconNetworkError';
  }
}

/**
 * O `beaconNetworkType` vem de `networks.json`. Ele é conferido contra o que o
 * SDK conhece de verdade: um valor inventado faria o Beacon abrir uma sessão
 * numa rede diferente da que a tela está mostrando.
 */
export function resolveBeaconNetworkType(value: string): NetworkType {
  const known = Object.values(NetworkType) as string[];
  if (!known.includes(value)) {
    throw new BeaconNetworkError(
      `beaconNetworkType "${value}" não existe no Beacon SDK — conhecidos: ${known.join(', ')}`,
    );
  }
  return value as NetworkType;
}

export class BeaconWalletPort implements WalletPort {
  private readonly wallet: BeaconWallet;
  private readonly tezos: TezosToolkit;

  constructor(network: TezzetNetwork) {
    const type = resolveBeaconNetworkType(network.beaconNetworkType);
    this.wallet = new BeaconWallet({
      name: 'Tezzet',
      network: { type, rpcUrl: network.endpoints.rpcUrl },
      enableMetrics: false,
    });
    this.tezos = new TezosToolkit(network.endpoints.rpcUrl);
    this.tezos.setWalletProvider(this.wallet);
  }

  async connect(): Promise<string> {
    // A rede vai no construtor do cliente Beacon, e é por isso que trocar de
    // rede cria uma sessão nova em vez de reaproveitar a anterior.
    await this.wallet.requestPermissions();
    return this.wallet.getPKH();
  }

  async disconnect(): Promise<void> {
    await this.wallet.disconnect();
  }

  async activeAddress(): Promise<string | null> {
    const account = await this.wallet.client.getActiveAccount();
    return account?.address ?? null;
  }

  /**
   * Uma chamada de estimativa, e os números dela são os que valem. Fixar
   * `storage_limit: 0` é o que faz uma transferência para um destino novo
   * falhar por `storage_exhausted` depois de a pessoa já ter assinado.
   */
  async estimateTransfer(
    destination: string,
    amountMutez: bigint,
    source: string,
  ): Promise<TransferEstimate> {
    const estimate = await this.tezos.estimate.transfer({
      to: destination,
      amount: mutezToTaquitoAmount(amountMutez),
      mutez: true,
      source,
    });
    return {
      feeMutez: BigInt(estimate.suggestedFeeMutez),
      burnMutez: BigInt(estimate.burnFeeMutez),
      gasLimit: estimate.gasLimit,
      storageLimit: estimate.storageLimit,
    };
  }

  /** Devolve o hash da operação. Quem assinou foi a carteira, não o Tezzet. */
  async sendTransfer(destination: string, amountMutez: bigint): Promise<string> {
    const operation = await this.tezos.wallet
      .transfer({ to: destination, amount: mutezToTaquitoAmount(amountMutez), mutez: true })
      .send();
    return operation.opHash;
  }
}
