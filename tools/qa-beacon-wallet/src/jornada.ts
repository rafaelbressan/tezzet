import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  HttpRpcSource,
  ProtocolConstantsProvider,
  resolveOperationState,
  TzKTHeadSource,
  TzKTHttp,
  formatMutezAsTez,
  tezToMutez,
  type OperationOutcome,
} from '@tezos-suite/chain';
import { explorerOperationUrl } from '../../../apps/tezzet/src/chain/explorer';
import {
  parseNetworkCatalog,
  selectNetwork,
  type TezzetNetwork,
} from '../../../apps/tezzet/src/config/networks';
import { TezzetNoChromium } from './app';
import { CarteiraDeTeste } from './carteira';
import { gerarChaveDescartavel } from './chave';
import { servirDist } from './servidor';
import type { PartialTezosOperation } from '@ecadlabs/beacon-wallet';
import { lerInfo, pedirXtz, type XtzPedido } from './torneira';

/**
 * A jornada inteira, sem humano em nenhum passo: chave nova → torneira →
 * pareamento → permissão → assinatura → confirmação pelo critério do
 * Tenderbake.
 *
 * A rede sai do mesmo `networks.json` que o app lê no `dist/`. Ler de outro
 * lugar deixaria o harness provar uma coisa numa rede e o app fazer outra em
 * outra, e o teste passaria assim mesmo.
 */

export class JornadaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JornadaError';
  }
}

export interface JornadaOptions {
  /** `apps/tezzet/dist`, já construído. */
  readonly dist: string;
  readonly networkId?: string;
  readonly faucetUrl?: string;
  /** Quanto pedir à torneira, em XTZ inteiros. */
  readonly torneiraXtz?: number;
  /** Para onde enviar. Padrão: de volta para a torneira, que já existe na cadeia. */
  readonly destino?: string;
  /** Quanto enviar, em XTZ como texto. Vira mutez sem passar por `number`. */
  readonly xtz?: string;
  readonly headless?: boolean;
  readonly log?: (linha: string) => void;
}

export interface JornadaResultado {
  readonly network: TezzetNetwork;
  /** O endereço descartável que a carteira de teste criou para esta execução. */
  readonly endereco: string;
  readonly torneira: XtzPedido;
  readonly destino: string;
  readonly amountMutez: bigint;
  readonly hash: string;
  readonly hashNaTela: string;
  readonly statusNaTela: string;
  readonly outcome: OperationOutcome;
  readonly explorador: string;
  /** O que o app pediu para a carteira assinar, como chegou no protocolo. */
  readonly detalhes: readonly PartialTezosOperation[];
}

const FAUCET_PADRAO = 'https://faucet.shadownet.teztnets.com';
const ESPERA_ENTRE_LEITURAS_MS = 6_000;

async function dormir(ms: number): Promise<void> {
  await new Promise((ok) => setTimeout(ok, ms));
}

/** `/context/contracts/{addr}/balance` do Octez é o gastável segundo o protocolo. */
async function saldo(network: TezzetNetwork, address: string): Promise<bigint> {
  const url = `${network.endpoints.rpcUrl}/chains/main/blocks/head/context/contracts/${address}/balance`;
  const response = await fetch(url);
  if (response.status === 404) return 0n;
  if (!response.ok) throw new JornadaError(`o RPC respondeu HTTP ${response.status} para ${url}`);
  return BigInt(JSON.parse(await response.text()) as string);
}

async function esperarSaldo(
  network: TezzetNetwork,
  address: string,
  minimoMutez: bigint,
  timeoutMs: number,
): Promise<bigint> {
  const limite = Date.now() + timeoutMs;
  let ultimo = 0n;
  while (Date.now() < limite) {
    ultimo = await saldo(network, address);
    if (ultimo >= minimoMutez) return ultimo;
    await dormir(ESPERA_ENTRE_LEITURAS_MS);
  }
  throw new JornadaError(
    `${address} ainda tem ${formatMutezAsTez(ultimo)} XTZ depois de ${timeoutMs} ms — ` +
      `a torneira injetou, mas o valor não chegou (esperado ao menos ${formatMutezAsTez(minimoMutez)})`,
  );
}

function lerRede(dist: string, networkId: string | undefined): TezzetNetwork {
  const arquivo = join(resolve(dist), 'networks.json');
  const catalogo = parseNetworkCatalog(JSON.parse(readFileSync(arquivo, 'utf8')));
  const rede = selectNetwork(catalogo, networkId ?? catalogo.defaultNetworkId);
  if (rede.kind !== 'test') {
    throw new JornadaError(
      `a rede "${rede.id}" move dinheiro de verdade — esta carteira aprova tudo que chega ` +
        'e só pode existir em rede de teste',
    );
  }
  return rede;
}

/**
 * Espera a operação virar `confirmed` pelo critério do Tenderbake: incluída no
 * nível L, cabeça em L+2, e **relida** confirmando bloco e situação.
 */
async function esperarConfirmacao(
  network: TezzetNetwork,
  hash: string,
  branchLevel: number,
  timeoutMs: number,
): Promise<OperationOutcome> {
  const http = new TzKTHttp(network.endpoints, { concurrency: 2 });
  const head = new TzKTHeadSource(http);
  const constants = await new ProtocolConstantsProvider(new HttpRpcSource(network.endpoints)).get();

  const limite = Date.now() + timeoutMs;
  let ultimo: OperationOutcome | undefined;
  while (Date.now() < limite) {
    ultimo = await resolveOperationState(http, head, hash, { branchLevel, constants });
    if (ultimo.status === 'confirmed') return ultimo;
    if (ultimo.status === 'failed' || ultimo.status === 'expired') {
      throw new JornadaError(
        `a cadeia devolveu "${ultimo.status}" para ${hash}` +
          (ultimo.chainStatus ? ` (${ultimo.chainStatus})` : ''),
      );
    }
    await dormir(ESPERA_ENTRE_LEITURAS_MS);
  }
  throw new JornadaError(
    `${hash} ficou em "${ultimo?.status ?? 'desconhecido'}" por ${timeoutMs} ms sem confirmar`,
  );
}

/**
 * O que o app mandou assinar é o que o app mostrou na revisão.
 *
 * Sem esta conferência, um app que trocasse o destino entre a tela e a
 * carteira passaria: o hash bateria, a cadeia confirmaria, e o dinheiro teria
 * ido para outro lugar.
 */
function conferirOQueFoiAssinado(
  detalhes: readonly PartialTezosOperation[],
  destino: string,
  amountMutez: bigint,
): void {
  const transacoes = detalhes.filter((op) => op.kind === 'transaction');
  if (detalhes.length !== 1 || transacoes.length !== 1) {
    throw new JornadaError(
      `o app pediu ${detalhes.length} operações (${detalhes.map((op) => op.kind).join(', ')}) ` +
        'para uma transferência simples',
    );
  }
  const transacao = transacoes[0]!;
  if (transacao.destination !== destino) {
    throw new JornadaError(
      `a tela revisou um envio para ${destino} e mandou assinar para ${transacao.destination}`,
    );
  }
  if (BigInt(transacao.amount) !== amountMutez) {
    throw new JornadaError(
      `a tela revisou ${amountMutez} mutez e mandou assinar ${transacao.amount}`,
    );
  }
}

export async function correrJornada(options: JornadaOptions): Promise<JornadaResultado> {
  const log = options.log ?? (() => undefined);
  const network = lerRede(options.dist, options.networkId);
  const faucetUrl = options.faucetUrl ?? FAUCET_PADRAO;
  const torneiraXtz = options.torneiraXtz ?? 10;
  const xtz = options.xtz ?? '1.000001';
  const amountMutez = tezToMutez(xtz);

  const chave = await gerarChaveDescartavel();
  log(`chave descartável: ${chave.address} (${network.label})`);

  log(`pedindo ${torneiraXtz} XTZ à torneira, com prova de trabalho…`);
  const torneira = await pedirXtz(chave.address, { baseUrl: faucetUrl, xtz: torneiraXtz });
  log(`torneira injetou ${torneira.hash} (${torneira.desafiosResolvidos} desafios, ${Math.round(torneira.duracaoMs / 1000)} s)`);

  // O valor cheio que a torneira disse ter injetado. Esperar só pelo que a
  // transferência custa deixaria passar uma torneira que injetou menos.
  const financiado = await esperarSaldo(network, chave.address, tezToMutez(String(torneiraXtz)), 180_000);
  log(`saldo na cadeia: ${formatMutezAsTez(financiado)} XTZ`);

  // O padrão devolve o XTZ para a torneira: ela já existe na cadeia, então a
  // transferência não paga alocação de destino novo.
  const destino = options.destino ?? (await lerInfo({ baseUrl: faucetUrl, xtz: torneiraXtz })).faucetAddress;

  const servido = await servirDist(options.dist);
  const app = await TezzetNoChromium.abrir({ url: servido.url, ...(options.headless !== undefined ? { headless: options.headless } : {}) });
  let carteira: CarteiraDeTeste | undefined;

  try {
    log('abrindo o Tezzet e pedindo o código de pareamento…');
    const pareamento = await app.conectarECopiarPareamento();

    carteira = await CarteiraDeTeste.abrir({ chave, rpcUrl: network.endpoints.rpcUrl });
    await carteira.parear(pareamento);

    const [autorizado, naTela] = await Promise.all([
      carteira.esperarPermissao(),
      app.esperarConectado(),
    ]);
    if (autorizado !== naTela) {
      throw new JornadaError(
        `a carteira autorizou ${autorizado} e o app está mostrando ${naTela}`,
      );
    }
    log(`permissão aprovada: o app assumiu ${naTela}`);

    await app.revisarEnvio(destino, xtz);
    await app.assinar();

    const operacao = await carteira.esperarOperacao();
    log(`carteira assinou e injetou ${operacao.hash} (branch no nível ${operacao.branchLevel})`);

    conferirOQueFoiAssinado(operacao.detalhes, destino, amountMutez);

    const hashNaTela = await app.hashNaTela();
    if (hashNaTela !== operacao.hash) {
      throw new JornadaError(
        `a carteira injetou ${operacao.hash} e o app está mostrando ${hashNaTela}`,
      );
    }

    const outcome = await esperarConfirmacao(network, operacao.hash, operacao.branchLevel, 300_000);
    log(`confirmada no nível ${outcome.level}, cabeça em ${outcome.headLevel}`);

    // A tela precisa chegar na mesma conclusão sozinha: é o texto que a
    // pessoa lê para saber que pode ir embora.
    const statusNaTela = await app.esperarTextoDeStatus(/Confirmada/, 120_000);

    return {
      network,
      endereco: chave.address,
      torneira,
      destino,
      amountMutez,
      hash: operacao.hash,
      hashNaTela,
      statusNaTela,
      outcome,
      explorador: explorerOperationUrl(network, operacao.hash),
      detalhes: operacao.detalhes,
    };
  } finally {
    await carteira?.fechar().catch(() => undefined);
    await app.fechar().catch(() => undefined);
    await servido.fechar().catch(() => undefined);
  }
}
