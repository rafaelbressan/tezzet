import { describe, expect, it } from 'vitest';
import {
  FieldTypeError,
  InvariantViolationError,
  MissingFieldError,
  ProtocolConstantsProvider,
} from '@tezos-suite/chain';
import { cyclesPerYear, readStakingConstants } from '../src/chain/protocol';
import { fakeRpc, fakeStakingConstants, RAW_CONSTANTS } from './helpers/fake-chain';

async function constantsFrom(raw: Record<string, unknown>) {
  return new ProtocolConstantsProvider(fakeRpc(raw)).get();
}

describe('readStakingConstants', () => {
  it('lê as quatro constantes da cadeia, sem nenhuma escrita no código', async () => {
    const constants = await fakeStakingConstants();

    expect(constants.unstakeFinalizationDelay).toBe(3);
    expect(constants.limitOfDelegationOverBaking).toBe(9);
    expect(constants.globalLimitOfStakingOverBaking).toBe(9);
    expect(constants.edgeOfStakingOverDelegation).toBe(3);
    expect(constants.blocksPerCycle).toBe(14400);
    expect(constants.minimalBlockDelay).toBe(6);
  });

  it.each([
    'unstake_finalization_delay',
    'limit_of_delegation_over_baking',
    'global_limit_of_staking_over_baking',
  ])('levanta com o nome do campo quando %s falta — nunca vira zero', async (field) => {
    const raw = { ...RAW_CONSTANTS };
    delete raw[field];

    await expect(constantsFrom(raw).then(readStakingConstants)).rejects.toThrow(MissingFieldError);
    await expect(constantsFrom(raw).then(readStakingConstants)).rejects.toThrow(new RegExp(field));
  });

  it('recusa um valor que não é inteiro em vez de arredondar', async () => {
    const raw = { ...RAW_CONSTANTS, unstake_finalization_delay: 3.5 };

    await expect(constantsFrom(raw).then(readStakingConstants)).rejects.toThrow(FieldTypeError);
  });

  it.each(['limit_of_delegation_over_baking', 'global_limit_of_staking_over_baking'])(
    'recusa %s igual a zero — capacidade infinita não é uma leitura',
    async (field) => {
      const raw = { ...RAW_CONSTANTS, [field]: 0 };

      await expect(constantsFrom(raw).then(readStakingConstants)).rejects.toThrow(
        InvariantViolationError,
      );
    },
  );

  it('recusa edge_of_staking_over_delegation zero — seria divisão por zero calada', async () => {
    const raw = { ...RAW_CONSTANTS, edge_of_staking_over_delegation: 0 };

    await expect(constantsFrom(raw).then(readStakingConstants)).rejects.toThrow(
      InvariantViolationError,
    );
  });

  it('aceita espera zero, e recusa espera negativa', async () => {
    const semEspera = await constantsFrom({ ...RAW_CONSTANTS, unstake_finalization_delay: 0 });
    expect(readStakingConstants(semEspera).unstakeFinalizationDelay).toBe(0);

    const negativa = { ...RAW_CONSTANTS, unstake_finalization_delay: -1 };
    await expect(constantsFrom(negativa).then(readStakingConstants)).rejects.toThrow(
      InvariantViolationError,
    );
  });
});

describe('cyclesPerYear', () => {
  it('deriva dos números da cadeia em vez de trazer 365 escrito', async () => {
    // 14400 blocos × 6 s = 86 400 s por ciclo, e 365,25 dias no ano.
    expect(cyclesPerYear(await fakeStakingConstants())).toBeCloseTo(365.25, 5);
  });

  it('acompanha uma rede com ciclo mais curto', async () => {
    // Bakingnet tem blocks_per_cycle 3600: quatro vezes mais ciclos no ano.
    const curto = await fakeStakingConstants({ ...RAW_CONSTANTS, blocks_per_cycle: 3600 });

    expect(cyclesPerYear(curto)).toBeCloseTo(1461, 5);
  });
});
