import { useCallback, useEffect, useState } from 'react';
import { fetchHistoryPage, type HistoryEntry } from '../chain/history';
import { explorerOperationUrl } from '../chain/explorer';
import { formatTimestamp } from '../lib/format';
import { describeFault } from '../lib/faults';
import type { ChainSession } from '../state/session';
import {
  Address,
  Amount,
  EmptyState,
  ExternalLink,
  Fault,
  ReadAt,
  Skeleton,
  StatusBadge,
} from '../ui/primitives';

const PAGE_SIZE = 25;

/**
 * Histórico com paginação de verdade: cursor `lastId`, e o fim da lista é a
 * TzKT que diz. Um "carregar mais" que some sem explicação é pior do que um
 * botão que continua lá — enquanto houver cursor, há mais para ler.
 */
export function HistoryScreen({ session, address }: { session: ChainSession; address: string }) {
  const [entries, setEntries] = useState<readonly HistoryEntry[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [finished, setFinished] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [attempts, setAttempts] = useState(0);
  const [readAt, setReadAt] = useState<Date | null>(null);
  const [indexerLevel, setIndexerLevel] = useState<number | undefined>(undefined);

  const loadPage = useCallback(
    async (from: number | null, replace: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const page = await fetchHistoryPage(session.http, address, {
          limit: PAGE_SIZE,
          cursor: from,
        });
        setEntries((current) => (replace ? page.entries : [...current, ...page.entries]));
        setCursor(page.nextCursor);
        setFinished(page.nextCursor === null);
        setReadAt(page.readAt);
        setIndexerLevel(page.indexerLevel);
        setAttempts(0);
      } catch (cause) {
        setError(cause);
        setAttempts((value) => value + 1);
      } finally {
        setLoading(false);
      }
    },
    [session, address],
  );

  useEffect(() => {
    setEntries([]);
    setCursor(null);
    setFinished(false);
    void loadPage(null, true);
  }, [loadPage]);

  return (
    <section className="panel">
      <div className="row row--between">
        <h2 className="panel__title">Histórico</h2>
        {readAt && <ReadAt at={readAt} indexerLevel={indexerLevel} />}
      </div>

      {error !== null && <Fault {...describeFault(error, 'O histórico', attempts)} />}

      {entries.length === 0 && loading && <Skeleton width="30ch" label="Histórico" />}

      {entries.length === 0 && !loading && error === null && (
        <EmptyState
          title="Nenhuma operação ainda"
          next="A primeira aparece aqui assim que a conta receber ou enviar XTZ. O indexador leva alguns segundos depois do bloco."
        />
      )}

      {entries.length > 0 && (
        <table className="history">
          <thead>
            <tr>
              <th scope="col">Quando</th>
              <th scope="col">O quê</th>
              <th scope="col">Com quem</th>
              <th scope="col">Situação</th>
              <th scope="col" className="history__amount">
                Valor
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>
                  {formatTimestamp(entry.timestamp)}
                  <br />
                  <ExternalLink href={explorerOperationUrl(session.network, entry.hash)}>
                    <span className="t-ophash">{entry.hash.slice(0, 10)}…</span>
                  </ExternalLink>
                </td>
                <td>{describeType(entry)}</td>
                <td>{counterparty(entry)}</td>
                <td>
                  <StatusBadge status={entry.status} />
                </td>
                <td className="history__amount">
                  {entry.amount === null ? (
                    // Operação que não move valor. Um "0,000000" aqui seria um
                    // número que ninguém leu.
                    <span className="note">—</span>
                  ) : (
                    <>
                      {entry.direction === 'out' ? '−' : entry.direction === 'in' ? '+' : ''}
                      <Amount mutez={entry.amount} />
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="form__actions">
        {!finished && (
          <button
            className="t-button t-button--quiet"
            type="button"
            disabled={loading}
            onClick={() => void loadPage(cursor, false)}
          >
            {loading ? 'Lendo…' : 'Carregar mais'}
          </button>
        )}
        {finished && entries.length > 0 && (
          <span className="note">Fim da lista — {entries.length} operações lidas.</span>
        )}
      </div>
    </section>
  );
}

const TYPE_LABEL: Record<string, string> = {
  transaction: 'Transferência',
  delegation: 'Delegação',
  origination: 'Origination',
  reveal: 'Revelação de chave',
  staking: 'Staking',
};

function describeType(entry: HistoryEntry): string {
  const label = TYPE_LABEL[entry.type] ?? entry.type;
  if (entry.type !== 'transaction') return label;
  return entry.direction === 'in' ? 'Recebido' : entry.direction === 'out' ? 'Enviado' : label;
}

function counterparty(entry: HistoryEntry) {
  const other = entry.direction === 'in' ? entry.sender : entry.target;
  if (!other) return <span className="note">—</span>;
  return <Address address={other} />;
}
