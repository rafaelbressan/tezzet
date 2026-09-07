/**
 * O `fetch` do navegador exige `this === window`.
 *
 * A camada de cadeia guarda o `fetch` numa propriedade (`fetchImpl`) e o
 * chama como método: `this.fetchImpl(url, init)`. Aí `this` é o objeto, e o
 * Chromium recusa com `Failed to execute 'fetch' on 'Window': Illegal
 * invocation` — em **toda** leitura de cadeia, do saldo ao envio.
 *
 * Em Node isso não acontece: o `fetch` do undici não confere o receptor. Foi
 * por isso que os testes de unidade (jsdom) e os de contrato (Node) passaram
 * verdes com o app incapaz de ler a cadeia num navegador de verdade.
 *
 * Esta função é o `fetch` global chamado solto, que é a forma que o navegador
 * aceita. Ela é passada a toda construção da camada de cadeia.
 */
export const boundFetch: typeof fetch = (...args) => fetch(...args);
