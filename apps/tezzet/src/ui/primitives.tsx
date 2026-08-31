import { type ReactNode, useCallback } from 'react';
import { formatReadAt, formatXtz, truncateAddress } from '../lib/format';

/**
 * As primitivas visuais da suíte, embrulhadas.
 *
 * O contrato está em `suite/tokens/tokens.css` (`.t-amount`, `.t-address`,
 * `.t-status`, ...). Nada aqui reimplementa formatação: se o valor for
 * formatado em dois lugares, um dos dois vai divergir.
 */

export function Amount({ mutez, unit = 'XTZ' }: { mutez: bigint; unit?: string }) {
  return (
    <span className="t-amount">
      {formatXtz(mutez)}
      <span className="t-amount__unit">{unit}</span>
    </span>
  );
}

export function Address({
  address,
  full = false,
  href,
}: {
  address: string;
  full?: boolean;
  href?: string;
}) {
  const shown = full ? address : truncateAddress(address);
  const body = (
    <span className={full ? 't-address' : 't-address t-address--truncated'} title={address}>
      {shown}
    </span>
  );
  return href ? <ExternalLink href={href}>{body}</ExternalLink> : body;
}

/**
 * Link para fora do app. Dentro do Tauri, uma navegação normal trocaria a
 * janela do app pela página do explorador e não haveria botão de voltar —
 * o navegador do sistema é quem abre.
 */
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  const onClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
      event.preventDefault();
      void import('@tauri-apps/plugin-opener').then((opener) => opener.openUrl(href));
    },
    [href],
  );
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" onClick={onClick}>
      {children}
    </a>
  );
}

export function NetworkBadge({ label, kind }: { label: string; kind: 'main' | 'test' }) {
  // A classe diz a natureza da rede; o nome vem da configuração, em texto.
  // Rede de teste grita (dourado de preenchimento), rede real fica quieta.
  return (
    <span className={`t-network t-network--${kind}`}>
      {label}
      <span className="visually-hidden">{kind === 'test' ? ' — rede de teste' : ' — rede real'}</span>
    </span>
  );
}

/** CARREGANDO. Barra na forma do número que vai chegar — nunca um zero. */
export function Skeleton({ width = '9ch', label }: { width?: string; label: string }) {
  return (
    <span
      className="t-skeleton"
      style={{ ['--skeleton-w' as string]: width }}
      role="status"
      aria-label={`${label}: lendo da cadeia`}
    />
  );
}

/** FALHA. O que falhou, de onde, quantas tentativas, e o que ficou sem saber. */
export function Fault({
  what,
  where,
  cost,
}: {
  what: string;
  where: string;
  cost: string;
}) {
  return (
    <div className="t-fault" role="alert">
      <strong className="t-fault__what">{what}</strong>
      <span className="t-fault__where">{where}</span>
      <span className="t-fault__cost">{cost}</span>
    </div>
  );
}

/** HORA DA LEITURA. Sem ela, um valor velho é indistinguível de um novo. */
export function ReadAt({ at, indexerLevel }: { at: Date; indexerLevel?: number }) {
  return (
    <span className="t-stale">
      {formatReadAt(at)}
      {indexerLevel === undefined ? '' : ` · nível ${indexerLevel}`}
    </span>
  );
}

/** VAZIO. O que ainda não aconteceu, e como acontece. Nunca um lamento. */
export function EmptyState({ title, next }: { title: string; next: string }) {
  return (
    <div className="t-empty">
      <p className="t-empty__title">{title}</p>
      <p className="t-empty__next">{next}</p>
    </div>
  );
}

const STATUS_CLASS: Record<string, string> = {
  applied: 't-status--paid',
  pending: 't-status--pending',
  failed: 't-status--failed',
  backtracked: 't-status--failed',
  skipped: 't-status--failed',
};

const STATUS_LABEL: Record<string, string> = {
  applied: 'aplicada',
  pending: 'pendente',
  failed: 'falhou',
  backtracked: 'revertida',
  skipped: 'ignorada',
};

/** A cor reforça; o texto carrega o significado. Nunca cor sozinha. */
export function StatusBadge({ status }: { status: string }) {
  const className = STATUS_CLASS[status] ?? 't-status--simulated';
  return <span className={`t-status ${className}`}>{STATUS_LABEL[status] ?? status}</span>;
}
