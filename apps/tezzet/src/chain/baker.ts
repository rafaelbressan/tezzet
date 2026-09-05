import {
  BILLIONTH,
  HttpError,
  InvariantViolationError,
  MILLIONTH,
  parseStakingParameters,
  requireInteger,
  requireMutez,
  requireObject,
  requireString,
  type NetworkConfig,
  type TzKTHttp,
} from '@tezos-suite/chain';
import type { StakingConstants } from './protocol';

/**
 * Um baker, com os números que decidem — e só eles.
 *
 * Não há lista, não há busca e não há ranking. A pessoa escreve um endereço e
 * o Tezzet mostra o que a cadeia diz sobre ele. Isso não é economia de
 * esforço: descobrir bakers dentro da carteira está **parado por decisão de
 * Rafael em 2026-08-30** (`suite/JOURNEY.md` §6.4), porque uma carteira que
 * recomenda para quem delegar é conflito de interesse direto se quem a
 * publica também opera um baker. Mostrar os números de um endereço que a
 * pessoa trouxe não tem esse problema.
 *
 * **A fonte dos números é o nó, não o indexador.** Todo valor que entra na
 * conta de capacidade vem de uma única leitura de
 * `/context/delegates/{pkh}`, que é o próprio estado do protocolo. A TzKT
 * entra só para o que ela sabe e o nó não guarda: nome, contagem de
 * delegadores e de quem stakeia, última atividade e versão do software.
 *
 * A escolha não é de gosto. O `bakingPower` da TzKT **não é** o
 * `baking_power` do nó: para 8 dos 191 bakers ativos da Shadownet, todos
 * abaixo do stake mínimo, a TzKT reporta 0 enquanto o nó reporta o valor
 * calculado. Conferir a conta contra o campo do indexador reprovaria nesses
 * oito, e reprovaria por estar certo.
 */

const RPC_WHERE = '/chains/main/blocks/head/context/delegates/{pkh}';
const TZKT_WHERE = '/v1/delegates/{address}';

/** O endereço é válido, mas não está registrado como baker nesta rede. */
export class NotABakerError extends Error {
  constructor(readonly address: string) {
    super(
      `${address} não está registrado como baker nesta rede — ` +
        'delegar para um endereço que não é baker é recusado pela cadeia',
    );
    this.name = 'NotABakerError';
  }
}

/** O nó conhece este baker e o indexador ainda não. Raro, e não é ausência de baker. */
export class BakerNotIndexedError extends Error {
  constructor(readonly address: string) {
    super(
      `o nó reconhece ${address} como baker, mas o indexador ainda não o conhece — ` +
        'sem ele não há nome, contagem de delegadores nem histórico de ciclo para mostrar',
    );
    this.name = 'BakerNotIndexedError';
  }
}

export interface BakerSnapshot {
  readonly address: string;
  readonly alias?: string;
  /**
   * `false` quando o baker foi desativado por inatividade. Delegar para um
   * baker desativado é permitido pela cadeia e não rende nada.
   */
  readonly active: boolean;

  /** O que é do próprio baker, congelado em stake. É a base de toda capacidade. */
  readonly ownStaked: bigint;
  /** O que terceiros têm em stake com ele. */
  readonly externalStaked: bigint;
  /** Delegado hoje. É o que ocupa espaço daqui para a frente. */
  readonly delegated: bigint;
  /**
   * O mínimo que esteve delegado no ciclo corrente. É **este** que entra no
   * poder de baker, e não o de agora: contar o de agora deixaria alguém
   * inflar o peso momentaneamente e ser pago por ele.
   */
  readonly minDelegated: bigint;

  /**
   * A fatia que o baker retira do rendimento de quem stakeia com ele, em
   * bilionésimos. **É a única taxa que a cadeia conhece e cobra sozinha.**
   */
  readonly stakingEdgeBillionth: bigint;
  /** Quanto stake de terceiros o baker aceita, em múltiplos do stake próprio (milionésimos). */
  readonly stakingLimitMillionth: bigint;

  /** Teto de stake de terceiros depois de aplicado o limite global. */
  readonly stakingCapacity: bigint;
  /** Quanto ainda cabe de stake de terceiros. Zero quando já passou. */
  readonly stakingFreeSpace: bigint;
  /**
   * Stake de terceiros acima do teto. O protocolo não recusa nem devolve: ele
   * conta esse excedente como **delegação**, que rende
   * `edge_of_staking_over_delegation` vezes menos.
   */
  readonly overStaked: bigint;

  readonly delegationCapacity: bigint;
  readonly delegationFreeSpace: bigint;

  /** Como o nó reporta. A conta abaixo é conferida contra ele. */
  readonly bakingPower: bigint;

  readonly delegatorsCount: number;
  readonly stakersCount: number;
  readonly lastActivityAt: Date;
  readonly softwareVersion?: string;

  readonly readAt: Date;
  readonly indexerLevel?: number;
}

export interface BakerBalances {
  readonly ownStaked: bigint;
  readonly externalStaked: bigint;
  /** Delegado agora — decide a capacidade livre. */
  readonly delegated: bigint;
  /** Mínimo do ciclo — decide o poder de baker. */
  readonly minDelegated: bigint;
  readonly stakingLimitMillionth: bigint;
}

export interface BakerCapacity {
  readonly stakingCapacity: bigint;
  readonly stakingFreeSpace: bigint;
  readonly overStaked: bigint;
  readonly delegationCapacity: bigint;
  readonly delegationFreeSpace: bigint;
  readonly bakingPower: bigint;
}

/**
 * A lei do poder de baker, conferida em 2026-09-05 contra o `baking_power` do
 * próprio nó em **198 de 198** bakers ativos da mainnet e **191 de 191** da
 * Shadownet — 389 acertos exatos, zero erros:
 *
 *   tetoDeStake  = min(limite do baker, limite global) × stake próprio
 *   excedente    = max(0, stake de terceiros − tetoDeStake)
 *   stakeVálido  = stake próprio + min(stake de terceiros, tetoDeStake)
 *   tetoDeDeleg  = limit_of_delegation_over_baking × stake próprio
 *   delegVálida  = min(delegado mínimo do ciclo + excedente, tetoDeDeleg)
 *   poder        = stakeVálido + delegVálida / edge_of_staking_over_delegation
 *
 * Duas partes não são óbvias e as duas foram medidas:
 *
 * 1. **O excedente de stake não é recusado nem devolvido — ele desce para
 *    delegação.** Uma conta que o jogasse fora erraria o poder para baixo e
 *    diria que cabe delegação onde a cadeia já não conta mais nada.
 * 2. **O delegado que conta é o mínimo do ciclo, não o de agora.** Usar o de
 *    agora acerta em 50 dos 198 bakers da mainnet; usar o mínimo acerta em
 *    198. A capacidade livre, ao contrário, usa o de agora — é ele que ocupa
 *    o espaço daqui para a frente, e a conta fica conservadora.
 */
export function computeBakerCapacity(
  balances: BakerBalances,
  constants: StakingConstants,
): BakerCapacity {
  const globalLimitMillionth = BigInt(constants.globalLimitOfStakingOverBaking) * MILLIONTH;
  const effectiveLimitMillionth =
    balances.stakingLimitMillionth < globalLimitMillionth
      ? balances.stakingLimitMillionth
      : globalLimitMillionth;

  const stakingCapacity = (effectiveLimitMillionth * balances.ownStaked) / MILLIONTH;
  const overStaked =
    balances.externalStaked > stakingCapacity ? balances.externalStaked - stakingCapacity : 0n;
  const countedStaked = balances.externalStaked - overStaked;

  const delegationCapacity = BigInt(constants.limitOfDelegationOverBaking) * balances.ownStaked;
  const countedDelegated = min(balances.minDelegated + overStaked, delegationCapacity);
  // O excedente de stake ocupa espaço de delegação. Ignorá-lo aqui diria que
  // cabe delegação onde a cadeia já não conta mais nada.
  const occupied = balances.delegated + overStaked;

  return {
    stakingCapacity,
    stakingFreeSpace: stakingCapacity - countedStaked,
    overStaked,
    delegationCapacity,
    delegationFreeSpace: delegationCapacity > occupied ? delegationCapacity - occupied : 0n,
    bakingPower:
      balances.ownStaked +
      countedStaked +
      countedDelegated / BigInt(constants.edgeOfStakingOverDelegation),
  };
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/**
 * O nó responde **HTTP 500** com `proto.…delegate.not_registered` para um
 * endereço válido que não é baker — não 404. Tratar todo 500 como falha de
 * rede transformaria "este endereço não é baker" em "o nó está com problema",
 * e a pessoa tentaria de novo para sempre.
 */
function isNotRegistered(body: string): boolean {
  return body.includes('delegate.not_registered');
}

interface RpcDelegate {
  readonly active: boolean;
  readonly balances: BakerBalances;
  readonly edgeBillionth: bigint;
  readonly bakingPower: bigint;
}

async function fetchDelegateFromNode(
  network: NetworkConfig,
  address: string,
  fetchImpl: typeof fetch,
): Promise<RpcDelegate> {
  const url = `${network.rpcUrl}/chains/main/blocks/head/context/delegates/${address}`;
  const response = await fetchImpl(url);
  const body = await response.text();
  if (!response.ok) {
    if (isNotRegistered(body)) throw new NotABakerError(address);
    throw new HttpError(response.status, url, body);
  }

  const raw = requireObject(JSON.parse(body), RPC_WHERE);
  const parameters = parseStakingParameters(
    requireObject(raw['active_staking_parameters'], `${RPC_WHERE}.active_staking_parameters`),
  );
  const minDelegated = requireObject(
    raw['min_delegated_in_current_cycle'],
    `${RPC_WHERE}.min_delegated_in_current_cycle`,
  );

  const deactivated = raw['deactivated'];
  if (typeof deactivated !== 'boolean') {
    throw new InvariantViolationError(
      'deactivated é booleano',
      `${address}: o nó respondeu ${JSON.stringify(deactivated)}`,
    );
  }

  return {
    active: !deactivated,
    balances: {
      ownStaked: requireMutez(raw, 'own_staked', RPC_WHERE),
      externalStaked: requireMutez(raw, 'external_staked', RPC_WHERE),
      delegated: requireMutez(raw, 'total_delegated', RPC_WHERE),
      minDelegated: requireMutez(minDelegated, 'amount', `${RPC_WHERE}.min_delegated_in_current_cycle`),
      stakingLimitMillionth: parameters.limitOfStakingOverBakingMillionth,
    },
    edgeBillionth: parameters.edgeOfBakingOverStakingBillionth,
    bakingPower: requireMutez(raw, 'baking_power', RPC_WHERE),
  };
}

function parseSoftwareVersion(raw: Record<string, unknown>): string | undefined {
  const software = raw['software'];
  if (typeof software !== 'object' || software === null || Array.isArray(software)) return undefined;
  const version = (software as Record<string, unknown>)['version'];
  return typeof version === 'string' ? version : undefined;
}

export interface FetchBakerOptions {
  readonly now?: () => Date;
  readonly fetchImpl?: typeof fetch;
}

export async function fetchBaker(
  http: TzKTHttp,
  network: NetworkConfig,
  address: string,
  constants: StakingConstants,
  options: FetchBakerOptions = {},
): Promise<BakerSnapshot> {
  const [node, indexed] = await Promise.all([
    fetchDelegateFromNode(network, address, options.fetchImpl ?? fetch),
    http.get<Record<string, unknown>>(`/v1/delegates/${address}`),
  ]);

  // 204 com corpo vazio: o indexador não conhece este endereço como baker. O
  // nó conhece, então não é "não é baker" — é o indexador atrás.
  if (indexed.body === undefined) throw new BakerNotIndexedError(address);
  const raw = requireObject(indexed.body, TZKT_WHERE);

  const capacity = computeBakerCapacity(node.balances, constants);

  // O teste que pode reprovar. A capacidade livre é a conta acima, e se ela
  // não reproduz o poder que o próprio nó reporta, a leitura do modelo
  // econômico está errada — e um "cabe mais 40 000 XTZ" errado só aparece
  // depois de a pessoa assinar.
  if (capacity.bakingPower !== node.bakingPower) {
    throw new InvariantViolationError(
      'poder de baker = stake válido + delegação válida / edge_of_staking_over_delegation',
      `${address}: a conta dá ${capacity.bakingPower} mutez e o nó reporta ${node.bakingPower} ` +
        `(stake próprio ${node.balances.ownStaked}, de terceiros ${node.balances.externalStaked}, ` +
        `delegado mínimo do ciclo ${node.balances.minDelegated}, ` +
        `limite ${node.balances.stakingLimitMillionth} milionésimos, protocolo ${constants.protocolHash}) — ` +
        'nenhum número de capacidade pode ser mostrado',
    );
  }

  const timestamp = requireString(raw, 'lastActivityTime', TZKT_WHERE);
  const lastActivityAt = new Date(timestamp);
  if (Number.isNaN(lastActivityAt.getTime())) {
    throw new InvariantViolationError(
      'lastActivityTime é uma data',
      `${address}: a TzKT respondeu ${JSON.stringify(timestamp)}`,
    );
  }

  const alias = raw['alias'];
  const softwareVersion = parseSoftwareVersion(raw);
  const indexerLevel = indexed.freshness?.level;

  return {
    address,
    ...(typeof alias === 'string' ? { alias } : {}),
    active: node.active,
    ownStaked: node.balances.ownStaked,
    externalStaked: node.balances.externalStaked,
    delegated: node.balances.delegated,
    minDelegated: node.balances.minDelegated,
    stakingEdgeBillionth: node.edgeBillionth,
    stakingLimitMillionth: node.balances.stakingLimitMillionth,
    ...capacity,
    delegatorsCount: requireInteger(raw, 'numDelegators', TZKT_WHERE),
    stakersCount: requireInteger(raw, 'stakersCount', TZKT_WHERE),
    lastActivityAt,
    ...(softwareVersion === undefined ? {} : { softwareVersion }),
    readAt: (options.now ?? (() => new Date()))(),
    ...(indexerLevel === undefined ? {} : { indexerLevel }),
  };
}

/**
 * A fatia do baker sobre o rendimento de stake, em texto. Bilionésimo, nunca
 * porcentagem crua: ler 90 000 000 como porcentagem dá 90 000 000 %.
 */
export function formatEdgePercent(edgeBillionth: bigint): string {
  const basisPoints = (edgeBillionth * 10_000n) / BILLIONTH;
  const whole = basisPoints / 100n;
  const fraction = (basisPoints % 100n).toString().padStart(2, '0');
  return `${whole},${fraction}%`;
}

/** O limite de stake do baker, em múltiplos do stake próprio dele. */
export function formatStakingLimit(limitMillionth: bigint): string {
  const hundredths = (limitMillionth * 100n) / MILLIONTH;
  const whole = hundredths / 100n;
  const fraction = (hundredths % 100n).toString().padStart(2, '0');
  return `${whole},${fraction}×`;
}
