import { createHash } from 'node:crypto';

/**
 * Cliente da torneira da Shadownet.
 *
 * A torneira exige prova de trabalho: ela devolve um desafio, o cliente
 * procura um `nonce` cujo `sha256(desafio:nonce)` comece com N zeros, e
 * repete umas dezenas de vezes até a torneira injetar a transferência.
 * Leva por volta de 20 s.
 *
 * Quando a torneira está fora, este módulo **falha alto**. Um teste que pula
 * em silêncio porque a torneira caiu passa a reprovar nada, e continua verde
 * enquanto o app quebra.
 */

export class TorneiraError extends Error {
  constructor(message: string) {
    super(`torneira da Shadownet: ${message}`);
    this.name = 'TorneiraError';
  }
}

export interface TorneiraOptions {
  readonly baseUrl: string;
  /** Em XTZ inteiros. A torneira recusa fora da faixa que ela anuncia em `/info`. */
  readonly xtz: number;
  readonly timeoutMs?: number;
  /** Teto de rodadas de desafio. A torneira pede ~18; 200 é folga, não política. */
  readonly maxDesafios?: number;
}

export interface TorneiraInfo {
  readonly faucetAddress: string;
  readonly challengesEnabled: boolean;
  readonly minTez: number;
  readonly maxTez: number;
}

interface Desafio {
  readonly challenge: string;
  readonly difficulty: number;
  readonly challengeCounter: number;
  readonly challengesNeeded: number;
}

async function pedir(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  let corpo: string;
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
    corpo = await response.text();
  } catch (cause) {
    throw new TorneiraError(`${url} não respondeu: ${String(cause)}`);
  } finally {
    clearTimeout(timer);
  }

  // Situação antes do corpo: um 502 do nginx chega como HTML, e um
  // `JSON.parse` incondicional transformaria "a torneira caiu" em
  // "unexpected token <".
  if (!response.ok) {
    throw new TorneiraError(`${url} respondeu HTTP ${response.status}: ${corpo.slice(0, 200)}`);
  }
  try {
    return JSON.parse(corpo) as Record<string, unknown>;
  } catch {
    throw new TorneiraError(`${url} respondeu algo que não é JSON: ${corpo.slice(0, 200)}`);
  }
}

function inteiro(fonte: Record<string, unknown>, campo: string, onde: string): number {
  const valor = fonte[campo];
  if (typeof valor !== 'number' || !Number.isInteger(valor)) {
    throw new TorneiraError(`${onde}.${campo} devia ser inteiro, veio ${JSON.stringify(valor)}`);
  }
  return valor;
}

function texto(fonte: Record<string, unknown>, campo: string, onde: string): string {
  const valor = fonte[campo];
  if (typeof valor !== 'string' || valor === '') {
    throw new TorneiraError(`${onde}.${campo} devia ser texto, veio ${JSON.stringify(valor)}`);
  }
  return valor;
}

export async function lerInfo(options: TorneiraOptions): Promise<TorneiraInfo> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const corpo = await pedir(`${options.baseUrl}/info`, { method: 'GET' }, timeoutMs);
  return {
    faucetAddress: texto(corpo, 'faucetAddress', '/info'),
    challengesEnabled: corpo['challengesEnabled'] === true,
    minTez: inteiro(corpo, 'minTez', '/info'),
    maxTez: inteiro(corpo, 'maxTez', '/info'),
  };
}

/** `sha256(desafio:nonce)` com `difficulty` zeros à esquerda. */
function resolver(challenge: string, difficulty: number): { solution: string; nonce: number } {
  const alvo = '0'.repeat(difficulty);
  for (let nonce = 0; ; nonce++) {
    const solution = createHash('sha256').update(`${challenge}:${nonce}`).digest('hex');
    if (solution.startsWith(alvo)) return { solution, nonce };
  }
}

function lerDesafio(corpo: Record<string, unknown>, onde: string): Desafio {
  return {
    challenge: texto(corpo, 'challenge', onde),
    difficulty: inteiro(corpo, 'difficulty', onde),
    challengeCounter: inteiro(corpo, 'challengeCounter', onde),
    challengesNeeded: inteiro(corpo, 'challengesNeeded', onde),
  };
}

export interface XtzPedido {
  /** Hash da operação com que a torneira financiou o endereço. */
  readonly hash: string;
  readonly desafiosResolvidos: number;
  readonly duracaoMs: number;
}

/**
 * Pede XTZ para `address` e devolve o hash da operação da torneira. Não espera
 * a confirmação — quem chama decide o que fazer com o hash.
 */
export async function pedirXtz(address: string, options: TorneiraOptions): Promise<XtzPedido> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxDesafios = options.maxDesafios ?? 200;
  const comeco = Date.now();

  const info = await lerInfo(options);
  if (!info.challengesEnabled) {
    throw new TorneiraError(
      'os desafios de prova de trabalho estão desligados — sem eles só resta o captcha, ' +
        'que exige um humano, e este harness existe justamente para não ter um',
    );
  }
  if (options.xtz < info.minTez || options.xtz > info.maxTez) {
    throw new TorneiraError(
      `pedido de ${options.xtz} XTZ fora da faixa que ela aceita (${info.minTez}–${info.maxTez})`,
    );
  }

  const json = { 'content-type': 'application/json' };
  let desafio = lerDesafio(
    await pedir(
      `${options.baseUrl}/challenge`,
      { method: 'POST', headers: json, body: JSON.stringify({ address, amount: options.xtz }) },
      timeoutMs,
    ),
    '/challenge',
  );

  for (let rodada = 1; rodada <= maxDesafios; rodada++) {
    const { solution, nonce } = resolver(desafio.challenge, desafio.difficulty);
    const corpo = await pedir(
      `${options.baseUrl}/verify`,
      { method: 'POST', headers: json, body: JSON.stringify({ address, solution, nonce }) },
      timeoutMs,
    );

    const hash = corpo['txHash'];
    if (typeof hash === 'string' && hash !== '') {
      return { hash, desafiosResolvidos: rodada, duracaoMs: Date.now() - comeco };
    }
    desafio = lerDesafio(corpo, '/verify');
  }

  throw new TorneiraError(
    `${maxDesafios} desafios resolvidos e ela ainda não injetou nada — ` +
      `ela pediu ${desafio.challengesNeeded} e está no ${desafio.challengeCounter}`,
  );
}
