import { useCallback, useState } from 'react';
import { fetchAccount, type AccountSnapshot } from '../chain/account';
import {
  BakerNotIndexedError,
  fetchBaker,
  NotABakerError,
  type BakerSnapshot,
} from '../chain/baker';
import { fetchBakerRecord, type CycleRecord } from '../chain/baker-record';
import { explorerAccountUrl } from '../chain/explorer';
import { readStakingConstants, type StakingConstants } from '../chain/protocol';
import { fetchCycleWindow } from '../chain/unstake';
import { describeFault } from '../lib/faults';
import type { ChainSession } from '../state/session';
import { useAsync } from '../state/useAsync';
import {
  checkDelegation,
  planDelegation,
  StakingValidationError,
  type DelegationPlan,
} from '../wallet/staking';
import { BakerCard } from '../ui/baker-card';
import { DelegateVersusStake } from '../ui/difference';
import { OperationReceipt, SentOperation } from '../ui/operation';
import { Address, Fault, Skeleton } from '../ui/primitives';

/**
 * Delegar, trocar de baker e parar de delegar — sem custódia.
 *
 * Delegar é a ação econômica central de quem tem XTZ, e é também a mais
 * incompreendida: **nada sai da conta.** O saldo continua gastável e continua
 * seu; o baker só usa o peso dele para produzir blocos, e paga por fora, do
 * jeito dele. Essa última parte é a que a tela precisa dizer alto, porque é a
 * parte que a cadeia não garante.
 *
 * Não há lista de bakers aqui, por decisão (`suite/JOURNEY.md` §6.4). A
 * pessoa traz um endereço e vê os números dele.
 */
type Stage =
  | { readonly kind: 'idle' }
  | { readonly kind: 'reviewing' }
  | { readonly kind: 'review'; readonly plan: DelegationPlan }
  | { readonly kind: 'signing'; readonly plan: DelegationPlan }
  | {
      readonly kind: 'sent';
      readonly plan: DelegationPlan;
      readonly hash: string;
      readonly branchLevel: number;
    };

interface BakerView {
  readonly baker: BakerSnapshot;
  readonly records: readonly CycleRecord[];
  readonly constants: StakingConstants;
}

export function DelegateScreen({ session, address }: { session: ChainSession; address: string }) {
  const account = useAsync(
    () => fetchAccount(session.http, address),
    [session.network.id, address],
  );

  const [typed, setTyped] = useState('');
  const [looked, setLooked] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [error, setError] = useState<unknown>(null);

  const view = useAsync<BakerView | null>(
    looked === null ? null : () => loadBaker(session, looked),
    [session.network.id, looked],
  );

  const current = account.state.kind === 'ready' ? account.state.value : null;
  const shown = view.state.kind === 'ready' ? view.state.value : null;

  const review = useCallback(
    async (baker: string | null, snapshot: AccountSnapshot) => {
      setError(null);
      setStage({ kind: 'reviewing' });
      try {
        const currentDelegate = snapshot.delegate?.address ?? null;
        // Antes de estimar, não depois: a estimativa fala com o nó e o nó
        // recusa primeiro, com o id cru do protocolo. A frase em português já
        // existe — o que faltava era chegar nela antes da rede.
        checkDelegation({ baker, currentDelegate });
        const estimate = await session.wallet.estimateSetDelegate(baker, address);
        setStage({
          kind: 'review',
          plan: planDelegation({
            baker,
            currentDelegate,
            spendableMutez: snapshot.spendable,
            estimate,
          }),
        });
      } catch (cause) {
        setError(cause);
        setStage({ kind: 'idle' });
      }
    },
    [session, address],
  );

  const sign = useCallback(
    async (plan: DelegationPlan) => {
      setError(null);
      setStage({ kind: 'signing', plan });
      try {
        // Lido antes de injetar: sem ele "não achei a operação" nunca vira
        // "ela nunca entrou", e reenviar viraria adivinhação.
        const branchLevel = await session.head.getHeadLevel();
        const hash = await session.wallet.sendSetDelegate(plan.baker);
        setStage({ kind: 'sent', plan, hash, branchLevel });
      } catch (cause) {
        setError(cause);
        setStage({ kind: 'review', plan });
      }
    },
    [session],
  );

  return (
    <section className="panel stack">
      <h2 className="panel__title">Delegar</h2>

      <DelegateVersusStake highlight="delegating" />

      <p className="note note--strong">
        Delegar <strong>não tira dinheiro da sua conta</strong>. O saldo continua gastável e
        continua seu; o baker só passa a contar o peso dele para produzir blocos. O que ele te paga
        por isso, e quando, é combinação dele — não é regra da cadeia.
      </p>

      {(account.state.kind === 'idle' || account.state.kind === 'loading') && (
        <Skeleton width="24ch" label="Delegação atual" />
      )}

      {account.state.kind === 'error' && (
        <Fault
          {...describeFault(
            account.state.error,
            'A delegação atual não foi lida, e sem ela não dá para saber se isto seria uma troca.',
            account.state.attempts,
          )}
        />
      )}

      {current && (
        <p className="note note--strong">
          {current.delegate ? (
            <>
              Hoje esta conta delega para{' '}
              <Address
                address={current.delegate.address}
                href={explorerAccountUrl(session.network, current.delegate.address)}
              />
              {current.delegate.alias ? ` (${current.delegate.alias})` : ''}. Delegar para outro
              baker troca — não acumula.
            </>
          ) : (
            'Hoje esta conta não delega para ninguém. Enquanto não delegar, o saldo dela não produz nada.'
          )}
        </p>
      )}

      {stage.kind === 'sent' ? (
        <SentOperation
          session={session}
          hash={stage.hash}
          branchLevel={stage.branchLevel}
          what={
            stage.plan.kind === 'undelegate'
              ? 'Pedido de parar de delegar assinado.'
              : `Delegação para ${stage.plan.baker} assinada.`
          }
          cost="A confirmação não foi lida. A operação já foi injetada — confira no explorador antes de assinar de novo."
        />
      ) : (
        <>
          <div className="form">
            <label className="t-field">
              <span className="t-field__label">Endereço do baker</span>
              <input
                className="t-field__input"
                value={typed}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => setTyped(event.target.value)}
                placeholder="tz1…"
              />
              <span className="t-field__hint">
                O Tezzet não sugere baker nenhum. Traga o endereço e veja os números dele.
              </span>
            </label>

            <div className="form__actions">
              <button
                className="t-button"
                type="button"
                disabled={typed.trim() === ''}
                onClick={() => {
                  setError(null);
                  setStage({ kind: 'idle' });
                  setLooked(typed.trim());
                }}
              >
                Ver este baker
              </button>
              {current?.delegate && (
                <button
                  className="t-button t-button--quiet"
                  type="button"
                  disabled={stage.kind === 'reviewing' || stage.kind === 'signing'}
                  onClick={() => void review(null, current)}
                >
                  Parar de delegar
                </button>
              )}
            </div>
          </div>

          {(view.state.kind === 'loading' || view.state.kind === 'idle') && looked !== null && (
            <Skeleton width="32ch" label="Dados do baker" />
          )}

          {view.state.kind === 'error' && (
            <Fault
              {...describeBakerFault(view.state.error, view.state.attempts)}
            />
          )}

          {shown && current && (
            <>
              <BakerCard
                baker={shown.baker}
                records={shown.records}
                constants={shown.constants}
                network={session.network}
                focus="delegating"
              />
              {current.delegate?.address === shown.baker.address ? (
                <p className="note note--strong">
                  <strong>Este já é o baker desta conta.</strong> Não há o que trocar: assinar de
                  novo pagaria a taxa e deixaria tudo como está. Para trocar, informe o endereço de
                  outro baker acima.
                </p>
              ) : (
                <div className="form__actions">
                  <button
                    className="t-button"
                    type="button"
                    disabled={stage.kind === 'reviewing' || stage.kind === 'signing'}
                    onClick={() => void review(shown.baker.address, current)}
                  >
                    {stage.kind === 'reviewing'
                      ? 'Estimando na rede…'
                      : current.delegate
                        ? 'Trocar para este baker'
                        : 'Delegar para este baker'}
                  </button>
                </div>
              )}
            </>
          )}

          {(stage.kind === 'review' || stage.kind === 'signing') && (
            <div className="stack">
              <OperationReceipt
                feeMutez={stage.plan.cost.feeMutez}
                burnMutez={stage.plan.cost.burnMutez}
                gasLimit={stage.plan.cost.gasLimit}
                storageLimit={stage.plan.cost.storageLimit}
              >
                <p className="receipt__line">
                  <span>{stage.plan.kind === 'undelegate' ? 'Parar de delegar para' : 'Delegar para'}</span>
                  <span className="t-address">
                    {stage.plan.kind === 'undelegate' ? stage.plan.previousDelegate : stage.plan.baker}
                  </span>
                </p>
                {stage.plan.kind === 'delegate' && stage.plan.previousDelegate !== null && (
                  <p className="receipt__line">
                    <span>Deixa de delegar para</span>
                    <span className="t-address">{stage.plan.previousDelegate}</span>
                  </p>
                )}
              </OperationReceipt>

              <p className="note note--strong">
                Nenhum XTZ sai da conta nesta operação — só a taxa acima. A assinatura acontece na
                sua carteira; o Tezzet não tem a chave.
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

      {error !== null && <Fault {...describeDelegationFault(error)} />}
    </section>
  );
}

async function loadBaker(session: ChainSession, address: string): Promise<BakerView> {
  const constants = readStakingConstants(await session.constants.get());
  const window = await fetchCycleWindow(session.http);
  const baker = await fetchBaker(session.http, session.network.endpoints, address, constants);
  const records = await fetchBakerRecord(session.http, address, window.cycle);
  return { baker, records, constants };
}

function describeBakerFault(error: unknown, attempts: number) {
  if (error instanceof NotABakerError) {
    return {
      what: 'Este endereço não está registrado como baker nesta rede.',
      where: error.address,
      cost: 'Delegar para ele seria recusado pela cadeia. Confira o endereço e a rede escolhida.',
    };
  }
  if (error instanceof BakerNotIndexedError) {
    return {
      what: 'O nó reconhece este baker, mas o indexador ainda não.',
      where: error.address,
      cost:
        'Sem o indexador não há nome, contagem de delegadores nem histórico de ciclo — ' +
        'e sem histórico não dá para mostrar quanto ele rendeu. Tente de novo mais tarde.',
    };
  }
  return describeFault(error, 'Os números deste baker não foram lidos.', attempts);
}

function describeDelegationFault(error: unknown) {
  if (error instanceof StakingValidationError) {
    return { what: error.message, where: 'conferência antes de assinar', cost: 'Nada foi assinado.' };
  }
  return describeFault(error, 'Nada foi assinado.');
}
