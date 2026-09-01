import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { explorerAccountUrl } from '../chain/explorer';
import { copyWithExpiry, systemClipboard, type ExpiringCopy, type ExpiryOutcome } from '../lib/clipboard';
import { describeFault } from '../lib/faults';
import type { ChainSession } from '../state/session';
import { Address, ExternalLink, Fault } from '../ui/primitives';
import { readDesignToken } from '../ui/tokens';

/**
 * A cópia do endereço expira.
 *
 * Malware que troca endereço na área de transferência é um dos ataques mais
 * baratos que existem contra usuário de cripto, e o app antigo copiava o
 * endereço e nunca limpava. Aqui o prazo é anunciado antes, aparece na tela
 * enquanto corre, e o que foi copiado some no fim dele.
 */
const COPY_TTL_MS = 45_000;

export function ReceiveScreen({ session, address }: { session: ChainSession; address: string }) {
  const [qr, setQr] = useState<string | null>(null);
  const [qrError, setQrError] = useState<unknown>(null);
  const [copyError, setCopyError] = useState<unknown>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<ExpiryOutcome | null>(null);
  const copy = useRef<ExpiringCopy | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(address, {
      margin: 2,
      width: 440,
      errorCorrectionLevel: 'M',
      // As duas cores saem dos tokens da suíte; nenhum hexadecimal aqui.
      color: { dark: readDesignToken('--c-ink'), light: readDesignToken('--c-surface') },
    })
      .then((url) => {
        if (!cancelled) setQr(url);
      })
      .catch((error: unknown) => {
        if (!cancelled) setQrError(error);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  useEffect(() => {
    if (remaining === null) return;
    if (remaining <= 0) {
      setRemaining(null);
      return;
    }
    const timer = setTimeout(() => setRemaining(remaining - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);

  useEffect(() => () => copy.current?.cancel(), []);

  const onCopy = useCallback(async () => {
    setCopyError(null);
    setOutcome(null);
    copy.current?.cancel();
    try {
      copy.current = await copyWithExpiry(systemClipboard(), address, {
        ttlMs: COPY_TTL_MS,
        onExpire: (result) => {
          setOutcome(result);
          setRemaining(null);
        },
      });
      setRemaining(Math.round(COPY_TTL_MS / 1000));
    } catch (error) {
      setCopyError(error);
    }
  }, [address]);

  return (
    <section className="panel">
      <h2 className="panel__title">Receber</h2>
      <div className="receive">
        <div className="receive__qr">
          {qr && <img src={qr} alt={`QR do endereço ${address}`} />}
          {qrError !== null && <Fault {...describeFault(qrError, 'O QR do endereço não foi gerado. O endereço em texto continua correto.')} />}
        </div>

        <div className="receive__side stack">
          <div>
            <span className="balance__label">Seu endereço nesta rede</span>
            <Address address={address} full />
          </div>

          <div className="form__actions">
            <button className="t-button" type="button" onClick={() => void onCopy()}>
              Copiar endereço
            </button>
            <ExternalLink href={explorerAccountUrl(session.network, address)}>
              Ver no explorador
            </ExternalLink>
          </div>

          {remaining !== null && (
            <p className="note note--strong" role="status">
              Copiado. A cópia se apaga em <span className="countdown">{remaining}s</span> — cole
              antes disso.
            </p>
          )}

          {outcome !== null && <p className="note">{OUTCOME_TEXT[outcome]}</p>}

          {copyError !== null && <Fault {...describeFault(copyError, 'O endereço não foi copiado. Selecione o texto acima e copie à mão.')} />}

          <p className="note">
            A cópia tem prazo porque programa que troca endereço na área de transferência é o
            ataque mais barato contra quem usa cripto. Confira sempre o começo e o fim do endereço
            depois de colar.
          </p>
        </div>
      </div>
    </section>
  );
}

const OUTCOME_TEXT: Record<ExpiryOutcome, string> = {
  cleared: 'Prazo vencido: a área de transferência foi limpa.',
  superseded: 'Prazo vencido: você já tinha copiado outra coisa, e ela não foi tocada.',
  'cleared-unverified':
    'Prazo vencido: não foi possível ler a área de transferência neste sistema, então ela foi limpa por precaução.',
  cancelled: '',
};
