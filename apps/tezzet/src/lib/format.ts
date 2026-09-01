import { formatMutezAsTez } from '@tezos-suite/chain';

/**
 * Truncamento de endereço **no meio**, nunca no fim.
 *
 * Quem confere um endereço confere o começo e o fim — são as duas pontas que
 * um endereço trocado por malware não consegue manter iguais. Cortar só o fim
 * esconde exatamente metade do que a pessoa precisa ver.
 */
export function truncateAddress(address: string, head = 8, tail = 6): string {
  if (head < 1 || tail < 1) {
    throw new RangeError(`truncateAddress: head e tail precisam ser >= 1, veio ${head}/${tail}`);
  }
  // Se o corte não economiza nada, mostrar inteiro é mais honesto.
  if (address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

/** Valor em XTZ, seis casas, sempre. `bigint` entra, texto sai. */
export function formatXtz(mutez: bigint): string {
  return formatMutezAsTez(mutez);
}

/** Data e hora locais, curtas, para carimbar quando o dado foi lido. */
export function formatReadAt(at: Date): string {
  return at.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatTimestamp(at: Date): string {
  return at.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
