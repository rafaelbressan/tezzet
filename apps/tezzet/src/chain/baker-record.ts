import {
  REWARD_EVENTS,
  requireInteger,
  requireMutez,
  requireObject,
  type TzKTHttp,
} from '@tezos-suite/chain';
import { cyclesPerYear, type StakingConstants } from './protocol';

/**
 * O que este baker fez nos últimos ciclos fechados — medido, nunca projetado.
 *
 * A regra da issue é dura e está certa: *"nenhuma projeção de rendimento sem
 * a conta disponível; se não der para estimar honestamente, diga isso"*. As
 * duas ações têm respostas diferentes, e a diferença é do protocolo, não do
 * app:
 *
 * - **Stake.** O protocolo credita quem stakeia direto, na cadeia, e reporta
 *   quanto (`*StakedShared`). Então o rendimento realizado é uma conta com
 *   todos os termos públicos, e ela é feita aqui.
 * - **Delegação.** A recompensa cai inteira no saldo líquido do baker
 *   (`*Delegated`) e quanto disso volta para o delegador é acordo privado do
 *   baker — não existe na cadeia. Então **não há rendimento de delegação para
 *   estimar.** O que dá para dizer é o teto: quanto o baker recebeu por
 *   unidade delegada. Nada além disso seria inventado.
 *
 * Uma leitura por ciclo, com `limit=0`: as listas de delegador e de staker não
 * entram na conta e um baker grande tem dezenas de milhares delas.
 * `assertDelegatorListComplete` **não** vale para esta leitura, justamente
 * porque a lista vem vazia de propósito.
 */

/** Quantos ciclos fechados olhar para trás. Poucos demais é ruído; muitos, história. */
export const DEFAULT_RECORD_CYCLES = 10;

export interface CycleRecord {
  readonly cycle: number;
  /** Saldo de snapshot: a base sobre a qual o rendimento do ciclo aconteceu. */
  readonly externalStaked: bigint;
  readonly delegated: bigint;
  /** Creditado na cadeia a quem stakeia, já descontada a fatia do baker. */
  readonly stakedShared: bigint;
  /** A fatia que o baker reteve do rendimento de quem stakeia. */
  readonly stakedEdge: bigint;
  /** Caiu no saldo líquido do baker. É o teto do que a delegação pode render. */
  readonly delegatedRewards: bigint;

  readonly blocks: number;
  readonly missedBlocks: number;
  readonly attestations: number;
  readonly missedAttestations: number;
  /** Punição que saiu do bolso de quem stakeia com ele — não do bolso do baker. */
  readonly lostExternalStake: bigint;
}

const SLASHING_FIELDS = [
  'doubleBakingLostExternalStaked',
  'doubleBakingLostExternalUnstaked',
  'doubleConsensusLostExternalStaked',
  'doubleConsensusLostExternalUnstaked',
] as const;

function sumRewardFields(
  raw: Record<string, unknown>,
  where: string,
  destination: 'Delegated' | 'StakedEdge' | 'StakedShared',
): bigint {
  let total = 0n;
  for (const event of REWARD_EVENTS) {
    total += requireMutez(raw, `${event}${destination}`, where);
  }
  return total;
}

export function parseCycleRecord(raw: Record<string, unknown>, where: string): CycleRecord {
  return {
    cycle: requireInteger(raw, 'cycle', where),
    externalStaked: requireMutez(raw, 'externalStakedBalance', where),
    delegated:
      requireMutez(raw, 'ownDelegatedBalance', where) +
      requireMutez(raw, 'externalDelegatedBalance', where),
    stakedShared: sumRewardFields(raw, where, 'StakedShared'),
    stakedEdge: sumRewardFields(raw, where, 'StakedEdge'),
    delegatedRewards: sumRewardFields(raw, where, 'Delegated'),
    blocks: requireInteger(raw, 'blocks', where),
    missedBlocks: requireInteger(raw, 'missedBlocks', where),
    attestations: requireInteger(raw, 'attestations', where),
    missedAttestations: requireInteger(raw, 'missedAttestations', where),
    lostExternalStake: SLASHING_FIELDS.reduce(
      (total, field) => total + requireMutez(raw, field, where),
      0n,
    ),
  };
}

/** O ciclo só fecha quando nenhum bloco dele ainda está no futuro. */
function isClosed(raw: Record<string, unknown>, where: string): boolean {
  return requireInteger(raw, 'futureBlocks', where) === 0;
}

export interface FetchBakerRecordOptions {
  readonly cycles?: number;
}

/**
 * Lê os últimos ciclos fechados. Um ciclo sem registro para este baker volta
 * 204 e é **pulado** — ausência de registro é ausência, não um ciclo de zeros
 * que puxaria a média para baixo.
 */
export async function fetchBakerRecord(
  http: TzKTHttp,
  baker: string,
  currentCycle: number,
  options: FetchBakerRecordOptions = {},
): Promise<readonly CycleRecord[]> {
  const wanted = options.cycles ?? DEFAULT_RECORD_CYCLES;
  const records: CycleRecord[] = [];

  for (let offset = 1; offset <= wanted; offset += 1) {
    const cycle = currentCycle - offset;
    if (cycle < 0) break;
    const where = `/v1/rewards/split/${baker}/${cycle}`;
    const { body } = await http.get<Record<string, unknown>>(where, { limit: 0 });
    if (body === undefined) continue;
    const raw = requireObject(body, where);
    if (!isClosed(raw, where)) continue;
    records.push(parseCycleRecord(raw, where));
  }

  return records;
}

const BILLIONTH = 1_000_000_000n;
/** 365,25 dias. Inteiro de propósito: a anualização não passa por float. */
const SECONDS_PER_YEAR = 31_557_600n;

export type StakingYield =
  | {
      readonly kind: 'measured';
      /** Ciclos que entraram na conta, do mais antigo ao mais recente. */
      readonly cycles: readonly number[];
      /** Soma do que o protocolo creditou a quem stakeia, nesses ciclos. */
      readonly credited: bigint;
      /** Soma das bases de cada ciclo — o denominador, escrito. */
      readonly base: bigint;
      readonly perCycleBillionth: bigint;
      readonly annualBillionth: bigint;
      /** Quantos ciclos o ano tem nesta rede, derivado das constantes. */
      readonly cyclesPerYear: number;
    }
  | { readonly kind: 'unavailable'; readonly reason: string };

/**
 * Rendimento realizado de quem stakeia com este baker.
 *
 * Passado medido, não previsão: a emissão da Tezos é adaptativa e muda com a
 * fração total em stake da rede, então nenhum número daqui promete o próximo
 * ciclo. A anualização assume todo bloco no tempo mínimo, o que é o melhor
 * caso — a tela precisa dizer isso junto com o número.
 */
export function measureStakingYield(
  records: readonly CycleRecord[],
  constants: StakingConstants,
): StakingYield {
  if (records.length === 0) {
    return {
      kind: 'unavailable',
      reason: 'nenhum ciclo fechado deste baker foi encontrado no indexador',
    };
  }

  let credited = 0n;
  let base = 0n;
  for (const record of records) {
    credited += record.stakedShared;
    base += record.externalStaked;
  }

  if (base === 0n) {
    return {
      kind: 'unavailable',
      reason:
        `este baker não teve nenhum stake de terceiros nos ${records.length} ciclos lidos, ` +
        'e um rendimento sem base é divisão por zero — não é zero por cento',
    };
  }

  const perCycleBillionth = (credited * BILLIONTH) / base;
  const secondsPerCycle = BigInt(constants.blocksPerCycle * constants.minimalBlockDelay);

  return {
    kind: 'measured',
    cycles: records.map((record) => record.cycle).reverse(),
    credited,
    base,
    perCycleBillionth,
    annualBillionth: (perCycleBillionth * SECONDS_PER_YEAR) / secondsPerCycle,
    cyclesPerYear: cyclesPerYear(constants),
  };
}

export type DelegationCeiling =
  | {
      readonly kind: 'measured';
      readonly cycles: readonly number[];
      /** O que caiu no saldo líquido do baker nesses ciclos. */
      readonly received: bigint;
      readonly base: bigint;
      readonly perCycleBillionth: bigint;
      readonly annualBillionth: bigint;
    }
  | { readonly kind: 'unavailable'; readonly reason: string };

/**
 * O **teto** do rendimento de delegação: tudo que o baker recebeu por unidade
 * delegada. Quanto disso chega ao delegador é decisão do baker, fora da
 * cadeia — por isso é teto, e por isso a tela nunca pode chamá-lo de
 * rendimento.
 */
export function measureDelegationCeiling(
  records: readonly CycleRecord[],
  constants: StakingConstants,
): DelegationCeiling {
  if (records.length === 0) {
    return {
      kind: 'unavailable',
      reason: 'nenhum ciclo fechado deste baker foi encontrado no indexador',
    };
  }

  let received = 0n;
  let base = 0n;
  for (const record of records) {
    received += record.delegatedRewards;
    base += record.delegated;
  }

  if (base === 0n) {
    return {
      kind: 'unavailable',
      reason: `este baker não teve nada delegado nos ${records.length} ciclos lidos`,
    };
  }

  const perCycleBillionth = (received * BILLIONTH) / base;
  const secondsPerCycle = BigInt(constants.blocksPerCycle * constants.minimalBlockDelay);

  return {
    kind: 'measured',
    cycles: records.map((record) => record.cycle).reverse(),
    received,
    base,
    perCycleBillionth,
    annualBillionth: (perCycleBillionth * SECONDS_PER_YEAR) / secondsPerCycle,
  };
}

export interface Reliability {
  readonly cycles: number;
  readonly blocks: number;
  readonly missedBlocks: number;
  readonly attestations: number;
  readonly missedAttestations: number;
  /** Punição que atingiu stake de terceiros. Zero é a resposta boa, e é lida. */
  readonly lostExternalStake: bigint;
}

/** Contagem crua. Sem nota, sem estrela, sem "excelente" — os números. */
export function summarizeReliability(records: readonly CycleRecord[]): Reliability {
  return records.reduce<Reliability>(
    (total, record) => ({
      cycles: total.cycles + 1,
      blocks: total.blocks + record.blocks,
      missedBlocks: total.missedBlocks + record.missedBlocks,
      attestations: total.attestations + record.attestations,
      missedAttestations: total.missedAttestations + record.missedAttestations,
      lostExternalStake: total.lostExternalStake + record.lostExternalStake,
    }),
    {
      cycles: 0,
      blocks: 0,
      missedBlocks: 0,
      attestations: 0,
      missedAttestations: 0,
      lostExternalStake: 0n,
    },
  );
}

/** Taxa em bilionésimos, para texto. Entra bilionésimo, sai porcentagem. */
export function formatRate(billionth: bigint): string {
  const hundredths = (billionth * 10_000n) / BILLIONTH;
  const negative = hundredths < 0n;
  const magnitude = negative ? -hundredths : hundredths;
  const whole = magnitude / 100n;
  const fraction = (magnitude % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole},${fraction}%`;
}
