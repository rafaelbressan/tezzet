import { fetchAccount } from '../chain/account';
import { explorerAccountUrl } from '../chain/explorer';
import { describeFault } from '../lib/faults';
import type { ChainSession } from '../state/session';
import { useAsync } from '../state/useAsync';
import { Address, Amount, EmptyState, Fault, ReadAt, Skeleton } from '../ui/primitives';

/**
 * Saldo, dividido.
 *
 * Desde o Adaptive Issuance o saldo cheio contém três coisas que não se
 * gastam — o que está em stake, o que está saindo de stake e o que está em
 * bond. Mostrar um número só esconde exatamente a parte que decide o que a
 * pessoa pode fazer agora, e foi assim que a versão anterior deste app
 * liberou gastar 4 000 XTZ que a cadeia não deixa mover.
 *
 * As quatro linhas somam o total, e a soma é conferida em `fetchAccount`.
 */
export function BalanceScreen({ session, address }: { session: ChainSession; address: string }) {
  const { state, reload } = useAsync(
    () => fetchAccount(session.http, address),
    [session.network.id, address],
  );

  return (
    <section className="panel">
      <div className="row row--between">
        <h2 className="panel__title">Saldo</h2>
        <button className="t-button t-button--quiet" type="button" onClick={reload}>
          Ler de novo
        </button>
      </div>

      {(state.kind === 'idle' || state.kind === 'loading') && (
        <div className="stack">
          <Skeleton width="16ch" label="Saldo total" />
          <div className="balance__split">
            <div className="balance__cell">
              <span className="balance__label">Gastável</span>
              <Skeleton width="12ch" label="Saldo gastável" />
            </div>
            <div className="balance__cell">
              <span className="balance__label">Em stake</span>
              <Skeleton width="12ch" label="Saldo em stake" />
            </div>
          </div>
        </div>
      )}

      {state.kind === 'error' && (
        <Fault {...describeFault(state.error, 'O saldo não foi lido.', state.attempts)} />
      )}

      {state.kind === 'ready' && !state.value.seenOnChain && (
        <EmptyState
          title="Esta conta ainda não existe na cadeia"
          next="Ela passa a existir na primeira vez que receber XTZ. Até lá não há saldo para ler — não é zero, é ausência de conta."
        />
      )}

      {state.kind === 'ready' && state.value.seenOnChain && (
        <div className="stack">
          <div className="row row--between">
            <span className="balance__total">
              <Amount mutez={state.value.total} />
            </span>
            <ReadAt at={state.value.readAt} indexerLevel={state.value.indexerLevel} />
          </div>

          <div className="balance__split">
            <div className="balance__cell">
              <span className="balance__label">Gastável agora</span>
              <span className="balance__value">
                <Amount mutez={state.value.spendable} />
              </span>
            </div>
            <div className="balance__cell">
              <span className="balance__label">Em stake (congelado)</span>
              <span className="balance__value">
                <Amount mutez={state.value.staked} />
              </span>
            </div>
            {state.value.unstaked > 0n && (
              <div className="balance__cell">
                <span className="balance__label">Saindo de stake</span>
                <span className="balance__value">
                  <Amount mutez={state.value.unstaked} />
                </span>
              </div>
            )}
            {state.value.bonds > 0n && (
              <div className="balance__cell">
                <span className="balance__label">Em bond de rollup</span>
                <span className="balance__value">
                  <Amount mutez={state.value.bonds} />
                </span>
              </div>
            )}
          </div>

          <p className="note">
            Só o gastável paga uma transferência. O que está em stake
            {state.value.unstaked > 0n ? ' e o que está saindo de stake' : ''} está congelado na
            cadeia
            {state.value.unstaked > 0n ? ' até a finalização' : ''}, e as parcelas acima somam o
            total.
          </p>

          <p className="note">
            {state.value.delegate ? (
              <>
                Delegando para{' '}
                <Address
                  address={state.value.delegate.address}
                  href={explorerAccountUrl(session.network, state.value.delegate.address)}
                />
                {state.value.delegate.alias ? ` (${state.value.delegate.alias})` : ''}.
              </>
            ) : (
              'Esta conta não delega para nenhum baker. Delegação e staking são a próxima onda.'
            )}
          </p>
        </div>
      )}
    </section>
  );
}
