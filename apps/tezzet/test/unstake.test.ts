import { describe, expect, it } from 'vitest';
import { FieldTypeError, MissingFieldError } from '@tezos-suite/chain';
import {
  computeUnstakeWait,
  fetchCycleWindow,
  fetchOpenUnstakeRequests,
  finalizableTotal,
} from '../src/chain/unstake';
import { fakeStakingConstants, RAW_CONSTANTS } from './helpers/fake-chain';
import { fakeTzKT } from './helpers/fake-tzkt';

const constants = await fakeStakingConstants();

/**
 * Pedido real da mainnet, lido em 2026-09-05: feito no ciclo 1344, liberando
 * no ciclo 1348, no nível 14 865 889. O ciclo 1344 começa no nível
 * 14 808 289, e 14 808 289 + 4 × 14 400 = 14 865 889.
 *
 * Esses três números são o teste. A constante da cadeia diz 3, e a espera é
 * de 4 ciclos — mostrar 3 seria prometer um dia a menos do que a cadeia dá.
 */
const JANELA_1344 = { headLevel: 14_818_898, cycle: 1344, cycleFirstLevel: 14_808_289 };

describe('computeUnstakeWait', () => {
  it('bate com o ciclo e o nível de liberação que a cadeia produziu', () => {
    const wait = computeUnstakeWait(JANELA_1344, constants, () => new Date('2026-09-05T22:52:00Z'));

    expect(wait.unlockCycle).toBe(1348);
    expect(wait.unlockLevel).toBe(14_865_889);
    expect(wait.cyclesToWait).toBe(4);
  });

  it('conta os blocos que faltam a partir de agora, não do começo do ciclo', () => {
    const wait = computeUnstakeWait(JANELA_1344, constants);

    // 14 865 889 − 14 818 898 = 46 991 blocos, e não os 57 600 de quatro
    // ciclos inteiros: quem pede no meio do ciclo espera menos.
    expect(wait.blocksToWait).toBe(46_991);
    expect(wait.secondsAtMinimum).toBe(46_991 * 6);
  });

  it('quem pede no primeiro bloco do ciclo espera quase quatro ciclos inteiros', () => {
    const noComeco = computeUnstakeWait(
      { ...JANELA_1344, headLevel: JANELA_1344.cycleFirstLevel },
      constants,
    );

    expect(noComeco.blocksToWait).toBe(4 * 14_400);
    expect(noComeco.unlockCycle).toBe(1348);
  });

  it('a data mais cedo sai da hora de agora mais a espera no tempo mínimo', () => {
    const agora = new Date('2026-09-05T22:52:00Z');
    const wait = computeUnstakeWait(JANELA_1344, constants, () => agora);

    expect(wait.earliestAt.getTime()).toBe(agora.getTime() + 46_991 * 6 * 1000);
  });

  it('acompanha uma rede com espera diferente, sem número escrito no código', async () => {
    const outra = await fakeStakingConstants({
      ...RAW_CONSTANTS,
      unstake_finalization_delay: 5,
    });
    const wait = computeUnstakeWait(JANELA_1344, outra);

    expect(wait.cyclesToWait).toBe(6);
    expect(wait.unlockCycle).toBe(1350);
  });
});

describe('fetchCycleWindow', () => {
  it('lê o primeiro nível do ciclo em vez de multiplicar ciclo por blocos', async () => {
    const { http, calls } = fakeTzKT([
      { body: { chainId: 'NetXdQprcVkpaWU', level: 14_818_898, cycle: 1344, protocol: 'PsUshuai', knownLevel: 14_818_898 } },
      { body: { index: 1344, firstLevel: 14_808_289, lastLevel: 14_822_688 } },
    ]);
    const window = await fetchCycleWindow(http);

    expect(window.cycleFirstLevel).toBe(14_808_289);
    // 1344 × 14 400 daria 19 353 600 — as fronteiras de ciclo andaram em
    // migrações de protocolo, e a multiplicação erra em toda cadeia migrada.
    expect(window.cycleFirstLevel).not.toBe(1344 * 14_400);
    expect(calls[1]).toContain('/v1/cycles/1344');
  });

  it('levanta quando o ciclo volta sem firstLevel', async () => {
    const { http } = fakeTzKT([
      { body: { chainId: 'x', level: 1, cycle: 1344, protocol: 'p', knownLevel: 1 } },
      { body: { index: 1344 } },
    ]);

    await expect(fetchCycleWindow(http)).rejects.toThrow(MissingFieldError);
  });
});

/** Linha real da TzKT, do pedido pendente do ciclo 1344. */
const PEDIDO = {
  id: 27514,
  cycle: 1344,
  baker: { address: 'tz3W7k9v3uniY1f2HQRKxymJybNvH3FgvZ5N' },
  staker: { address: 'tz3W7k9v3uniY1f2HQRKxymJybNvH3FgvZ5N' },
  requestedAmount: 15133366888,
  restakedAmount: 0,
  finalizedAmount: 0,
  slashedAmount: 0,
  actualAmount: 15133366888,
  status: 'pending',
  unlockCycle: 1348,
  unlockLevel: 14865889,
  unlockTime: '2026-09-09T05:11:43Z',
};

describe('fetchOpenUnstakeRequests', () => {
  it('pede só o que ainda está aberto, ordenado pela liberação', async () => {
    const { http, calls } = fakeTzKT([{ body: [PEDIDO] }]);
    const requests = await fetchOpenUnstakeRequests(http, PEDIDO.staker.address);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.remaining).toBe(15_133_366_888n);
    expect(requests[0]?.unlockCycle).toBe(1348);
    expect(calls[0]).toContain('status.ne=finalized');
    expect(calls[0]).toContain('sort.asc=unlockLevel');
  });

  it('recusa um status que não conhece em vez de tratar como pendente', async () => {
    const { http } = fakeTzKT([{ body: [{ ...PEDIDO, status: 'liberado' }] }]);

    await expect(fetchOpenUnstakeRequests(http, PEDIDO.staker.address)).rejects.toThrow(
      FieldTypeError,
    );
  });

  it('levanta quando actualAmount não vem — o valor parado não vira zero', async () => {
    const semValor: Record<string, unknown> = { ...PEDIDO };
    delete semValor['actualAmount'];
    const { http } = fakeTzKT([{ body: [semValor] }]);

    await expect(fetchOpenUnstakeRequests(http, PEDIDO.staker.address)).rejects.toThrow(
      MissingFieldError,
    );
  });

  it('lista vazia é lista vazia, não erro', async () => {
    const { http } = fakeTzKT([{ body: [] }]);

    expect(await fetchOpenUnstakeRequests(http, PEDIDO.staker.address)).toEqual([]);
  });
});

describe('finalizableTotal', () => {
  it('soma só o que já cumpriu a espera — pendente não conta', async () => {
    const { http } = fakeTzKT([
      {
        body: [
          PEDIDO,
          { ...PEDIDO, id: 27515, status: 'finalizable', actualAmount: 400 },
          { ...PEDIDO, id: 27516, status: 'finalizable', actualAmount: 600 },
        ],
      },
    ]);
    const requests = await fetchOpenUnstakeRequests(http, PEDIDO.staker.address);

    expect(finalizableTotal(requests)).toBe(1000n);
  });

  it('sem nada liberado o total é zero, e a tela não oferece finalizar', async () => {
    const { http } = fakeTzKT([{ body: [PEDIDO] }]);

    expect(finalizableTotal(await fetchOpenUnstakeRequests(http, PEDIDO.staker.address))).toBe(0n);
  });
});
