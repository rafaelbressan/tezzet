import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PrefixV2, b58Encode } from '@taquito/utils';
import { TzKTHttp, requireObject, requireString } from '@tezos-suite/chain';
import { fetchAccount } from '../../src/chain/account';
import { fetchHistoryPage } from '../../src/chain/history';
import { parseNetworkCatalog, selectNetwork, type TezzetNetwork } from '../../src/config/networks';
import { MAX_INDEXER_LAG_BLOCKS } from '../../src/state/session';

/**
 * Teste de contrato: fala com a TzKT e com o nó de verdade.
 *
 * Não roda no `npm test` — roda em `npm run test:contract`, antes de release e
 * na rotina diária. É o único teste capaz de reprovar quando a API remove um
 * campo: contra fixture, oito campos removidos continuaram sendo somados como
 * zero durante meses, e nada acusou.
 *
 * A versão anterior deste arquivo afirmava `total === staked + delegado`, que
 * era a própria definição da conta feita em `account.ts` — verdadeira para
 * qualquer entrada, incapaz de reprovar. Ela passou verde enquanto o app
 * liberava gastar o saldo saindo de stake. Hoje o gastável é conferido contra
 * **outra fonte**: o `balance` do RPC do nó, que é o gastável segundo o
 * protocolo.
 */
const catalog = parseNetworkCatalog(JSON.parse(readFileSync('public/networks.json', 'utf8')));
const shadownet = selectNetwork(catalog, 'shadownet');
const mainnet = selectNetwork(catalog, 'mainnet');

const tzkt = (network: TezzetNetwork) =>
  new TzKTHttp(network.endpoints, { maxLagBlocks: MAX_INDEXER_LAG_BLOCKS });

const CONTA_ATIVA = 'tz1TfBtHD87eRJnSn4vvnsE1JGzKvpoKLJMj';

/** `/context/contracts/{addr}/balance` do Octez é o **gastável**, não o cheio. */
async function gastavelSegundoONo(network: TezzetNetwork, address: string): Promise<bigint> {
  const url = `${network.endpoints.rpcUrl}/chains/main/blocks/head/context/contracts/${address}/balance`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`RPC respondeu HTTP ${response.status} para ${url}`);
  return BigInt(JSON.parse(await response.text()) as string);
}

async function conferirGastavel(network: TezzetNetwork, address: string) {
  const [snapshot, doNo] = await Promise.all([
    fetchAccount(tzkt(network), address),
    gastavelSegundoONo(network, address),
  ]);

  // Duas leituras podem cair em blocos diferentes; a conferência tolera isso
  // e ainda assim reprovaria a soma errada, que erra por bilhões de mutez.
  const diferenca = snapshot.spendable > doNo ? snapshot.spendable - doNo : doNo - snapshot.spendable;
  expect(
    diferenca,
    `TzKT diz ${snapshot.spendable} mutez gastáveis e o nó diz ${doNo} — ` +
      `total ${snapshot.total}, stake ${snapshot.staked}, saindo ${snapshot.unstaked}, bond ${snapshot.bonds}`,
  ).toBeLessThanOrEqual(1_000_000n);

  return snapshot;
}

describe('Shadownet, de verdade', () => {
  it('o gastável bate com o que o nó diz ser gastável', async () => {
    const snapshot = await conferirGastavel(shadownet, CONTA_ATIVA);

    expect(snapshot.seenOnChain).toBe(true);
    expect(snapshot.spendable + snapshot.staked + snapshot.unstaked + snapshot.bonds).toBe(snapshot.total);
  }, 30_000);

  it('lê o histórico e pagina com cursor', async () => {
    const primeira = await fetchHistoryPage(tzkt(shadownet), CONTA_ATIVA, { limit: 5 });

    expect(primeira.entries.length).toBeGreaterThan(0);
    expect(primeira.indexerLevel).toBeGreaterThan(0);

    if (primeira.nextCursor !== null) {
      const segunda = await fetchHistoryPage(tzkt(shadownet), CONTA_ATIVA, {
        limit: 5,
        cursor: primeira.nextCursor,
      });
      const idsDaPrimeira = new Set(primeira.entries.map((entry) => entry.id));
      // Nenhuma linha se repete entre páginas: é o que `offset` não garante.
      for (const entry of segunda.entries) expect(idsDaPrimeira.has(entry.id)).toBe(false);
    }
  }, 30_000);

  it('conta que nunca existiu volta como ausência, não como saldo zero', async () => {
    // Endereço derivado de 20 bytes fixos: base58 e checksum válidos, e
    // ninguém tem a chave dele. A versão anterior apontava para um endereço
    // real da Shadownet que estava vazio no dia em que o teste foi escrito e
    // recebeu 100 XTZ depois — um teste que dependia de a conta de outra
    // pessoa continuar vazia.
    const nunca = b58Encode(new Uint8Array(20).fill(0xbe), PrefixV2.Ed25519PublicKeyHash);
    const account = await fetchAccount(tzkt(shadownet), nunca);

    expect(account.seenOnChain).toBe(false);
  }, 30_000);
});

describe('mainnet, só leitura', () => {
  /**
   * A Shadownet quase não tem conta com saldo saindo de stake, e é justamente
   * esse o caso que a versão anterior errava. Este teste lê — e só lê — uma
   * conta de mainnet que tem, para que a conferência exista de fato.
   */
  it('conta com saldo saindo de stake: o gastável exclui o que está saindo', async () => {
    // A conta é procurada, não escrita: quem tem um pedido de unstake ainda
    // pendente tem, por construção, saldo saindo de stake. A versão anterior
    // fixava `tz1aLq13…`, que finalizou o unstake dela e zerou o campo — o
    // teste passou a reprovar sozinho, sem ninguém ter mexido no código.
    const comUnstake = await stakerComUnstakePendente(mainnet);
    const snapshot = await conferirGastavel(mainnet, comUnstake);

    expect(snapshot.unstaked).toBeGreaterThan(0n);
    expect(snapshot.spendable).toBeLessThan(snapshot.total - snapshot.staked);
  }, 30_000);
});

/** Quem tem um pedido de unstake pendente tem saldo saindo de stake. */
async function stakerComUnstakePendente(network: TezzetNetwork): Promise<string> {
  const { body } = await tzkt(network).get<unknown[]>('/v1/staking/unstake_requests', {
    status: 'pending',
    limit: 1,
    'sort.desc': 'id',
  });
  const rows = body ?? [];
  expect(rows.length, `${network.label} não tem nenhum unstake pendente agora`).toBe(1);
  const row = requireObject(rows[0], '/v1/staking/unstake_requests[0]');
  return requireString(
    requireObject(row['staker'], 'unstake_requests[0].staker'),
    'address',
    'unstake_requests[0].staker',
  );
}
