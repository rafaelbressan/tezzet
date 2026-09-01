import { describe, expect, it } from 'vitest';
import { fetchAccount } from '../src/chain/account';
import { planTransfer } from '../src/wallet/transfer';
import { fakeTzKT } from './helpers/fake-tzkt';

/**
 * O caminho inteiro do envio, com a conta que reprovou a primeira entrega:
 * saldo cheio de 24 015,668853 XTZ, dos quais 20 015 estão em stake e 4 000
 * estão saindo de stake. O gastável são 0,233129 XTZ.
 *
 * Antes, o app oferecia 4 000,233129 e deixava assinar. A pessoa assinaria
 * uma operação que a cadeia recusa — e o único aviso viria depois, do nó.
 */
const CONTA = {
  type: 'user',
  address: 'tz1aLq132WVXyh7AmnNiVbWMRDS7rwGatLiQ',
  balance: 24015668853,
  stakedBalance: 20015435724,
  unstakedBalance: 4000000000,
  rollupBonds: 0,
  smartRollupBonds: 0,
};

const DESTINO = 'tz1aRoaRhSpRYvFdyvgWLL6TGyRoGF51wDjM';
const ESTIMATIVA = { feeMutez: 500n, burnMutez: 0n, gasLimit: 1000, storageLimit: 0 };

describe('enviar de uma conta com saldo saindo de stake', () => {
  it('recusa 1 000 XTZ de uma conta com 0,233129 XTZ gastáveis', async () => {
    const { http } = fakeTzKT([{ body: CONTA }]);
    const account = await fetchAccount(http, CONTA.address);

    expect(account.spendable).toBe(233129n);
    expect(() =>
      planTransfer({
        destination: DESTINO,
        amountMutez: 1_000_000_000n,
        spendableMutez: account.spendable,
        estimate: ESTIMATIVA,
      }),
    ).toThrow(/faltam 999\.767371 XTZ/);
  });

  it('aceita o que cabe no gastável, e a sobra é a real', async () => {
    const { http } = fakeTzKT([{ body: CONTA }]);
    const account = await fetchAccount(http, CONTA.address);

    const plan = planTransfer({
      destination: DESTINO,
      amountMutez: 100_000n,
      spendableMutez: account.spendable,
      estimate: ESTIMATIVA,
    });

    expect(plan.totalMutez).toBe(100_500n);
    expect(plan.remainingMutez).toBe(132_629n);
  });

  it('as parcelas da tela de saldo somam o total, e não mais que ele', async () => {
    const { http } = fakeTzKT([{ body: CONTA }]);
    const account = await fetchAccount(http, CONTA.address);

    expect(account.spendable + account.staked + account.unstaked + account.bonds).toBe(account.total);
  });
});
