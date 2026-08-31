# Suíte Tezos.Rio

O espaço unificado de **Tezzet** (guardar) e **TAPS** (pagar): uma identidade, um
vocabulário e um conjunto de tokens para os dois produtos.

Vive no repositório do Tezzet porque é de lá que vem a identidade — o dourado
`#C8B08B`, os cinzas e os cantos retos saem direto do `app/src/main/res/values/colors.xml`
e do `button_selector.xml` do app original.

## Conteúdo

| Arquivo | O que é |
|---|---|
| `index.html` | A referência viva. Abra no navegador: marca, cor, tipografia, forma, kit de componentes, jornada, voz e plano de adoção, tudo renderizado. |
| `NARRATIVE.md` | A narrativa: por que os dois produtos são uma suíte, a ideia do corte, a voz e o vocabulário fixo. |
| `JOURNEY.md` | **A jornada.** A tese, as duas passagens entre Tezzet e TAPS, a identidade compartilhada, o que a navegação não compartilha, e a primeira execução de cada produto com o texto real das telas. |
| `tokens/tokens.json` | **A fonte única.** Neutro de plataforma. Todo o resto deriva daqui. |
| `tokens/tokens.css` | Variáveis CSS e as primitivas compartilhadas (`.t-amount`, `.t-address`, `.t-status`, `.t-button`, `.t-skeleton`, `.t-fault`, `.t-cross`, ...). |
| `tokens/contrast.mjs` | Recalcula as razões WCAG a partir de `tokens.json` e **reprova** se algum valor declarado divergir. Sem dependência: `node suite/tokens/contrast.mjs`. |

## Ver

```
# conferir os números de contraste (sem dependência)
node suite/tokens/contrast.mjs

# qualquer navegador
open suite/index.html

# ou servindo, se preferir
python3 -m http.server 8000   # → http://localhost:8000/suite/
```

Sem build, sem dependências. As fontes vêm do Google Fonts; sem rede, os fallbacks
declarados assumem e o layout continua correto.

## Consumir

### Tezzet web (Next.js + Tailwind v4)

```ts
// app/layout.tsx
import "@tezosrio/suite/tokens/tokens.css";
```

```css
/* app/globals.css — mapeia os tokens para o Tailwind v4 */
@import "tailwindcss";
@theme {
  --color-ink:        var(--c-ink);
  --color-gold:       var(--c-gold);
  --color-paper:      var(--c-paper);
  --color-steel-deep: var(--c-steel-deep);
  --font-display:     var(--f-display);
  --font-body:        var(--f-body);
  --font-data:        var(--f-data);
  --radius-DEFAULT:   var(--radius);
}
```

As primitivas `.t-*` são o contrato. Envolva cada uma num componente React
(`<Amount>`, `<Address>`, `<StatusBadge>`) e não reimplemente a formatação.

### TAPS mobile (React Native + Expo)

Gerar o tema no build a partir do JSON — nunca copiar valores à mão:

```js
// scripts/build-theme.mjs
import tokens from "@tezosrio/suite/tokens/tokens.json" with { type: "json" };
const pick = (g) => Object.fromEntries(
  Object.entries(tokens[g]).filter(([k]) => !k.startsWith("$")).map(([k, v]) => [k, v.value])
);
// → escreve src/theme.ts com { color, space, font, ... } tipado
```

Traduções necessárias no mobile:

- `radius: 0` → `borderRadius: 0` em tudo. É o padrão, não uma exceção.
- `shadow-hard` → uma `View` deslocada 2px atrás do elemento. `elevation` do Android
  e `shadowRadius` do iOS produzem desfoque, que não é o idioma do sistema.
- `cut` → `react-native-svg` ou Skia com o mesmo ângulo de 21°.
- `font-variant-numeric: tabular-nums` → `fontVariant: ["tabular-nums"]` no `Text`.

### Núcleo comum

Extrair um pacote TypeScript compartilhado com o que não é visual e ainda assim
precisa ser idêntico nos dois produtos:

- formatar valor (mutez `bigint` → string em XTZ com seis casas)
- truncar endereço (no meio, nunca no fim)
- validar endereço (`tz1`, `tz2`, `tz3`, `tz4`, `KT1`)
- montar URL do explorador por rede

Testado uma vez. Usado nos dois.

## Regras

Antes de mudar qualquer coisa, leia `NARRATIVE.md`. Em resumo:

1. **Dourado nunca é texto sobre fundo claro.** 1,79:1 — ilegível. Só preenchimento, régua ou corte.
2. **`border-radius: 0` em tudo.** Sem exceções.
3. **Um ângulo só: 21°.** Um segundo ângulo destrói a assinatura.
4. **Dado da cadeia é sempre monoespaçado e tabular.**
5. **Valor em XTZ tem seis casas decimais**, e é `bigint` em mutez no código.
6. **Cor nunca carrega significado sozinha.** Todo status tem texto.
7. **Nenhum produto ganha paleta própria.** A distinção entre Tezzet e TAPS é o rótulo.
8. **A passagem entre produtos carrega dado, nunca autoridade.** Nenhuma sessão atravessa o corte, e todo dado vindo de outro produto usa `.t-origin`. Ver `JOURNEY.md`.
9. **Nenhum número na tela é um número que ninguém leu.** Carregando, falha, velho e vazio têm primitiva própria — e nenhuma delas mostra zero.

Sugestão de portão no CI de cada repositório: falhar o build se aparecer um literal
hexadecimal de cor fora de `tokens.*`, um `border-radius` diferente de zero, ou um
valor monetário tipado como `number`. E rodar `node suite/tokens/contrast.mjs`, que
já reprova sozinho — o `index.html` desta pasta passa nos três.

## Idioma

Esta página e os documentos estão em português, o idioma do time. Os **nomes dos
tokens estão em inglês** de propósito, para que o código não precise de tradução
quando a suíte for publicada para a comunidade Tezos. Uma versão em inglês do
`index.html` e do `NARRATIVE.md` é pré-requisito para tornar o repositório público.

## Versão

`1.1.0` — declarada em `tokens/tokens.json` (`$version`). Mudança ou acréscimo de valor
de token é *minor*; **remoção ou renomeação de token ou de primitiva `.t-*` é *major***.
A regra passa a cobrir as primitivas explicitamente: elas são o contrato de consumo tanto
quanto os tokens são.

### O que mudou em 1.1.0

- **Acrescentadas** cinco cores que já estavam escritas à mão em `index.html`
  (`paper-dim`, `steel-dim`, `steel-faint`, `rule-dark`, `hairline`), e as primitivas
  `.t-skeleton`, `.t-fault`, `.t-stale`, `.t-empty`, `.t-cross` e `.t-origin`.
- **Corrigidas** as razões de contraste, que estavam subestimadas na 1.0.0. Uma delas
  mudava uma regra: `steel` sobre `paper` é **4,62:1** e passa AA — a 1.0.0 dizia 4,25:1
  e "falha AA". A preferência de desenho não mudou (corpo de texto sobre `paper` é `ink`),
  mas ela agora é preferência declarada, não limitação inventada. `tokens/contrast.mjs`
  existe para que isso não volte a acontecer.
- **Renomeadas** `.t-network--ghostnet` → `.t-network--test` e `.t-network--mainnet` →
  `.t-network--main`. Ghostnet foi desligada (ADR-0001 §11.2) e o nome de uma rede não
  pertence a uma folha de estilo — é exatamente a constante-de-rede-na-fonte que a suíte
  proíbe no código. Pela regra acima isso seria *major*; fica em *minor* porque a 1.0.0
  **não tem nenhum consumidor** — nenhum arquivo fora de `suite/` importa `tokens.css`,
  conferido nos dois repositórios. A regra vale a partir daqui.
