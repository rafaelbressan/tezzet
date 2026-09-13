import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { FAKE_TEZZET_NETWORK, fakeSession, fakeWallet } from './helpers/fake-chain';
import { routedTzKT } from './helpers/fake-tzkt';

/**
 * BRES-73: a QA achou `role="tablist"` sem o resto do padrão ARIA — sem
 * `tabpanel`, sem `aria-controls`, sem `tabindex` móvel e sem navegação por
 * seta. Leitor de tela anunciava "aba" e não entregava o que anuncia.
 */

const CONTA = 'tz1TfBtHD87eRJnSn4vvnsE1JGzKvpoKLJMj';

const SALDO = {
  type: 'user',
  address: CONTA,
  balance: 1_000_000,
  stakedBalance: 0,
  unstakedBalance: 0,
  rollupBonds: 0,
  smartRollupBonds: 0,
};

vi.mock('../src/config/networks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config/networks')>();
  return {
    ...actual,
    loadNetworkCatalog: async () => ({
      defaultNetworkId: FAKE_TEZZET_NETWORK.id,
      networks: [FAKE_TEZZET_NETWORK],
    }),
  };
});

vi.mock('../src/state/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/state/session')>();
  return {
    ...actual,
    createChainSession: () => {
      const { http } = routedTzKT([['/v1/accounts/', { body: SALDO }]]);
      return fakeSession(http, fakeWallet());
    },
  };
});

describe('abas do Tezzet', () => {
  it('cada aba controla um tabpanel, só a ativa está na ordem de tabulação, e a seta navega', async () => {
    render(<App />);

    const abas = await screen.findAllByRole('tab');
    expect(abas).toHaveLength(6);

    const [ativa, ...resto] = abas;
    expect(ativa).toBeDefined();
    if (!ativa) throw new Error('sem aba ativa');

    expect(ativa.getAttribute('aria-selected')).toBe('true');
    expect(ativa.tabIndex).toBe(0);
    for (const aba of resto) {
      expect(aba.tabIndex).toBe(-1);
    }

    const painel = screen.getByRole('tabpanel');
    expect(painel.getAttribute('aria-labelledby')).toBe(ativa.id);
    expect(ativa.getAttribute('aria-controls')).toBe(painel.id);

    fireEvent.keyDown(ativa, { key: 'ArrowRight' });

    const novaAtiva = screen.getAllByRole('tab').find((item) => item.getAttribute('aria-selected') === 'true');
    expect(novaAtiva).toBe(abas[1]);
    expect(novaAtiva?.tabIndex).toBe(0);
    expect(ativa.tabIndex).toBe(-1);
    // A ativação automática move o painel junto com o foco.
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(novaAtiva?.id);
  });
});
