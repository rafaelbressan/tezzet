import {
  BeaconMessageType,
  Regions,
  Serializer,
  TezosOperationType,
  WalletClient,
  type BeaconRequestOutputMessage,
  type NodeDistributions,
  type P2PPairingRequest,
  type PartialTezosOperation,
} from '@ecadlabs/beacon-wallet';
import { OpKind, TezosToolkit, type ParamsWithKind } from '@taquito/taquito';
import { mutezToTaquitoAmount } from '@tezos-suite/chain';
import type { ChaveDescartavel } from './chave';
import { MemoriaStorage } from './memoria';
import { garantirLocalStorage } from './navegador';

/**
 * A carteira Beacon de teste: o outro lado do pareamento que a QA do Tezzet
 * não tinha.
 *
 * Ela aprova **tudo** que chega, e é por isso que ela só pode existir com uma
 * chave descartável na Shadownet. Não é uma carteira: é o lado do protocolo
 * que faltava para provar que `sendTransfer` chega até a cadeia sem um humano
 * apertando "aprovar".
 *
 * O que ela não faz: nada além de permissão e transferência. Um pedido que
 * ela não entende vira erro alto, nunca uma aprovação de algo que ninguém
 * leu.
 */

/**
 * Os mesmos relays que o `@taquito/beacon-wallet` usa do lado do app. O
 * pareamento carrega o relay que o app escolheu, mas as duas pontas precisam
 * estar na mesma federação Matrix — apontar a carteira para a lista antiga
 * (papers.tech) é um pareamento que nunca completa e não diz por quê.
 */
const RELAYS_OCTEZ: NodeDistributions = {
  [Regions.EUROPE_WEST]: [
    'beacon-node-1.octez.io',
    'beacon-node-2.octez.io',
    'beacon-node-3.octez.io',
    'beacon-node-4.octez.io',
    'beacon-node-5.octez.io',
    'beacon-node-6.octez.io',
    'beacon-node-7.octez.io',
    'beacon-node-8.octez.io',
  ],
};

export class CarteiraDeTesteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CarteiraDeTesteError';
  }
}

export interface OperacaoAprovada {
  readonly hash: string;
  /** Nível da cabeça lido **antes** de injetar: é o `branchLevel` da confirmação. */
  readonly branchLevel: number;
  readonly detalhes: readonly PartialTezosOperation[];
}

export interface CarteiraDeTesteOptions {
  readonly chave: ChaveDescartavel;
  readonly rpcUrl: string;
  readonly nome?: string;
  readonly relays?: NodeDistributions;
}

/** Um valor que ainda não chegou, mais o jeito de esperar por ele. */
class Aguardado<T> {
  private resolver?: (value: T) => void;
  private rejeitar?: (reason: unknown) => void;
  private readonly promessa: Promise<T>;
  private pronto = false;

  constructor(private readonly oQue: string) {
    this.promessa = new Promise<T>((resolve, reject) => {
      this.resolver = resolve;
      this.rejeitar = reject;
    });
    // Sem isto, um `unhandledRejection` derruba o processo antes de quem
    // espera chegar no `await`.
    this.promessa.catch(() => undefined);
  }

  entregar(value: T): void {
    if (this.pronto) return;
    this.pronto = true;
    this.resolver?.(value);
  }

  falhar(reason: unknown): void {
    if (this.pronto) return;
    this.pronto = true;
    this.rejeitar?.(reason);
  }

  async esperar(timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const estouro = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new CarteiraDeTesteError(`${this.oQue} não chegou em ${timeoutMs} ms`)),
        timeoutMs,
      );
    });
    try {
      return await Promise.race([this.promessa, estouro]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

function transacaoParaTaquito(op: PartialTezosOperation): ParamsWithKind {
  if (op.kind !== TezosOperationType.TRANSACTION) {
    throw new CarteiraDeTesteError(
      `a carteira de teste só assina transferência, e o app pediu "${op.kind}" — ` +
        'aprovar sem entender é exatamente o que ela não pode fazer',
    );
  }

  // Valor em mutez como `bigint` até a fronteira do Taquito, que só aceita
  // `number`. `mutezToTaquitoAmount` recusa acima de MAX_SAFE_INTEGER em vez
  // de arredondar calado.
  const params: ParamsWithKind = {
    kind: OpKind.TRANSACTION,
    to: op.destination,
    amount: mutezToTaquitoAmount(BigInt(op.amount)),
    mutez: true,
  };

  // Taxa, gás e storage vêm do app quando ele os mandou. Reestimar aqui
  // apagaria o número que a tela mostrou à pessoa, e o teste deixaria de
  // provar que a estimativa do Tezzet é aceita pela cadeia.
  return {
    ...params,
    ...(op.fee !== undefined ? { fee: Number(op.fee) } : {}),
    ...(op.gas_limit !== undefined ? { gasLimit: Number(op.gas_limit) } : {}),
    ...(op.storage_limit !== undefined ? { storageLimit: Number(op.storage_limit) } : {}),
    ...(op.parameters !== undefined ? { parameter: op.parameters } : {}),
  };
}

export class CarteiraDeTeste {
  private readonly client: WalletClient;
  private readonly tezos: TezosToolkit;
  private readonly permissaoAprovada = new Aguardado<string>('o pedido de permissão do app');
  private readonly operacaoAprovada = new Aguardado<OperacaoAprovada>('o pedido de assinatura do app');

  private constructor(
    private readonly chave: ChaveDescartavel,
    client: WalletClient,
    tezos: TezosToolkit,
  ) {
    this.client = client;
    this.tezos = tezos;
  }

  get address(): string {
    return this.chave.address;
  }

  static async abrir(options: CarteiraDeTesteOptions): Promise<CarteiraDeTeste> {
    garantirLocalStorage();
    const client = new WalletClient({
      name: options.nome ?? 'Carteira de teste do Tezzet',
      storage: new MemoriaStorage(),
      matrixNodes: options.relays ?? RELAYS_OCTEZ,
    });
    const tezos = new TezosToolkit(options.rpcUrl);
    tezos.setSignerProvider(options.chave.signer);

    const carteira = new CarteiraDeTeste(options.chave, client, tezos);
    await client.init();
    await client.connect((message) => {
      void carteira.responder(message).catch((cause) => {
        carteira.permissaoAprovada.falhar(cause);
        carteira.operacaoAprovada.falhar(cause);
      });
    });
    return carteira;
  }

  /** Aceita o código de pareamento que o app mostrou (o mesmo que um QR carrega). */
  async parear(pareamento: string): Promise<void> {
    const peer = (await new Serializer().deserialize(pareamento)) as P2PPairingRequest;
    if (peer?.type !== 'p2p-pairing-request' || typeof peer.publicKey !== 'string') {
      throw new CarteiraDeTesteError(
        `o código de pareamento não é um p2p-pairing-request: ${JSON.stringify(peer).slice(0, 200)}`,
      );
    }
    await this.client.addPeer(peer);
  }

  async esperarPermissao(timeoutMs = 90_000): Promise<string> {
    return this.permissaoAprovada.esperar(timeoutMs);
  }

  async esperarOperacao(timeoutMs = 180_000): Promise<OperacaoAprovada> {
    return this.operacaoAprovada.esperar(timeoutMs);
  }

  async fechar(): Promise<void> {
    await this.client.destroy();
  }

  private async responder(message: BeaconRequestOutputMessage): Promise<void> {
    if (message.type === BeaconMessageType.PermissionRequest) {
      await this.client.respond({
        type: BeaconMessageType.PermissionResponse,
        id: message.id,
        network: message.network,
        scopes: message.scopes,
        walletType: 'implicit',
        address: this.chave.address,
        publicKey: this.chave.publicKey,
      });
      this.permissaoAprovada.entregar(this.chave.address);
      return;
    }

    if (message.type === BeaconMessageType.OperationRequest) {
      const detalhes = message.operationDetails;
      const params = detalhes.map(transacaoParaTaquito);

      // Lido antes de injetar. Sem este nível, "não achei a operação" nunca
      // vira "ela nunca vai entrar", e reenviar deixa de ser seguro.
      const branchLevel = await this.tezos.rpc.getBlockHeader().then((header) => header.level);
      const operacao = await this.tezos.contract.batch(params).send();

      await this.client.respond({
        type: BeaconMessageType.OperationResponse,
        id: message.id,
        transactionHash: operacao.hash,
      });
      this.operacaoAprovada.entregar({ hash: operacao.hash, branchLevel, detalhes });
      return;
    }

    throw new CarteiraDeTesteError(
      `pedido "${message.type}" não faz parte da jornada que este harness cobre`,
    );
  }
}
