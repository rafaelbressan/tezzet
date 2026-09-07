import { useEffect, useRef, useState, type ReactNode } from 'react';
import { resolveOperationState, type OperationOutcome } from '@tezos-suite/chain';
import { explorerOperationUrl } from '../chain/explorer';
import { describeFault } from '../lib/faults';
import type { ChainSession } from '../state/session';
import { Amount, ExternalLink, Fault } from './primitives';

/**
 * O que acontece depois de a carteira assinar — igual para toda operação.
 *
 * Enviar, delegar, stakear, sair do stake e finalizar terminam do mesmo
 * jeito: um hash, um link para o explorador, e a confirmação sendo relida da
 * cadeia. Uma cópia deste laço por tela seria cinco lugares para o critério
 * de confirmação divergir, e o critério é a parte difícil.
 */
const POLL_INTERVAL_MS = 8_000;

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
export function SentOperation({
  session,
  hash,
  branchLevel,
  what,
  cost,
}: {
  session: ChainSession;
  hash: string;
  branchLevel: number;
  /** A frase que diz o que foi assinado, em português comum. */
  what: string;
  /** O que ficou sem saber se a leitura da confirmação falhar. */
  cost: string;
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
      <p className="note note--strong">{what}</p>
      <p>
        <ExternalLink href={explorerOperationUrl(session.network, hash)}>
          <span className="t-ophash">{hash}</span>
        </ExternalLink>
      </p>
      <p className="note note--strong" role="status">
        {outcome ? OUTCOME_TEXT[outcome.status] : 'Consultando a cadeia…'}
        {outcome?.level !== undefined && ` Nível ${outcome.level}, cabeça em ${outcome.headLevel}.`}
      </p>
      {error !== null && <Fault {...describeFault(error, cost)} />}
    </div>
  );
}

/**
 * A revisão que antecede a assinatura. As linhas próprias da operação entram
 * como filhos, e o custo da rede vem sempre — sem custo escrito, "confirmar"
 * é um botão que a pessoa aperta sem saber quanto vai pagar.
 */
export function OperationReceipt({
  feeMutez,
  burnMutez,
  gasLimit,
  storageLimit,
  children,
}: {
  feeMutez: bigint;
  burnMutez: bigint;
  gasLimit: number;
  storageLimit: number;
  children?: ReactNode;
}) {
  return (
    <div className="receipt">
      {children}
      <p className="receipt__line">
        <span>Taxa estimada</span>
        <Amount mutez={feeMutez} />
      </p>
      {burnMutez > 0n && (
        <p className="receipt__line">
          <span>Alocação na cadeia</span>
          <Amount mutez={burnMutez} />
        </p>
      )}
      <p className="note">
        gas {gasLimit} · storage {storageLimit}
      </p>
    </div>
  );
}
