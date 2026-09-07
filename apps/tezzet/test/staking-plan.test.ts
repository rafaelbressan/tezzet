import { describe, expect, it } from 'vitest';
import { AddressError } from '@tezos-suite/chain';
import {
  checkDelegation,
  checkStake,
  planDelegation,
  planFinalize,
  planStake,
  planUnstake,
  StakingValidationError,
} from '../src/wallet/staking';
import type { TransferEstimate } from '../src/wallet/transfer';

const BAKER = 'tz1fwnfJNgiDACshK9avfRfFbMaXrs3ghoJa';
const OUTRO_BAKER = 'tz1TfBtHD87eRJnSn4vvnsE1JGzKvpoKLJMj';

/** `limit_of_staking_over_baking_millionth` de um baker que aceita 5× o stake próprio. */
const ACEITA_STAKE = 5_000_000n;

const TAXA: TransferEstimate = {
  feeMutez: 500n,
  burnMutez: 0n,
  gasLimit: 1000,
  storageLimit: 0,
};

describe('planDelegation', () => {
  it('delegar não move valor: o custo é a taxa, e só', () => {
    const plan = planDelegation({
      baker: BAKER,
      currentDelegate: null,
      spendableMutez: 1_000_000n,
      estimate: TAXA,
    });

    expect(plan.kind).toBe('delegate');
    expect(plan.cost.totalMutez).toBe(500n);
    expect(plan.cost.remainingMutez).toBe(999_500n);
  });

  it('trocar de baker registra de quem se deixa de delegar', () => {
    const plan = planDelegation({
      baker: BAKER,
      currentDelegate: OUTRO_BAKER,
      spendableMutez: 1_000_000n,
      estimate: TAXA,
    });

    expect(plan.previousDelegate).toBe(OUTRO_BAKER);
  });

  it('recusa assinar de novo para o mesmo baker — seria taxa por nada', () => {
    expect(() =>
      planDelegation({
        baker: BAKER,
        currentDelegate: BAKER,
        spendableMutez: 1_000_000n,
        estimate: TAXA,
      }),
    ).toThrow(StakingValidationError);
  });

  it('recusa parar de delegar quem já não delega', () => {
    expect(() =>
      planDelegation({
        baker: null,
        currentDelegate: null,
        spendableMutez: 1_000_000n,
        estimate: TAXA,
      }),
    ).toThrow(/já não delega/);
  });

  it('recusa um KT1 com o motivo certo — contrato não é baker', () => {
    expect(() =>
      planDelegation({
        baker: 'KT1TxqZ8QtKvLu3V3JH7Gx58n7Co8pgtpQU5',
        currentDelegate: null,
        spendableMutez: 1_000_000n,
        estimate: TAXA,
      }),
    ).toThrow(/contrato/);
  });

  it('recusa endereço com checksum errado antes de chegar na rede', () => {
    // Um dígito trocado no meio: prefixo e tamanho continuam certos.
    expect(() =>
      planDelegation({
        baker: 'tz1fwnfJNgiDACshK9avfRfFbMaXrs3ghoJb',
        currentDelegate: null,
        spendableMutez: 1_000_000n,
        estimate: TAXA,
      }),
    ).toThrow(AddressError);
  });

  it('recusa quando o gastável não paga nem a taxa', () => {
    expect(() =>
      planDelegation({
        baker: BAKER,
        currentDelegate: null,
        spendableMutez: 499n,
        estimate: TAXA,
      }),
    ).toThrow(/faltam/);
  });
});

describe('planStake', () => {
  it('congela do gastável, e mostra o que sobra depois da taxa', () => {
    const plan = planStake({
      amountMutez: 100_000n,
      spendableMutez: 1_000_000n,
      currentDelegate: BAKER,
        bakerStakingLimitMillionth: ACEITA_STAKE,
      estimate: TAXA,
    });

    expect(plan.baker).toBe(BAKER);
    expect(plan.spendableAfterMutez).toBe(1_000_000n - 100_000n - 500n);
  });

  it('recusa stakear sem delegar — a cadeia não tem para quem mandar', () => {
    expect(() =>
      planStake({
        amountMutez: 100_000n,
        spendableMutez: 1_000_000n,
        currentDelegate: null,
        bakerStakingLimitMillionth: ACEITA_STAKE,
        estimate: TAXA,
      }),
    ).toThrow(/delegue primeiro/);
  });

  it('recusa congelar tudo sem deixar a taxa', () => {
    // O valor cabe no gastável; valor + taxa não. Conferir só o valor deixaria
    // a operação falhar na cadeia depois de assinada.
    expect(() =>
      planStake({
        amountMutez: 1_000_000n,
        spendableMutez: 1_000_000n,
        currentDelegate: BAKER,
        bakerStakingLimitMillionth: ACEITA_STAKE,
        estimate: TAXA,
      }),
    ).toThrow(/faltam/);
  });

  it('recusa valor zero ou negativo', () => {
    for (const amountMutez of [0n, -1n]) {
      expect(() =>
        planStake({
          amountMutez,
          spendableMutez: 1_000_000n,
          currentDelegate: BAKER,
          bakerStakingLimitMillionth: ACEITA_STAKE,
          estimate: TAXA,
        }),
      ).toThrow(StakingValidationError);
    }
  });

  it('recusa stakear com baker que não aceita stake de terceiros', () => {
    // O limite zero é a condição que a cadeia devolve como
    // `staking_to_delegate_that_refuses_external_staking`. Ela é conhecida
    // antes de qualquer chamada de rede.
    expect(() =>
      planStake({
        amountMutez: 100_000n,
        spendableMutez: 1_000_000n,
        currentDelegate: BAKER,
        bakerStakingLimitMillionth: 0n,
        estimate: TAXA,
      }),
    ).toThrow(/não aceita stake de terceiros/);
  });
});

/**
 * As conferências que **não precisam da rede**, separadas do custo.
 *
 * Elas existem em separado por causa de um defeito real (BRES-116): a tela
 * estimava antes de conferir, o nó recusava primeiro, e a pessoa lia
 * `(temporary) proto.025-PsUshuai.delegate.unchanged` no lugar de uma frase
 * que já estava escrita no código.
 */
describe('checkDelegation', () => {
  it('recusa o baker atual sem precisar de estimativa nenhuma', () => {
    expect(() => checkDelegation({ baker: BAKER, currentDelegate: BAKER })).toThrow(
      /já delega para este baker/,
    );
  });

  it('recusa parar de delegar quem não delega', () => {
    expect(() => checkDelegation({ baker: null, currentDelegate: null })).toThrow(/já não delega/);
  });

  it('deixa passar a troca de baker', () => {
    expect(() => checkDelegation({ baker: BAKER, currentDelegate: OUTRO_BAKER })).not.toThrow();
  });
});

describe('checkStake', () => {
  it('recusa baker de limite zero sem precisar de estimativa nenhuma', () => {
    expect(() =>
      checkStake({
        amountMutez: 100_000n,
        currentDelegate: BAKER,
        bakerStakingLimitMillionth: 0n,
      }),
    ).toThrow(StakingValidationError);
  });

  it('a frase diz o que fazer: delegar continua valendo, stakear pede outro baker', () => {
    try {
      checkStake({ amountMutez: 1n, currentDelegate: BAKER, bakerStakingLimitMillionth: 0n });
      expect.unreachable('checkStake deveria ter recusado');
    } catch (error) {
      expect((error as Error).message).toContain('trocar de baker');
    }
  });

  it('espaço de stake esgotado não é recusa — a cadeia aceita e conta como delegação', () => {
    // Limite > 0 com espaço zero rende menos, e isso é aviso do cartão do
    // baker. Bloquear aqui recusaria uma operação que a cadeia aceita.
    expect(() =>
      checkStake({
        amountMutez: 100_000n,
        currentDelegate: BAKER,
        bakerStakingLimitMillionth: 1n,
      }),
    ).not.toThrow();
  });
});

describe('planUnstake', () => {
  it('tira do stake e diz quanto continua congelado', () => {
    const plan = planUnstake({
      amountMutez: 400_000n,
      stakedMutez: 1_000_000n,
      spendableMutez: 10_000n,
      estimate: TAXA,
    });

    expect(plan.stakedAfterMutez).toBe(600_000n);
  });

  it('recusa tirar mais do que está em stake', () => {
    expect(() =>
      planUnstake({
        amountMutez: 1_000_001n,
        stakedMutez: 1_000_000n,
        spendableMutez: 10_000n,
        estimate: TAXA,
      }),
    ).toThrow(/só há/);
  });

  it('recusa quando não há gastável para a taxa, mesmo com stake de sobra', () => {
    // Este é o caso que trava de verdade: muito congelado, nada líquido, e a
    // saída do stake precisa de taxa em dinheiro gastável.
    expect(() =>
      planUnstake({
        amountMutez: 1_000n,
        stakedMutez: 1_000_000n,
        spendableMutez: 0n,
        estimate: TAXA,
      }),
    ).toThrow(/não paga taxa/);
  });
});

describe('planFinalize', () => {
  it('soma o liberado ao gastável e desconta a taxa', () => {
    const plan = planFinalize({
      finalizableMutez: 900_000n,
      spendableMutez: 10_000n,
      estimate: TAXA,
    });

    expect(plan.spendableAfterMutez).toBe(10_000n - 500n + 900_000n);
  });

  it('recusa finalizar quando não há nada liberado', () => {
    expect(() =>
      planFinalize({ finalizableMutez: 0n, spendableMutez: 10_000n, estimate: TAXA }),
    ).toThrow(/nada liberado/);
  });
});

describe('estimativa negativa', () => {
  it('é recusada em vez de virar crédito', () => {
    expect(() =>
      planDelegation({
        baker: BAKER,
        currentDelegate: null,
        spendableMutez: 1_000_000n,
        estimate: { ...TAXA, feeMutez: -1n },
      }),
    ).toThrow(/negativa/);
  });
});
