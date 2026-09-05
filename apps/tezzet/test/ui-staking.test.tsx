import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DelegateVersusStake } from '../src/ui/difference';
import { StakeScreen } from '../src/screens/StakeScreen';
import { fakeSession, fakeWallet, stubNodeFetch } from './helpers/fake-chain';
import { routedTzKT } from './helpers/fake-tzkt';

afterEach(() => vi.unstubAllGlobals());

const CONTA = 'tz1TfBtHD87eRJnSn4vvnsE1JGzKvpoKLJMj';
const BAKER = 'tz1fwnfJNgiDACshK9avfRfFbMaXrs3ghoJa';

/**
 * Os dois critérios de aceite que só a tela pode provar:
 *
 *  1. a diferença entre delegar e stakear fica clara **sem documentação
 *     externa** — está escrita na tela, não atrás de um link;
 *  2. a espera do unstake aparece **antes** da confirmação.
 *
 * O segundo é o que já custou dinheiro em outras carteiras: quem descobre a
 * espera depois de assinar não tem como desfazer.
 */
describe('a diferença entre delegar e stakear', () => {
  it('está na tela, com a linha da punição escrita', () => {
    render(<DelegateVersusStake highlight="delegating" />);

    const linha = screen.getByRole('row', { name: /Se o baker for punido/ });
    expect(within(linha).getByText('você não perde nada')).toBeDefined();
    expect(within(linha).getByText('você perde parte do que congelou')).toBeDefined();
  });

  it('diz que delegar não congela e que stakear congela', () => {
    render(<DelegateVersusStake highlight="staking" />);

    const linha = screen.getByRole('row', { name: /O seu dinheiro/ });
    expect(within(linha).getByText(/continua gastável/)).toBeDefined();
    expect(within(linha).getByText(/congela/)).toBeDefined();
  });

  it('mostra as duas colunas mesmo destacando uma — esconder é esconder a comparação', () => {
    render(<DelegateVersusStake highlight="staking" />);

    expect(screen.getByRole('columnheader', { name: 'Delegar' })).toBeDefined();
    expect(screen.getByRole('columnheader', { name: 'Stakear' })).toBeDefined();
  });
});

const CONTA_COM_STAKE = {
  type: 'user',
  address: CONTA,
  balance: 3_000_000,
  stakedBalance: 2_000_000,
  unstakedBalance: 0,
  rollupBonds: 0,
  smartRollupBonds: 0,
  delegate: { address: BAKER, alias: 'Bake Nug' },
};

/** Como o nó descreve o baker: é daqui que sai todo número da conta. */
const DELEGADO_NO_NO = {
  deactivated: false,
  baking_power: '12926013094',
  own_staked: '12893367008',
  external_staked: '8972868',
  total_delegated: '71019655',
  min_delegated_in_current_cycle: { amount: '71019655' },
  active_staking_parameters: {
    limit_of_staking_over_baking_millionth: 5000000,
    edge_of_baking_over_staking_billionth: 90000000,
  },
};

/** O que só o indexador tem: nome, contagens e última atividade. */
const DELEGADO_NA_TZKT = {
  address: BAKER,
  alias: 'Bake Nug',
  numDelegators: 4,
  stakersCount: 1,
  lastActivityTime: '2026-09-05T22:52:37Z',
};

function montarTela() {
  const { http } = routedTzKT([
    ['/v1/head', { body: { chainId: 'NetXdQprcVkpaWU', level: 14_818_898, cycle: 1344, protocol: 'PsUshuai', knownLevel: 14_818_898 } }],
    ['/v1/cycles/1344', { body: { index: 1344, firstLevel: 14_808_289 } }],
    ['/v1/staking/unstake_requests', { body: [] }],
    [`/v1/accounts/${CONTA}`, { body: CONTA_COM_STAKE }],
    [`/v1/delegates/${BAKER}`, { body: DELEGADO_NA_TZKT }],
    ['/v1/rewards/split/', { status: 204 }],
  ]);
  vi.stubGlobal('fetch', stubNodeFetch(DELEGADO_NO_NO));
  const wallet = fakeWallet();
  render(<StakeScreen session={fakeSession(http, wallet)} address={CONTA} />);
  return wallet;
}

describe('a espera do unstake', () => {
  it('aparece antes de qualquer confirmação, com ciclo, dias e data', async () => {
    montarTela();

    const aviso = await screen.findByRole('note');

    // Quatro ciclos, não os três da constante: o ciclo corrente já está
    // correndo e não conta.
    expect(aviso.textContent).toContain('4 ciclos');
    expect(aviso.textContent).toContain('ciclo 1348');
    expect(aviso.textContent).toContain('3 dias');
    expect(aviso.textContent).toMatch(/liberando no ciclo 1348, a partir de \d{2}\/\d{2}\/\d{4}/);
  });

  it('avisa que o dinheiro não volta sozinho depois da espera', async () => {
    montarTela();

    const aviso = await screen.findByRole('note');
    expect(aviso.textContent).toContain('não volta sozinho');
  });

  it('a espera está na tela sem ninguém ter assinado nada', async () => {
    const wallet = montarTela();

    await screen.findByRole('note');
    expect(wallet.signed).toEqual([]);
  });
});

describe('a tela de stake', () => {
  it('diz para qual baker o stake vai, porque a cadeia não deixa escolher outro', async () => {
    montarTela();

    await waitFor(() => {
      expect(screen.getByText(/é o baker para quem esta conta delega/)).toBeDefined();
    });
  });

  it('mostra a fatia que a cadeia cobra, e diz que é a única verificável', async () => {
    montarTela();

    await waitFor(() => expect(screen.getByText('9,00%')).toBeDefined());
    expect(screen.getByText(/única taxa que o Tezzet consegue verificar/)).toBeDefined();
  });

  it('sem ciclo fechado, recusa mostrar rendimento em vez de mostrar zero', async () => {
    montarTela();

    await waitFor(() => {
      expect(screen.getByText(/Sem rendimento para mostrar:/)).toBeDefined();
    });
    expect(screen.getByText(/Um número aqui seria inventado/)).toBeDefined();
  });
});
