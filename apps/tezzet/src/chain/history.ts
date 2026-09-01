import { requireInteger, requireObject, requireString, type TzKTHttp } from '@tezos-suite/chain';
import { FieldTypeError, requireMutez } from '@tezos-suite/chain';

/**
 * Histórico de operações, via TzKT, com paginação de cursor.
 *
 * Paginação por `offset` reordena quando chega operação nova entre duas
 * páginas: a última linha da página 1 reaparece como primeira da página 2, ou
 * some. `lastId` é o id da última linha lida e não se move — a TzKT devolve o
 * que vem estritamente depois dele. Uma página que volta cheia não prova que
 * acabou; a lista fecha quando volta mais curta que o limite pedido.
 */

/** Tipos que uma carteira de usuário mostra. Um baker tem outra tela. */
export const WALLET_OPERATION_TYPES = [
  'transaction',
  'delegation',
  'origination',
  'reveal',
  'staking',
] as const;

export type OperationDirection = 'in' | 'out' | 'self' | 'none';

export interface HistoryEntry {
  /** Cursor da TzKT. É o que a próxima página usa como `lastId`. */
  readonly id: number;
  readonly type: string;
  readonly hash: string;
  readonly level: number;
  readonly timestamp: Date;
  /** `applied`, `failed`, `backtracked`, `skipped` — como a cadeia disse. */
  readonly status: string;
  readonly sender: string | null;
  readonly target: string | null;
  readonly direction: OperationDirection;
  /**
   * Valor movido, em mutez. `null` quando a operação não move valor (um
   * `reveal`, por exemplo). Nunca `0n` para dizer "não sei": zero é um valor
   * que alguém leu.
   */
  readonly amount: bigint | null;
  /** Taxa paga ao baker, quando a conta é quem pagou. */
  readonly bakerFee: bigint | null;
}

export interface HistoryPage {
  readonly entries: readonly HistoryEntry[];
  /** `lastId` para a próxima chamada, ou `null` quando a lista fechou. */
  readonly nextCursor: number | null;
  readonly readAt: Date;
  readonly indexerLevel?: number;
}

function optionalAddress(raw: Record<string, unknown>, field: string, where: string): string | null {
  const value = raw[field];
  if (value === undefined || value === null) return null;
  const party = requireObject(value, `${where}.${field}`);
  return requireString(party, 'address', `${where}.${field}`);
}

function optionalMutez(raw: Record<string, unknown>, field: string, where: string): bigint | null {
  const value = raw[field];
  if (value === undefined || value === null) return null;
  return requireMutez(raw, field, where);
}

function direction(sender: string | null, target: string | null, address: string): OperationDirection {
  const fromMe = sender === address;
  const toMe = target === address;
  if (fromMe && toMe) return 'self';
  if (fromMe) return 'out';
  if (toMe) return 'in';
  return 'none';
}

function parseEntry(raw: unknown, index: number, address: string): HistoryEntry {
  const where = `/v1/accounts/${address}/operations[${index}]`;
  const operation = requireObject(raw, where);
  const timestampRaw = requireString(operation, 'timestamp', where);
  const timestamp = new Date(timestampRaw);
  if (Number.isNaN(timestamp.getTime())) {
    throw new FieldTypeError('timestamp', where, 'uma data ISO 8601', timestampRaw);
  }
  const sender = optionalAddress(operation, 'sender', where);
  const target = optionalAddress(operation, 'target', where);

  return {
    id: requireInteger(operation, 'id', where),
    type: requireString(operation, 'type', where),
    hash: requireString(operation, 'hash', where),
    level: requireInteger(operation, 'level', where),
    timestamp,
    status: requireString(operation, 'status', where),
    sender,
    target,
    direction: direction(sender, target, address),
    amount: optionalMutez(operation, 'amount', where),
    bakerFee: optionalMutez(operation, 'bakerFee', where),
  };
}

export interface FetchHistoryOptions {
  /** Página. A TzKT aceita até 10 000; 50 é o que cabe numa tela sem mentir. */
  readonly limit?: number;
  /** Id da última linha já lida. Ausente = começo da lista. */
  readonly cursor?: number | null;
  readonly types?: readonly string[];
  readonly now?: () => Date;
}

export async function fetchHistoryPage(
  http: TzKTHttp,
  address: string,
  options: FetchHistoryOptions = {},
): Promise<HistoryPage> {
  const limit = options.limit ?? 50;
  const query: Record<string, string | number> = {
    limit,
    'sort.desc': 'id',
    type: (options.types ?? WALLET_OPERATION_TYPES).join(','),
  };
  if (options.cursor !== undefined && options.cursor !== null) {
    query['lastId'] = options.cursor;
  }

  const { body, freshness } = await http.get<unknown[]>(
    `/v1/accounts/${address}/operations`,
    query,
  );
  const rows = body ?? [];
  if (!Array.isArray(rows)) {
    throw new FieldTypeError(
      '(corpo)',
      `/v1/accounts/${address}/operations`,
      'uma lista de operações',
      rows,
    );
  }

  const entries = rows.map((row, index) => parseEntry(row, index, address));
  const last = entries.at(-1);
  const readAt = (options.now ?? (() => new Date()))();
  const indexerLevel = freshness?.level;

  return {
    entries,
    // Página mais curta que o limite pedido é o único sinal de fim que a TzKT
    // dá. Página cheia pode ser a última — só a próxima chamada decide.
    nextCursor: entries.length < limit || last === undefined ? null : last.id,
    readAt,
    ...(indexerLevel === undefined ? {} : { indexerLevel }),
  };
}
