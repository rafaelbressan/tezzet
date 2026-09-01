# Carteira Beacon de teste

Prova que o Tezzet **assina e envia de verdade**, sem humano em nenhum passo.

A QA da BRES-45 parava no modal de pareamento do Beacon: não havia carteira do
outro lado. Instalar uma carteira, pareá-la e apertar "aprovar" toda vez que
alguém quisesse revalidar é o que este pacote elimina.

## O que ele faz

Uma execução, do zero:

1. gera uma chave ed25519 descartável, viva só enquanto o processo roda;
2. pede XTZ à torneira da Shadownet, resolvendo a prova de trabalho (~20 s);
3. sobe o `dist/` do app num Chromium headless;
4. clica em "Conectar carteira" e copia o código de pareamento do modal do
   Beacon — o mesmo texto que o QR carrega;
5. pareia, aprova a permissão e devolve o endereço;
6. preenche o envio, aprova a assinatura, injeta na cadeia;
7. confere a confirmação pelo critério do Tenderbake, contra a cadeia.

## Rodar

```sh
npm install
npm run enviar                       # a jornada inteira, imprime o hash
npm run enviar -- --com-janela       # com o Chromium visível
npm run test:e2e                     # a mesma jornada, com as asserções
```

Ambos constroem o `dist/` do app antes. `npm run enviar -- --ajuda` lista as
opções (rede, destino, valor, torneira).

O Chromium vem do Playwright, na versão fixada em `package.json`. Se ele não
estiver no cache da máquina: `npx playwright install chromium`.

## A regra que não pode ser afrouxada

A chave é **do harness**, gerada na hora, descartável, e só existe na
Shadownet. **Ela nunca entra no app.**

É por isso que esta carteira tem `package.json` próprio, fora da árvore de
dependências do produto: `apps/tezzet/test/sem-chave.test.ts` reprova qualquer
pacote de assinatura no `package.json` do app, e essa regra fica como está.

A jornada recusa qualquer rede com `kind: "main"`. Esta carteira aprova tudo
que chega — ela só pode existir onde XTZ não vale dinheiro.

## Quando a torneira cai

O harness **falha alto** dizendo isso. Ele nunca pula o teste em silêncio: um
teste que se desliga sozinho quando a dependência cai deixa de reprovar
qualquer coisa e continua verde enquanto o app quebra.

## Fora de escopo

Interop com carteira de terceiro (Temple, Kukai, Umami, AirGap). Isso prova
que aquelas carteiras aceitam a rede `shadownet` — outra coisa, outra issue.

## Como está montado

| arquivo | o que é |
| --- | --- |
| `src/chave.ts` | a chave descartável |
| `src/torneira.ts` | a torneira, com a prova de trabalho |
| `src/carteira.ts` | o lado carteira do Beacon: pareia, aprova, assina, injeta |
| `src/memoria.ts` | armazenamento do Beacon em memória — nada em disco |
| `src/navegador.ts` | o `localStorage` que o SDK do Beacon exige no Node |
| `src/servidor.ts` | serve o `dist/` numa origem HTTP |
| `src/app.ts` | o Tezzet dirigido pelo Chromium, pela interface de verdade |
| `src/jornada.ts` | a jornada inteira |
| `src/cli.ts` | `npm run enviar` |
| `test/jornada.e2e.test.ts` | a mesma jornada, com as asserções |

`@tezos-suite/chain` é o mesmo `vendor/` que o app usa. Uma segunda cópia da
confirmação Tenderbake aqui aprovaria um critério que o produto não usa.
