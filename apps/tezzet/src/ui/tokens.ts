/**
 * Lê um token de design do CSS em execução.
 *
 * Nenhum valor visual é escrito no TypeScript. Quando um valor precisa ir
 * para uma API que não entende CSS — o gerador de QR, por exemplo — ele é
 * lido da variável, não copiado. Copiar é como um `#C8B08B` acaba num
 * arquivo `.ts` e deixa de acompanhar a suíte.
 */
export function readDesignToken(name: string, root: HTMLElement | null = document.documentElement): string {
  const value = root ? getComputedStyle(root).getPropertyValue(name).trim() : '';
  if (value === '') {
    throw new Error(`token de design "${name}" não está definido — suite/tokens/tokens.css foi carregado?`);
  }
  return value;
}
