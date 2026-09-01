import { describe, expect, it } from 'vitest';
import { InvariantViolationError, MissingFieldError } from '@tezos-suite/chain';
import { fetchAccount } from '../src/chain/account';
import { fakeTzKT } from './helpers/fake-tzkt';

const ADDRESS = 'tz1fwnfJNgiDACshK9avfRfFbMaXrs3ghoJa';

// Números reais da TzKT em 2026-08-31. A relação balance − staked = delegado
// é conferida contra eles: 235999207943 − 235795238232 = 203969711.
const BAKE_NUG = {
  type: 'delegate',
  address: ADDRESS,
  balance: 235999207943,
  stakedBalance: 235795238232,
  unstakedBalance: 0,
  rollupBonds: 0,
  smartRollupBonds: 0,
};

// Conta de mainnet com `unstakedBalance` > 0, lida em 2026-09-01. É o caso que
// a versão anterior errava: ela liberava gastar os 4 000 XTZ que estão saindo
// de stake. O nó diz que o gastável são 233 129 mutez, e é esse o número.
const SAINDO_DE_STAKE = {
  type: 'user',
  address: 'tz1aLq132WVXyh7AmnNiVbWMRDS7rwGatLiQ',
  balance: 24015668853,
  stakedBalance: 20015435724,
  unstakedBalance: 4000000000,
  rollupBonds: 0,
  smartRollupBonds: 0,
};

describe('fetchAccount', () => {
  it('separa o que está em stake do que é gastável', async () => {
    const { http } = fakeTzKT([{ body: BAKE_NUG }]);
    const account = await fetchAccount(http, ADDRESS);

    expect(account.total).toBe(235999207943n);
    expect(account.staked).toBe(235795238232n);
    expect(account.spendable).toBe(203969711n);
    expect(account.seenOnChain).toBe(true);
  });

  it('tira do gastável o que está saindo de stake', async () => {
    const { http } = fakeTzKT([{ body: SAINDO_DE_STAKE }]);
    const account = await fetchAccount(http, SAINDO_DE_STAKE.address);

    // 24 015 668 853 − 20 015 435 724 − 4 000 000 000. O nó devolve o mesmo.
    expect(account.spendable).toBe(233129n);
    expect(account.unstaked).toBe(4_000_000_000n);
    expect(account.spendable + account.staked + account.unstaked + account.bonds).toBe(account.total);
  });

  it('tira do gastável o bond de rollup', async () => {
    const { http } = fakeTzKT([
      { body: { ...BAKE_NUG, stakedBalance: 0, balance: 1_000_000, rollupBonds: 400_000, smartRollupBonds: 100_000 } },
    ]);
    const account = await fetchAccount(http, ADDRESS);

    expect(account.bonds).toBe(500_000n);
    expect(account.spendable).toBe(500_000n);
  });

  it('trata conta nunca vista como ausência de conta, não como saldo zero', async () => {
    const { http } = fakeTzKT([
      { body: { type: 'empty', address: ADDRESS, counter: 221047432 } },
    ]);
    const account = await fetchAccount(http, ADDRESS);

    expect(account.seenOnChain).toBe(false);
    expect(account.total).toBe(0n);
  });

  it.each(['balance', 'stakedBalance', 'unstakedBalance', 'rollupBonds', 'smartRollupBonds'])(
    'levanta com o nome do campo quando %s não vem — nunca vira zero',
    async (campo) => {
      const incompleto: Record<string, unknown> = { ...BAKE_NUG };
      delete incompleto[campo];
      const { http } = fakeTzKT([{ body: incompleto }]);

      await expect(fetchAccount(http, ADDRESS)).rejects.toThrow(MissingFieldError);
      await expect(fetchAccount(http, ADDRESS)).rejects.toThrow(new RegExp(campo));
    },
  );

  it('recusa mostrar qualquer número quando o congelado é maior que o saldo', async () => {
    const { http } = fakeTzKT([{ body: { ...BAKE_NUG, balance: 1, stakedBalance: 2 } }]);

    await expect(fetchAccount(http, ADDRESS)).rejects.toThrow(InvariantViolationError);
  });

  it('a soma do congelado é conferida junta, não campo a campo', async () => {
    // Cada parte cabe no saldo; as três juntas não. Conferir uma de cada vez
    // deixaria passar, e o gastável sairia negativo.
    const { http } = fakeTzKT([
      { body: { ...BAKE_NUG, balance: 100, stakedBalance: 60, unstakedBalance: 60, rollupBonds: 0 } },
    ]);

    await expect(fetchAccount(http, ADDRESS)).rejects.toThrow(InvariantViolationError);
  });

  it('carimba a hora da leitura e o nível do indexador', async () => {
    const { http } = fakeTzKT([{ body: BAKE_NUG, headers: { 'tzkt-level': '14742856' } }]);
    const at = new Date('2026-08-31T15:17:07Z');
    const account = await fetchAccount(http, ADDRESS, () => at);

    expect(account.readAt).toEqual(at);
    expect(account.indexerLevel).toBe(14742856);
  });

  it('recusa dado de indexador atrasado além do aceito', async () => {
    const { http } = fakeTzKT([
      { body: BAKE_NUG, headers: { 'tzkt-level': '14742000', 'tzkt-known-level': '14742856' } },
    ]);

    await expect(fetchAccount(http, ADDRESS)).rejects.toThrow(/blocos atrás|behind/);
  });
});
