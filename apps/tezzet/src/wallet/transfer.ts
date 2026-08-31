import { assertPayableAddress, type AddressKind } from '@tezos-suite/chain';
import { formatXtz } from '../lib/format';

/**
 * O que a rede cobra para mover este valor. Todos os campos vêm de uma
 * `estimate` de verdade — `storageLimit` nunca é fixo em 0, e `burnMutez` é
 * o custo de alocar um destino que ainda não existe na cadeia.
 */
export interface TransferEstimate {
  readonly feeMutez: bigint;
  readonly burnMutez: bigint;
  readonly gasLimit: number;
  readonly storageLimit: number;
}

export interface TransferRequest {
  readonly destination: string;
  readonly amountMutez: bigint;
  /** Parte líquida do saldo. O que está em stake não paga transferência. */
  readonly spendableMutez: bigint;
  readonly estimate: TransferEstimate;
}

export interface TransferPlan {
  readonly destination: string;
  readonly destinationKind: AddressKind;
  readonly amountMutez: bigint;
  readonly feeMutez: bigint;
  readonly burnMutez: bigint;
  readonly totalMutez: bigint;
  readonly remainingMutez: bigint;
  readonly gasLimit: number;
  readonly storageLimit: number;
}

/**
 * Erro de envio com os números dentro. "Algo deu errado" não diz à pessoa se
 * ela precisa mandar menos, esperar, ou corrigir o endereço.
 */
export class TransferValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransferValidationError';
  }
}

export function planTransfer(request: TransferRequest): TransferPlan {
  const kind = assertPayableAddress(request.destination);

  if (request.amountMutez <= 0n) {
    throw new TransferValidationError(
      `o valor precisa ser maior que zero (veio ${request.amountMutez} mutez)`,
    );
  }

  const { feeMutez, burnMutez } = request.estimate;
  if (feeMutez < 0n || burnMutez < 0n) {
    throw new TransferValidationError(
      `a estimativa voltou negativa: taxa ${feeMutez} mutez, alocação ${burnMutez} mutez`,
    );
  }

  const totalMutez = request.amountMutez + feeMutez + burnMutez;
  if (totalMutez > request.spendableMutez) {
    const missing = totalMutez - request.spendableMutez;
    throw new TransferValidationError(
      `faltam ${formatXtz(missing)} XTZ: enviar ${formatXtz(request.amountMutez)} custa ` +
        `${formatXtz(totalMutez)} XTZ com taxa de ${formatXtz(feeMutez)} e alocação de ` +
        `${formatXtz(burnMutez)}, e o saldo disponível é ${formatXtz(request.spendableMutez)} XTZ ` +
        '(o que está em stake não entra)',
    );
  }

  return {
    destination: request.destination,
    destinationKind: kind,
    amountMutez: request.amountMutez,
    feeMutez,
    burnMutez,
    totalMutez,
    remainingMutez: request.spendableMutez - totalMutez,
    gasLimit: request.estimate.gasLimit,
    storageLimit: request.estimate.storageLimit,
  };
}
