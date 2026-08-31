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
 * Desde o Adaptive Issuance "saldo" deixou de ser um número. O que está em
 * stake não é gastável e conta com peso cheio para o baker; o que está
 * delegado é gastável e conta com peso reduzido; o que está saindo de stake
 * não é nem um nem outro até ser finalizado. Mostrar um número só esconde
 * exatamente a parte que o usuário precisa decidir.
 *
 * A relação `balance = stakedBalance + delegado` foi conferida contra dado
 * real da TzKT em 2026-08-31 (tz1fwnfJNgiDACshK9avfRfFbMaXrs3ghoJa:
 * 235999207943 − 235795238232 = 203969711 = ownDelegatedBalance). Ela é
 * checada em execução: se não valer, o app levanta em vez de mostrar um
 * número que ninguém conferiu.
 */
export interface AccountSnapshot {
  readonly address: string;
  /**
   * `false` quando a TzKT devolve `type: "empty"` — a conta nunca apareceu na
   * cadeia. Isso é uma leitura, não um valor ausente: os zeros abaixo são
   * verdade conhecida, e a interface diz "nunca usada" em vez de "0,000000".
   */
  readonly seenOnChain: boolean;
  /** Saldo total. Inclui o que está em stake. */
  readonly total: bigint;
  /** Congelado em stake. Não é gastável. */
  readonly staked: bigint;
  /** Saindo de stake, aguardando finalização. Não é gastável nem delegado. */
  readonly unstaked: bigint;
  /** `total − staked`: a parte líquida, que é a que delega. */
  readonly delegated: bigint;
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
      staked: 0n,
      unstaked: 0n,
      delegated: 0n,
      delegate: null,
      readAt,
      ...(indexerLevel === undefined ? {} : { indexerLevel }),
    };
  }

  // Nenhum destes campos ganha default. Um `|| 0` aqui é o mesmo defeito que
  // fez o TAPS pagar zero a todos os delegadores, em silêncio.
  const total = requireMutez(raw, 'balance', WHERE);
  const staked = requireMutez(raw, 'stakedBalance', WHERE);
  const unstaked = requireMutez(raw, 'unstakedBalance', WHERE);

  if (staked > total) {
    throw new InvariantViolationError(
      'balance >= stakedBalance',
      `${address}: balance ${total} mutez é menor que stakedBalance ${staked} mutez — ` +
        'a divisão entre stake e delegação não fecha e nenhum dos dois números pode ser mostrado',
    );
  }

  return {
    address,
    seenOnChain: true,
    total,
    staked,
    unstaked,
    delegated: total - staked,
    delegate: parseDelegate(raw),
    readAt,
    ...(indexerLevel === undefined ? {} : { indexerLevel }),
  };
}
