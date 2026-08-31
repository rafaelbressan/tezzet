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
};

describe('fetchAccount', () => {
  it('separa o que está em stake do que está delegado', async () => {
    const { http } = fakeTzKT([{ body: BAKE_NUG }]);
    const account = await fetchAccount(http, ADDRESS);

    expect(account.total).toBe(235999207943n);
    expect(account.staked).toBe(235795238232n);
    expect(account.delegated).toBe(203969711n);
    expect(account.seenOnChain).toBe(true);
  });

  it('trata conta nunca vista como ausência de conta, não como saldo zero', async () => {
    const { http } = fakeTzKT([
      { body: { type: 'empty', address: ADDRESS, counter: 221047432 } },
    ]);
    const account = await fetchAccount(http, ADDRESS);

    expect(account.seenOnChain).toBe(false);
    expect(account.total).toBe(0n);
  });

  it('levanta com o nome do campo quando stakedBalance não vem — nunca vira zero', async () => {
    const { stakedBalance, ...semStake } = BAKE_NUG;
    void stakedBalance;
    const { http } = fakeTzKT([{ body: semStake }]);

    await expect(fetchAccount(http, ADDRESS)).rejects.toThrow(MissingFieldError);
    await expect(fetchAccount(http, ADDRESS)).rejects.toThrow(/stakedBalance/);
  });

  it('recusa mostrar qualquer número quando stake é maior que o saldo', async () => {
    const { http } = fakeTzKT([
      { body: { ...BAKE_NUG, balance: 1, stakedBalance: 2 } },
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
