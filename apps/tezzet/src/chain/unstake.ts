import {
  FieldTypeError,
  fetchHead,
  requireInteger,
  requireMutez,
  requireObject,
  requireString,
  type TzKTHttp,
} from '@tezos-suite/chain';
import type { StakingConstants } from './protocol';

/**
 * O tempo que o dinheiro fica preso depois de sair do stake.
 *
 * Este é o número que precisa aparecer **antes** de a pessoa confirmar. Ele
 * não está em nenhuma resposta antes de a operação existir, então é
 * calculado — e a conta é a que a cadeia usa, conferida contra a realidade:
 *
 *   ciclo de liberação = ciclo do pedido + unstake_finalization_delay + 1
 *   nível de liberação = primeiro nível do ciclo do pedido + (delay + 1) × blocos por ciclo
 *
 * Conferido em 2026-09-05 contra 400 pedidos de mainnet dos ciclos 1311 a
 * 1344 (`unlockCycle − cycle` = 4 nos 400, com a constante em 3) e contra 60
 * pedidos com o `unlockLevel` batendo exatamente, em cinco ciclos diferentes.
 *
 * O `+ 1` é a parte que erra fácil: a constante vale 3 e a espera é de 4
 * ciclos, porque o ciclo em que o pedido é feito já está correndo e não conta.
 * Mostrar 3 ciclos seria prometer um dia a menos de espera do que a cadeia dá.
 */
export interface UnstakeWait {
  readonly unlockCycle: number;
  readonly unlockLevel: number;
  /** Ciclos de espera contados como a pessoa conta: do agora até liberar. */
  readonly cyclesToWait: number;
  readonly blocksToWait: number;
  /**
   * Segundos **se todo bloco sair no tempo mínimo**. É um piso: rodada
   * perdida faz o bloco demorar mais, e a espera real só pode ser maior.
   */
  readonly secondsAtMinimum: number;
  /** A data mais cedo possível. Nunca "a data" — a mais cedo. */
  readonly earliestAt: Date;
}

export interface CycleWindow {
  readonly headLevel: number;
  readonly cycle: number;
  readonly cycleFirstLevel: number;
}

export function computeUnstakeWait(
  window: CycleWindow,
  constants: StakingConstants,
  now: () => Date = () => new Date(),
): UnstakeWait {
  const cyclesOfDelay = constants.unstakeFinalizationDelay + 1;
  const unlockCycle = window.cycle + cyclesOfDelay;
  const unlockLevel = window.cycleFirstLevel + cyclesOfDelay * constants.blocksPerCycle;
  // Um pedido feito no último bloco do ciclo espera quase o mesmo que um
  // feito no primeiro: a espera é contada em ciclos inteiros, não em blocos
  // a partir de agora. Mostrar só "4 ciclos" esconderia essa diferença.
  const blocksToWait = Math.max(0, unlockLevel - window.headLevel);
  const secondsAtMinimum = blocksToWait * constants.minimalBlockDelay;

  return {
    unlockCycle,
    unlockLevel,
    cyclesToWait: cyclesOfDelay,
    blocksToWait,
    secondsAtMinimum,
    earliestAt: new Date(now().getTime() + secondsAtMinimum * 1000),
  };
}

/** Cabeça da cadeia e a janela do ciclo corrente, as duas leituras da conta. */
export async function fetchCycleWindow(http: TzKTHttp): Promise<CycleWindow> {
  const head = await fetchHead(http);
  const where = `/v1/cycles/${head.cycle}`;
  const { body } = await http.getRequired<Record<string, unknown>>(`/v1/cycles/${head.cycle}`);
  const cycle = requireObject(body, where);
  return {
    headLevel: head.level,
    cycle: head.cycle,
    // O primeiro nível do ciclo é lido, nunca multiplicado: as fronteiras de
    // ciclo andaram em migrações de protocolo, e `ciclo × blocos por ciclo`
    // erra em toda cadeia que já migrou.
    cycleFirstLevel: requireInteger(cycle, 'firstLevel', where),
  };
}

/**
 * Um pedido de saída de stake já feito.
 *
 * `finalizable` é o estado que a interface precisa gritar: o dinheiro já
 * cumpriu a espera e **não volta sozinho** para o gastável. Falta uma
 * operação `finalize_unstake`, e quem não souber disso vai achar que a
 * cadeia perdeu o valor.
 */
export type UnstakeRequestStatus = 'pending' | 'finalizable' | 'finalized';

export interface UnstakeRequest {
  readonly id: number;
  readonly cycle: number;
  readonly baker: string;
  readonly status: UnstakeRequestStatus;
  /** O que foi pedido na saída. */
  readonly requested: bigint;
  /** O que ainda está neste pedido, depois de punição e refinanciamento. */
  readonly remaining: bigint;
  /** Perdido em punição do baker. Zero é um número lido, não um padrão. */
  readonly slashed: bigint;
  readonly unlockCycle: number;
  readonly unlockLevel: number;
  readonly unlockAt: Date;
}

const REQUEST_STATUSES: readonly string[] = ['pending', 'finalizable', 'finalized'];

const REQUESTS_WHERE = '/v1/staking/unstake_requests';

function parseRequest(raw: unknown, index: number): UnstakeRequest {
  const where = `${REQUESTS_WHERE}[${index}]`;
  const row = requireObject(raw, where);

  const status = requireString(row, 'status', where);
  if (!REQUEST_STATUSES.includes(status)) {
    throw new FieldTypeError('status', where, REQUEST_STATUSES.join(' | '), status);
  }

  const unlockRaw = requireString(row, 'unlockTime', where);
  const unlockAt = new Date(unlockRaw);
  if (Number.isNaN(unlockAt.getTime())) {
    throw new FieldTypeError('unlockTime', where, 'uma data ISO 8601', unlockRaw);
  }

  const baker = requireObject(row['baker'], `${where}.baker`);

  return {
    id: requireInteger(row, 'id', where),
    cycle: requireInteger(row, 'cycle', where),
    baker: requireString(baker, 'address', `${where}.baker`),
    status: status as UnstakeRequestStatus,
    requested: requireMutez(row, 'requestedAmount', where),
    remaining: requireMutez(row, 'actualAmount', where),
    slashed: requireMutez(row, 'slashedAmount', where),
    unlockCycle: requireInteger(row, 'unlockCycle', where),
    unlockLevel: requireInteger(row, 'unlockLevel', where),
    unlockAt,
  };
}

/**
 * Pedidos ainda abertos desta conta. `finalized` fica de fora: ele já virou
 * saldo gastável e aparece no histórico, não numa lista de espera.
 */
export async function fetchOpenUnstakeRequests(
  http: TzKTHttp,
  staker: string,
): Promise<readonly UnstakeRequest[]> {
  const { body } = await http.get<unknown[]>(REQUESTS_WHERE, {
    staker,
    'status.ne': 'finalized',
    limit: 100,
    'sort.asc': 'unlockLevel',
  });
  const rows = body ?? [];
  if (!Array.isArray(rows)) {
    throw new FieldTypeError('(corpo)', REQUESTS_WHERE, 'uma lista de pedidos', rows);
  }
  return rows.map(parseRequest);
}

/** Só o que já cumpriu a espera e precisa de uma operação para voltar. */
export function finalizableTotal(requests: readonly UnstakeRequest[]): bigint {
  let total = 0n;
  for (const request of requests) {
    if (request.status === 'finalizable') total += request.remaining;
  }
  return total;
}
