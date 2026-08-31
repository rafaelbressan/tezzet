import { useCallback, useEffect, useMemo, useState } from 'react';
import { TZKT_ATTRIBUTION } from '@tezos-suite/chain';
import { loadNetworkCatalog, movesRealMoney, selectNetwork } from './config/networks';
import { describeFault } from './lib/faults';
import { createChainSession } from './state/session';
import { useAsync } from './state/useAsync';
import { BalanceScreen } from './screens/BalanceScreen';
import { ConnectScreen } from './screens/ConnectScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { ReceiveScreen } from './screens/ReceiveScreen';
import { SendScreen } from './screens/SendScreen';
import { Address, ExternalLink, Fault, NetworkBadge, Skeleton } from './ui/primitives';

const NETWORK_STORAGE_KEY = 'tezzet.rede';

const TABS = [
  { id: 'saldo', label: 'Saldo' },
  { id: 'historico', label: 'Histórico' },
  { id: 'receber', label: 'Receber' },
  { id: 'enviar', label: 'Enviar' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function App() {
  const catalog = useAsync(() => loadNetworkCatalog(), []);
  const [networkId, setNetworkId] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('saldo');
  const [pendingNetworkId, setPendingNetworkId] = useState<string | null>(null);

  // A rede escolhida é lembrada, mas só vale se ainda existir na configuração:
  // uma rede desligada não pode voltar pela porta dos fundos do armazenamento.
  useEffect(() => {
    if (catalog.state.kind !== 'ready' || networkId !== null) return;
    const stored = window.localStorage.getItem(NETWORK_STORAGE_KEY);
    const known = catalog.state.value.networks.some((network) => network.id === stored);
    setNetworkId(known && stored ? stored : catalog.state.value.defaultNetworkId);
  }, [catalog.state, networkId]);

  const network = useMemo(() => {
    if (catalog.state.kind !== 'ready' || networkId === null) return null;
    return selectNetwork(catalog.state.value, networkId);
  }, [catalog.state, networkId]);

  const session = useMemo(() => (network ? createChainSession(network) : null), [network]);

  // Uma sessão do Beacon vale para uma rede. Ao trocar de rede, a conexão
  // anterior deixa de valer — mantê-la na tela mostraria o saldo de uma rede
  // com o endereço autorizado em outra.
  useEffect(() => {
    setAddress(null);
    if (!session) return;
    let cancelled = false;
    void session.wallet
      .activeAddress()
      .then((active) => {
        if (!cancelled) setAddress(active);
      })
      .catch(() => {
        if (!cancelled) setAddress(null);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const commitNetwork = useCallback((id: string) => {
    window.localStorage.setItem(NETWORK_STORAGE_KEY, id);
    setNetworkId(id);
    setPendingNetworkId(null);
  }, []);

  // Rede de teste troca direto; mainnet pergunta, toda vez. Lembrar da última
  // escolha não é o mesmo que ter sido autorizado desta vez.
  const requestNetwork = useCallback(
    (id: string) => {
      if (catalog.state.kind !== 'ready') return;
      if (movesRealMoney(selectNetwork(catalog.state.value, id))) {
        setPendingNetworkId(id);
        return;
      }
      commitNetwork(id);
    },
    [catalog.state, commitNetwork],
  );

  const disconnect = useCallback(async () => {
    if (!session) return;
    await session.wallet.disconnect();
    setAddress(null);
  }, [session]);

  return (
    <div className="app t-dark">
      <header className="app__header">
        <h1 className="wordmark">
          Tezzet<span className="wordmark__role">guardar</span>
        </h1>

        {catalog.state.kind === 'ready' && network && (
          <>
            <label className="visually-hidden" htmlFor="rede">
              Rede
            </label>
            <select
              id="rede"
              className="select"
              value={pendingNetworkId ?? network.id}
              onChange={(event) => requestNetwork(event.target.value)}
            >
              {catalog.state.value.networks.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <NetworkBadge label={network.label} kind={network.kind} />
          </>
        )}

        {catalog.state.kind === 'loading' && <Skeleton width="10ch" label="Rede" />}

        <div className="app__spacer" />

        {address && (
          <>
            <Address address={address} />
            <button className="t-button t-button--quiet" type="button" onClick={() => void disconnect()}>
              Desconectar
            </button>
          </>
        )}
      </header>

      <main className="app__main">
        {catalog.state.kind === 'error' && (
          <Fault {...describeFault(catalog.state.error, 'A configuração de rede', catalog.state.attempts)} />
        )}

        {pendingNetworkId !== null && catalog.state.kind === 'ready' && (
          <section className="panel stack">
            <h2 className="panel__title">
              Trocar para {selectNetwork(catalog.state.value, pendingNetworkId).label}?
            </h2>
            <p className="note note--strong">
              Esta rede move dinheiro de verdade. Toda operação assinada nela gasta XTZ real, e
              não há como desfazer.
            </p>
            <div className="form__actions">
              <button className="t-button" type="button" onClick={() => commitNetwork(pendingNetworkId)}>
                Trocar mesmo assim
              </button>
              <button
                className="t-button t-button--quiet"
                type="button"
                onClick={() => setPendingNetworkId(null)}
              >
                Ficar em {network?.label ?? 'onde estou'}
              </button>
            </div>
          </section>
        )}

        {session && !address && pendingNetworkId === null && (
          <ConnectScreen session={session} onConnected={setAddress} />
        )}

        {session && address && pendingNetworkId === null && (
          <>
            <nav className="tabs" role="tablist">
              {TABS.map((item) => (
                <button
                  key={item.id}
                  role="tab"
                  type="button"
                  className="tabs__item"
                  aria-selected={tab === item.id}
                  onClick={() => setTab(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </nav>

            {tab === 'saldo' && <BalanceScreen session={session} address={address} />}
            {tab === 'historico' && <HistoryScreen session={session} address={address} />}
            {tab === 'receber' && <ReceiveScreen session={session} address={address} />}
            {tab === 'enviar' && <SendScreen session={session} address={address} />}
          </>
        )}
      </main>

      <footer className="app__footer">
        {/* Atribuição da TzKT: é exigência de licença do free tier, não cortesia. */}
        <ExternalLink href={TZKT_ATTRIBUTION.href}>{TZKT_ATTRIBUTION.text}</ExternalLink>
        <span>Esta versão não guarda chave nenhuma. Quem assina é a sua carteira.</span>
      </footer>
    </div>
  );
}
