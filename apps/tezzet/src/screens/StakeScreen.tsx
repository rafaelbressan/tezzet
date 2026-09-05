import { useCallback, useState } from 'react';
import { MutezParseError, tezToMutez } from '@tezos-suite/chain';
import { fetchAccount, type AccountSnapshot } from '../chain/account';
import { fetchBaker, NotABakerError, type BakerSnapshot } from '../chain/baker';
import { fetchBakerRecord, type CycleRecord } from '../chain/baker-record';
import { explorerAccountUrl } from '../chain/explorer';
import { readStakingConstants, type StakingConstants } from '../chain/protocol';
import {
  computeUnstakeWait,
  fetchCycleWindow,
  fetchOpenUnstakeRequests,
  finalizableTotal,
  type UnstakeRequest,
  type UnstakeWait,
} from '../chain/unstake';
import { describeFault } from '../lib/faults';
import { formatTimestamp } from '../lib/format';
import type { ChainSession } from '../state/session';
import { useAsync } from '../state/useAsync';
import {
  planFinalize,
  planStake,
  planUnstake,
  StakingValidationError,
  type FinalizePlan,
  type StakePlan,
  type UnstakePlan,
} from '../wallet/staking';
import { BakerCard } from '../ui/baker-card';
import { DelegateVersusStake } from '../ui/difference';
import { OperationReceipt, SentOperation } from '../ui/operation';
import { Address, Amount, EmptyState, Fault, Skeleton } from '../ui/primitives';

/**
 * Stake: congelar valor com o próprio baker, e tirar de volta.
 *
 * Três coisas desta tela existem porque a cadeia é assim e esconder isso
 * custaria dinheiro de quem usa:
 *
 * 1. **Só dá para stakear com o baker para quem a conta já delega.** Sem
 *    delegação não há para quem stakear, e a operação é recusada.
 * 2. **A espera do unstake aparece antes de confirmar**, com a data mais
 *    cedo possível, em ciclos e em dias. Depois de assinar já não é aviso.
 * 3. **O dinheiro não volta sozinho.** Cumprida a espera, ele fica
 *    `finalizável` e precisa de uma segunda operação. Quem não souber disso
 *    vai achar que a cadeia comeu o valor.
 */
type Stage =
  | { readonly kind: 'idle' }
  | { readonly kind: 'reviewing' }
  | { readonly kind: 'review'; readonly plan: PendingPlan }
  | { readonly kind: 'signing'; readonly plan: PendingPlan }
  | {
      readonly kind: 'sent';
      readonly plan: PendingPlan;
      readonly hash: string;
      readonly branchLevel: number;
    };

type PendingPlan =
  | { readonly action: 'stake'; readonly plan: StakePlan }
  | { readonly action: 'unstake'; readonly plan: UnstakePlan; readonly wait: UnstakeWait }
  | { readonly action: 'finalize'; readonly plan: FinalizePlan };

interface StakingView {
  readonly account: AccountSnapshot;
  readonly constants: StakingConstants;
  readonly requests: readonly UnstakeRequest[];
  readonly wait: UnstakeWait;
  readonly baker: BakerSnapshot | null;
  readonly records: readonly CycleRecord[];
}

export function StakeScreen({ session, address }: { session: ChainSession; address: string }) {
  const view = useAsync(() => loadStaking(session, address), [session.network.id, address]);
  const [stakeAmount, setStakeAmount] = useState('');
  const [unstakeAmount, setUnstakeAmount] = useState('');
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [error, setError] = useState<unknown>(null);

  const review = useCallback(
    async (build: () => Promise<PendingPlan>) => {
      setError(null);
      setStage({ kind: 'reviewing' });
      try {
        setStage({ kind: 'review', plan: await build() });
      } catch (cause) {
        setError(cause);
        setStage({ kind: 'idle' });
      }
    },
    [],
  );

  const sign = useCallback(
    async (pending: PendingPlan) => {
      setError(null);
      setStage({ kind: 'signing', plan: pending });
      try {
        const branchLevel = await session.head.getHeadLevel();
        const hash = await send(session, pending);
        setStage({ kind: 'sent', plan: pending, hash, branchLevel });
      } catch (cause) {
        setError(cause);
        setStage({ kind: 'review', plan: pending });
      }
    },
    [session],
  );

  if (view.state.kind === 'idle' || view.state.kind === 'loading') {
    return (
      <section className="panel stack">
        <h2 className="panel__title">Stake</h2>
        <Skeleton width="28ch" label="Situação do stake" />
      </section>
    );
  }

  if (view.state.kind === 'error') {
    return (
      <section className="panel stack">
        <h2 className="panel__title">Stake</h2>
        <Fault
          {...describeFault(
            view.state.error,
            'A situação do stake não foi lida, e sem ela nenhuma operação pode ser montada.',
            view.state.attempts,
          )}
        />
      </section>
    );
  }

  const { account, constants, requests, wait, baker, records } = view.state.value;
  const finalizable = finalizableTotal(requests);
  const delegate = account.delegate?.address ?? null;

  return (
    <section className="panel stack">
      <h2 className="panel__title">Stake</h2>

      <DelegateVersusStake highlight="staking" />

      {stage.kind === 'sent' ? (
        <SentOperation
          session={session}
          hash={stage.hash}
          branchLevel={stage.branchLevel}
          what={describeSigned(stage.plan)}
          cost="A confirmação não foi lida. A operação já foi injetada — confira no explorador antes de assinar de novo."
        />
      ) : (
        <>
          <div className="balance__split">
            <div className="balance__cell">
              <span className="balance__label">Gastável agora</span>
              <span className="balance__value">
                <Amount mutez={account.spendable} />
              </span>
            </div>
            <div className="balance__cell">
              <span className="balance__label">Em stake (congelado)</span>
              <span className="balance__value">
                <Amount mutez={account.staked} />
              </span>
            </div>
            <div className="balance__cell">
              <span className="balance__label">Saindo de stake</span>
              <span className="balance__value">
                <Amount mutez={account.unstaked} />
              </span>
            </div>
          </div>

          {delegate === null ? (
            <EmptyState
              title="Esta conta não delega para ninguém"
              next="Só dá para stakear com o próprio baker. Delegue primeiro, na aba Delegar, e volte aqui depois."
            />
          ) : (
            <p className="note note--strong">
              Stake vai para{' '}
              <Address
                address={delegate}
                href={explorerAccountUrl(session.network, delegate)}
              />
              , que é o baker para quem esta conta delega. A cadeia não deixa escolher outro.
            </p>
          )}

          {baker && (
            <BakerCard
              baker={baker}
              records={records}
              constants={constants}
              network={session.network}
              focus="staking"
            />
          )}

          <UnstakeRequestList
            requests={requests}
            finalizable={finalizable}
            onFinalize={() =>
              void review(async () => ({
                action: 'finalize',
                plan: planFinalize({
                  finalizableMutez: finalizable,
                  spendableMutez: account.spendable,
                  estimate: await session.wallet.estimateFinalizeUnstake(address),
                }),
              }))
            }
            busy={stage.kind === 'reviewing' || stage.kind === 'signing'}
          />

          {delegate !== null && (
            <div className="form">
              <label className="t-field">
                <span className="t-field__label">Congelar em stake, em XTZ</span>
                <input
                  className="t-field__input"
                  value={stakeAmount}
                  inputMode="decimal"
                  autoComplete="off"
                  onChange={(event) => setStakeAmount(event.target.value)}
                  placeholder="0.000000"
                />
                <span className="t-field__hint">
                  Sai do gastável na hora. Para voltar, são duas operações e a espera abaixo.
                </span>
              </label>
              <div className="form__actions">
                <button
                  className="t-button"
                  type="button"
                  disabled={stage.kind === 'reviewing' || stakeAmount.trim() === ''}
                  onClick={() =>
                    void review(async () => {
                      const amountMutez = tezToMutez(stakeAmount);
                      return {
                        action: 'stake',
                        plan: planStake({
                          amountMutez,
                          spendableMutez: account.spendable,
                          currentDelegate: delegate,
                          estimate: await session.wallet.estimateStake(amountMutez, address),
                        }),
                      };
                    })
                  }
                >
                  Revisar o stake
                </button>
              </div>
            </div>
          )}

          {account.staked > 0n && (
            <div className="form">
              <label className="t-field">
                <span className="t-field__label">Tirar do stake, em XTZ</span>
                <input
                  className="t-field__input"
                  value={unstakeAmount}
                  inputMode="decimal"
                  autoComplete="off"
                  onChange={(event) => setUnstakeAmount(event.target.value)}
                  placeholder="0.000000"
                />
                <span className="t-field__hint">
                  Até <Amount mutez={account.staked} /> XTZ, que é o que está congelado hoje.
                </span>
              </label>

              <WaitNotice wait={wait} constants={constants} />

              <div className="form__actions">
                <button
                  className="t-button"
                  type="button"
                  disabled={stage.kind === 'reviewing' || unstakeAmount.trim() === ''}
                  onClick={() =>
                    void review(async () => {
                      const amountMutez = tezToMutez(unstakeAmount);
                      return {
                        action: 'unstake',
                        wait,
                        plan: planUnstake({
                          amountMutez,
                          stakedMutez: account.staked,
                          spendableMutez: account.spendable,
                          estimate: await session.wallet.estimateUnstake(amountMutez, address),
                        }),
                      };
                    })
                  }
                >
                  Revisar a saída
                </button>
              </div>
            </div>
          )}

          {(stage.kind === 'review' || stage.kind === 'signing') && (
            <div className="stack">
              <Review pending={stage.plan} />
              <p className="note note--strong">
                A assinatura acontece na sua carteira. O Tezzet não tem a chave e não pode assinar
                por você.
              </p>
              <div className="form__actions">
                <button
                  className="t-button"
                  type="button"
                  disabled={stage.kind === 'signing'}
                  onClick={() => void sign(stage.plan)}
                >
                  {stage.kind === 'signing' ? 'Aguardando a carteira…' : 'Assinar na carteira'}
                </button>
                <button
                  className="t-button t-button--quiet"
                  type="button"
                  disabled={stage.kind === 'signing'}
                  onClick={() => setStage({ kind: 'idle' })}
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {error !== null && <Fault {...describeStakingFault(error)} />}
    </section>
  );
}

/**
 * A espera, escrita antes de a pessoa apertar qualquer coisa.
 *
 * Em ciclos **e** em dias **e** com a data: quem tem XTZ raciocina em ciclo,
 * quem está decidindo raciocina em dia, e a data é o que dá para conferir
 * depois. Os três números vêm da mesma conta.
 */
function WaitNotice({ wait, constants }: { wait: UnstakeWait; constants: StakingConstants }) {
  return (
    <p className="wait" role="note">
      <strong>
        Depois de assinar, o valor fica preso por {wait.cyclesToWait} ciclos —{' '}
        {formatDays(wait.secondsAtMinimum)} no melhor caso, liberando no ciclo {wait.unlockCycle}, a
        partir de {formatTimestamp(wait.earliestAt)}.
      </strong>{' '}
      São {wait.blocksToWait.toLocaleString('pt-BR')} blocos, contados no tempo mínimo de{' '}
      {constants.minimalBlockDelay} s por bloco; qualquer rodada perdida faz demorar mais, nunca
      menos. Passada a espera, o valor <strong>não volta sozinho</strong>: ele fica finalizável e
      precisa de mais uma operação, que você assina aqui.
    </p>
  );
}

function UnstakeRequestList({
  requests,
  finalizable,
  onFinalize,
  busy,
}: {
  requests: readonly UnstakeRequest[];
  finalizable: bigint;
  onFinalize: () => void;
  busy: boolean;
}) {
  if (requests.length === 0) return null;

  return (
    <div className="stack">
      <h3 className="baker__section">Saídas de stake em andamento</h3>
      <table className="history">
        <thead>
          <tr>
            <th scope="col">Pedido</th>
            <th scope="col">Situação</th>
            <th scope="col">Libera</th>
            <th scope="col" className="history__amount">
              Valor
            </th>
          </tr>
        </thead>
        <tbody>
          {requests.map((request) => (
            <tr key={request.id}>
              <td>
                <span className="t-cycle">{request.cycle}</span>
              </td>
              <td>
                {/* A cor reforça; o texto carrega o significado. Um selo
                    "pendente" ao lado de "liberado" diria as duas coisas. */}
                <span
                  className={
                    request.status === 'finalizable'
                      ? 't-status t-status--paid'
                      : 't-status t-status--pending'
                  }
                >
                  {request.status === 'finalizable' ? 'liberado' : 'esperando'}
                </span>
                {request.status === 'finalizable' && ' · falta finalizar'}
              </td>
              <td>
                <span className="t-cycle">{request.unlockCycle}</span> ·{' '}
                {formatTimestamp(request.unlockAt)}
              </td>
              <td className="history__amount">
                <Amount mutez={request.remaining} />
                {request.slashed > 0n && (
                  <span className="note"> · punição levou {request.slashed.toString()} mutez</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {finalizable > 0n ? (
        <>
          <p className="note note--strong">
            <Amount mutez={finalizable} /> XTZ já cumpriram a espera e estão parados. Eles só voltam
            para o gastável com a operação abaixo — a cadeia não faz isso sozinha.
          </p>
          <div className="form__actions">
            <button className="t-button" type="button" disabled={busy} onClick={onFinalize}>
              Finalizar e trazer de volta
            </button>
          </div>
        </>
      ) : (
        <p className="note">
          Nada liberado ainda. Quando um destes pedidos cumprir a espera, o botão de finalizar
          aparece aqui.
        </p>
      )}
    </div>
  );
}

function Review({ pending }: { pending: PendingPlan }) {
  const cost = pending.plan.cost;
  return (
    <>
      <OperationReceipt
        feeMutez={cost.feeMutez}
        burnMutez={cost.burnMutez}
        gasLimit={cost.gasLimit}
        storageLimit={cost.storageLimit}
      >
        {pending.action === 'stake' && (
          <>
            <p className="receipt__line">
              <span>Congelar em stake</span>
              <Amount mutez={pending.plan.amountMutez} />
            </p>
            <p className="receipt__line">
              <span>Gastável depois</span>
              <Amount mutez={pending.plan.spendableAfterMutez} />
            </p>
          </>
        )}
        {pending.action === 'unstake' && (
          <>
            <p className="receipt__line">
              <span>Tirar do stake</span>
              <Amount mutez={pending.plan.amountMutez} />
            </p>
            <p className="receipt__line">
              <span>Continua em stake</span>
              <Amount mutez={pending.plan.stakedAfterMutez} />
            </p>
          </>
        )}
        {pending.action === 'finalize' && (
          <p className="receipt__line">
            <span>Volta para o gastável</span>
            <Amount mutez={pending.plan.finalizableMutez} />
          </p>
        )}
      </OperationReceipt>

      {pending.action === 'unstake' && (
        <p className="note note--strong">
          Confirmando, este valor fica preso até o ciclo {pending.wait.unlockCycle}, a partir de{' '}
          {formatTimestamp(pending.wait.earliestAt)} — e depois ainda precisa da operação de
          finalizar. Não há como cancelar no meio.
        </p>
      )}
    </>
  );
}

async function loadStaking(session: ChainSession, address: string): Promise<StakingView> {
  const constants = readStakingConstants(await session.constants.get());
  const [account, window, requests] = await Promise.all([
    fetchAccount(session.http, address),
    fetchCycleWindow(session.http),
    fetchOpenUnstakeRequests(session.http, address),
  ]);

  const delegate = account.delegate?.address ?? null;
  const baker = delegate
    ? await fetchBaker(session.http, session.network.endpoints, delegate, constants)
    : null;
  const records = delegate ? await fetchBakerRecord(session.http, delegate, window.cycle) : [];

  return {
    account,
    constants,
    requests,
    wait: computeUnstakeWait(window, constants),
    baker,
    records,
  };
}

function send(session: ChainSession, pending: PendingPlan): Promise<string> {
  switch (pending.action) {
    case 'stake':
      return session.wallet.sendStake(pending.plan.amountMutez);
    case 'unstake':
      return session.wallet.sendUnstake(pending.plan.amountMutez);
    case 'finalize':
      return session.wallet.sendFinalizeUnstake();
  }
}

function describeSigned(pending: PendingPlan): string {
  switch (pending.action) {
    case 'stake':
      return 'Stake assinado. O valor sai do gastável quando a operação entrar em um bloco.';
    case 'unstake':
      return `Saída do stake assinada. Libera no ciclo ${pending.wait.unlockCycle}, e ainda precisa da operação de finalizar.`;
    case 'finalize':
      return 'Finalização assinada. O valor volta para o gastável quando a operação entrar em um bloco.';
  }
}

/** Dias inteiros e horas. "345 600 segundos" não é uma espera que alguém sente. */
function formatDays(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  if (days === 0) return `${hours} h`;
  return restHours === 0 ? `${days} dias` : `${days} dias e ${restHours} h`;
}

function describeStakingFault(error: unknown) {
  if (error instanceof StakingValidationError) {
    return { what: error.message, where: 'conferência antes de assinar', cost: 'Nada foi assinado.' };
  }
  if (error instanceof MutezParseError) {
    return { what: error.message, where: 'valor digitado', cost: 'Nada foi assinado.' };
  }
  if (error instanceof NotABakerError) {
    return {
      what: 'O baker para quem esta conta delega não está mais registrado como baker.',
      where: error.address,
      cost: 'Nada foi assinado. Escolha outro baker na aba Delegar antes de stakear.',
    };
  }
  return describeFault(error, 'Nada foi assinado.');
}
