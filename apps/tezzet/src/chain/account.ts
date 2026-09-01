import {
  InvariantViolationError,
  requireMutez,
  requireObject,
  requireString,
  type TzKTHttp,
} from '@tezos-suite/chain';

/**
 * Saldo de uma conta, lido da TzKT.
 *
 * Desde o Adaptive Issuance "saldo" deixou de ser um número. O `balance` da
 * TzKT é o **saldo cheio** (`full_balance` do RPC) e contém três coisas que
 * não se gastam:
 *
 *     balance = gastável + stakedBalance + unstakedBalance + bonds
 *
 * Conferido contra a mainnet em 2026-09-01, `tz1aLq132WVXyh7AmnNiVbWMRDS7rwGatLiQ`:
 *
 *     24 015 668 853 − 20 015 435 724 − 4 000 000 000 = 233 129
 *
 * e `GET /chains/main/blocks/head/context/contracts/{addr}/balance` — o
 * gastável, segundo o próprio nó — devolve exatamente 233 129.
 *
 * A versão anterior deste arquivo fazia `gastável = balance − staked` e
 * esquecia o `unstakedBalance`. Nessa conta ela liberava gastar 4 000 XTZ que
 * a cadeia não deixa mover: a pessoa assinaria e a operação seria recusada.
 * O teste que deveria pegar isso afirmava `total === staked + delegado`, que
 * é a própria definição da linha — verdadeira para qualquer entrada. Hoje a
 * conferência é contra o RPC, que é outra fonte
 * (`test/contract/shadownet.contract.test.ts`).
 */
export interface AccountSnapshot {
  readonly address: string;
  /**
   * `false` quando a TzKT devolve `type: "empty"` — a conta nunca apareceu na
   * cadeia. Isso é uma leitura, não um valor ausente: os zeros abaixo são
   * verdade conhecida, e a interface diz "nunca usada" em vez de "0,000000".
   */
  readonly seenOnChain: boolean;
  /** Saldo cheio. Contém o que está em stake, saindo de stake e em bond. */
  readonly total: bigint;
  /**
   * O que pode financiar uma transferência **agora**. É o único número que a
   * tela de envio pode usar como teto.
   */
  readonly spendable: bigint;
  /** Congelado em stake. Não é gastável. */
  readonly staked: bigint;
  /**
   * Saindo de stake (congelado + finalizável), aguardando finalização. Não é
   * gastável até ser finalizado.
   */
  readonly unstaked: bigint;
  /** Bond de rollup, congelado. Quase sempre zero numa conta de usuário. */
  readonly bonds: bigint;
  /** Baker para quem a conta delega, ou `null` quando não delega. */
  readonly delegate: { readonly address: string; readonly alias?: string } | null;
  /** Quando esta leitura foi feita. Sem isso, valor velho é igual a valor novo. */
  readonly readAt: Date;
  /** Nível que o indexador tinha processado quando respondeu. */
  readonly indexerLevel?: number;
}

const WHERE = '/v1/accounts/{address}';

function parseDelegate(raw: Record<string, unknown>): AccountSnapshot['delegate'] {
  const value = raw['delegate'];
  if (value === undefined || value === null) return null;
  const delegate = requireObject(value, `${WHERE}.delegate`);
  const address = requireString(delegate, 'address', `${WHERE}.delegate`);
  const alias = delegate['alias'];
  return typeof alias === 'string' ? { address, alias } : { address };
}

export async function fetchAccount(
  http: TzKTHttp,
  address: string,
  now: () => Date = () => new Date(),
): Promise<AccountSnapshot> {
  const { body, freshness } = await http.getRequired<Record<string, unknown>>(
    `/v1/accounts/${address}`,
  );
  const raw = requireObject(body, WHERE);
  const type = requireString(raw, 'type', WHERE);
  const readAt = now();
  const indexerLevel = freshness?.level;

  if (type === 'empty') {
    return {
      address,
      seenOnChain: false,
      total: 0n,
      spendable: 0n,
      staked: 0n,
      unstaked: 0n,
      bonds: 0n,
      delegate: null,
      readAt,
      ...(indexerLevel === undefined ? {} : { indexerLevel }),
    };
  }

  // Nenhum destes campos ganha default. Um `|| 0` aqui é o mesmo defeito que
  // fez o TAPS pagar zero a todos os delegadores, em silêncio — e um campo
  // congelado esquecido é o que faz o app liberar gastar o que não existe.
  const total = requireMutez(raw, 'balance', WHERE);
  const staked = requireMutez(raw, 'stakedBalance', WHERE);
  const unstaked = requireMutez(raw, 'unstakedBalance', WHERE);
  const bonds = requireMutez(raw, 'rollupBonds', WHERE) + requireMutez(raw, 'smartRollupBonds', WHERE);

  const frozen = staked + unstaked + bonds;
  if (frozen > total) {
    throw new InvariantViolationError(
      'balance >= stakedBalance + unstakedBalance + bonds',
      `${address}: congelado ${frozen} mutez (stake ${staked}, saindo ${unstaked}, bond ${bonds}) ` +
        `é maior que o saldo cheio ${total} mutez — a divisão não fecha e nenhum dos números pode ser mostrado`,
    );
  }

  return {
    address,
    seenOnChain: true,
    total,
    spendable: total - frozen,
    staked,
    unstaked,
    bonds,
    delegate: parseDelegate(raw),
    readAt,
    ...(indexerLevel === undefined ? {} : { indexerLevel }),
  };
}
