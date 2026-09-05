import {
  FieldTypeError,
  InvariantViolationError,
  MissingFieldError,
  type ProtocolConstants,
} from '@tezos-suite/chain';

/**
 * As constantes que governam delegação e staking, lidas da cadeia.
 *
 * A camada de cadeia da suíte (SPEC-0002) tipa as constantes que o TAPS
 * precisa. Estas quatro só passam a importar quando a carteira deixa de
 * apenas ler e passa a delegar e a stakear, e elas ficam em `raw` — o mapa
 * congelado do que o nó respondeu. Nenhuma delas ganha valor aqui:
 *
 *   `unstake_finalization_delay`        decide quanto tempo o dinheiro fica preso
 *   `limit_of_delegation_over_baking`   decide se ainda cabe delegação no baker
 *   `global_limit_of_staking_over_baking` é o teto que nenhum baker ultrapassa
 *   `edge_of_staking_over_delegation`   é quanto uma unidade delegada vale
 *
 * Escrever `3` ao lado de qualquer uma delas seria escrever um número que só
 * vale até o próximo upgrade de protocolo — e que erraria calado, porque nada
 * na resposta do nó contradiz um número que ninguém leu.
 */
const SOURCE = '/chains/main/blocks/head/context/constants';

export interface StakingConstants {
  /**
   * O atraso, em ciclos, que o protocolo aplica ao `unstake`.
   *
   * **Não é o número de ciclos de espera.** O ciclo em que os fundos ficam
   * liberados é `ciclo do pedido + unstake_finalization_delay + 1` — o `+1`
   * porque o ciclo do pedido não conta, ele já está correndo. Conferido em
   * 400 pedidos reais da mainnet, ciclos 1311 a 1344: `unlockCycle − cycle`
   * deu 4 nos 400, com a constante em 3.
   */
  readonly unstakeFinalizationDelay: number;
  /** Quanto pode ser delegado a um baker, em múltiplos do stake próprio dele. */
  readonly limitOfDelegationOverBaking: number;
  /** Teto de stake de terceiros que nenhum baker ultrapassa, mesmo pedindo mais. */
  readonly globalLimitOfStakingOverBaking: number;
  /** Quantas unidades delegadas valem uma unidade em stake no poder de baker. */
  readonly edgeOfStakingOverDelegation: number;
  /** Do que veio: sem isso não dá para dizer que ciclo produziu que número. */
  readonly protocolHash: string;
  readonly blocksPerCycle: number;
  readonly minimalBlockDelay: number;
}

function requireInteger(raw: Readonly<Record<string, unknown>>, field: string): number {
  if (!(field in raw) || raw[field] === null || raw[field] === undefined) {
    throw new MissingFieldError(field, SOURCE);
  }
  const value = raw[field];
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isInteger(parsed)) {
    throw new FieldTypeError(field, SOURCE, 'um inteiro', value);
  }
  return parsed;
}

function requirePositive(value: number, field: string): number {
  if (value <= 0) {
    throw new InvariantViolationError(
      `${field} > 0`,
      `o nó respondeu ${value} para ${field} — este número divide ou multiplica valor, ` +
        'e um zero aqui produziria capacidade infinita ou divisão por zero em silêncio',
    );
  }
  return value;
}

export function readStakingConstants(constants: ProtocolConstants): StakingConstants {
  return {
    // Pode ser zero num protocolo futuro que acabe com a espera — zero é uma
    // resposta, e o único valor recusado é o negativo.
    unstakeFinalizationDelay: requireNonNegative(
      requireInteger(constants.raw, 'unstake_finalization_delay'),
      'unstake_finalization_delay',
    ),
    limitOfDelegationOverBaking: requirePositive(
      requireInteger(constants.raw, 'limit_of_delegation_over_baking'),
      'limit_of_delegation_over_baking',
    ),
    globalLimitOfStakingOverBaking: requirePositive(
      requireInteger(constants.raw, 'global_limit_of_staking_over_baking'),
      'global_limit_of_staking_over_baking',
    ),
    edgeOfStakingOverDelegation: requirePositive(
      constants.edgeOfStakingOverDelegation,
      'edge_of_staking_over_delegation',
    ),
    protocolHash: constants.protocolHash,
    blocksPerCycle: requirePositive(constants.blocksPerCycle, 'blocks_per_cycle'),
    minimalBlockDelay: requirePositive(constants.minimalBlockDelay, 'minimal_block_delay'),
  };
}

function requireNonNegative(value: number, field: string): number {
  if (value < 0) {
    throw new InvariantViolationError(
      `${field} >= 0`,
      `o nó respondeu ${value} para ${field}, e um atraso negativo não tem leitura possível`,
    );
  }
  return value;
}

/**
 * Quantos ciclos cabem num ano, derivado — nunca escrito.
 *
 * Serve para anualizar um rendimento já realizado. É o número de ciclos que
 * caberiam num ano **se todo bloco saísse no tempo mínimo**; rodadas
 * perdidas fazem o ciclo demorar mais, então este é um teto e a tela precisa
 * dizer isso.
 */
export function cyclesPerYear(constants: StakingConstants): number {
  const secondsPerCycle = constants.blocksPerCycle * constants.minimalBlockDelay;
  return (365.25 * 24 * 60 * 60) / secondsPerCycle;
}
