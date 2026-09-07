/**
 * BRES-119 — a medição que exige assinar.
 *
 * A revisão do stake prometia mutez exatos. A cadeia não guarda stake externo
 * em mutez: guarda em pseudotokens, converte nos dois sentidos e reavalia com
 * o tempo. Nenhum teste de leitura fecha essa conta — para afirmar
 * `stakedBalance <= pedido` numa conta sem stake é preciso assinar o stake.
 *
 * Esta ferramenta faz isso, e por isso mora **fora do app**:
 * `apps/tezzet/test/sem-chave.test.ts` reprova qualquer pacote de assinatura
 * dentro de `apps/tezzet`, e é para continuar reprovando. Aqui há
 * `@taquito/signer`; no app, nunca.
 *
 * A chave também mora fora do repositório. O caminho vem de
 * `TEZZET_SHADOWNET_KEY` e não tem valor padrão: sem a variável, o processo
 * recusa subir. Não existe caminho que aponte para dentro deste repositório,
 * e um teste garante isso.
 *
 * ## Uso
 *
 *     npm install
 *     node gerar-chave.mjs                      # uma vez, escreve o arquivo em 0600
 *     npx @tacoinfra/get-tez <tz1…> --amount 100 --network shadownet
 *     TEZZET_SHADOWNET_KEY=… npm run medir
 *
 * Gasta apenas XTZ de torneira de rede de teste. Nunca aponte para a mainnet.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { TezosToolkit } from '@taquito/taquito';
import { InMemorySigner } from '@taquito/signer';

const RPC = 'https://rpc.shadownet.teztnets.com';
const TZKT = 'https://api.shadownet.tzkt.io';
/** Baker da Shadownet com espaço de stake de terceiros. */
const BAKER = process.env.TEZZET_SHADOWNET_BAKER ?? 'tz1X2jPbN1V6Yae7gf1NcbR4DgMKrouHrrrA';

/** Segredo sem valor padrão: ausente é recusa de subir, não fallback. */
const caminhoDaChave = process.env.TEZZET_SHADOWNET_KEY;
if (!caminhoDaChave) {
  throw new Error(
    'TEZZET_SHADOWNET_KEY não está definida. Ela aponta para o arquivo da chave, ' +
      'que fica fora deste repositório — em ~/workspace/tezzet/shadownet-probe/secrets/, ' +
      'por exemplo. Sem ela o processo não sobe.',
  );
}
const conta = JSON.parse(readFileSync(caminhoDaChave, 'utf8'));
if (conta.network !== 'shadownet') {
  throw new Error(`esta ferramenta só fala com a Shadownet, e a chave diz "${conta.network}"`);
}

const tezos = new TezosToolkit(RPC);
tezos.setProvider({ signer: new InMemorySigner(conta.sk) });

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function tzkt(caminho) {
  const resposta = await fetch(`${TZKT}${caminho}`);
  if (!resposta.ok) throw new Error(`TzKT ${resposta.status} em ${caminho}`);
  return resposta.json();
}

/** Saldos como o indexador os vê. Campo ausente é erro, nunca zero. */
async function saldos() {
  const c = await tzkt(`/v1/accounts/${conta.address}`);
  // `type: "empty"` é a conta que ainda não existe na cadeia. Este zero é o
  // que a cadeia diz, e é o único zero que este arquivo aceita sem ler campo.
  if (c.type === 'empty') return { spendable: 0n, staked: 0n, unstaked: 0n, pseudotokens: null };
  for (const campo of ['balance', 'stakedBalance', 'unstakedBalance']) {
    if (typeof c[campo] !== 'number') throw new Error(`TzKT não trouxe ${campo}`);
  }
  return {
    spendable: BigInt(c.balance),
    staked: BigInt(c.stakedBalance),
    unstaked: BigInt(c.unstakedBalance),
    pseudotokens: c.stakedPseudotokens === undefined ? null : String(c.stakedPseudotokens),
  };
}

/** Espera o indexador passar do nível da operação — senão lê-se o passado. */
async function indexado(nivel) {
  for (let tentativa = 0; tentativa < 40; tentativa += 1) {
    if ((await tzkt('/v1/head')).level >= nivel) return;
    await dormir(3000);
  }
  throw new Error(`TzKT não alcançou o nível ${nivel}`);
}

const registro = { rede: 'shadownet', conta: conta.address, baker: BAKER, passos: [] };
const passo = (nome, dados) => {
  registro.passos.push({ nome, ...dados });
  console.log(nome, JSON.stringify(dados, (_, v) => (typeof v === 'bigint' ? String(v) : v)));
};

const antesDeTudo = await saldos();
passo('antes-de-tudo', antesDeTudo);
if (antesDeTudo.staked !== 0n) {
  throw new Error('a conta já tem stake, e a perda da primeira conversão só acontece uma vez');
}

// 1. Delegar. Sem delegação o protocolo recusa o stake.
const delegacao = await tezos.contract.setDelegate({ source: conta.address, delegate: BAKER });
await delegacao.confirmation(1);
passo('delegou', { hash: delegacao.hash, nivel: delegacao.includedInBlock });
await indexado(delegacao.includedInBlock);

// 2. O primeiro stake da conta, num valor redondo. Aqui mora a perda.
const PEDIDO_1 = BigInt(process.env.TEZZET_PEDIDO_MUTEZ ?? '50000000');
const stake1 = await tezos.contract.stake({ amount: Number(PEDIDO_1), mutez: true });
await stake1.confirmation(1);
await indexado(stake1.includedInBlock);
const depoisDoStake1 = await saldos();
passo('primeiro-stake', {
  hash: stake1.hash,
  nivel: stake1.includedInBlock,
  pedidoMutez: PEDIDO_1,
  congeladoMutez: depoisDoStake1.staked,
  diferencaMutez: depoisDoStake1.staked - PEDIDO_1,
  pseudotokens: depoisDoStake1.pseudotokens,
});

// 3. Um segundo stake, por cima do que já existe.
const PEDIDO_2 = 1_000_000n;
const stake2 = await tezos.contract.stake({ amount: Number(PEDIDO_2), mutez: true });
await stake2.confirmation(1);
await indexado(stake2.includedInBlock);
const depoisDoStake2 = await saldos();
passo('segundo-stake', {
  hash: stake2.hash,
  nivel: stake2.includedInBlock,
  pedidoMutez: PEDIDO_2,
  antesMutez: depoisDoStake1.staked,
  depoisMutez: depoisDoStake2.staked,
  creditadoMutez: depoisDoStake2.staked - depoisDoStake1.staked,
  diferencaMutez: depoisDoStake2.staked - depoisDoStake1.staked - PEDIDO_2,
});

// 4. Uma saída de stake: o app promete `em stake − pedido`, estático.
const SAIDA = 20_000_000n;
const prometidoPeloApp = depoisDoStake2.staked - SAIDA;
const unstake = await tezos.contract.unstake({ amount: Number(SAIDA), mutez: true });
await unstake.confirmation(1);
await indexado(unstake.includedInBlock);
const logoDepois = await saldos();
passo('saida-do-stake', {
  hash: unstake.hash,
  nivel: unstake.includedInBlock,
  saidaMutez: SAIDA,
  prometidoPeloAppMutez: prometidoPeloApp,
  lidoLogoDepoisMutez: logoDepois.staked,
  diferencaMutez: logoDepois.staked - prometidoPeloApp,
});

// 5. A deriva: o mesmo saldo, relido depois, sem ninguém assinar nada.
await dormir(90_000);
const maisTarde = await saldos();
passo('deriva-sem-assinar', {
  prometidoPeloAppMutez: prometidoPeloApp,
  lidoMaisTardeMutez: maisTarde.staked,
  derivaDesdeALeituraAnteriorMutez: maisTarde.staked - logoDepois.staked,
  diferencaMutez: maisTarde.staked - prometidoPeloApp,
});

registro.medidoEm = new Date().toISOString();
const destino = new URL('./medicao.json', import.meta.url);
writeFileSync(destino, JSON.stringify(registro, (_, v) => (typeof v === 'bigint' ? String(v) : v), 2) + '\n');
console.log(`\n${destino.pathname} escrito`);
