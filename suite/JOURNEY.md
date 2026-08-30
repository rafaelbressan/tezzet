# Suíte Tezos — a jornada entre Tezzet e TAPS

> Escrito por Suite Design & Journey · BRES-43 · 2026-08-30
> Base factual: `docs/tezos-network-facts.md`, `docs/spec/0001-nucleo-criptografico-compartilhado.md`,
> `docs/adr/0001-stack-unificada-tezzet-taps.md` e `docs/spec/REGRAS-DE-NEGOCIO.md` (repo do TAPS).
> Vocabulário e regras visuais: [`NARRATIVE.md`](NARRATIVE.md). Valores: [`tokens/`](tokens/).

---

## 1. A tese

Um pagamento de delegação é **um evento com dois registros**. O delegador vê um valor entrar na
carteira. O baker sabe de que ciclo ele veio, qual foi a recompensa bruta, quanto foi comissão,
o que ficou retido abaixo do mínimo e o que sobrou acumulado para o ciclo seguinte. Hoje cada lado
vê a própria metade e adivinha a outra: o delegador não sabe por que recebeu aquele valor, e o
baker descobre que o pagamento falhou quando alguém reclama. A jornada entre Tezzet e TAPS existe
para fechar essa lacuna — **cada lado passa a poder ler a metade do outro, do mesmo evento** —
e não para levar quem usa um produto a instalar o outro.

Isso dá um teste, e ele é o critério de aceite de qualquer passagem futura:

> **Toda passagem responde "isso está certo?".**
> Nenhuma responde "e se você também usasse…".

Uma passagem que só faz sentido do ponto de vista de quem vende não entra. A seção 6 lista as que
foram recusadas por esse teste, com o motivo de cada uma, para que ninguém precise redescobrir.

---

## 2. A regra da passagem

> **A passagem carrega dado. Nunca autoridade.**

Nenhuma sessão, credencial, permissão ou chave atravessa o corte. O que atravessa é informação, e
ela chega **marcada com a procedência**: de onde veio e se foi verificada.

Isto não é preferência de desenho. É o limite duro herdado do veto do Tezos Core & Crypto e
registrado em SPEC-0001 §8.5: *"mesma interface de login" nunca vira "a mesma credencial assina
dinheiro"*. A sessão do operador autoriza o console do TAPS; ela não autoriza payout. Uma tela que
sugira o contrário é reprovação, e nenhuma primitiva desta suíte torna essa tela fácil de fazer.

Três consequências que valem para sempre:

1. **A suíte não tem barra de aplicativos nem seletor de produto.** Um seletor de app implica uma
   sessão que abrange os dois produtos — que é exatamente o que a regra proíbe. As passagens são
   contextuais, aparecem onde a pergunta nasce, e são de mão única.
2. **A suíte não tem conta.** Ver a seção 3.
3. **Todo dado que chega de fora chega desconfiado.** O produto que recebe mostra a origem e o
   estado da verificação antes de mostrar o valor, e a pessoa é quem decide. A primitiva é
   `.t-origin`, e ela não tem estado padrão: sem procedência, o dado não entra na tela.

---

## 3. Identidade compartilhada — o que significa ser a mesma pessoa

As duas naturezas são diferentes e a suíte admite isso em vez de forçar simetria:

| | **Tezzet** | **TAPS** |
|---|---|---|
| O que existe | Um cofre local, neste aparelho | Uma conta de operador, neste console |
| Identidade é | Controlar uma chave | Ter uma credencial e um papel |
| Quantas pessoas | Exatamente uma: quem está com o aparelho | Várias, com papéis e revogação |
| Recuperação | A frase de recuperação. Não há outra | O administrador do console |
| Servidor | Nenhum | O próprio, na máquina do baker |

**Não existe conta da suíte, e não vai existir.** O Tezzet não tem servidor onde uma conta pudesse
morar, e inventar um para "unificar o login" adicionaria a única peça que o produto conseguiu
evitar até aqui.

O que é genuinamente compartilhado é a **cerimônia de entrada**, não o fator: prompt nativo sempre
(nunca `<input>` de HTML para segredo), separação entre entrar e transacionar, verificação nativa
sem recuo silencioso, a mesma gramática de erro e a mesma política de sessão e de tempo limite.
O baker que usa os dois não aprende duas coisas. A escolha de fator por plataforma está em
SPEC-0001 §6 — Android Keystore, Windows Hello, e no Linux só a senha — e não se redecide aqui.

**Então o que liga uma pessoa dos dois lados?** Um **endereço**. É público, é verificável por
qualquer um, e não precisa de conta nenhuma para ser conferido. Quando uma passagem precisar de
prova, a prova é **assinatura sobre o dado**, nunca sessão sobre a pessoa:

> **Assina-se o dado, não se autentica a pessoa.**

O extrato do ciclo (seção 4) é assinado pelo endereço do baker. Quem recebe confere a assinatura
contra o endereço para quem delega — informação que já está na cadeia. Ninguém faz login em lugar
nenhum, e mesmo assim a origem fica provada.

---

## 4. Passagem A — o extrato do ciclo

**Direção:** TAPS produz → Tezzet lê. O dado anda do baker para o delegador.

**Por que existe.** A comissão e a retenção abaixo do mínimo são política do baker: **não estão na
cadeia**. O delegador consegue ver, sozinho, que recebeu um valor e de qual lote — mas não consegue
derivar de que ciclo aquilo é, quanto foi a comissão, nem o que ficou retido. Essa informação
existe, do outro lado, e hoje não chega a quem ela é sobre.

**Onde aparece.** No Tezzet, no detalhe de uma entrada vinda do endereço para quem a pessoa delega.
Em nenhum outro lugar. Não é uma aba, não é uma seção, não é uma notificação.

### 4.1 O que a passagem tem de degradar com honestidade

A passagem é **graduada**, porque o baker pode não rodar TAPS — e a maioria não roda.

**Nível 0, sempre disponível, só cadeia.** Funciona sem TAPS nenhum:

```
RECEBIDO                                              0,125000 XTZ
de  tz1fwnf…rZbA                    o baker para quem você delega
Lote  onvX8mR2…KpQ4uZ · 1.069 destinos · injetado no ciclo 1338
                                                    lido há 2 min
```

Repare no que a linha **não** diz: ela diz o ciclo em que a operação foi **injetada**, não o ciclo
que ela **paga**. Os dois quase sempre diferem, e a relação entre eles é convenção do baker, não
fato da cadeia. Afirmar o ciclo pago aqui seria apresentar uma inferência como leitura — o mesmo
erro de categoria que faz um `|| 0` virar um pagamento de zero.

**Nível 1, quando o baker publica extrato.** A passagem:

```
◤ EXTRATO DO CICLO · TAPS de tz1fwnf…rZbA
  De que ciclo veio este valor, qual foi a comissão, o que ficou retido.
  Assinatura conferida contra tz1fwnf…rZbA
```

E o extrato:

```
CICLO 1336

Recompensa bruta                                      0,131578 XTZ
Comissão do baker            5,00%                   −0,006578 XTZ
                                                     ────────────
Pago                                                  0,125000 XTZ

Retido abaixo do mínimo                               0,000000 XTZ
Acumulado de ciclos anteriores                        0,000000 XTZ

O mínimo deste ciclo foi 0,000477 XTZ — a taxa estimada para a sua
transferência, na hora da distribuição. Abaixo dela, o valor não é
pago: ele acumula e entra no ciclo seguinte.

Assinado por tz1fwnf…rZbA em 30/08/2026 04:12       conferido
```

Os números são reais: são a distribuição medida do ciclo 1336 do Bake Nug, e o mínimo de 477 mutez
é a mediana de taxa medida sobre 5.957 transferências de mainnet
(`docs/tezos-network-facts.md` §3.6).

### 4.2 Os estados

**Vazio — o baker não publica extrato.** Convite, não lamento, e sem pedir nada a ninguém:

```
O SEU BAKER NÃO PUBLICA EXTRATO

O que está acima veio da cadeia: o lote, os destinos e o valor que
chegou a você. A comissão e a retenção são política do baker e não
ficam na cadeia — não há de onde lê-las.
```

Não há botão "peça ao seu baker". Cobrar do delegador uma conversa que não é dele seria transformar
uma limitação nossa em tarefa dele.

**Carregando.** Barra na forma do número. Nunca um zero, nunca `--`:

```
Recompensa bruta                                    ▨▨▨▨▨▨▨▨▨▨▨▨
```

**Falha de leitura.** Diz o que falhou, de onde, e o que deixou de ser conhecido:

```
A TzKT não respondeu.
api.tzkt.io · 3 tentativas · última às 11:04
Sem ela não dá para saber de que lote este valor veio. O valor
recebido está correto: ele está na cadeia, e é 0,125000 XTZ.
```

A última frase é a regra inteira em uma linha: **separe o que continua conhecido do que deixou de
ser.** O erro do TAPS que motivou toda a reconstrução foi o oposto — trocar o desconhecido por zero
e seguir em frente.

**Assinatura que não confere.** O caso mais delicado, e o mais seco:

```
EXTRATO RECUSADO
A assinatura não corresponde a tz1fwnf…rZbA.

O valor que você recebeu continua correto — ele está na cadeia. O
extrato, não. Não use os números abaixo para conferir nada.
```

O extrato recusado **não é escondido**: ele fica visível, marcado, e inutilizável para conferência.
Esconder produziria a pergunta "cadê o extrato?" e nenhuma resposta.

---

## 5. Passagem B — o pedido de reforço da carteira de pagamento

**Direção:** TAPS pede → Tezzet decide. O dado anda do console para a carteira; a autoridade
fica parada, com a pessoa.

**Por que existe.** O TAPS **não assina** — a chave de payout vive num `octez-signer` em outra
máquina (SPEC-0001 §11). Mas antes de pagar, alguém precisa garantir que a carteira de pagamento
tem saldo. Quem sabe quanto o ciclo vai custar é o TAPS. Quem tem o dinheiro do baker e a chave que
move esse dinheiro é a carteira. Hoje esse encontro acontece na cabeça do baker, com dois números
copiados à mão — e um erro de dígito aqui é dinheiro no endereço errado.

**Onde aparece.** No TAPS, na tela do ciclo, **somente quando o saldo não cobre o lote**. Nunca
como sugestão permanente.

```
CICLO 1336 · fechado, a pagar

Pagamentos          1.069 delegadores            27,547507 XTZ
Taxas estimadas                                   0,509913 XTZ
                                                ─────────────
Total                                            28,057420 XTZ

Carteira de pagamento  tz1PayS…9dQ2              24,852700 XTZ
Faltam                                            3,204720 XTZ

Não dá para pagar o ciclo 1336 com este saldo. A distribuição roda
quando o ciclo 1338 começar — 02/09, 04:06.

  ◤ REFORÇAR NO TEZZET
    Abre um pedido de transferência de 3,204720 XTZ para
    tz1PayS…9dQ2. Quem envia é você, no Tezzet.

  [ Copiar endereço e valor ]
```

O botão secundário existe de propósito: quem guarda XTZ noutra carteira precisa da mesma informação
sem o Tezzet no meio. **A passagem nunca é o único caminho.**

**Do outro lado, no Tezzet**, o pedido chega como o que ele é — entrada de fora:

```
┌ PEDIDO DE TRANSFERÊNCIA · TAPS NESTE COMPUTADOR · NÃO VERIFICADO ┐

Para     tz1PayS8n4kQvW3xJ2mHc7RdLpAe5TgYb9dQ2
Valor    3,204720 XTZ
Nota     Reforço da carteira de pagamento · ciclo 1336

O Tezzet não verificou quem pediu esta transferência — só que ela
chegou. Confira o endereço caractere a caractere antes de enviar.

  [ Enviar 3,204720 XTZ ]        [ Descartar ]
```

Três coisas que essa tela faz de propósito:

- **O verbo do botão é o que acontece** — *Enviar 3,204720 XTZ*, com o valor dentro do botão. A
  confirmação depois é *Enviado 3,204720 XTZ*. O verbo não muda no meio do caminho.
- **O endereço aparece inteiro**, não truncado. Truncar é para listas; para conferir antes de
  enviar dinheiro, o que serve é o endereço completo.
- **Nada está pré-aprovado.** O PIN de transação é pedido depois, em janela nativa, e é conferido
  dentro do núcleo (SPEC-0001 §8.4). O pedido do TAPS não encurta esse caminho em um passo sequer.

**Falha.** Se o pedido chegar malformado, o Tezzet não conserta e não adivinha:

```
PEDIDO DESCARTADO
O endereço de destino não é válido: tz1PayS8n4kQvW3xJ2mHc7RdLpAe5TgYb9dQ
tem 35 caracteres; um endereço Tezos tem 36. Nada foi preenchido.
```

---

## 6. As passagens recusadas

Escritas aqui para que ninguém precise refazer o raciocínio, e para que uma reversão tenha que dar
o motivo.

| Passagem | Por que foi recusada |
|---|---|
| **Descobrir bakers dentro do Tezzet** | Uma carteira que recomenda para quem delegar tem conflito de interesse com quem a usa. É publicidade com aparência de recurso. |
| **"Instale o TAPS" para quem tem endereço de baker** | Responde "e se você também usasse". Falha o teste da seção 1. |
| **Login único da suíte** | Proibido pela seção 2. E o Tezzet não tem servidor onde uma conta pudesse existir. |
| **Aprovar payout do TAPS pelo Tezzet** | Faria a carteira do baker virar custódia de payout, desfazendo a decisão de SPEC-0001 §11. Quem aprova payout é o companion do TAPS (BRES-49), que é outro produto da mesma suíte. |
| **Carteira embutida dentro do TAPS** | Um console de operação com fundos dentro é o modelo de maior risco possível — e é literalmente o defeito que a reconstrução existe para apagar. |
| **Painel único com os dois produtos** | Simetria forçada. Os públicos, os riscos e as frequências de uso são diferentes; ver a seção 7. |

Duas passagens, não seis. Uma jornada com muitas passagens é um funil com outro nome.

---

## 7. Navegação — o que é comum e o que deliberadamente não é

### Comum, e a mesma implementação nos dois

- **A cerimônia de entrada.** Desbloqueio, sessão, tempo limite, prompt nativo, gramática de erro.
- **A cerimônia de confirmação** antes de qualquer coisa que mova dinheiro: o quê, para quem,
  quanto, quanto custa, e o verbo que não muda.
- **O selo de rede**, sempre no mesmo canto. Rede real fica quieta; rede de teste grita.
- **As primitivas de dado de cadeia** — endereço, valor, hash, ciclo, status.
- **Os quatro estados** da seção 8. Um número na tela é sempre um número que foi lido.
- **A gramática de erro:** o que houve, com que números, e o que continua valendo.

### Deliberadamente diferente

| | **Tezzet** | **TAPS** |
|---|---|---|
| Tela inicial | O saldo | O ciclo |
| Modelo de navegação | Uma tarefa por vez, poucas e profundas | Console: listas, filtros, histórico, configuração |
| Densidade | Um número grande, espaço generoso | Tabela densa, muitas linhas de uma vez |
| Rascunho | Não existe. Uma operação aconteceu ou não | Configuração tem rascunho e validação antes de aplicar |
| Pessoas | Uma. Nunca introduza "usuários" no Tezzet | Várias, com papéis e revogação |
| Frequência | Minutos por semana | Aberto o dia inteiro |
| Fator de desbloqueio | Varia por plataforma, e o texto varia junto | Varia por plataforma, e o texto varia junto |

**Mesmos tokens, escalas diferentes.** O Tezzet usa `--t-2xl` para um saldo e `--s-8` entre blocos;
o TAPS usa `--t-sm` em tabela e `--s-2`. Não é outra linguagem — é a mesma linguagem falada em
outro volume.

**O texto do desbloqueio muda com a plataforma, e isso é obrigatório.** Nunca escreva "use sua
digital" num app que roda no Linux, onde só há senha (SPEC-0001 §6.1). Uma frase que promete o que
a plataforma não faz é pior que nenhuma frase.

---

## 8. Os quatro estados de todo dado de cadeia

Nenhum dos quatro é um zero. Esta é a tradução visual da regra "falte alto", e ela existe porque um
`|| 0` num campo da TzKT fez o TAPS calcular pagamento zero para todos os delegadores, em silêncio.

| Estado | O que aparece | O que nunca aparece |
|---|---|---|
| **Carregando** | Barra na forma do número (`.t-skeleton`) | `0`, `--`, `0,000000`, espaço em branco |
| **Falha** | O que falhou, o host, quantas tentativas, o que deixou de ser conhecido, e o que **continua** conhecido (`.t-fault`) | "Algo deu errado", ícone sozinho, silêncio |
| **Velho** | A hora da leitura, colada no dado (`.t-stale`) | Um valor sem hora, indistinguível de um novo |
| **Vazio** | O que ainda não aconteceu e **quando** acontece (`.t-empty`) | "Nada por aqui", ilustração, desculpa |

Exemplo de vazio que é convite, com a mecânica real da rede:

```
NENHUM PAGAMENTO AINDA

O ciclo 1336 fechou. A distribuição dele roda quando o ciclo 1338
começar — 02/09, 04:06. A recompensa de um ciclo é creditada no
último bloco dele, e a suíte espera mais um ciclo porque uma
denúncia ainda pode reduzir o valor.
```

Vazio com data é uma promessa verificável. Vazio sem data é uma desculpa.

---

## 9. Primeira execução do Tezzet, contada como história

Alguém abriu o Tezzet pela primeira vez. Não tem carteira, não tem conta, e está desconfiado —
que é a postura certa.

**1 · Abertura.** Sem splash e sem promessa.

> **TEZZET — GUARDAR**
> Esta carteira fica neste aparelho. Não há servidor, não há conta e não há recuperação por
> e-mail. Se você perder o aparelho e a frase de recuperação, o dinheiro se perde com eles.
>
> `[ Criar carteira ]` `[ Importar carteira ]`

**2 · Rede.** Começa na rede de teste. Trocar é decisão, e ela é pedida, não presumida.

> Você está na **Shadownet**. O XTZ daqui não vale dinheiro, e é onde dá para errar de graça.
> Trocar para mainnet é uma decisão sua, e ela pede confirmação toda vez.

**3 · Senha.** A janela é do sistema, e a tela diz por quê.

> A senha vai ser pedida numa janela do sistema, fora do aplicativo. Nenhuma tela do Tezzet lê o
> que você digita ali.
>
> *No Linux:* Neste computador só a senha destrava a carteira. Não há Windows Hello, e o Tezzet
> não usa leitor biométrico no Linux.
> *No Windows:* Depois da primeira vez, o Windows Hello destrava. A senha continua valendo, e é
> ela que recupera se o Hello for reconfigurado.
> *No Android:* Depois da primeira vez, a biometria do aparelho destrava. A senha continua valendo.

**4 · PIN de transação.** Seis dígitos, e a tela explica o que eles não fazem.

> Escolha um PIN de transação. Ele **não** protege a carteira guardada — a senha faz isso. O PIN é
> o que separa **abrir** a carteira de **gastar** o que está nela.

**5 · Frase de recuperação.** A tela mais seca do produto. Sem ilustração, sem parabéns.

> **DOZE PALAVRAS**
> Quem tiver estas doze palavras tem o seu dinheiro. Ninguém do Tezzet pode recuperá-las por você,
> porque ninguém do Tezzet as tem.
> Escreva no papel. Não fotografe, não digite num aplicativo de notas, não guarde na nuvem.
> A captura de tela está desligada nesta tela.
>
> `1 abandon   2 ability   3 able   4 about …`
>
> Depois: confirme a 3ª, a 7ª e a 11ª palavra.

**6 · Pronto — e o vazio é convite.**

> **CARTEIRA CRIADA**
> `tz1VSUr8wwNhLAzempoch5d6hLRiTh8Cjcjb`   `0,000000 XTZ`
>
> Nada aconteceu ainda. Receba XTZ neste endereço, ou peça à torneira da Shadownet para testar
> sem risco.

**Onde a passagem A aparece nesta história:** em lugar nenhum. Ela só existe depois que a pessoa
delega e recebe a primeira recompensa. Uma passagem que aparece antes de ter serventia é um anúncio.

---

## 10. Primeira execução do TAPS, contada como história

Um baker instalou o TAPS na própria máquina. Ele tem um nó rodando e delegadores esperando.

**1 · Abertura.** O que o produto é, e o que ele não é.

> **TAPS — PAGAR**
> O TAPS roda nesta máquina. Ele calcula, monta e acompanha os pagamentos do seu baker.
> **Ele não guarda a chave que assina.**

**2 · Endereço do baker.** Lido da cadeia, não digitado e aceito.

> Endereço do baker
> `tz1fwnf…rZbA` → **Bake Nug** · 2.919 delegadores · ciclo atual 1338 · lido há 8 s
>
> *Erro:* Este endereço não é um baker. Nenhum ciclo com direitos de consenso encontrado para
> `tz1VSUr8ww…Th8Cjcjb`.

**3 · Rede.** Começa na Bakingnet, e a tela prova por que a constante vem da rede:

> Você está na **Bakingnet**. Um ciclo aqui dura **6 horas**, não 1 dia — `blocks_per_cycle` é
> 3600 aqui e 14400 na mainnet. O TAPS lê esse número da rede a cada início de ciclo. Se ele
> estivesse escrito no código, todo cálculo derivado de ciclo erraria por 4×, e erraria calado.

**4 · O assinador.** A tela difícil, e ela fica mais seca, não mais amigável.

> O TAPS não assina. Ele pede a assinatura a um `octez-signer` que roda em **outra máquina**, com a
> sua chave. Sem ele o TAPS calcula e simula, e não paga.
>
> Socket do assinador · Chave de cliente autorizada
>
> *Assinatura de teste recusada:* o assinador respondeu que o byte mágico `0x03` não está
> autorizado. Ligue `--magic-bytes 0x03` nele. Sem isso, ele recusa operações de transferência —
> e com ele ligado, recusa assinar bloco e atestação, que é o que você quer.

**5 · Modo.** Três, e começa no do meio.

> **Desligado** · **Simula** · **Paga**
> Em **Simula**, o TAPS calcula tudo e não envia nada. Os números da simulação são exatamente os
> que o pagamento real produziria no mesmo instante — se diferirem, é defeito, não modo.
>
> *Ao trocar para Paga:* A partir daqui o TAPS envia dinheiro de verdade quando o ciclo virar.
> Digite o endereço do baker para confirmar.

**6 · Comissão.**

> Comissão do baker: **5,00%** (500 pontos-base). Vale para todos os delegadores que não tiverem
> comissão própria registrada.

**7 · Vazio, com data.**

> **NENHUM PAGAMENTO AINDA**
> O ciclo 1336 fechou. A distribuição dele roda quando o ciclo 1338 começar — 02/09, 04:06.

**Onde a passagem B aparece nesta história:** em lugar nenhum. Ela só aparece no primeiro ciclo em
que faltar saldo. Se nunca faltar, o baker nunca a vê — e isso é o desenho funcionando.

---

## 11. Um terceiro produto entra na suíte

O que ele precisa trazer:

1. **Um verbo no infinitivo.** Guardar, pagar, e o terceiro. Sem verbo, não é um lado do corte —
   é um recurso de outro produto.
2. **Uma resposta escrita sobre chave:** ele guarda chave, pede assinatura a outro, ou não toca em
   chave nenhuma. Não há quarta opção, e a resposta muda a cerimônia de entrada inteira.

O que ele **não** traz:

- Paleta própria. A única distinção permitida continua sendo o rótulo.
- Um segundo ângulo. 21° é a assinatura; dois ângulos não são assinatura nenhuma.
- Uma conta, um login único, ou um seletor de aplicativos. Ver a seção 2.
- Uma implementação nova de endereço, valor, hash, ciclo, status ou rede. As primitivas `.t-*`
  são o contrato.

E como ele se liga aos outros: **por passagens de mão única que carregam dado**, cada uma passando
pelo teste da seção 1 e cada uma com procedência declarada. Um produto que precisa de uma sessão
compartilhada para funcionar não entra nesta suíte — ele é outro produto, de outra suíte.

O sistema aguenta isso porque a coisa compartilhada é pequena de propósito: tokens, primitivas,
vocabulário e cerimônia. Nada disso cresce com o número de produtos.

---

## 12. O que esta jornada exige e ainda não existe

Nenhuma tela deste documento pressupõe código que ninguém vai escrever. O que falta virou issue:

| O que falta | Passagem que depende | Issue |
|---|---|---|
| Extrato do ciclo por delegador, assinado e publicável, produzido pelo TAPS | A | BRES-69 |
| Leitor de pedido de transferência com procedência explícita, no Tezzet | B | BRES-70 |
| Cerimônia de entrada como implementação única, consumida pelos dois | seções 3 e 7 | BRES-71 |

---

## 13. Como isto se faz cumprir em revisão

Perguntas que reprovam um PR de interface da suíte:

- A passagem responde "isso está certo?" ou responde "e se você também usasse…"?
- Algum dado que veio de outro produto aparece sem `.t-origin`?
- Alguma tela deixa entender que a sessão de um produto autoriza uma assinatura no outro?
- Algum número na tela pode ser um zero que ninguém leu?
- Algum estado de erro diz "algo deu errado" em vez de dizer os números?
- Alguma tela promete um fator de desbloqueio que aquela plataforma não tem?
- Algum valor visual não saiu de `tokens/`?
- O verbo do botão é o mesmo verbo da confirmação?
