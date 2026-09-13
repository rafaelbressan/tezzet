import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TZKT_ATTRIBUTION } from '@tezos-suite/chain';
import { loadNetworkCatalog, movesRealMoney, selectNetwork } from './config/networks';
import { describeFault } from './lib/faults';
import { createChainSession } from './state/session';
import { useAsync } from './state/useAsync';
import { BalanceScreen } from './screens/BalanceScreen';
import { ConnectScreen } from './screens/ConnectScreen';
import { DelegateScreen } from './screens/DelegateScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { ReceiveScreen } from './screens/ReceiveScreen';
import { SendScreen } from './screens/SendScreen';
import { StakeScreen } from './screens/StakeScreen';
import { Address, ExternalLink, Fault, NetworkBadge, Skeleton } from './ui/primitives';

const NETWORK_STORAGE_KEY = 'tezzet.rede';

// Delegar e stakear são abas separadas de propósito: são duas ações
// diferentes, com riscos diferentes, e juntá-las numa aba "Render" faria a
// interface dizer que são a mesma coisa com um botão a mais.
const TABS = [
  { id: 'saldo', label: 'Saldo' },
  { id: 'historico', label: 'Histórico' },
  { id: 'receber', label: 'Receber' },
  { id: 'enviar', label: 'Enviar' },
  { id: 'delegar', label: 'Delegar' },
  { id: 'stake', label: 'Stake' },
] as const;

type TabId = (typeof TABS)[number]['id'];

const tabButtonId = (id: TabId) => `tab-${id}`;
const tabPanelId = (id: TabId) => `panel-${id}`;

export function App() {
  const catalog = useAsync(() => loadNetworkCatalog(), []);
  const [networkId, setNetworkId] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('saldo');
  const [pendingNetworkId, setPendingNetworkId] = useState<string | null>(null);
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({} as Record<TabId, HTMLButtonElement | null>);

  // Padrão ARIA de tablist: a seta move o foco E a seleção (ativação
  // automática) — só uma aba fica no tabIndex 0 por vez, o resto sai da
  // ordem de tabulação. Sem isto as quatro abas entram na tabulação normal
  // e as setas não fazem nada, que é o que a QA reprovou.
  const moveTab = useCallback((from: TabId, delta: 1 | -1) => {
    const index = TABS.findIndex((item) => item.id === from);
    const next = TABS[(index + delta + TABS.length) % TABS.length];
    if (!next) return;
    setTab(next.id);
    tabRefs.current[next.id]?.focus();
  }, []);

  const onTabKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, id: TabId) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        moveTab(id, 1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        moveTab(id, -1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        const first = TABS[0];
        if (first) {
          setTab(first.id);
          tabRefs.current[first.id]?.focus();
        }
      } else if (event.key === 'End') {
        event.preventDefault();
        const last = TABS[TABS.length - 1];
        if (last) {
          setTab(last.id);
          tabRefs.current[last.id]?.focus();
        }
      }
    },
    [moveTab],
  );

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
          <Fault {...describeFault(catalog.state.error, 'O app não abre sem saber em que rede está.', catalog.state.attempts)} />
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
                  ref={(node) => {
                    tabRefs.current[item.id] = node;
                  }}
                  id={tabButtonId(item.id)}
                  role="tab"
                  type="button"
                  className="tabs__item"
                  aria-selected={tab === item.id}
                  aria-controls={tabPanelId(item.id)}
                  tabIndex={tab === item.id ? 0 : -1}
                  onClick={() => setTab(item.id)}
                  onKeyDown={(event) => onTabKeyDown(event, item.id)}
                >
                  {item.label}
                </button>
              ))}
            </nav>

            <div
              role="tabpanel"
              id={tabPanelId(tab)}
              aria-labelledby={tabButtonId(tab)}
              tabIndex={0}
            >
              {tab === 'saldo' && <BalanceScreen session={session} address={address} />}
              {tab === 'historico' && <HistoryScreen session={session} address={address} />}
              {tab === 'receber' && <ReceiveScreen session={session} address={address} />}
              {tab === 'enviar' && <SendScreen session={session} address={address} />}
              {tab === 'delegar' && <DelegateScreen session={session} address={address} />}
              {tab === 'stake' && <StakeScreen session={session} address={address} />}
            </div>
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
