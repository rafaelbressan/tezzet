import { describe, expect, it } from 'vitest';
import { MissingFieldError } from '@tezos-suite/chain';
import {
  fetchBakerRecord,
  formatRate,
  measureDelegationCeiling,
  measureStakingYield,
  summarizeReliability,
  type CycleRecord,
} from '../src/chain/baker-record';
import { fakeStakingConstants } from './helpers/fake-chain';
import { fakeTzKT } from './helpers/fake-tzkt';

const constants = await fakeStakingConstants();

/**
 * Split real da Shadownet, baker `tz1N29q…`, ciclo 383, lido em 2026-09-05.
 * Os `*StakedShared` somam 1 615 816 mutez sobre 2 493 090 688 em stake de
 * terceiros — 0,0648% no ciclo.
 */
const SPLIT_383: Record<string, unknown> = {
  cycle: 383,
  futureBlocks: 0,
  ownDelegatedBalance: 167239287779,
  externalDelegatedBalance: 578103319719,
  ownStakedBalance: 1167878532323,
  externalStakedBalance: 2493090688,
  blocks: 633,
  missedBlocks: 0,
  attestations: 4414464,
  missedAttestations: 0,
  blockRewardsDelegated: 73311530,
  blockRewardsStakedOwn: 344618348,
  blockRewardsStakedEdge: 7594,
  blockRewardsStakedShared: 727979,
  attestationRewardsDelegated: 73148232,
  attestationRewardsStakedOwn: 343848263,
  attestationRewardsStakedEdge: 7341,
  attestationRewardsStakedShared: 726665,
  dalAttestationRewardsDelegated: 16224255,
  dalAttestationRewardsStakedOwn: 76265441,
  dalAttestationRewardsStakedEdge: 1629,
  dalAttestationRewardsStakedShared: 161172,
  vdfRevelationRewardsDelegated: 0,
  vdfRevelationRewardsStakedOwn: 0,
  vdfRevelationRewardsStakedEdge: 0,
  vdfRevelationRewardsStakedShared: 0,
  nonceRevelationRewardsDelegated: 0,
  nonceRevelationRewardsStakedOwn: 0,
  nonceRevelationRewardsStakedEdge: 0,
  nonceRevelationRewardsStakedShared: 0,
  doubleBakingLostExternalStaked: 0,
  doubleBakingLostExternalUnstaked: 0,
  doubleConsensusLostExternalStaked: 0,
  doubleConsensusLostExternalUnstaked: 0,
  delegators: [],
  stakers: [],
  actualStakers: [],
};

describe('fetchBakerRecord', () => {
  it('lê os últimos ciclos fechados, sem trazer as listas de delegador', async () => {
    const { http, calls } = fakeTzKT([
      { body: { ...SPLIT_383, cycle: 383 } },
      { body: { ...SPLIT_383, cycle: 382 } },
    ]);
    const records = await fetchBakerRecord(http, 'tz1N29q', 384, { cycles: 2 });

    expect(records.map((r) => r.cycle)).toEqual([383, 382]);
    // `limit=0` é o que impede uma tela de carteira baixar 60 mil delegadores
    // por ciclo só para calcular uma taxa.
    expect(calls[0]).toContain('limit=0');
  });

  it('pula um ciclo que ainda não fechou em vez de contar meia recompensa', async () => {
    const { http } = fakeTzKT([
      { body: { ...SPLIT_383, cycle: 383, futureBlocks: 12 } },
      { body: { ...SPLIT_383, cycle: 382 } },
    ]);
    const records = await fetchBakerRecord(http, 'tz1N29q', 384, { cycles: 2 });

    expect(records.map((r) => r.cycle)).toEqual([382]);
  });

  it('pula um ciclo sem registro (204) sem transformá-lo em zeros', async () => {
    const { http } = fakeTzKT([{ status: 204 }, { body: { ...SPLIT_383, cycle: 382 } }]);
    const records = await fetchBakerRecord(http, 'tz1N29q', 384, { cycles: 2 });

    expect(records).toHaveLength(1);
    // Um ciclo de zeros puxaria a média para baixo e ninguém perceberia.
    expect(records[0]?.stakedShared).toBeGreaterThan(0n);
  });

  it('levanta quando um campo de recompensa some da API', async () => {
    const semCampo: Record<string, unknown> = { ...SPLIT_383 };
    delete semCampo['attestationRewardsStakedShared'];
    const { http } = fakeTzKT([{ body: semCampo }]);

    await expect(fetchBakerRecord(http, 'tz1N29q', 384, { cycles: 1 })).rejects.toThrow(
      MissingFieldError,
    );
  });
});

const RECORD_383: CycleRecord = {
  cycle: 383,
  externalStaked: 2_493_090_688n,
  delegated: 167_239_287_779n + 578_103_319_719n,
  stakedShared: 727_979n + 726_665n + 161_172n,
  stakedEdge: 7_594n + 7_341n + 1_629n,
  delegatedRewards: 73_311_530n + 73_148_232n + 16_224_255n,
  blocks: 633,
  missedBlocks: 0,
  attestations: 4_414_464,
  missedAttestations: 0,
  lostExternalStake: 0n,
};

describe('measureStakingYield', () => {
  it('divide o que a cadeia creditou pelo que estava em stake, e mostra os dois', () => {
    const measured = measureStakingYield([RECORD_383], constants);
    if (measured.kind !== 'measured') throw new Error(measured.reason);

    expect(measured.credited).toBe(1_615_816n);
    expect(measured.base).toBe(2_493_090_688n);
    // 1 615 816 / 2 493 090 688 = 0,000648117…, em bilionésimos.
    expect(measured.perCycleBillionth).toBe(648_117n);
    expect(measured.cycles).toEqual([383]);
  });

  it('anualiza pelos ciclos que cabem no ano desta rede', () => {
    const measured = measureStakingYield([RECORD_383], constants);
    if (measured.kind !== 'measured') throw new Error(measured.reason);

    // 648 117 × 365,25 ciclos no ano = 236 724 734 bilionésimos, ou 23,67%.
    expect(measured.annualBillionth).toBe(236_724_734n);
    expect(formatRate(measured.annualBillionth)).toBe('23,67%');
  });

  it('sem base não inventa zero por cento', () => {
    const measured = measureStakingYield([{ ...RECORD_383, externalStaked: 0n }], constants);

    expect(measured.kind).toBe('unavailable');
    if (measured.kind !== 'unavailable') throw new Error('deveria ser indisponível');
    expect(measured.reason).toContain('não é zero por cento');
  });

  it('sem ciclo nenhum diz que não sabe, em vez de mostrar um número', () => {
    const measured = measureStakingYield([], constants);

    expect(measured.kind).toBe('unavailable');
  });
});

describe('measureDelegationCeiling', () => {
  it('é o que caiu no bolso do baker por unidade delegada — o teto, não o pago', () => {
    const ceiling = measureDelegationCeiling([RECORD_383], constants);
    if (ceiling.kind !== 'measured') throw new Error(ceiling.reason);

    expect(ceiling.received).toBe(162_684_017n);
    expect(ceiling.base).toBe(745_342_607_498n);
    expect(ceiling.perCycleBillionth).toBe(218_267n);
    // 7,97% ao ano de teto contra 23,67% de rendimento medido de stake: a
    // diferença entre as duas ações não é retórica, é uma ordem de grandeza.
    expect(formatRate(ceiling.annualBillionth)).toBe('7,97%');
  });

  it('sem nada delegado, não há teto para mostrar', () => {
    const ceiling = measureDelegationCeiling([{ ...RECORD_383, delegated: 0n }], constants);

    expect(ceiling.kind).toBe('unavailable');
  });
});

describe('summarizeReliability', () => {
  it('soma os ciclos e não vira nota nenhuma', () => {
    const reliability = summarizeReliability([
      RECORD_383,
      { ...RECORD_383, cycle: 382, blocks: 600, missedBlocks: 3, lostExternalStake: 4_000n },
    ]);

    expect(reliability.cycles).toBe(2);
    expect(reliability.blocks).toBe(1233);
    expect(reliability.missedBlocks).toBe(3);
    expect(reliability.lostExternalStake).toBe(4_000n);
  });

  it('sem ciclo, tudo zero e nenhum ciclo contado — histórico ausente não é limpo', () => {
    expect(summarizeReliability([]).cycles).toBe(0);
  });
});

describe('formatRate', () => {
  it('bilionésimo vira porcentagem com duas casas', () => {
    expect(formatRate(1_000_000_000n)).toBe('100,00%');
    expect(formatRate(74_200_000n)).toBe('7,42%');
    expect(formatRate(0n)).toBe('0,00%');
  });
});
