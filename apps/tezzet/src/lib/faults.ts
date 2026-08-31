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
 * veio, e **o que deixou de ser conhecido**. "Algo deu errado" não permite
 * nem tentar de novo com critério nem escrever um relato de defeito.
 */
export interface FaultDescription {
  readonly what: string;
  readonly where: string;
  readonly cost: string;
}

export function describeFault(error: unknown, missing: string, attempts = 1): FaultDescription {
  const tries = attempts > 1 ? ` · ${attempts} tentativas` : '';

  if (error instanceof RateLimitedError) {
    return {
      what: 'O indexador recusou por excesso de chamadas (HTTP 429).',
      where: `${hostOf(error.url)}${tries}`,
      cost: `${missing} não foi lido. A resposta não traz Retry-After; o app espera e tenta de novo.`,
    };
  }
  if (error instanceof StaleIndexerError) {
    const lag = error.knownLevel - error.indexerLevel;
    return {
      what: `O indexador está ${lag} blocos atrás do nó (nível ${error.indexerLevel} de ${error.knownLevel}).`,
      where: `atraso aceito: ${error.maxLagBlocks} blocos${tries}`,
      cost: `${missing} seria um número velho, e um número velho é indistinguível de um novo. Não foi mostrado.`,
    };
  }
  if (error instanceof HttpError) {
    return {
      what: `A leitura respondeu HTTP ${error.status}.`,
      where: `${hostOf(error.url)}${tries}`,
      cost: `${missing} não foi lido.`,
    };
  }
  if (error instanceof MissingFieldError) {
    return {
      what: `O campo "${error.field}" não veio na resposta.`,
      where: `${error.source}${tries}`,
      cost: `${missing} não foi calculado. O app não substitui campo ausente por zero.`,
    };
  }
  if (error instanceof FieldTypeError) {
    return {
      what: `O campo "${error.field}" veio com formato inesperado (esperado: ${error.expected}).`,
      where: `${error.source}${tries}`,
      cost: `${missing} não foi calculado.`,
    };
  }
  if (error instanceof InvariantViolationError) {
    return {
      what: `Os números lidos não fecham: ${error.invariant}.`,
      where: `${error.detail}${tries}`,
      cost: `${missing} não foi mostrado — nenhum dos números pode ser confiado.`,
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
    return {
      what: 'A rede não respondeu.',
      where: `${error.message}${tries}`,
      cost: `${missing} não foi lido.`,
    };
  }
  return {
    what: error instanceof Error ? error.message : String(error),
    where: error instanceof Error ? error.name + tries : `erro sem tipo${tries}`,
    cost: `${missing} não foi lido.`,
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
