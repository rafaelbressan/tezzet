import { readFileSync } from 'node:fs';
import {
  ProtocolConstantsProvider,
  TzKTHeadSource,
  type RpcSource,
  type TzKTHttp,
} from '@tezos-suite/chain';
import { readStakingConstants, type StakingConstants } from '../../src/chain/protocol';
import type { TezzetNetwork } from '../../src/config/networks';
import type { ChainSession } from '../../src/state/session';
import type { WalletPort } from '../../src/wallet/beacon';
import type { TransferEstimate } from '../../src/wallet/transfer';
import { TEST_NETWORK } from './fake-tzkt';

/**
 * Constantes de protocolo **reais**, lidas da mainnet em 2026-09-05
 * (`PsUshuai…`), aparadas para os campos que a suíte usa. Números inventados
 * aqui não provariam nada: a conta da espera do unstake só é verificável
 * contra a constante que a cadeia realmente publica.
 *
 * O que garante que este arquivo não envelhece calado é o teste de contrato,
 * que relê as mesmas constantes do nó de verdade.
 */
export const RAW_CONSTANTS = JSON.parse(
  readFileSync('test/fixtures/constants-mainnet.json', 'utf8'),
) as Record<string, unknown>;

export const PROTOCOL_HASH = 'PsUshuai9QapM5TGj1JpuVGkdxz5GykdnEvS6Rh8SUVrARvZLCY';

export function fakeRpc(raw: Record<string, unknown> = RAW_CONSTANTS): RpcSource {
  return {
    getChainId: async () => 'NetXdQprcVkpaWU',
    getProtocolHash: async () => PROTOCOL_HASH,
    getRawConstants: async () => raw,
    getHeadLevel: async () => 14_818_898,
  };
}

export async function fakeStakingConstants(
  raw: Record<string, unknown> = RAW_CONSTANTS,
): Promise<StakingConstants> {
  return readStakingConstants(await new ProtocolConstantsProvider(fakeRpc(raw)).get());
}

export const NO_COST: TransferEstimate = {
  feeMutez: 0n,
  burnMutez: 0n,
  gasLimit: 0,
  storageLimit: 0,
};

export interface FakeWallet extends WalletPort {
  /** O que a tela pediu para a carteira assinar, na ordem. */
  readonly signed: string[];
  /**
   * O que a tela mandou estimar, na ordem. Estimar é uma ida ao nó, e há
   * recusas que o app conhece antes dela (BRES-116) — uma lista vazia aqui é
   * a prova de que a conferência aconteceu antes da rede.
   */
  readonly estimated: string[];
}

/**
 * Carteira falsa. Ela não assina nada e não guarda chave — só registra o que
 * foi pedido, que é o que um teste desta onda pode afirmar.
 */
export function fakeWallet(estimate: TransferEstimate = NO_COST): FakeWallet {
  const signed: string[] = [];
  const estimated: string[] = [];
  return {
    signed,
    estimated,
    connect: async () => 'tz1TfBtHD87eRJnSn4vvnsE1JGzKvpoKLJMj',
    disconnect: async () => undefined,
    activeAddress: async () => 'tz1TfBtHD87eRJnSn4vvnsE1JGzKvpoKLJMj',
    estimateTransfer: async (destination) => {
      estimated.push(`transfer:${destination}`);
      return estimate;
    },
    sendTransfer: async (destination, _amountMutez, estimate) => {
      signed.push(`transfer:${destination}:${estimate.feeMutez}:${estimate.gasLimit}:${estimate.storageLimit}`);
      return 'ooTransfer';
    },
    estimateSetDelegate: async (baker) => {
      estimated.push(`setDelegate:${baker ?? 'none'}`);
      return estimate;
    },
    sendSetDelegate: async (baker) => {
      signed.push(`setDelegate:${baker ?? 'none'}`);
      return 'ooDelegate';
    },
    estimateStake: async (amountMutez) => {
      estimated.push(`stake:${amountMutez}`);
      return estimate;
    },
    sendStake: async (amountMutez) => {
      signed.push(`stake:${amountMutez}`);
      return 'ooStake';
    },
    estimateUnstake: async (amountMutez) => {
      estimated.push(`unstake:${amountMutez}`);
      return estimate;
    },
    sendUnstake: async (amountMutez) => {
      signed.push(`unstake:${amountMutez}`);
      return 'ooUnstake';
    },
    estimateFinalizeUnstake: async () => {
      estimated.push('finalizeUnstake');
      return estimate;
    },
    sendFinalizeUnstake: async () => {
      signed.push('finalizeUnstake');
      return 'ooFinalize';
    },
  };
}

export const FAKE_TEZZET_NETWORK: TezzetNetwork = {
  id: 'rede-de-teste',
  label: 'Rede de teste',
  kind: 'test',
  beaconNetworkType: 'custom',
  endpoints: TEST_NETWORK,
  explorerUrl: 'https://explorador.exemplo.invalid',
};

/**
 * O nó, falso, para uma tela.
 *
 * `fetchBaker` fala com o RPC pelo `fetch` global — é a fronteira certa em
 * produção, e num teste de tela precisa de um substituto. Este só responde
 * `/context/delegates/…` e levanta em qualquer outra URL, para que uma
 * chamada de rede não prevista apareça como falha e não como silêncio.
 */
export function stubNodeFetch(delegate: unknown): typeof fetch {
  return async (input) => {
    const url = String(input);
    if (!url.includes('/context/delegates/')) {
      throw new Error(`stubNodeFetch: chamada não prevista para ${url}`);
    }
    return new Response(JSON.stringify(delegate), { status: 200 });
  };
}

export function fakeSession(http: TzKTHttp, wallet: WalletPort = fakeWallet()): ChainSession {
  return {
    network: FAKE_TEZZET_NETWORK,
    http,
    head: new TzKTHeadSource(http),
    constants: new ProtocolConstantsProvider(fakeRpc()),
    wallet,
  };
}
