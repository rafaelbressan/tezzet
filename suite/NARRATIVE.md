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

## A passagem entre os dois lados

O corte separa dois produtos que descrevem **o mesmo evento**. Um pagamento de delegação tem dois registros: o delegador vê um valor entrar; o baker sabe de que ciclo ele veio, qual foi a recompensa bruta, quanto foi comissão e o que ficou retido abaixo do mínimo. Hoje cada lado vê a própria metade e adivinha a outra. A passagem existe para que cada lado possa ler a metade do outro.

### O teste que decide se ela deve existir

> **O que a pessoa deixa de conseguir fazer se a passagem não existir?**

Se a resposta for "nada, ela abre o outro aplicativo", não é passagem — é propaganda cruzada, e a resposta certa é não construir.

Aqui a resposta não é "nada". **Quem delega pelo Tezzet não consegue conferir se recebeu o que era devido.** A cadeia diz que 0,125000 XTZ entraram, de que lote e para quantos destinos. Ela não diz a recompensa bruta, a comissão, o mínimo aplicado nem o que ficou acumulado — nada disso está na cadeia, porque é política do baker. Sem a passagem, a pergunta *isso está certo?* não tem resposta possível: nem no Tezzet, nem num explorador genérico. E abrir o outro aplicativo não resolve — o TAPS é do baker, roda na máquina dele, e o delegador nunca vai ter acesso a ele.

Disso sai o critério de aceite de qualquer passagem futura:

> **Toda passagem de dado responde "isso está certo?".**

### A restrição que decide o desenho

**O TAPS é local-first: não há servidor, não há login e não há porta aberta.** Isso elimina de saída o desenho óbvio — o Tezzet consultar o TAPS de alguém. Sobram três caminhos.

| Caminho | O que ele responde | O que custa |
|---|---|---|
| **Pela cadeia** — os dois leem a mesma TzKT | de quem veio, qual lote, quantos destinos, quanto entrou, e quando | nada: não precisa de acordo entre os produtos, e funciona mesmo que o TAPS não exista |
| **Por arquivo** — o baker publica o extrato do ciclo, assinado; o Tezzet lê e confere contra a cadeia | de que ciclo veio, a comissão, o retido abaixo do mínimo e o acumulado | um formato, uma assinatura, e um passo manual do baker |
| **Só descoberta** — um convite, sem dado atravessando | nada | nada |

**A escolha: os dois primeiros, em degraus. O terceiro não é passagem.**

**Por que os dois, e não um.** A cadeia sozinha não responde à pergunta — ela mostra o valor, não se o valor está certo. O arquivo sozinho não serve porque a maioria dos bakers não roda TAPS: uma passagem que só funciona quando o outro lado coopera deixa a tela vazia para quase todo mundo. Em degraus, o degrau 0 funciona sempre e o degrau 1 acrescenta o que só o outro lado sabe. O degrau 1 é uma resposta melhor, não uma condição para haver resposta.

**Por que a descoberta não é passagem.** Ela não carrega dado nenhum, então não passa no teste. Isso não a proíbe — só a tira daqui. Dizer que o outro produto existe é **sugestão de produto**, governada por outra regra (*só aparece para quem é candidato*, e na Tezos dá para saber quem é candidato lendo o campo de *delegate* da cadeia), e quem decide sobre ela é produto, não desenho.

### A regra que não se negocia

> **A passagem carrega dado, nunca autoridade.**

Nenhuma sessão, credencial, permissão ou chave atravessa o corte. A sessão que abre o console do TAPS não é a que assina dinheiro. Três consequências permanentes:

1. **A suíte não tem barra de aplicativos nem seletor de produto.** Um seletor implica uma sessão que abrange os dois. As passagens são contextuais e de mão única: aparecem onde a pergunta nasce.
2. **A suíte não tem conta.** O que liga uma pessoa dos dois lados é um **endereço** — público e conferível por qualquer um. Quando a origem precisa ser provada, **assina-se o dado; não se autentica a pessoa.**
3. **Todo dado que chega do outro lado chega desconfiado.** Ele aparece marcado com `.t-origin`: de onde veio e em que estado está a verificação, em **texto**, antes do valor. A primitiva não tem estado padrão — **sem procedência, o dado não entra na tela.**

### Os dois sentidos

| | **Passagem A — o extrato do ciclo** | **Passagem B — o reforço da carteira** |
|---|---|---|
| Direção | TAPS produz → Tezzet lê | TAPS pede → Tezzet decide |
| Para quem | O delegador | O baker |
| Onde aparece | No detalhe de uma entrada vinda do baker para quem se delega | Na tela do ciclo, só quando o saldo não cobre o lote |
| O que atravessa | Dado assinado, conferido contra a cadeia | Um endereço e um valor, não verificados |
| O que nunca atravessa | Autoridade | Autoridade |

O convite para atravessar é `.t-cross`, e ele nunca é o único caminho: ao lado dele há sempre a mesma informação em forma copiável, para quem não usa o outro produto.

O texto real de cada tela, os estados de falha e o que foi recusado estão em [`JOURNEY.md`](JOURNEY.md). O desenho aplicado está em `index.html`, seção **jornada**.

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
