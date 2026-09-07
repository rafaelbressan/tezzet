import {
  FieldTypeError,
  HttpError,
  InvariantViolationError,
  MissingFieldError,
  RateLimitedError,
  StaleIndexerError,
} from '@tezos-suite/chain';
import { NetworkConfigError } from '../config/networks';

/**
 * Uma falha na tela precisa dizer três coisas: **o que** houve, **de onde**
 * veio, e **o que deixou de acontecer**. "Algo deu errado" não permite nem
 * tentar de novo com critério nem escrever um relato de defeito.
 *
 * `cost` é uma frase inteira, escrita por quem chama. A versão anterior
 * montava a frase colando um sujeito num "não foi lido" fixo, e produzia
 * "A conexão não foi lido." na tela.
 */
export interface FaultDescription {
  readonly what: string;
  readonly where: string;
  readonly cost: string;
}

/**
 * Recusas da cadeia que o app sabe explicar, pelo id do protocolo **sem o
 * prefixo de versão**: `proto.025-PsUshuai.delegate.unchanged` entra aqui como
 * `delegate.unchanged`. O prefixo muda a cada protocolo e a condição não.
 *
 * Esta tabela é rede de segurança, não a defesa principal. As duas condições
 * abaixo são conferidas antes de estimar (`checkDelegation`, `checkStake`), e
 * chegar aqui significa que o estado mudou entre a leitura e a assinatura —
 * o baker fechou o stake, ou a conta delegou por outra carteira no meio.
 *
 * Só entra id observado na cadeia. Traduzir de memória produz frase confiante
 * e errada, que é pior que o id cru.
 */
const PROTOCOL_FAULTS: Record<string, { readonly what: string; readonly next: string }> = {
  'delegate.unchanged': {
    what: 'Esta conta já delega para este baker.',
    next: 'Para trocar, informe outro endereço; para continuar com este, não há nada a assinar.',
  },
  'operations.staking_to_delegate_that_refuses_external_staking': {
    what: 'Este baker não aceita stake de terceiros: o limite dele é zero.',
    next: 'Delegar para ele continua valendo; para stakear é preciso trocar de baker.',
  },
  'delegate.not_registered': {
    what: 'Este endereço não está registrado como baker nesta rede.',
    next: 'Confira o endereço e a rede escolhida.',
  },
};

/**
 * O id do protocolo dentro de uma rejeição do Taquito.
 *
 * `instanceof TezosOperationError` não serve: duas cópias do pacote na árvore
 * — o que acontece com `@taquito/beacon-wallet` puxando a sua — dariam
 * `false` para um erro que é exatamente aquele. O que se procura é a forma:
 * um `errors` que é lista e traz ids no formato `proto.<versão>.<condição>`.
 */
function protocolFaultId(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const errors = (error as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return undefined;

  const ids = errors.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return [];
    const id = (item as { id?: unknown }).id;
    return typeof id === 'string' && /^proto\.[^.]+\..+/.test(id) ? [id] : [];
  });

  // O último é o que o Taquito escolhe para a mensagem, e é o mais específico
  // da pilha. Mas se algum id da pilha tem tradução, ela ganha: a frase em
  // português vale mais que a posição na lista.
  return ids.find((id) => shortProtocolId(id) in PROTOCOL_FAULTS) ?? ids[ids.length - 1];
}

function shortProtocolId(id: string): string {
  return id.replace(/^proto\.[^.]+\./, '');
}

export function describeFault(error: unknown, cost: string, attempts = 1): FaultDescription {
  const tries = attempts > 1 ? ` · ${attempts} tentativas` : '';

  const protocolId = protocolFaultId(error);
  if (protocolId !== undefined) {
    const known = PROTOCOL_FAULTS[shortProtocolId(protocolId)];
    if (known) {
      return { what: known.what, where: `${protocolId}${tries}`, cost: `${cost} ${known.next}` };
    }
    return {
      what: 'A cadeia recusou a operação, e o Tezzet não sabe traduzir este motivo.',
      where: `${protocolId}${tries}`,
      cost: `${cost} O identificador ao lado é do protocolo e serve para relatar o defeito.`,
    };
  }
  if (error instanceof RateLimitedError) {
    return {
      what: 'O indexador recusou por excesso de chamadas (HTTP 429).',
      where: `${hostOf(error.url)}${tries}`,
      cost: `${cost} A resposta não traz Retry-After; o app espera e tenta de novo.`,
    };
  }
  if (error instanceof StaleIndexerError) {
    const lag = error.knownLevel - error.indexerLevel;
    return {
      what: `O indexador está ${lag} blocos atrás do nó (nível ${error.indexerLevel} de ${error.knownLevel}).`,
      where: `atraso aceito: ${error.maxLagBlocks} blocos${tries}`,
      cost: `${cost} Seria um número velho, e um número velho é indistinguível de um novo.`,
    };
  }
  if (error instanceof HttpError) {
    return { what: `A leitura respondeu HTTP ${error.status}.`, where: `${hostOf(error.url)}${tries}`, cost };
  }
  if (error instanceof MissingFieldError) {
    return {
      what: `O campo "${error.field}" não veio na resposta.`,
      where: `${error.source}${tries}`,
      cost: `${cost} O app não substitui campo ausente por zero.`,
    };
  }
  if (error instanceof FieldTypeError) {
    return {
      what: `O campo "${error.field}" veio com formato inesperado (esperado: ${error.expected}).`,
      where: `${error.source}${tries}`,
      cost,
    };
  }
  if (error instanceof InvariantViolationError) {
    return {
      what: `Os números lidos não fecham: ${error.invariant}.`,
      where: `${error.detail}${tries}`,
      cost: `${cost} Nenhum dos números pode ser confiado.`,
    };
  }
  if (error instanceof NetworkConfigError) {
    return {
      what: 'A configuração de rede é inválida.',
      where: error.message,
      cost: 'O app não abre sem saber em que rede está.',
    };
  }
  if (error instanceof TypeError) {
    // Em navegador e webview, falha de rede chega como TypeError sem detalhe.
    return { what: 'A rede não respondeu.', where: `${error.message}${tries}`, cost };
  }

  const { what, where } = descreverDesconhecido(error);
  return { what, where: `${where}${tries}`, cost };
}

/**
 * O que um SDK de terceiro lança nem sempre é um `Error`. O Beacon rejeita com
 * objetos simples, e `String(objeto)` vira **"[object Object]"** — que foi
 * exatamente o que a tela mostrou na primeira versão. Aqui os campos que esses
 * objetos costumam trazer são procurados por nome antes de qualquer conversão.
 */
function descreverDesconhecido(error: unknown): { what: string; where: string } {
  if (error instanceof Error) {
    return { what: error.message || error.name, where: error.name };
  }
  if (typeof error === 'object' && error !== null) {
    const bag = error as Record<string, unknown>;
    const texto = campoDeTexto(bag, ['message', 'description', 'title', 'reason', 'error']);
    // `errorType` antes de `type`, e não o contrário: o Beacon rejeita com
    // `{ type: 'error', errorType: 'ABORTED_ERROR' }`, onde `type` diz apenas
    // "é um erro" e `errorType` é o único dado útil da rejeição.
    const tipo = campoDeTexto(bag, ['errorType', 'name', 'code', 'type']);

    if (texto) return { what: texto, where: tipo ?? 'erro sem tipo' };
    // Sem mensagem: o tipo vira a frase, e a carga bruta vai para a linha de
    // origem — em vez de o JSON inteiro virar o título do painel.
    if (tipo) return { what: `O erro veio sem mensagem, do tipo ${tipo}.`, where: serializar(error) };
    return { what: serializar(error), where: 'erro sem tipo' };
  }
  return { what: String(error), where: `erro do tipo ${typeof error}` };
}

function campoDeTexto(bag: Record<string, unknown>, campos: readonly string[]): string | undefined {
  for (const campo of campos) {
    const valor = bag[campo];
    if (typeof valor === 'string' && valor.trim() !== '') return valor;
  }
  return undefined;
}

function serializar(value: unknown): string {
  try {
    const texto = JSON.stringify(value, (_chave, valor) =>
      typeof valor === 'bigint' ? `${valor}` : valor,
    );
    if (texto && texto !== '{}') return texto.slice(0, 300);
  } catch {
    // objeto circular: cai no nome do construtor abaixo
  }
  const nome = (value as object).constructor?.name;
  return nome ? `erro do tipo ${nome}, sem mensagem` : 'erro sem mensagem';
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
