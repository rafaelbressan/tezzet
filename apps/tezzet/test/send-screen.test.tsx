import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SendScreen } from '../src/screens/SendScreen';
import { fakeSession, fakeWallet } from './helpers/fake-chain';
import { routedTzKT } from './helpers/fake-tzkt';

/**
 * BRES-73: a QA do PR #11 achou que `sendTransfer` ignorava a estimativa que
 * a tela de revisão mostrou — o Taquito re-estimava na hora de assinar, e a
 * pessoa aprovava números que podiam já não valer. O teste afirma que os
 * quatro números da estimativa (taxa, limite de gas e de storage) chegam
 * intactos até a chamada que assina.
 */

const CONTA = 'tz1TfBtHD87eRJnSn4vvnsE1JGzKvpoKLJMj';
const DESTINO = 'tz1aRoaRhSpRYvFdyvgWLL6TGyRoGF51wDjM';

const SALDO = {
  type: 'user',
  address: CONTA,
  balance: 10_000_000,
  stakedBalance: 0,
  unstakedBalance: 0,
  rollupBonds: 0,
  smartRollupBonds: 0,
};

const ESTIMATIVA = { feeMutez: 517n, burnMutez: 64_250n, gasLimit: 1521, storageLimit: 257 };

function montar() {
  const { http } = routedTzKT([
    ['/v1/head', { body: { chainId: 'NetXdQprcVkpaWU', level: 100, cycle: 1, protocol: 'PsUshuai', knownLevel: 100 } }],
    [`/v1/accounts/${CONTA}`, { body: SALDO }],
  ]);
  const wallet = fakeWallet(ESTIMATIVA);
  return { session: fakeSession(http, wallet), wallet };
}

async function preencherErevisar() {
  fireEvent.change(screen.getByPlaceholderText('tz1…'), { target: { value: DESTINO } });
  fireEvent.change(screen.getByPlaceholderText('0.000000'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Revisar' }));
  await screen.findByRole('button', { name: 'Assinar na carteira' });
}

describe('SendScreen', () => {
  it('assina com a taxa e os limites da estimativa revisada, não com os defaults do Taquito', async () => {
    const { session, wallet } = montar();
    render(<SendScreen session={session} address={CONTA} />);

    await preencherErevisar();
    fireEvent.click(screen.getByRole('button', { name: 'Assinar na carteira' }));

    await screen.findByText(/enviados para/);
    expect(wallet.signed).toEqual([
      `transfer:${DESTINO}:${ESTIMATIVA.feeMutez}:${ESTIMATIVA.gasLimit}:${ESTIMATIVA.storageLimit}`,
    ]);
  });

  it('se a carteira recusar assinar, o painel de falha aparece e nada foi enviado', async () => {
    const { session, wallet } = montar();
    wallet.sendTransfer = async () => {
      throw new Error('A pessoa fechou a carteira.');
    };
    render(<SendScreen session={session} address={CONTA} />);

    await preencherErevisar();
    fireEvent.click(screen.getByRole('button', { name: 'Assinar na carteira' }));

    expect(await screen.findByText('A pessoa fechou a carteira.')).toBeDefined();
    expect(screen.queryByText(/enviados para/)).toBeNull();
    // Volta para a revisão, não para o formulário em branco: a pessoa não
    // precisa digitar tudo de novo para tentar assinar de novo.
    expect(await screen.findByRole('button', { name: 'Assinar na carteira' })).toBeDefined();
  });
});
