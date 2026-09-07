import { assertPayableAddress } from '@tezos-suite/chain';
import { formatXtz } from '../lib/format';
import type { TransferEstimate } from './transfer';

/**
 * As contas de delegar e de stakear, antes de qualquer assinatura.
 *
 * Delegar e stakear são coisas diferentes e a diferença aparece aqui, no
 * tipo, antes de aparecer na tela:
 *
 * - **Delegar não move dinheiro.** O saldo continua gastável e continua seu;
 *   você só aponta para quem usa o peso dele. Custa a taxa da operação.
 * - **Stakear congela dinheiro.** O valor sai do gastável, entra em stake, e
 *   só volta passando pela espera do `unstake` — e depois por uma segunda
 *   operação para virar gastável de novo.
 *
 * Nenhuma das duas manda chave para lugar nenhum: quem assina é a carteira.
 */

export class StakingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StakingValidationError';
  }
}

/** Custo de uma operação que não move valor: só a taxa da rede. */
export interface OperationCost {
  readonly feeMutez: bigint;
  readonly burnMutez: bigint;
  readonly totalMutez: bigint;
  readonly remainingMutez: bigint;
  readonly gasLimit: number;
  readonly storageLimit: number;
}

function costOf(estimate: TransferEstimate, spendableMutez: bigint, what: string): OperationCost {
  const { feeMutez, burnMutez } = estimate;
  if (feeMutez < 0n || burnMutez < 0n) {
    throw new StakingValidationError(
      `a estimativa de ${what} voltou negativa: taxa ${feeMutez} mutez, alocação ${burnMutez} mutez`,
    );
  }
  const totalMutez = feeMutez + burnMutez;
  if (totalMutez > spendableMutez) {
    throw new StakingValidationError(
      `faltam ${formatXtz(totalMutez - spendableMutez)} XTZ para pagar ${what}: ` +
        `a operação custa ${formatXtz(totalMutez)} XTZ e o gastável é ${formatXtz(spendableMutez)} XTZ ` +
        '(o que está em stake ou saindo de stake não paga taxa)',
    );
  }
  return {
    feeMutez,
    burnMutez,
    totalMutez,
    remainingMutez: spendableMutez - totalMutez,
    gasLimit: estimate.gasLimit,
    storageLimit: estimate.storageLimit,
  };
}

/**
 * O que decide se a delegação pode acontecer — **sem nenhum número de custo**.
 *
 * Esta parte está separada porque ela é conferível antes de falar com a rede,
 * e o custo não é. Estimar primeiro entrega a recusa para a cadeia, que
 * responde com o id cru do protocolo em vez da frase que já está escrita
 * aqui embaixo.
 */
export interface DelegationCheck {
  /** Para quem passar a delegar. `null` = parar de delegar. */
  readonly baker: string | null;
  /** Para quem a conta delega hoje, lido da cadeia. `null` = não delega. */
  readonly currentDelegate: string | null;
}

export interface DelegationRequest extends DelegationCheck {
  readonly spendableMutez: bigint;
  readonly estimate: TransferEstimate;
}

/**
 * Tudo que reprova uma delegação sem custar uma chamada de rede.
 *
 * Chame **antes** de estimar. `planDelegation` chama de novo, porque a
 * garantia é do domínio e não da ordem em que uma tela resolveu fazer as
 * coisas.
 */
export function checkDelegation(request: DelegationCheck): void {
  if (request.baker === null) {
    if (request.currentDelegate === null) {
      throw new StakingValidationError(
        'esta conta já não delega para ninguém — não há o que parar, e a operação ' +
          'só gastaria a taxa',
      );
    }
    return;
  }

  assertPayableAddress(request.baker);
  if (request.baker.startsWith('KT1')) {
    throw new StakingValidationError(
      `${request.baker} é um contrato, e um contrato não pode ser baker — ` +
        'um baker é sempre uma conta tz1, tz2, tz3 ou tz4',
    );
  }
  if (request.baker === request.currentDelegate) {
    throw new StakingValidationError(
      'esta conta já delega para este baker; assinar de novo só gastaria a taxa',
    );
  }
}

export interface DelegationPlan {
  readonly kind: 'delegate' | 'undelegate';
  readonly baker: string | null;
  readonly previousDelegate: string | null;
  readonly cost: OperationCost;
}

export function planDelegation(request: DelegationRequest): DelegationPlan {
  checkDelegation(request);

  if (request.baker === null) {
    return {
      kind: 'undelegate',
      baker: null,
      previousDelegate: request.currentDelegate,
      cost: costOf(request.estimate, request.spendableMutez, 'parar de delegar'),
    };
  }

  return {
    kind: 'delegate',
    baker: request.baker,
    previousDelegate: request.currentDelegate,
    cost: costOf(request.estimate, request.spendableMutez, 'a delegação'),
  };
}

/** A mesma separação da delegação: o que reprova sem custo, longe do custo. */
export interface StakeCheck {
  readonly amountMutez: bigint;
  /**
   * Para quem a conta delega. O protocolo só aceita stake para o próprio
   * baker: sem delegação não há para quem stakear, e a operação é recusada.
   */
  readonly currentDelegate: string | null;
  /**
   * `limit_of_staking_over_baking_millionth` do baker: quanto stake de
   * terceiros ele aceita, em milionésimos do stake próprio dele. **Zero
   * significa que ele não aceita nenhum**, e a cadeia recusa a operação com
   * `staking_to_delegate_that_refuses_external_staking`.
   *
   * Não confundir com o espaço livre de stake: quando o limite é maior que
   * zero e o espaço acabou, a cadeia **aceita** e conta o excedente como
   * delegação — rende menos, mas não é recusa, e por isso é aviso e não
   * bloqueio.
   */
  readonly bakerStakingLimitMillionth: bigint;
}

export interface StakeRequest extends StakeCheck {
  readonly spendableMutez: bigint;
  readonly estimate: TransferEstimate;
}

/**
 * Tudo que reprova um stake sem custar uma chamada de rede.
 *
 * Devolve a garantia no tipo (`asserts`) para que quem chamar não precise
 * conferir de novo o delegado só para convencer o compilador.
 */
export function checkStake(
  request: StakeCheck,
): asserts request is StakeCheck & { readonly currentDelegate: string } {
  if (request.currentDelegate === null) {
    throw new StakingValidationError(
      'esta conta não delega para nenhum baker, e só dá para stakear com o próprio ' +
        'baker — delegue primeiro, e stakeie depois',
    );
  }
  if (request.bakerStakingLimitMillionth === 0n) {
    throw new StakingValidationError(
      'este baker não aceita stake de terceiros: o limite dele é zero, e a cadeia ' +
        'recusaria a operação — delegar para ele continua valendo, mas para stakear ' +
        'é preciso trocar de baker',
    );
  }
  if (request.amountMutez <= 0n) {
    throw new StakingValidationError(
      `o valor precisa ser maior que zero (veio ${request.amountMutez} mutez)`,
    );
  }
}

export interface StakePlan {
  readonly amountMutez: bigint;
  readonly baker: string;
  readonly cost: OperationCost;
  /** Gastável depois de congelar o valor **e** pagar a taxa. */
  readonly spendableAfterMutez: bigint;
}

export function planStake(request: StakeRequest): StakePlan {
  checkStake(request);

  const cost = costOf(request.estimate, request.spendableMutez, 'o stake');
  const totalMutez = request.amountMutez + cost.totalMutez;
  if (totalMutez > request.spendableMutez) {
    throw new StakingValidationError(
      `faltam ${formatXtz(totalMutez - request.spendableMutez)} XTZ: congelar ` +
        `${formatXtz(request.amountMutez)} XTZ custa ${formatXtz(totalMutez)} XTZ com a taxa de ` +
        `${formatXtz(cost.feeMutez)}, e o gastável é ${formatXtz(request.spendableMutez)} XTZ`,
    );
  }

  return {
    amountMutez: request.amountMutez,
    baker: request.currentDelegate,
    cost,
    spendableAfterMutez: request.spendableMutez - totalMutez,
  };
}

export interface UnstakeRequestPlanInput {
  readonly amountMutez: bigint;
  /** O que está congelado em stake hoje. É o teto do que pode sair. */
  readonly stakedMutez: bigint;
  readonly spendableMutez: bigint;
  readonly estimate: TransferEstimate;
}

export interface UnstakePlan {
  readonly amountMutez: bigint;
  readonly stakedAfterMutez: bigint;
  readonly cost: OperationCost;
}

export function planUnstake(request: UnstakeRequestPlanInput): UnstakePlan {
  if (request.amountMutez <= 0n) {
    throw new StakingValidationError(
      `o valor precisa ser maior que zero (veio ${request.amountMutez} mutez)`,
    );
  }
  if (request.amountMutez > request.stakedMutez) {
    throw new StakingValidationError(
      `só há ${formatXtz(request.stakedMutez)} XTZ em stake, e o pedido é de ` +
        `${formatXtz(request.amountMutez)} XTZ`,
    );
  }

  return {
    amountMutez: request.amountMutez,
    stakedAfterMutez: request.stakedMutez - request.amountMutez,
    // A taxa sai do gastável, não do stake: sem gastável não dá para sair do
    // stake, e descobrir isso depois de assinar é o pior momento.
    cost: costOf(request.estimate, request.spendableMutez, 'a saída do stake'),
  };
}

export interface FinalizeRequest {
  /** O que já cumpriu a espera e está esperando esta operação. */
  readonly finalizableMutez: bigint;
  readonly spendableMutez: bigint;
  readonly estimate: TransferEstimate;
}

export interface FinalizePlan {
  readonly finalizableMutez: bigint;
  readonly cost: OperationCost;
  readonly spendableAfterMutez: bigint;
}

export function planFinalize(request: FinalizeRequest): FinalizePlan {
  if (request.finalizableMutez <= 0n) {
    throw new StakingValidationError(
      'não há nada liberado para finalizar — o que saiu do stake ainda está cumprindo a espera',
    );
  }
  const cost = costOf(request.estimate, request.spendableMutez, 'a finalização');
  return {
    finalizableMutez: request.finalizableMutez,
    cost,
    spendableAfterMutez: request.spendableMutez - cost.totalMutez + request.finalizableMutez,
  };
}
