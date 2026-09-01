import { Buffer } from 'buffer';

/**
 * O SDK do Beacon usa o `Buffer` do Node para criar a própria chave de sessão
 * (`loadOrCreateBeaconSecret`). Num webview não existe `Buffer`, e o que
 * acontece é pior do que um erro: a chamada estoura no carregamento, o botão
 * "Conectar carteira" fica em "Aguardando a carteira…" para sempre, e nenhuma
 * tela diz nada — porque a exceção acontece fora do fluxo do clique.
 *
 * Os 76 testes não pegavam isso: jsdom roda sob Node, onde `Buffer` é global.
 * `test/beacon-webview.test.ts` roda com o global apagado, que é o navegador.
 *
 * Este módulo é importado no topo de `wallet/beacon.ts` — antes do
 * `@taquito/beacon-wallet` — e não no `main.tsx`, para que a garantia viva ao
 * lado de quem precisa dela em vez de depender da ordem de imports da raiz.
 */
if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer;
}

// Bibliotecas empacotadas para Node ainda procuram `global`. Sem isto, o
// mesmo tipo de falha silenciosa acontece um nível abaixo.
if (typeof (globalThis as { global?: unknown }).global === 'undefined') {
  (globalThis as { global?: unknown }).global = globalThis;
}

export {};
