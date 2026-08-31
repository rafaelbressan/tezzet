# Suíte Tezos.Rio — narrativa

## O problema que isto resolve

Tezzet e TAPS são dois produtos do mesmo time, para a mesma rede, feitos para os dois lados da mesma relação econômica — e hoje não parecem ter nada a ver um com o outro. Um é um app Android em Java de 2019. O outro é um backend TypeScript de 2025 sem interface. Nada é compartilhado: nem cor, nem tipografia, nem vocabulário, nem sequer a forma de escrever um endereço `tz1`.

Isso custa três coisas concretas:

1. **Retrabalho.** Cada produto vai reimplementar "mostrar um valor em XTZ", "truncar um endereço", "linkar um hash de operação". Duas implementações, dois conjuntos de bugs de arredondamento.
2. **Confiança.** Em cripto, consistência visual é sinal de seriedade. Dois produtos do mesmo time que parecem de times diferentes enfraquecem os dois.
3. **Explicação.** Hoje não existe uma frase que diga o que os dois produtos são juntos. Sem isso, não há suíte — há dois repositórios.

## A ideia central: o corte

A identidade já existia e ninguém tinha reparado. Está no logotipo do Tezzet:

```
TEZ ◤ ZET
```

Preto pesado condensado, cortado ao meio por um golpe dourado em diagonal. A palavra é simétrica em torno do corte: **TEZ** de um lado, **ZET** do outro, e o dourado é exatamente a linha que os separa e os une.

É disso que a suíte inteira é feita. Um ângulo — 21° — tirado desse corte, usado em toda parte: nos divisores de seção, no chanfro dos cartões, no preenchimento dos botões. Um dourado só, `#C8B08B`, que só aparece no corte. Tudo o mais fica reto, plano e quieto: cantos a zero, sombra dura sem desfoque, sem gradiente.

A regra: **gaste a ousadia num lugar só.** O corte é a coisa memorável. O resto é disciplina.

## Os dois lados

O corte não é ornamento — ele diz o que a suíte é.

| | **TEZZET** | **TAPS** |
|---|---|---|
| Verbo | **Guardar** | **Pagar** |
| Quem | Quem tem XTZ | Quem opera um baker |
| Onde | No bolso | No servidor |
| Relação | Delega | Recompensa |

São os dois lados de uma única transação econômica na Tezos: alguém delega, alguém paga de volta. Um produto para cada lado, e o corte no meio.

**A frase da suíte:**

> Tezos, dos dois lados do corte.
> Tezzet guarda. TAPS paga.

Isso é curto o suficiente para caber num cabeçalho e específico o suficiente para não servir para mais nada.

## O que muda em cada produto

**Nada de paleta própria.** Nem Tezzet nem TAPS ganham uma cor "sua". A única distinção permitida entre os dois é o rótulo. Se um dia um terceiro produto entrar na suíte, ele entra do mesmo jeito: mesmo dourado, mesmo corte, outro verbo.

**O que é compartilhado de verdade** não é a estética, é o vocabulário técnico. Endereço, valor, hash, ciclo, status de pagamento e rede são conceitos da Tezos, não de um produto. Eles precisam ter **uma** implementação correta, com truncamento, precisão e estados de erro resolvidos uma vez. É isso que está em `tokens/tokens.css`, na seção de primitivas.

## Voz

**Em português, na segunda pessoa, sem entusiasmo.** O público dos dois produtos é gente cuidadosa lidando com dinheiro próprio ou dos outros. Empolgação lê como venda; e ninguém quer que a carteira dele esteja animada.

**Diga o que acontece, não o que o sistema faz.** "Enviar 12,5 XTZ" e não "Submeter transação". O botão que diz *Aprovar pagamento* produz a confirmação *Pagamento aprovado* — o verbo não muda no meio do caminho.

**Erros não pedem desculpa e nunca são vagos.** Errado: "Ops! Algo deu errado." Certo: "Saldo insuficiente. São necessários 1.204,3 XTZ e há 1.190,0 XTZ na carteira."

**Tela vazia é convite, não lamento.** "Nenhum pagamento ainda. O ciclo 1336 fechou; a distribuição dele roda quando o 1338 começar."

**Nunca esconda risco atrás de tom simpático.** Mostrar mnemônica, aprovar payout e trocar para mainnet são momentos em que a interface deve ficar mais seca, não mais amigável.

### Vocabulário fixo

Uma palavra por conceito, nos dois produtos:

| Use | Não use |
|---|---|
| carteira | wallet, conta |
| endereço | address, chave pública |
| frase de recuperação | seed, mnemônica, seed phrase |
| senha da carteira | passphrase, senha mestra |
| PIN de transação | senha de transação, código |
| ciclo | cycle |
| delegador | delegante, delegate |
| baker | validador, padeiro |
| recompensa | reward, rendimento |
| pagamento | payout, distribuição |
| taxa da rede | fee, taxa de transação |
| comissão do baker | fee do baker, taxa de serviço |
| operação | transação, tx |
| rede de teste | testnet, shadownet/bakingnet (como termo genérico) |
| carteira de pagamento | hot wallet, carteira quente |
| assinador remoto | signer, servidor de assinatura |
| extrato do ciclo | relatório, recibo, demonstrativo |
| passagem | ponte, integração, deep link |
| desligado · simula · paga | off, simulation, on (na interface) |

`Shadownet`, `Bakingnet` e `mainnet` são nomes próprios de redes específicas — servem quando você fala **daquela** rede, e não como palavra genérica para "rede de teste". **Ghostnet foi desligada** (ADR-0001 §11.2): não aparece mais em texto nenhum da suíte. As redes de teste hoje são **Shadownet** para o Tezzet e **Bakingnet** para o TAPS.

**Senha da carteira e PIN de transação são coisas diferentes, e chamar as duas de "senha" é perigoso.** A senha da carteira protege o cofre guardado e é a raiz da recuperação. O PIN de transação não protege nada em repouso — ele não deriva chave e não cifra nada; é o portão que separa **abrir** a carteira de **gastar** o que está nela, e quem segura a contagem de tentativas é o sistema operacional (SPEC-0001 §8.4). Uma pessoa que acredita que o PIN de seis dígitos protege o cofre está errada sobre a própria segurança, e foi a interface que ensinou isso a ela.

## Regras que não se negociam

1. **Dourado nunca é texto sobre fundo claro.** `#C8B08B` sobre `#EDEDED` dá 1,79:1. É preenchimento, régua ou corte — nunca letra. Sobre preto (9,46:1) pode tudo. Todas as razões da suíte são recalculadas por `tokens/contrast.mjs`, que reprova se `tokens.json` divergir do cálculo.
2. **Zero cantos arredondados.** Herdado do `button_selector.xml` original, que já usava `android:radius="0dp"`.
3. **Um ângulo só.** 21°. Um segundo ângulo destrói a assinatura.
4. **Todo dado da cadeia é monoespaçado e tabular.** Endereço, hash, valor, ciclo, bloco. Sem exceção — é o que permite conferir dois valores um sobre o outro.
5. **Valor em XTZ tem seis casas decimais.** A unidade da rede é o mutez. Arredondar para duas casas é perder dinheiro.
6. **Cor nunca carrega significado sozinha.** Todo status tem texto. Daltonismo e impressão em preto e branco continuam funcionando.
7. **Movimento orienta, não enfeita.** O corte se abre uma vez, no carregamento. O resto é transição de estado. Tudo respeita `prefers-reduced-motion`.
8. **A passagem entre produtos carrega dado, nunca autoridade.** Nenhuma sessão, credencial ou permissão atravessa o corte, e todo dado que vem de outro produto chega marcado com a procedência. Ver [`JOURNEY.md`](JOURNEY.md).
9. **Nenhum número na tela é um número que ninguém leu.** Dado de cadeia tem quatro estados — carregando, falha, velho e vazio — e nenhum deles é um zero.

## Como isto vira código

- `JOURNEY.md` — a jornada entre os dois produtos: a tese, as duas passagens, a identidade compartilhada e a primeira execução de cada um, com o texto real das telas.
- `tokens/tokens.json` — fonte única, neutra de plataforma. Web, React Native e Compose geram a partir dele.
- `tokens/contrast.mjs` — recalcula as razões de contraste e reprova se o JSON divergir.
- `tokens/tokens.css` — variáveis CSS e as primitivas compartilhadas.
- `index.html` — a referência viva. Abra num navegador para ver tudo aplicado.

Ver `README.md` deste diretório para o passo a passo de adoção em cada repositório.
