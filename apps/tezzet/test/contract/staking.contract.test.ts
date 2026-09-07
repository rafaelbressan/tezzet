import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  HttpRpcSource,
  ProtocolConstantsProvider,
  TzKTHttp,
  requireInteger,
  requireMutez,
  requireObject,
  requireString,
} from '@tezos-suite/chain';
import { PrefixV2, b58Encode } from '@taquito/utils';
import { fetchAccount } from '../../src/chain/account';
import { fetchBaker, NotABakerError } from '../../src/chain/baker';
import { fetchBakerRecord, measureStakingYield } from '../../src/chain/baker-record';
import { readStakingConstants } from '../../src/chain/protocol';
import { computeUnstakeWait, fetchCycleWindow } from '../../src/chain/unstake';
import { parseNetworkCatalog, selectNetwork, type TezzetNetwork } from '../../src/config/networks';
import { MAX_INDEXER_LAG_BLOCKS } from '../../src/state/session';

/**
 * Teste de contrato de delegação e stake: fala com a Shadownet e com a
 * mainnet de verdade. Roda em `npm run test:contract`, não no `npm test`.
 *
 * Ele existe para reprovar duas coisas que um teste contra fixture nunca
 * reprovaria:
 *
 *  1. **A conta da espera do unstake.** Aqui ela é conferida contra o que a
 *     cadeia realmente fez: um pedido real da rede traz o `unlockCycle` e o
 *     `unlockLevel` que o protocolo atribuiu, e a conta do app precisa dar
 *     exatamente os mesmos números. Nenhuma fixture prova isso, porque a
 *     fixture é escrita por quem também escreveu a conta.
 *  2. **A lei do poder de baker.** `fetchBaker` levanta quando a conta não
 *     reproduz o poder reportado, então rodar contra um baker de verdade é o
 *     próprio teste — se o protocolo mudar a regra, isto reprova.
 */
const catalog = parseNetworkCatalog(JSON.parse(readFileSync('public/networks.json', 'utf8')));
const shadownet = selectNetwork(catalog, 'shadownet');
const mainnet = selectNetwork(catalog, 'mainnet');

const tzkt = (network: TezzetNetwork) =>
  new TzKTHttp(network.endpoints, { maxLagBlocks: MAX_INDEXER_LAG_BLOCKS });

const stakingConstants = async (network: TezzetNetwork) =>
  readStakingConstants(
    await new ProtocolConstantsProvider(new HttpRpcSource(network.endpoints)).get(),
  );

/** Um pedido de saída de stake que a cadeia já resolveu, com os campos crus. */
async function pedidoReal(network: TezzetNetwork) {
  const http = tzkt(network);
  const { body } = await http.get<unknown[]>('/v1/staking/unstake_requests', {
    limit: 1,
    'sort.desc': 'id',
  });
  const rows = body ?? [];
  expect(rows.length, `${network.label} não tem nenhum pedido de unstake para conferir`).toBe(1);
  const row = requireObject(rows[0], 'unstake_requests[0]');

  const cycle = requireInteger(row, 'cycle', 'unstake_requests[0]');
  const { body: cycleBody } = await http.getRequired<Record<string, unknown>>(
    `/v1/cycles/${cycle}`,
  );

  return {
    cycle,
    cycleFirstLevel: requireInteger(requireObject(cycleBody, 'cycle'), 'firstLevel', 'cycle'),
    unlockCycle: requireInteger(row, 'unlockCycle', 'unstake_requests[0]'),
    unlockLevel: requireInteger(row, 'unlockLevel', 'unstake_requests[0]'),
  };
}

/**
 * BRES-119. O que a cadeia guarda de stake externo **não** é mutez: é
 * pseudotoken. A ida arredonda para baixo e a volta é reavaliada a cada
 * ciclo, então o saldo em stake de uma conta não é a soma do que ela pediu.
 *
 * Encontrado assinando na Shadownet em 2026-09-06: 50,000000 pedidos
 * congelaram 49,999999, e um "continua em stake" de 29,999999 virou
 * 30,000004 minutos depois. A tela prometia esses números como exatos.
 *
 * Este teste é o que impede a promessa de voltar. Ele não pode assinar nada
 * — não existe chave neste repositório, e `sem-chave.test.ts` garante que
 * não vai existir —, então ele afirma o mesmo fato pelo lado da leitura: em
 * contas reais, o saldo em stake diverge da soma dos pedidos. No dia em que
 * parar de divergir para todo mundo, o aviso da tela virou mentira e esta
 * linha reprova.
 */
async function stakersComHistoricoCompleto(network: TezzetNetwork, quantos: number) {
  const http = tzkt(network);
  const { body: recentes } = await http.get<unknown[]>('/v1/staking/updates', {
    limit: 200,
    'sort.desc': 'id',
    type: 'stake',
    select: 'staker',
  });

  const enderecos: string[] = [];
  for (const value of recentes ?? []) {
    const address = requireString(requireObject(value, '/v1/staking/updates[].staker'), 'address', '/v1/staking/updates[].staker');
    if (!enderecos.includes(address)) enderecos.push(address);
    if (enderecos.length === quantos) break;
  }
  expect(enderecos.length, `${network.label} não tem nenhum stake recente para conferir`).toBeGreaterThan(0);

  const LIMITE = 1000;
  const contas = [];
  for (const address of enderecos) {
    const { body: updates } = await http.get<unknown[]>('/v1/staking/updates', {
      staker: address,
      limit: LIMITE,
      'sort.asc': 'id',
    });
    const rows = updates ?? [];
    // Histórico truncado não serve: a soma sairia incompleta e a divergência
    // seria do teste, não da cadeia.
    if (rows.length >= LIMITE) continue;

    let pedidoLiquidoMutez = 0n;
    for (const [index, value] of rows.entries()) {
      const where = `/v1/staking/updates[${index}]`;
      const row = requireObject(value, where);
      const type = requireString(row, 'type', where);
      if (type === 'stake') pedidoLiquidoMutez += requireMutez(row, 'amount', where);
      if (type === 'unstake') pedidoLiquidoMutez -= requireMutez(row, 'amount', where);
    }

    const conta = await fetchAccount(http, address);
    contas.push({ address, pedidoLiquidoMutez, stakedMutez: conta.staked });
  }

  return contas;
}

describe.each([
  ['Shadownet', shadownet],
  ['Mainnet', mainnet],
])('%s, de verdade', (_name, network) => {
  it('a espera do unstake que o app calcula é a que a cadeia aplicou', async () => {
    const [constants, pedido] = await Promise.all([
      stakingConstants(network),
      pedidoReal(network),
    ]);

    const wait = computeUnstakeWait(
      {
        // O nível da cabeça não muda o ciclo nem o nível de liberação; ele só
        // decide quantos blocos ainda faltam. Aqui vale o começo do ciclo.
        headLevel: pedido.cycleFirstLevel,
        cycle: pedido.cycle,
        cycleFirstLevel: pedido.cycleFirstLevel,
      },
      constants,
    );

    expect(wait.unlockCycle).toBe(pedido.unlockCycle);
    expect(wait.unlockLevel).toBe(pedido.unlockLevel);
    // A constante da cadeia é o atraso, e a espera é um ciclo a mais. Se
    // alguém "simplificar" tirando o +1, esta linha reprova.
    expect(wait.cyclesToWait).toBe(constants.unstakeFinalizationDelay + 1);
  }, 30_000);

  it('a lei do poder de baker fecha em bakers vivos da rede', async () => {
    const http = tzkt(network);
    const constants = await stakingConstants(network);

    const { body } = await http.get<unknown[]>('/v1/delegates', {
      limit: 12,
      active: 'true',
      select: 'address',
    });
    const addresses = (body ?? []).map((value) => String(value));
    expect(addresses.length).toBeGreaterThan(0);

    for (const address of addresses) {
      // `fetchBaker` levanta InvariantViolationError quando a conta não
      // reproduz o `baking_power` que o nó reporta — chamar já é a afirmação.
      const baker = await fetchBaker(http, network.endpoints, address, constants);
      expect(baker.address).toBe(address);
      expect(baker.stakingFreeSpace).toBeGreaterThanOrEqual(0n);
      expect(baker.delegationFreeSpace).toBeGreaterThanOrEqual(0n);
    }
  }, 120_000);

  it('um endereço que não é baker é recusado como tal, e não como falha de rede', async () => {
    const http = tzkt(network);
    const constants = await stakingConstants(network);

    // O nó responde HTTP 500 com `delegate.not_registered` — o endereço abaixo
    // vem de 20 bytes fixos e ninguém tem a chave dele.
    const naoBaker = b58Encode(new Uint8Array(20).fill(0xbe), PrefixV2.Ed25519PublicKeyHash);

    await expect(fetchBaker(http, network.endpoints, naoBaker, constants)).rejects.toThrow(
      NotABakerError,
    );
  }, 30_000);

  it('o saldo em stake não é a soma dos mutez pedidos — a cadeia guarda pseudotokens', async () => {
    const contas = await stakersComHistoricoCompleto(network, 8);
    expect(contas.length, `${network.label} não deu nenhum staker com histórico inteiro`).toBeGreaterThan(0);

    const divergentes = contas.filter((conta) => conta.stakedMutez !== conta.pedidoLiquidoMutez);
    const relato = contas
      .map((c) => `${c.address}: pedido ${c.pedidoLiquidoMutez} mutez, em stake ${c.stakedMutez} mutez (${c.stakedMutez - c.pedidoLiquidoMutez})`)
      .join('\n');

    expect(
      divergentes.length,
      'nenhuma conta divergiu: se isso for verdade, o stake voltou a ser guardado em ' +
        `mutez e o aviso da revisão virou mentira\n${relato}`,
    ).toBeGreaterThan(0);

    // O que a tela promete é `pedido`; o que a cadeia mostra depois é
    // `stakedMutez`. A diferença é o tamanho da mentira que o aviso cobre.
    for (const conta of divergentes) {
      expect(conta.stakedMutez).toBeGreaterThanOrEqual(0n);
    }
  }, 120_000);

  it('o rendimento de stake sai de ciclos fechados de verdade, ou diz que não sabe', async () => {
    const http = tzkt(network);
    const constants = await stakingConstants(network);
    const window = await fetchCycleWindow(http);

    const { body } = await http.get<unknown[]>('/v1/delegates', {
      limit: 200,
      active: 'true',
      select: 'address,externalStakedBalance',
    });
    const comStake = (body ?? [])
      .map((value) => requireObject(value, '/v1/delegates[]'))
      .find((row) => Number(row['externalStakedBalance']) > 0);
    expect(comStake, `${network.label} não tem baker com stake de terceiros`).toBeDefined();

    const address = String(comStake?.['address']);
    const records = await fetchBakerRecord(http, address, window.cycle, { cycles: 3 });
    const measured = measureStakingYield(records, constants);

    if (measured.kind === 'unavailable') {
      // Não saber é uma resposta válida, e ela precisa vir com o motivo.
      expect(measured.reason.length).toBeGreaterThan(10);
      return;
    }
    expect(measured.base).toBeGreaterThan(0n);
    expect(measured.perCycleBillionth).toBeGreaterThanOrEqual(0n);
    // Um rendimento de mais de 1 000% ao ano seria erro de unidade, não juro.
    expect(measured.annualBillionth).toBeLessThan(10_000_000_000n);
  }, 60_000);
});
