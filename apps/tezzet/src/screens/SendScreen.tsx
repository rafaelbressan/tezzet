import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MutezParseError,
  resolveOperationState,
  tezToMutez,
  type OperationOutcome,
} from '@tezos-suite/chain';
import { fetchAccount } from '../chain/account';
import { explorerOperationUrl } from '../chain/explorer';
import { describeFault } from '../lib/faults';
import { formatXtz } from '../lib/format';
import type { ChainSession } from '../state/session';
import { planTransfer, type TransferPlan } from '../wallet/transfer';
import { Amount, ExternalLink, Fault } from '../ui/primitives';

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
const POLL_INTERVAL_MS = 8_000;

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
        // O que está em stake não paga transferência: a parte líquida é o teto.
        spendableMutez: account.delegated,
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
        <Sent session={session} hash={stage.hash} plan={stage.plan} branchLevel={stage.branchLevel} />
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
  return describeFault(error, 'O envio');
}

function Receipt({ plan }: { plan: TransferPlan }) {
  return (
    <div className="receipt">
      <p className="receipt__line">
        <span>Valor</span>
        <Amount mutez={plan.amountMutez} />
      </p>
      <p className="receipt__line">
        <span>Taxa estimada</span>
        <Amount mutez={plan.feeMutez} />
      </p>
      <p className="receipt__line">
        <span>Alocação do destino</span>
        <Amount mutez={plan.burnMutez} />
      </p>
      <p className="receipt__line">
        <span>Total a debitar</span>
        <Amount mutez={plan.totalMutez} />
      </p>
      <p className="receipt__line">
        <span>Sobra no saldo líquido</span>
        <Amount mutez={plan.remainingMutez} />
      </p>
      <p className="note">
        gas {plan.gasLimit} · storage {plan.storageLimit} · destino {plan.destinationKind}
      </p>
    </div>
  );
}

const OUTCOME_TEXT: Record<OperationOutcome['status'], string> = {
  pending: 'Injetada. Ainda não apareceu em um bloco.',
  included: 'Em um bloco, aguardando os dois níveis que fecham a confirmação.',
  confirmed: 'Confirmada: relida no mesmo bloco, com dois níveis por cima.',
  failed: 'A cadeia recusou a operação.',
  expired: 'O branch expirou sem a operação entrar. Ela nunca vai entrar, e reenviar agora é seguro.',
};

/**
 * Confirmação pelo critério do Tenderbake: incluída no nível L, cabeça em
 * L+2, e **relida** confirmando bloco e situação. Contar blocos sozinho
 * assume que a cadeia que você viu é a que ficou.
 */
function Sent({
  session,
  hash,
  plan,
  branchLevel,
}: {
  session: ChainSession;
  hash: string;
  plan: TransferPlan;
  branchLevel: number;
}) {
  const [outcome, setOutcome] = useState<OperationOutcome | null>(null);
  const [error, setError] = useState<unknown>(null);
  const stop = useRef(false);

  useEffect(() => {
    stop.current = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const constants = await session.constants.get();
        const result = await resolveOperationState(session.http, session.head, hash, {
          branchLevel,
          constants,
        });
        if (stop.current) return;
        setOutcome(result);
        if (result.status === 'pending' || result.status === 'included') {
          timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
        }
      } catch (cause) {
        if (!stop.current) setError(cause);
      }
    };

    void poll();
    return () => {
      stop.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [session, hash, branchLevel]);

  return (
    <div className="stack">
      <p className="note note--strong">
        {formatXtz(plan.amountMutez)} XTZ enviados para {plan.destination}.
      </p>
      <p>
        <ExternalLink href={explorerOperationUrl(session.network, hash)}>
          <span className="t-ophash">{hash}</span>
        </ExternalLink>
      </p>
      <p className="note note--strong" role="status">
        {outcome ? OUTCOME_TEXT[outcome.status] : 'Consultando a cadeia…'}
        {outcome?.level !== undefined && ` Nível ${outcome.level}, cabeça em ${outcome.headLevel}.`}
      </p>
      {error !== null && <Fault {...describeFault(error, 'A confirmação')} />}
    </div>
  );
}
