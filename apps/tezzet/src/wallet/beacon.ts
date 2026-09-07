// Antes de qualquer import do Beacon: o SDK toca `Buffer` no carregamento.
import '../polyfills';
import { NetworkType } from '@ecadlabs/beacon-dapp';
import { BeaconWallet } from '@taquito/beacon-wallet';
import { TezosToolkit, type Estimate } from '@taquito/taquito';
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

  /** `baker === null` é parar de delegar: a operação sem destinatário. */
  estimateSetDelegate(baker: string | null, source: string): Promise<TransferEstimate>;
  sendSetDelegate(baker: string | null): Promise<string>;

  estimateStake(amountMutez: bigint, source: string): Promise<TransferEstimate>;
  sendStake(amountMutez: bigint): Promise<string>;

  estimateUnstake(amountMutez: bigint, source: string): Promise<TransferEstimate>;
  sendUnstake(amountMutez: bigint): Promise<string>;

  estimateFinalizeUnstake(source: string): Promise<TransferEstimate>;
  sendFinalizeUnstake(): Promise<string>;
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
    return toTransferEstimate(
      await this.tezos.estimate.transfer({
        to: destination,
        amount: mutezToTaquitoAmount(amountMutez),
        mutez: true,
        source,
      }),
    );
  }

  /** Devolve o hash da operação. Quem assinou foi a carteira, não o Tezzet. */
  async sendTransfer(destination: string, amountMutez: bigint): Promise<string> {
    const operation = await this.tezos.wallet
      .transfer({ to: destination, amount: mutezToTaquitoAmount(amountMutez), mutez: true })
      .send();
    return operation.opHash;
  }

  /**
   * Delegar, stakear, sair do stake e finalizar são quatro operações da
   * cadeia, e as quatro passam pelo mesmo caminho das transferências: o
   * Tezzet monta e estima, a carteira do usuário assina, o Tezzet injeta.
   *
   * A estimativa não é enfeite de tela. É ela que descobre, **antes** da
   * assinatura, que o baker não aceita mais stake, que a conta não delega
   * para ninguém, ou que não há gastável para a taxa — a cadeia simula a
   * operação e recusa com o próprio motivo dela.
   */
  async estimateSetDelegate(baker: string | null, source: string): Promise<TransferEstimate> {
    return toTransferEstimate(
      await this.tezos.estimate.setDelegate(
        baker === null ? { source } : { source, delegate: baker },
      ),
    );
  }

  async sendSetDelegate(baker: string | null): Promise<string> {
    const operation = await this.tezos.wallet
      .setDelegate(baker === null ? {} : { delegate: baker })
      .send();
    return operation.opHash;
  }

  async estimateStake(amountMutez: bigint, source: string): Promise<TransferEstimate> {
    return toTransferEstimate(
      await this.tezos.estimate.stake({
        source,
        amount: mutezToTaquitoAmount(amountMutez),
        mutez: true,
      }),
    );
  }

  async sendStake(amountMutez: bigint): Promise<string> {
    const operation = await this.tezos.wallet
      .stake({ amount: mutezToTaquitoAmount(amountMutez), mutez: true })
      .send();
    return operation.opHash;
  }

  async estimateUnstake(amountMutez: bigint, source: string): Promise<TransferEstimate> {
    return toTransferEstimate(
      await this.tezos.estimate.unstake({
        source,
        amount: mutezToTaquitoAmount(amountMutez),
        mutez: true,
      }),
    );
  }

  async sendUnstake(amountMutez: bigint): Promise<string> {
    const operation = await this.tezos.wallet
      .unstake({ amount: mutezToTaquitoAmount(amountMutez), mutez: true })
      .send();
    return operation.opHash;
  }

  /**
   * `finalize_unstake` não leva valor: o protocolo recusa com
   * `operations.invalid_nonzero_transaction_amount` se levar. Quanto volta é
   * decidido pela cadeia, não por quem pede.
   */
  async estimateFinalizeUnstake(source: string): Promise<TransferEstimate> {
    return toTransferEstimate(await this.tezos.estimate.finalizeUnstake({ source }));
  }

  async sendFinalizeUnstake(): Promise<string> {
    const operation = await this.tezos.wallet.finalizeUnstake({}).send();
    return operation.opHash;
  }
}

/**
 * Uma estimativa do Taquito vira os quatro números que a tela mostra. Nenhum
 * deles é fixado: `storageLimit` fixo em 0 é o que faz uma operação falhar
 * por `storage_exhausted` depois de a pessoa já ter assinado.
 */
function toTransferEstimate(estimate: Estimate): TransferEstimate {
  return {
    feeMutez: BigInt(estimate.suggestedFeeMutez),
    burnMutez: BigInt(estimate.burnFeeMutez),
    gasLimit: estimate.gasLimit,
    storageLimit: estimate.storageLimit,
  };
}
