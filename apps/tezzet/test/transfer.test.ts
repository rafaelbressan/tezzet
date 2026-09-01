import { describe, expect, it } from 'vitest';
import { AddressError } from '@tezos-suite/chain';
import { planTransfer, TransferValidationError } from '../src/wallet/transfer';

const DESTINO = 'tz1aRoaRhSpRYvFdyvgWLL6TGyRoGF51wDjM';
const ESTIMATIVA = { feeMutez: 500n, burnMutez: 0n, gasLimit: 1000, storageLimit: 0 };

describe('planTransfer', () => {
  it('soma valor, taxa e alocação e diz o que sobra', () => {
    const plan = planTransfer({
      destination: DESTINO,
      amountMutez: 1_000_000n,
      spendableMutez: 2_000_000n,
      estimate: { ...ESTIMATIVA, burnMutez: 64_250n },
    });

    expect(plan.totalMutez).toBe(1_064_750n);
    expect(plan.remainingMutez).toBe(935_250n);
    expect(plan.destinationKind).toBe('tz1');
  });

  it('recusa quando o saldo não cobre valor + taxa, e diz de quanto é a falta', () => {
    expect(() =>
      planTransfer({
        destination: DESTINO,
        amountMutez: 1_000_000n,
        spendableMutez: 1_000_000n,
        estimate: ESTIMATIVA,
      }),
    ).toThrow(/faltam 0\.000500 XTZ/);
  });

  it('recusa endereço com um dígito trocado — checksum, não regex', () => {
    const trocado = `${DESTINO.slice(0, -1)}${DESTINO.endsWith('M') ? 'N' : 'M'}`;

    expect(() => planTransfer({ destination: trocado, amountMutez: 1n, spendableMutez: 10n, estimate: ESTIMATIVA })).toThrow(
      AddressError,
    );
  });

  it('diz que tz5 ainda não é suportado, em vez de dizer que é inválido', () => {
    expect(() =>
      planTransfer({ destination: 'tz5abc', amountMutez: 1n, spendableMutez: 10n, estimate: ESTIMATIVA }),
    ).toThrow(/não suportad|not supported/i);
  });

  it('recusa valor zero ou negativo', () => {
    expect(() =>
      planTransfer({ destination: DESTINO, amountMutez: 0n, spendableMutez: 10n, estimate: ESTIMATIVA }),
    ).toThrow(TransferValidationError);
  });

  it('o teto é o gastável: stake, saindo de stake e bond não pagam transferência', () => {
    // Conta com 10 XTZ cheios, 9 congelados: só 1 XTZ é gastável.
    expect(() =>
      planTransfer({
        destination: DESTINO,
        amountMutez: 2_000_000n,
        spendableMutez: 1_000_000n,
        estimate: ESTIMATIVA,
      }),
    ).toThrow(/não entra/);
  });
});
