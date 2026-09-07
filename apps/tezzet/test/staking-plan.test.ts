import { describe, expect, it } from 'vitest';
import { AddressError } from '@tezos-suite/chain';
import {
  planDelegation,
  planFinalize,
  planStake,
  planUnstake,
  StakingValidationError,
} from '../src/wallet/staking';
import type { TransferEstimate } from '../src/wallet/transfer';

const BAKER = 'tz1fwnfJNgiDACshK9avfRfFbMaXrs3ghoJa';
const OUTRO_BAKER = 'tz1TfBtHD87eRJnSn4vvnsE1JGzKvpoKLJMj';

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
        estimate: TAXA,
      }),
    ).toThrow(/faltam/);
  });

  it('recusa valor zero ou negativo', () => {
    for (const amountMutez of [0n, -1n]) {
      expect(() =>
        planStake({ amountMutez, spendableMutez: 1_000_000n, currentDelegate: BAKER, estimate: TAXA }),
      ).toThrow(StakingValidationError);
    }
  });

  // BRES-119. Na Shadownet, 50,000000 pedidos congelaram 49,999999, e
  // 90,000000 congelaram 89,999999: o protocolo converte mutez em
  // pseudotokens e arredonda para baixo na primeira conversão da conta. O que
  // o app sabe exatamente é o que sai do gastável. Um campo com o saldo em
  // stake depois seria inventado, e a tela o mostraria como promessa — então
  // o plano não tem esse campo, e este teste é o que impede de voltar.
  it('não promete saldo em stake depois: a cadeia converte e arredonda para baixo', () => {
    const plan = planStake({
      amountMutez: 50_000_000n,
      spendableMutez: 60_000_000n,
      currentDelegate: BAKER,
      estimate: TAXA,
    });

    expect(Object.keys(plan)).not.toContain('stakedAfterMutez');
    expect(Object.keys(plan)).not.toContain('stakedAfterApproxMutez');
    // O que sobra é exato porque é subtração do gastável, não conversão.
    expect(plan.amountMutez).toBe(50_000_000n);
    expect(plan.spendableAfterMutez).toBe(60_000_000n - 50_000_000n - 500n);
  });

  // O bug de verdade seria alguém "corrigir" a diferença de 1 mutez somando
  // ou subtraindo no app. O plano pede o que a pessoa digitou, exatamente: o
  // arredondamento é do protocolo e conferir contra a cadeia é o único jeito
  // de saber quanto foi.
  it('pede o valor digitado, sem compensar o arredondamento do protocolo', () => {
    const plan = planStake({
      amountMutez: 90_000_000n,
      spendableMutez: 100_000_000n,
      currentDelegate: BAKER,
      estimate: TAXA,
    });

    expect(plan.amountMutez).toBe(90_000_000n);
  });
});

describe('planUnstake', () => {
  it('tira do stake e estima quanto continua congelado', () => {
    const plan = planUnstake({
      amountMutez: 400_000n,
      stakedMutez: 1_000_000n,
      spendableMutez: 10_000n,
      estimate: TAXA,
    });

    expect(plan.stakedAfterApproxMutez).toBe(600_000n);
  });

  // BRES-119. O campo se chamava `stakedAfterMutez` e a tela o mostrava como
  // um número exato. Ele nunca foi exato: o protocolo guarda o stake em
  // pseudotokens e reavalia o valor em mutez sozinho — na Shadownet, 29,999999
  // prometidos viraram 30,000004 minutos depois e 30,000028 mais tarde. O
  // nome é o teste: quem for usar o número tem que ler "approx" para chegar
  // nele.
  it('o que continua em stake é aproximado, e o nome do campo diz isso', () => {
    const plan = planUnstake({
      amountMutez: 400_000n,
      stakedMutez: 1_000_000n,
      spendableMutez: 10_000n,
      estimate: TAXA,
    });

    expect(Object.keys(plan)).toContain('stakedAfterApproxMutez');
    expect(Object.keys(plan)).not.toContain('stakedAfterMutez');
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
