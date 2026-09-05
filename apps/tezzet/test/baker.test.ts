import { describe, expect, it } from 'vitest';
import { InvariantViolationError, MissingFieldError } from '@tezos-suite/chain';
import {
  BakerNotIndexedError,
  computeBakerCapacity,
  fetchBaker,
  formatEdgePercent,
  formatStakingLimit,
  NotABakerError,
} from '../src/chain/baker';
import { fakeStakingConstants } from './helpers/fake-chain';
import { fakeTzKT, TEST_NETWORK } from './helpers/fake-tzkt';

const constants = await fakeStakingConstants();

/**
 * `tz1eCs8…`, lido do nó da mainnet em 2026-09-05. É o baker que quebra as
 * duas contas mais fáceis ao mesmo tempo:
 *
 * - tem 16 996 297 589 mutez de stake de terceiros com um teto de 5× sobre
 *   2 843 299 019 de stake próprio: **2 779 802 494 acima**, e a cadeia conta
 *   esse excedente como delegação em vez de recusá-lo;
 * - a conta ingênua dá 21 693 861 730 e a que só trunca o stake dá
 *   18 914 059 236. O nó diz **19 840 660 068**.
 */
const RPC_COM_EXCEDENTE = {
  deactivated: false,
  baking_power: '19840660068',
  total_staked: '19839596608',
  total_delegated: '5562795368',
  min_delegated_in_current_cycle: { amount: '5562795368' },
  own_staked: '2843299019',
  own_delegated: '5509335300',
  external_staked: '16996297589',
  external_delegated: '53460068',
  active_staking_parameters: {
    limit_of_staking_over_baking_millionth: 5000000,
    edge_of_baking_over_staking_billionth: 50000000,
  },
};

const TZKT_ROW = {
  address: 'tz1eCs8nFQiKTqwcqQjKyz8QGMCQ4JAXbPS8',
  alias: 'Um baker qualquer',
  numDelegators: 12,
  stakersCount: 30,
  lastActivityTime: '2026-09-05T22:50:00Z',
  software: { version: 'v25.1' },
};

const ADDRESS = TZKT_ROW.address;

function fakeNode(body: unknown, status = 200): typeof fetch {
  return async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
}

describe('computeBakerCapacity', () => {
  it('conta o stake acima do limite como delegação, e não como perda', () => {
    const capacity = computeBakerCapacity(
      {
        ownStaked: 2_843_299_019n,
        externalStaked: 16_996_297_589n,
        delegated: 5_562_795_368n,
        minDelegated: 5_562_795_368n,
        stakingLimitMillionth: 5_000_000n,
      },
      constants,
    );

    expect(capacity.bakingPower).toBe(19_840_660_068n);
    expect(capacity.overStaked).toBe(2_779_802_494n);
    expect(capacity.stakingFreeSpace).toBe(0n);
  });

  it('o poder usa o delegado mínimo do ciclo, não o de agora', () => {
    // Delegado agora bem maior que o mínimo do ciclo: usar o de agora deixaria
    // alguém inflar o peso por um bloco e ser pago por ele. Na mainnet, usar o
    // de agora acerta em 50 dos 198 bakers; usar o mínimo acerta nos 198.
    const capacity = computeBakerCapacity(
      {
        ownStaked: 1_000_000_000n,
        externalStaked: 0n,
        delegated: 900_000_000n,
        minDelegated: 300_000_000n,
        stakingLimitMillionth: 0n,
      },
      constants,
    );

    expect(capacity.bakingPower).toBe(1_000_000_000n + 300_000_000n / 3n);
  });

  it('mas a capacidade livre usa o delegado de agora — a conta fica conservadora', () => {
    const capacity = computeBakerCapacity(
      {
        ownStaked: 1_000_000_000n,
        externalStaked: 0n,
        delegated: 900_000_000n,
        minDelegated: 300_000_000n,
        stakingLimitMillionth: 0n,
      },
      constants,
    );

    // 9 × 1 000 XTZ de capacidade, menos os 900 XTZ que já estão lá agora.
    expect(capacity.delegationCapacity).toBe(9_000_000_000n);
    expect(capacity.delegationFreeSpace).toBe(9_000_000_000n - 900_000_000n);
  });

  it('respeita o limite global mesmo quando o baker pede mais', () => {
    const pedindo20x = computeBakerCapacity(
      {
        ownStaked: 1_000_000_000n,
        externalStaked: 0n,
        delegated: 0n,
        minDelegated: 0n,
        stakingLimitMillionth: 20_000_000n,
      },
      constants,
    );

    // global_limit_of_staking_over_baking é 9, e 9 × 1 000 XTZ é o teto.
    expect(pedindo20x.stakingCapacity).toBe(9_000_000_000n);
  });

  it('um baker que nunca definiu parâmetros não aceita stake nenhum', () => {
    const capacity = computeBakerCapacity(
      {
        ownStaked: 7_566_866_415_655n,
        externalStaked: 0n,
        delegated: 0n,
        minDelegated: 0n,
        stakingLimitMillionth: 0n,
      },
      constants,
    );

    expect(capacity.stakingCapacity).toBe(0n);
    expect(capacity.stakingFreeSpace).toBe(0n);
  });

  it('o excedente de stake ocupa espaço de delegação', () => {
    const semExcedente = computeBakerCapacity(
      {
        ownStaked: 1_000_000_000n,
        externalStaked: 0n,
        delegated: 0n,
        minDelegated: 0n,
        stakingLimitMillionth: 5_000_000n,
      },
      constants,
    );
    const comExcedente = computeBakerCapacity(
      {
        ownStaked: 1_000_000_000n,
        externalStaked: 6_000_000_000n,
        delegated: 0n,
        minDelegated: 0n,
        stakingLimitMillionth: 5_000_000n,
      },
      constants,
    );

    expect(comExcedente.overStaked).toBe(1_000_000_000n);
    // Ignorar o excedente diria que cabe 1 000 XTZ a mais de delegação do que
    // a cadeia aceita contar.
    expect(comExcedente.delegationFreeSpace).toBe(semExcedente.delegationFreeSpace - 1_000_000_000n);
  });
});

describe('fetchBaker', () => {
  it('tira os números do nó e o nome do indexador', async () => {
    const { http } = fakeTzKT([{ body: TZKT_ROW }]);
    const baker = await fetchBaker(http, TEST_NETWORK, ADDRESS, constants, {
      fetchImpl: fakeNode(RPC_COM_EXCEDENTE),
    });

    expect(baker.active).toBe(true);
    expect(baker.bakingPower).toBe(19_840_660_068n);
    expect(baker.stakingEdgeBillionth).toBe(50_000_000n);
    expect(baker.alias).toBe('Um baker qualquer');
    expect(baker.delegatorsCount).toBe(12);
    expect(baker.softwareVersion).toBe('v25.1');
  });

  it('o nó recusa com 500 e "not_registered" — isso é "não é baker", não falha de rede', async () => {
    // Tratar todo 500 como erro de rede faria a pessoa tentar de novo para
    // sempre num endereço que nunca vai virar baker.
    const { http } = fakeTzKT([{ body: TZKT_ROW }]);

    await expect(
      fetchBaker(http, TEST_NETWORK, ADDRESS, constants, {
        fetchImpl: fakeNode(
          '[{"kind":"temporary","id":"proto.025-PsUshuai.delegate.not_registered","pkh":"tz1x"}]',
          500,
        ),
      }),
    ).rejects.toThrow(NotABakerError);
  });

  it('um 500 de verdade continua sendo falha de rede', async () => {
    const { http } = fakeTzKT([{ body: TZKT_ROW }]);

    await expect(
      fetchBaker(http, TEST_NETWORK, ADDRESS, constants, {
        fetchImpl: fakeNode('erro interno', 500),
      }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it('nó conhece e indexador não: é atraso do indexador, não ausência de baker', async () => {
    const { http } = fakeTzKT([{ status: 204 }]);

    await expect(
      fetchBaker(http, TEST_NETWORK, ADDRESS, constants, {
        fetchImpl: fakeNode(RPC_COM_EXCEDENTE),
      }),
    ).rejects.toThrow(BakerNotIndexedError);
  });

  it('recusa mostrar capacidade quando a conta não reproduz o poder do nó', async () => {
    // Um mutez a mais no poder reportado: a conta deixa de fechar e nenhum
    // número de capacidade pode ser mostrado.
    const { http } = fakeTzKT([{ body: TZKT_ROW }]);

    await expect(
      fetchBaker(http, TEST_NETWORK, ADDRESS, constants, {
        fetchImpl: fakeNode({ ...RPC_COM_EXCEDENTE, baking_power: '19840660069' }),
      }),
    ).rejects.toThrow(InvariantViolationError);
  });

  it.each(['own_staked', 'external_staked', 'total_delegated', 'baking_power'])(
    'levanta com o nome do campo quando o nó não manda %s',
    async (field) => {
      const incompleto: Record<string, unknown> = { ...RPC_COM_EXCEDENTE };
      delete incompleto[field];
      const { http } = fakeTzKT([{ body: TZKT_ROW }]);

      await expect(
        fetchBaker(http, TEST_NETWORK, ADDRESS, constants, { fetchImpl: fakeNode(incompleto) }),
      ).rejects.toThrow(MissingFieldError);
    },
  );

  it('levanta quando falta o delegado mínimo do ciclo — ele decide o poder', async () => {
    const semMinimo: Record<string, unknown> = { ...RPC_COM_EXCEDENTE };
    delete semMinimo['min_delegated_in_current_cycle'];
    const { http } = fakeTzKT([{ body: TZKT_ROW }]);

    await expect(
      fetchBaker(http, TEST_NETWORK, ADDRESS, constants, { fetchImpl: fakeNode(semMinimo) }),
    ).rejects.toThrow();
  });

  it('baker desativado é lido como desativado, e a tela avisa', async () => {
    const { http } = fakeTzKT([{ body: TZKT_ROW }]);
    const baker = await fetchBaker(http, TEST_NETWORK, ADDRESS, constants, {
      fetchImpl: fakeNode({ ...RPC_COM_EXCEDENTE, deactivated: true }),
    });

    expect(baker.active).toBe(false);
  });
});

describe('a taxa e o limite em texto', () => {
  it('bilionésimo vira porcentagem, e não um número mil vezes maior', () => {
    expect(formatEdgePercent(90_000_000n)).toBe('9,00%');
    expect(formatEdgePercent(50_000_000n)).toBe('5,00%');
    expect(formatEdgePercent(0n)).toBe('0,00%');
    // O padrão de quem nunca chamou set_delegate_parameters: fica com tudo.
    expect(formatEdgePercent(1_000_000_000n)).toBe('100,00%');
  });

  it('milionésimo vira múltiplo', () => {
    expect(formatStakingLimit(5_000_000n)).toBe('5,00×');
    expect(formatStakingLimit(0n)).toBe('0,00×');
    expect(formatStakingLimit(9_000_000n)).toBe('9,00×');
  });
});
