import { useCallback, useState } from 'react';
import { MutezParseError, tezToMutez } from '@tezos-suite/chain';
import { fetchAccount } from '../chain/account';
import { describeFault } from '../lib/faults';
import { formatXtz } from '../lib/format';
import type { ChainSession } from '../state/session';
import { planTransfer, type TransferPlan } from '../wallet/transfer';
import { OperationReceipt, SentOperation } from '../ui/operation';
import { Amount, Fault } from '../ui/primitives';

/**
 * Enviar XTZ **sem tocar em chave**.
 *
 * O Tezzet estima na rede, confere que o saldo cobre valor + taxa + alocação,
 * e manda a operação para a carteira do usuário assinar. A assinatura
 * acontece na carteira; o Tezzet só injeta o que voltou.
 *
 * O valor é lido como texto e vira `bigint` em mutez em `tezToMutez`. Passar
 * por `number` perderia o valor antes de qualquer conta: `0.00397 * 1e6`
 * arredonda para 3969 em vez de 3970.
 */
type Stage =
  | { readonly kind: 'form' }
  | { readonly kind: 'reviewing' }
  | { readonly kind: 'review'; readonly plan: TransferPlan }
  | { readonly kind: 'signing'; readonly plan: TransferPlan }
  | { readonly kind: 'sent'; readonly plan: TransferPlan; readonly hash: string; readonly branchLevel: number };

export function SendScreen({ session, address }: { session: ChainSession; address: string }) {
  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('');
  const [stage, setStage] = useState<Stage>({ kind: 'form' });
  const [error, setError] = useState<unknown>(null);

  const review = useCallback(async () => {
    setError(null);
    setStage({ kind: 'reviewing' });
    try {
      const amountMutez = tezToMutez(amount);
      const [account, headLevel] = await Promise.all([
        fetchAccount(session.http, address),
        session.head.getHeadLevel(),
      ]);
      void headLevel;
      const estimate = await session.wallet.estimateTransfer(destination.trim(), amountMutez, address);
      const plan = planTransfer({
        destination: destination.trim(),
        amountMutez,
        // O teto é o gastável de verdade: o que está em stake, saindo de
        // stake ou em bond está congelado e não paga transferência.
        spendableMutez: account.spendable,
        estimate,
      });
      setStage({ kind: 'review', plan });
    } catch (cause) {
      setError(cause);
      setStage({ kind: 'form' });
    }
  }, [amount, destination, session, address]);

  const sign = useCallback(
    async (plan: TransferPlan) => {
      setError(null);
      setStage({ kind: 'signing', plan });
      try {
        // Lido antes de injetar: é o nível a partir do qual o `branch` da
        // operação expira, e sem ele "não achei" nunca vira "nunca entrou".
        const branchLevel = await session.head.getHeadLevel();
        const hash = await session.wallet.sendTransfer(plan.destination, plan.amountMutez);
        setStage({ kind: 'sent', plan, hash, branchLevel });
      } catch (cause) {
        setError(cause);
        setStage({ kind: 'review', plan });
      }
    },
    [session],
  );

  return (
    <section className="panel">
      <h2 className="panel__title">Enviar</h2>

      {(stage.kind === 'form' || stage.kind === 'reviewing') && (
        <div className="form">
          <label className="t-field">
            <span className="t-field__label">Endereço de destino</span>
            <input
              className="t-field__input"
              value={destination}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => setDestination(event.target.value)}
              placeholder="tz1…"
            />
            <span className="t-field__hint">tz1, tz2, tz3, tz4 ou KT1. O checksum é conferido.</span>
          </label>

          <label className="t-field">
            <span className="t-field__label">Valor em XTZ</span>
            <input
              className="t-field__input"
              value={amount}
              inputMode="decimal"
              autoComplete="off"
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.000000"
            />
            <span className="t-field__hint">Até seis casas decimais. Um mutez é 0,000001 XTZ.</span>
          </label>

          <div className="form__actions">
            <button
              className="t-button"
              type="button"
              disabled={stage.kind === 'reviewing' || destination.trim() === '' || amount.trim() === ''}
              onClick={() => void review()}
            >
              {stage.kind === 'reviewing' ? 'Estimando na rede…' : 'Revisar'}
            </button>
          </div>
        </div>
      )}

      {(stage.kind === 'review' || stage.kind === 'signing') && (
        <div className="stack">
          <Receipt plan={stage.plan} />
          <p className="note">
            A assinatura acontece na sua carteira. O Tezzet não tem a chave e não pode assinar por
            você.
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
              onClick={() => setStage({ kind: 'form' })}
            >
              Corrigir
            </button>
          </div>
        </div>
      )}

      {stage.kind === 'sent' && (
        <SentOperation
          session={session}
          hash={stage.hash}
          branchLevel={stage.branchLevel}
          what={`${formatXtz(stage.plan.amountMutez)} XTZ enviados para ${stage.plan.destination}.`}
          cost="A confirmação não foi lida. A operação já foi injetada — confira no explorador antes de reenviar."
        />
      )}

      {error !== null && <Fault {...describeSendFault(error)} />}
    </section>
  );
}

function describeSendFault(error: unknown) {
  if (error instanceof MutezParseError) {
    return {
      what: error.message,
      where: 'valor digitado',
      cost: 'Nada foi enviado.',
    };
  }
  return describeFault(error, 'Nada foi enviado.');
}

function Receipt({ plan }: { plan: TransferPlan }) {
  return (
    <OperationReceipt
      feeMutez={plan.feeMutez}
      burnMutez={plan.burnMutez}
      gasLimit={plan.gasLimit}
      storageLimit={plan.storageLimit}
    >
      <p className="receipt__line">
        <span>Valor</span>
        <Amount mutez={plan.amountMutez} />
      </p>
      <p className="receipt__line">
        <span>Total a debitar</span>
        <Amount mutez={plan.totalMutez} />
      </p>
      <p className="receipt__line">
        <span>Sobra no gastável</span>
        <Amount mutez={plan.remainingMutez} />
      </p>
      <p className="note">destino {plan.destinationKind}</p>
    </OperationReceipt>
  );
}
