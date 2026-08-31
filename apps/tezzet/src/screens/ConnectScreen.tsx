import { useState } from 'react';
import { Fault } from '../ui/primitives';
import { describeFault } from '../lib/faults';
import type { ChainSession } from '../state/session';

/**
 * A primeira tela. O que ela promete é o que esta onda entrega: o Tezzet
 * mostra e monta, a carteira do usuário assina. Nenhuma semente é digitada
 * aqui, nem hoje nem depois — importar carteira é outra tela, de outra onda.
 */
export function ConnectScreen({
  session,
  onConnected,
}: {
  session: ChainSession;
  onConnected: (address: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      onConnected(await session.wallet.connect());
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel stack">
      <h2 className="panel__title">Conectar carteira</h2>
      <p className="note note--strong">
        O Tezzet não guarda chave nenhuma. Ele lê a cadeia e monta as operações; quem assina é a
        carteira que você já usa, pelo Beacon.
      </p>
      <p className="note">
        Rede: <strong>{session.network.label}</strong>. A conexão vale para esta rede — trocar de
        rede pede uma conexão nova.
      </p>
      <p className="note">
        {session.network.kind === 'test'
          ? 'O XTZ desta rede não vale dinheiro, e é onde dá para errar de graça.'
          : 'Esta rede move dinheiro de verdade. Toda operação assinada aqui gasta XTZ real.'}
      </p>
      <div className="form__actions">
        <button className="t-button" type="button" onClick={() => void connect()} disabled={busy}>
          {busy ? 'Aguardando a carteira…' : 'Conectar carteira'}
        </button>
      </div>
      {error !== null && <Fault {...describeFault(error, 'A conexão')} />}
    </section>
  );
}
