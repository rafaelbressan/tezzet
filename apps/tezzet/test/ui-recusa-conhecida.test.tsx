import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DelegateScreen } from '../src/screens/DelegateScreen';
import { StakeScreen } from '../src/screens/StakeScreen';
import { fakeSession, fakeWallet, stubNodeFetch } from './helpers/fake-chain';
import { routedTzKT } from './helpers/fake-tzkt';

afterEach(() => vi.unstubAllGlobals());

/**
 * BRES-116: em dois caminhos o app já tinha a informação para recusar com uma
 * frase em português, e mesmo assim deixava a cadeia recusar. O que a pessoa
 * lia era o identificador cru do protocolo —
 * `(temporary) proto.025-PsUshuai.delegate.unchanged`.
 *
 * A causa era a ordem: estimar primeiro, conferir depois. A estimativa fala
 * com o nó, o nó recusa, e a guarda amigável vira código morto. Por isso todo
 * teste daqui afirma **duas** coisas: que a frase aparece, e que
 * `wallet.estimated` continua vazio — sem a segunda, o teste passaria com a
 * ordem errada e uma tradução de id no fim do caminho.
 */

const CONTA = 'tz1TfBtHD87eRJnSn4vvnsE1JGzKvpoKLJMj';
const BAKER = 'tz1fwnfJNgiDACshK9avfRfFbMaXrs3ghoJa';
const OUTRO_BAKER = 'tz1USvTYjY1mPfrFkqMbdahAKNuhmu2eSczg';

const CONTA_DELEGANDO = {
  type: 'user',
  address: CONTA,
  balance: 3_000_000,
  stakedBalance: 2_000_000,
  unstakedBalance: 0,
  rollupBonds: 0,
  smartRollupBonds: 0,
  delegate: { address: BAKER, alias: 'Bake Nug' },
};

/**
 * Um baker que **aceita** stake de terceiros: 5× o stake próprio.
 * `baking_power` é o que o nó reporta, e `fetchBaker` reprova se a conta de
 * capacidade não reproduzir esse número — os valores aqui fecham.
 */
const ACEITA_STAKE = {
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

/**
 * O baker do caso 2 da issue: `limit_of_staking_over_baking_millionth = 0`.
 * Sem stake de terceiros, o poder é o stake próprio mais a delegação válida
 * dividida por `edge_of_staking_over_delegation` (3).
 */
const RECUSA_STAKE = {
  ...ACEITA_STAKE,
  baking_power: '12917040226',
  external_staked: '0',
  active_staking_parameters: {
    limit_of_staking_over_baking_millionth: 0,
    edge_of_baking_over_staking_billionth: 90000000,
  },
};

const DELEGADO_NA_TZKT = {
  address: BAKER,
  alias: 'Bake Nug',
  numDelegators: 4,
  stakersCount: 1,
  lastActivityTime: '2026-09-05T22:52:37Z',
};

function montar(delegadoNoNo: unknown) {
  const { http } = routedTzKT([
    [
      '/v1/head',
      {
        body: {
          chainId: 'NetXdQprcVkpaWU',
          level: 14_818_898,
          cycle: 1344,
          protocol: 'PsUshuai',
          knownLevel: 14_818_898,
        },
      },
    ],
    ['/v1/cycles/1344', { body: { index: 1344, firstLevel: 14_808_289 } }],
    ['/v1/staking/unstake_requests', { body: [] }],
    [`/v1/accounts/${CONTA}`, { body: CONTA_DELEGANDO }],
    ['/v1/delegates/', { body: DELEGADO_NA_TZKT }],
    ['/v1/rewards/split/', { status: 204 }],
  ]);
  vi.stubGlobal('fetch', stubNodeFetch(delegadoNoNo));
  const wallet = fakeWallet();
  return { session: fakeSession(http, wallet), wallet };
}

async function verBaker(endereco: string) {
  fireEvent.change(await screen.findByRole('textbox'), { target: { value: endereco } });
  fireEvent.click(screen.getByRole('button', { name: 'Ver este baker' }));
}

describe('redelegar para o baker que já é o atual', () => {
  it('não oferece a troca, e diz por que não há o que trocar', async () => {
    const { session, wallet } = montar(ACEITA_STAKE);
    render(<DelegateScreen session={session} address={CONTA} />);

    await verBaker(BAKER);

    expect(await screen.findByText(/Este já é o baker desta conta/)).toBeDefined();
    expect(screen.queryByRole('button', { name: /Trocar para este baker/ })).toBeNull();
    // A prova de que a recusa não passou pela rede.
    expect(wallet.estimated).toEqual([]);
    expect(wallet.signed).toEqual([]);
  });

  it('a troca para outro baker continua sendo oferecida', async () => {
    // O controle do teste acima: sem ele, um botão que sumisse sempre
    // passaria como conserto.
    const { session } = montar(ACEITA_STAKE);
    render(<DelegateScreen session={session} address={CONTA} />);

    await verBaker(OUTRO_BAKER);

    expect(await screen.findByRole('button', { name: 'Trocar para este baker' })).toBeDefined();
    expect(screen.queryByText(/Este já é o baker desta conta/)).toBeNull();
  });
});

describe('stakear com baker que não aceita stake de terceiros', () => {
  it('não mostra o formulário de stake, e diz o que fazer', async () => {
    const { session, wallet } = montar(RECUSA_STAKE);
    render(<StakeScreen session={session} address={CONTA} />);

    expect(await screen.findByText(/troque de baker na aba Delegar/)).toBeDefined();
    expect(screen.queryByText('Congelar em stake, em XTZ')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Revisar o stake' })).toBeNull();
    expect(wallet.estimated).toEqual([]);
  });

  it('tirar do stake continua possível — quem já congelou não fica preso', async () => {
    // O limite zero é sobre entrar, não sobre sair. Esconder a saída junto
    // trancaria o dinheiro de quem stakeou antes de o baker fechar.
    const { session } = montar(RECUSA_STAKE);
    render(<StakeScreen session={session} address={CONTA} />);

    expect(await screen.findByText('Tirar do stake, em XTZ')).toBeDefined();
  });

  it('com baker que aceita, o formulário de stake está lá', async () => {
    const { session } = montar(ACEITA_STAKE);
    render(<StakeScreen session={session} address={CONTA} />);

    expect(await screen.findByText('Congelar em stake, em XTZ')).toBeDefined();
    expect(screen.queryByText(/troque de baker na aba Delegar/)).toBeNull();
  });
});
