# ADR-0001 — Stack unificada da Suíte Tezos (Tezzet + TAPS)

| | |
|---|---|
| **Status** | **Proposta — passada 1: critérios pré-registrados, decisão pendente** |
| **Data desta passada** | 2026-08-27 |
| **Quem decide** | Rafael Miranda Bressan (portão humano) |
| **Quem recomenda** | Squad Suíte Tezos — recomendação redigida pelo Tezos Suite Lead |
| **Issue** | BRES-40 |
| **Depende de** | BRES-36 (spike Tauri v2 em Linux, Windows e Android) — ainda em execução nesta data |
| **Substitui** | Nada. É a primeira ADR da suíte. |

---

## Decisão

**PENDENTE.** Esta é a passada 1 e ela não decide.

O que fica fixado aqui é a **regra de decisão**, não a decisão. Três das cinco alternativas estão rejeitadas com evidência já disponível hoje. Duas seguem finalistas. Os portões que separam uma da outra estão pré-registrados na seção 3 e **congelados a partir da data de commit deste arquivo**, antes de o relatório do spike existir.

O motivo de escrever os critérios primeiro é simples: critério escrito depois do resultado não é critério, é racionalização do que aconteceu de ser mais fácil. O histórico do git deste arquivo é a prova da ordem.

## Aviso que precisa estar na primeira página

**Esta ADR vai decidir sobre cinco plataformas tendo verificado três.**

Não há máquina macOS disponível para a squad. Sem Mac não se builda iOS **nem** macOS desktop. Os alvos que o spike verifica de fato são **Linux, Windows e Android**. Tudo que esta ADR vier a afirmar sobre Apple é pesquisa, não verificação, e está registrado como risco aberto na seção 8 — com plano, prazo e custo.

Ninguém deve ler esta ADR e escrever "suporta iOS" em lugar nenhum.

---

## 1. Contexto

Dois produtos, dois lados da mesma relação econômica na rede Tezos: **Tezzet** (carteira, "guardar") e **TAPS** (distribuição de recompensas para bakers, "pagar"). Os dois estão parados, cada um por um motivo diferente, e os dois foram analisados em 2026-08-26 (`ANALYSIS.md` em cada repositório).

O estado verificado:

- **Tezzet** — app Android Java, commit `1c5f0c9` de 01/11/2019, ~1.286 linhas em 7 activities. Não compila (`jcenter()` e `dl.bintray.com` desligados levaram junto o `TezosJ_SDK`), não é publicável (`targetSdkVersion 28`), e assina com premissas do protocolo Babylon. Conclusão da análise: **reescrever, não migrar**. O código Java não é reaproveitável; a marca, o fluxo de telas e a decisão de ser não-custodial são.
- **TAPS** — backend NestJS de 26/11/2025, 13.541 linhas TypeScript em `src/` e 4.201 em `test/`. **Não compila** (12 erros `TS2300` em `tzkt-client.service.ts`, confirmados rodando `tsc`). Não tem migration nenhuma (`prisma/migrations/` só tem `.gitkeep`). O segredo JWT efetivo é o literal `'your-secret-key-change-in-production'`, publicado no repositório. O cálculo de recompensa retorna zero para todos os delegadores, em silêncio, porque todo acesso a campo da TzKT usa `|| 0`.

### 1.1 Restrições confirmadas em 2026-08-27

Estas três mudam o espaço de decisão e precisam aparecer explicitamente, porque várias conclusões abaixo dependem delas:

**Não há usuários em produção em nenhum dos dois sistemas.** Nenhuma compatibilidade a preservar, nenhuma migração obrigatória, nenhuma janela de manutenção, nenhuma urgência de segurança por exposição real. Decorre daí, diretamente, que **consertar o build e o JWT do TAPS atual não vale o esforço**: são correções em código que a reescrita passa por cima, e ninguém depende delas hoje. Se esta premissa for falsa — se existir um baker rodando TAPS em produção — ela dispara o gatilho de reversão RV-5 da seção 9 e a urgência de tudo muda.

**Não há máquina macOS.** Ver o aviso da primeira página.

**Runtime WSL** para toda a squad, por enquanto. Isso não é detalhe: é o ambiente onde os tempos de build e a cadeia de ferramentas Android são medidos, e entra como portão P6.

### 1.2 A proposta em avaliação

Unificar os dois produtos em **Tauri v2 + núcleo Rust**:

- Um código para desktop e mobile, cobrindo o requisito de ser cross-device e publicável nas lojas.
- A chave privada atrás da fronteira Rust — `zeroize`, controle real de memória, nada de JavaScript tocando a semente. Isso ataca diretamente a classe de erro encontrada nos **dois** sistemas: o `clearSensitiveData()` do TAPS que itera sobre uma `String` imutável sem apagar nada, e o `myWallet = null` do Tezzet comentado como "Erases wallet from memory".
- Divisão proposta: **Rust é dono da chave** (gerar, derivar, guardar, assinar), **TypeScript é dono da cadeia** (Taquito monta, estima e injeta; TzKT traz histórico). A fronteira é um `Signer` customizado do Taquito.
- Para o **TAPS**, uma tese adicional: o usuário é um baker rodando na própria máquina — o README original diz "We will use Lucee only for localhost (not Internet)". A migração de nov/2025 o transformou num stack de nuvem multi-tenant. Um app desktop local-first apaga a categoria inteira de autenticação, CORS e rate limit.

Essa proposta **não estava** nas duas `ANALYSIS.md`. As análises recomendaram, cada uma por conta própria, **Next.js na web + React Native/Expo no mobile** para o Tezzet, e **React Native + Expo** para o companion do TAPS. Isso importa: a alternativa concorrente não é um espantalho construído para perder, é a recomendação escrita por quem leu os dois códigos linha a linha.

---

## 2. Alternativas consideradas

Cinco. Três são rejeitadas agora, com evidência que já existe. Duas seguem finalistas e são decididas pelos portões da seção 3.

### 2.1 Rejeitada — manter o NestJS e só acrescentar frontends

**O que seria:** consertar o build do TAPS, gerar as migrations, corrigir o JWT, e construir os clientes (web e mobile) contra a API que já existe.

**Por que é rejeitada, com evidência:**

O argumento a favor dessa opção é sempre "já está pronto". Ele não se sustenta contra o que foi verificado. Não é um sistema pronto com defeitos; é um sistema que nunca rodou:

- Não compila (`TS2300` × 12 em `tzkt-client.service.ts`, mais `TS2339` em `payments.controller.ts` acessando seis campos que `PaymentEntity` não tem).
- Não tem banco. `prisma migrate deploy` roda com sucesso e não cria tabela nenhuma.
- `MonitoringModule` nunca é importado pelo `AppModule` — métricas, health e Sentry jamais são instanciados.
- O cálculo central retorna zero, e a validação que deveria pegar isso (`validateCalculation()`) é tautológica por construção: como `bakerShare = totalRewards − totalDelegatorPayments`, a condição testada nunca pode ser verdadeira.
- O pipeline aponta para clusters ECS e domínios `*.example.com` que não existem, com `actions/upload-artifact@v3` já desativado pelo GitHub e `npm audit` em `continue-on-error: true`.

Somado à restrição confirmada de **zero usuários em produção**, "já está pronto" vira "já está escrito", que é outra coisa. E o que está escrito precisa ser refeito no caminho do dinheiro de qualquer forma: `bigint` em mutez do começo ao fim (hoje `Math.floor(0.29 * 1e6)` dá 289999), constantes lidas da cadeia (hoje `BLOCKS_PER_CYCLE: 4096` fixo), idempotência real (hoje `clearPreviousAttempt()` apaga a evidência da tentativa anterior antes de reenviar).

Esta opção também não responde à pergunta que motivou o épico: ela não entrega desktop nem mobile, só mantém um backend de nuvem que o produto não pede.

**Fica registrado:** não é rejeitada por ser feia. É rejeitada porque o custo de consertar é comparável ao de reescrever e o resultado ainda não seria o produto pedido.

### 2.2 Rejeitada — nativo por plataforma (Kotlin/Compose + Swift/SwiftUI + desktop separado)

**O que seria:** a melhor segurança possível por plataforma — Keystore/StrongBox no Android, Secure Enclave no iOS — com código independente em cada uma.

**Por que é rejeitada, com evidência:**

O número que decide é o tamanho do time. A squad tem cinco papéis e um humano que revisa tudo. Nativo por plataforma multiplica por três a superfície de manutenção do que é justamente a parte que **não pode divergir**: o caminho do dinheiro e o ciclo de vida da chave.

E há evidência histórica direta dentro deste próprio repositório sobre o que acontece com um app nativo de plataforma única mantido por um time pequeno: o Tezzet ficou parado em `targetSdkVersion 28` e no protocolo Babylon durante seis anos, até deixar de compilar por causa do desligamento de um repositório de artefatos. Multiplicar isso por três plataformas não melhora o desfecho.

Ela permanece disponível como **reversão parcial** (seção 9): se o alvo iOS se mostrar inviável no framework escolhido, o mobile pode virar nativo sem que o desktop mude.

### 2.3 Rejeitada — web/PWA apenas

**O que seria:** um só alvo, o navegador, para os dois produtos.

**Por que é rejeitada, com evidência:**

Duas razões independentes, cada uma suficiente.

A primeira é de produto: **não é publicável nas lojas** e não atende ao requisito explícito de ser cross-device instalável. Para o TAPS, um PWA não resolve o problema real — o baker precisa de um agendador que rode com a máquina, não de uma aba aberta.

A segunda é de segurança, e é a mais séria. Para uma carteira, o navegador tem uma classe de risco que as outras opções não têm: **supply chain**. Uma dependência transitiva comprometida no bundle que toca a chave lê a semente, e a lista de pacotes de um app web moderno é longa demais para auditar a cada release. A própria `ANALYSIS.md` do Tezzet chega nessa conclusão ao escrever as regras não-negociáveis da versão web (CSP rígida, SRI, lockfile, mínimo de dependências no bundle da chave) — são regras que existem porque o risco é estrutural, não porque alguém foi descuidado.

**Ressalva que fica registrada:** web *somente-leitura*, sem custódia, via Beacon, continua sendo uma boa ideia e não está rejeitada. O que está rejeitado é web como **a** plataforma dos dois produtos, incluindo custódia. A sequência do épico já reflete isso: BRES-45 entrega leitura e Beacon com zero custódia, e BRES-50 deixa custódia própria por último.

### 2.4 Finalista A — Tauri v2 + núcleo Rust

Descrita em 1.2. É a proposta em avaliação. **Não aprovada.** Decidida pelos portões da seção 3.

O que ela promete e o spike precisa provar: um código para desktop e mobile, com a chave atrás de uma fronteira que o JavaScript não atravessa.

O que ela custa está na seção 5, escrito sem suavizar.

### 2.5 Finalista B — React Native + Expo, com módulo de chave nativo por plataforma

**O que seria:** a recomendação original das duas análises. Um pacote de domínio em TypeScript compartilhado (Taquito, validações, formatação, tokens de design) e a criptografia de armazenamento implementada **separadamente em cada plataforma** — Keystore/StrongBox no Android, Keychain/Secure Enclave no iOS, WebCrypto na web — precisamente porque essa é a parte que *não* deve ser compartilhada.

**Por que segue viva:** ela ataca o mesmo problema com uma fronteira diferente. Em vez de mover a chave para Rust, ela a move para o cofre do sistema operacional, que é o mecanismo que as lojas e as plataformas mantêm e auditam. Não exige Rust. Tem ecossistema mobile maduro e caminho de publicação conhecido nas duas lojas.

**Onde ela é mais fraca:** o desktop. Expo não entrega desktop; sob esta opção o TAPS local-first precisa de um empacotamento separado (serviço Node local + UI, empacotado por sistema operacional) e o Tezzet desktop deixa de existir ou vira web instalável. Isso reintroduz parte da superfície que a tese local-first do TAPS existia para apagar.

---

## 3. Critérios de decisão — PRÉ-REGISTRADOS E CONGELADOS

**Congelados em 2026-08-27, antes de o relatório de BRES-36 existir.** A prova da ordem é o histórico do git deste arquivo. Alteração posterior a esta seção só é válida se: (a) feita antes de o relatório do spike ser postado, (b) em commit separado, e (c) com justificativa escrita no próprio commit.

Os portões abaixo se aplicam ao **Finalista A (Tauri v2)**. Eles não são uma lista de desejos: cada um mapeia um critério de aceite de BRES-36, para que o relatório do spike possa ser lido contra eles sem interpretação.

### 3.1 Portões bloqueantes (todos precisam passar)

| # | Portão | Limiar verificável |
|---|---|---|
| **P1** | Um código, três plataformas | Build verde **e app funcionando** em Linux, Windows e Android — 3 de 3, do mesmo código-fonte. Fork de código por plataforma conta como falha. |
| **P2** | Operação real na cadeia | Pelo menos **2 hashes** de operação injetada em Ghostnet, um de alvo desktop e um do **Android**, cada um verificável num explorador público. Hash não conferível = não conta. |
| **P3** | A fronteira da chave se sustenta | Demonstração de que semente e chave privada não aparecem em nenhum ponto do lado JavaScript, com **método descrito** (inspeção do bundle, instrumentação do IPC, dump de heap do webview — algo reproduzível). Afirmação sem método = **não atendido**. |
| **P4** | Dependências de cripto mantidas | O núcleo Rust se monta com crates **mantidas** — critério: último release ≤ 12 meses **ou** commit no repositório ≤ 6 meses. `tezos_crypto_rs` e `tezos_data_encoding` estão parados há ~2 anos; depender deles reprova P4. |
| **P5** | Armazenamento seguro no Android | Stronghold guardando a semente cifrada **e** Biometric destravando, funcionando no Android. O Barcode Scanner é desejável (paridade com o app atual) mas **não** bloqueia. |
| **P6** | Custo de operação no runtime real (WSL) | Build limpo ≤ **30 min** por alvo e incremental ≤ **5 min**; binário desktop ≤ **40 MB**; APK ≤ **50 MB**. Nenhum passo manual não documentável em cada build. |
| **P7** | Relatório honesto | O relatório tem uma seção do que foi **difícil ou frágil**. Um relatório só com sucessos não permite decidir e reprova P7 por si só. |

Os limiares de P6 são generosos de propósito: eles não existem para escolher o framework mais rápido, existem para reprovar um desfecho absurdo. Se um build Android limpo levar duas horas no WSL, isso é um imposto diário sobre a squad e precisa aparecer na decisão em vez de virar folclore.

### 3.2 Critérios de eliminação (qualquer um reprova o Finalista A)

| # | Eliminação |
|---|---|
| **K1** | Android não builda, ou só builda com fork de código-fonte. |
| **K2** | Nenhuma operação injetada em Ghostnet a partir do Android. |
| **K3** | Stronghold indisponível ou instável no Android. |
| **K4** | A chave precisa transitar pelo lado JavaScript em algum ponto do fluxo real de assinatura. |
| **K5** | A camada de cadeia só funciona dependendo de crate Tezos abandonada. |

K4 é o mais importante e merece ser dito por extenso: **se a fronteira vaza, a razão principal para adotar Rust deixa de existir.** Todo o custo da seção 5 é pago em troca dessa fronteira. Sem ela, o Finalista B faz o mesmo trabalho sem cobrar Rust.

### 3.3 O que explicitamente **não** é critério

Registrado para que não seja usado como argumento depois:

- **iOS e macOS não verificados** não reprovam nada. São risco aberto (seção 8), não portão. Reprovar o Tauri por não ter Mac seria reprovar qualquer alternativa pelo mesmo motivo.
- **Ausência de caso público de app Tauri v2 publicado na App Store** não reprova. Entra como peso no risco de iOS, e a ausência do dado é ela própria um dado — o spike deve dizer se procurou e não achou.
- **Aproveitamento de código do TAPS** não é critério, e a seção 6 mostra por quê: nos dois finalistas o TypeScript continua dono da camada de cadeia, então o aproveitamento é praticamente o mesmo. Usar aproveitamento para escolher entre A e B seria um argumento vazio.
- **Preferência estética, elegância da arquitetura e "o que é mais moderno"** não são critérios.

### 3.4 Regra de decisão (a decisão é uma função destes portões, assinada antes do dado)

- **R1 — Aprovar Tauri.** P1–P7 todos atendidos e nenhum K disparado → recomendar **Tauri v2 + núcleo Rust** para os dois produtos: Tezzet (desktop + mobile), TAPS desktop local-first e TAPS companion mobile.
- **R2 — Rejeitar Tauri.** Qualquer K disparado, ou P3 ou P5 não atendidos → **Finalista B**: React Native + Expo com módulo de chave nativo por plataforma; TAPS desktop vira serviço local em Node empacotado por sistema operacional.
- **R3 — Falha parcial de plataforma.** P1 verde em Linux e Android mas falho no Windows (ou o inverso entre desktops) → **não decidir agora**. Devolver ao spike com escopo reduzido ao alvo que falhou e prazo definido. Windows é alvo real, não opcional.
- **R4 — P4 falho por motivo restrito.** Se as crates genéricas (`ed25519-dalek`, `bip39`, `blake2`, `bs58`, `argon2`, `zeroize`) bastam para chave e armazenamento, e a única lacuna é encoding/forjamento Tezos em Rust, **P4 é considerado atendido** — porque a proposta já deixa forjamento no Taquito, do lado TypeScript. Se, e só se, o desenho exigir reimplementar encoding Tezos em Rust, P4 reprova e vale R2.
- **R5 — Evidência insuficiente.** Se o relatório não permitir avaliar P1–P7 → **não decidir**. Devolver o spike com a lista do que falta. Nesta ADR, adiar é um desfecho válido; decidir sem evidência não é.
- **R6 — Portão humano.** Em qualquer desfecho, a squad recomenda e **Rafael decide**. Nenhuma issue de produto vai para `todo` e o estágio 3 não é promovido antes dessa aprovação.

---

## 4. Decisão por produto — e por que ela pode ser diferente

Uma ADR honesta admite que a resposta pode não ser a mesma para os dois produtos. Aqui ela quase certamente não é, e a razão é que os dois estão em pontos opostos do espectro de custo de troca.

**Tezzet: escolha livre.** Vai ser reescrito de qualquer jeito — 1.286 linhas de Java que não compilam, contra um SDK morto, num protocolo de 2019. Não há nada a preservar além da marca, do fluxo de telas e da decisão de ser não-custodial. Custo de trocar de stack: zero. Portanto a stack do Tezzet segue **inteiramente** o resultado dos portões.

**TAPS: duas decisões separadas que não podem ser confundidas.**

1. **Local-first é decisão de produto**, e ela **não depende do spike**. Ou o usuário do TAPS é um baker na própria máquina — e então apagar a superfície HTTP pública apaga junto autenticação, CORS e rate limit, que é exatamente onde estão os piores achados da análise — ou ele não é, e aí o produto é outro. A evidência disponível aponta para o primeiro caso (o README original: "We will use Lucee only for localhost (not Internet)"), e a restrição de zero usuários em produção significa que ninguém é prejudicado pela mudança. **Pré-registro:** esta ADR recomenda local-first para o TAPS **independentemente** do resultado do spike; o que o spike decide é *com o quê* se empacota, não *o quê* se empacota.
2. **O framework** segue os portões, como o Tezzet.

**Companion mobile do TAPS: mesmo framework do Tezzet mobile, sempre.** Aqui não há escolha razoável de divergir. Os dois apps mobile da suíte compartilham tokens de design, formatação de valor em mutez, exibição de endereço e hash, e a jornada única de `suite/`. Manter dois frameworks mobile para uma squad deste tamanho é a mesma armadilha da alternativa 2.2, com outro nome.

**Consequência que precisa estar escrita:** o único desfecho em que os dois produtos usam frameworks diferentes é R2 combinado com a decisão de manter o TAPS desktop como serviço Node — e mesmo nele o *domínio* continua sendo TypeScript compartilhado. Não existe desfecho previsto em que Tezzet e TAPS não compartilhem o núcleo de chave.

---

## 5. O custo de adotar Rust, dito em voz alta

Esta seção existe porque uma ADR que só lista benefícios não é uma ADR.

**Rust é uma restrição de contratação e de manutenção, permanente.** Aprovar o Finalista A significa que este projeto passa a exigir alguém que leia e revise Rust — não que saiba "um pouco de Rust", mas que saiba Rust **e** criptografia, porque o código que fica lá dentro é geração de entropia, derivação BIP-32, assinatura Ed25519, AEAD e zeroização de memória. Revisão superficial de código criptográfico é pior que revisão nenhuma, porque produz confiança falsa — é exatamente o erro que os dois sistemas já cometeram, cada um com um comentário afirmando que apagava a chave da memória sem apagar coisa alguma.

**São duas cadeias de suprimento, não uma.** npm continua existindo; crates.io se soma a ele. Duas superfícies de auditoria, dois lockfiles, dois `audit` no CI.

**A cadeia de ferramentas fica mais pesada.** Cargo mais NDK do Android mais cross-compilation, dentro do WSL. Tempo de build e tempo de CI sobem. É por isso que P6 existe e mede isso em números em vez de deixar por conta da impressão de quem buildou.

**O contra-argumento honesto, e por que ele não anula o custo:** a quantidade de Rust é pequena e **limitada por desenho**. O núcleo de chave é gerar, derivar, guardar, assinar — algo entre 1.500 e 2.500 linhas que mudam raramente, porque BIP-39 e Ed25519 não mudam a cada upgrade de protocolo. É deliberadamente o Taquito, do lado TypeScript, que absorve a parte que muda toda hora. Isso torna o custo pagável. Não o torna zero, e ele não deve ser apresentado como zero em lugar nenhum.

**O que também precisa ser dito sobre o Finalista B:** ele não é gratuito. Ele troca Rust por **dois módulos nativos** de chave — Kotlin para Keystore/StrongBox e Swift para Keychain/Secure Enclave — mais WebCrypto na web. São três implementações do ciclo de vida da chave em vez de uma, e a auditoria precisa cobrir as três. A pergunta que os portões respondem não é "Rust custa caro?", é **"a fronteira única de Rust custa menos que três fronteiras nativas?"**

---

## 6. Plano de aproveitamento do TAPS — o que fica, o que vai fora, o que se porta

Medido no código real, em 2026-08-27, no branch `agent/cartier/de00c8b0eb47`: **13.541 linhas TypeScript em `src/`** e 4.201 em `test/`.

| Bloco | LOC | Destino | Por quê |
|---|---:|---|---|
| `modules/auth` | 2.043 | **Fora** | Existe porque há superfície HTTP pública. Local-first apaga a categoria. E o que existe está quebrado: JWT assinado com literal do código-fonte, `verify-wallet` retornando `{valid:true}` para qualquer passphrase, rate limit de login definido e nunca aplicado, `logout` que não invalida nada. |
| `modules/monitoring` | 828 | **Fora** | Nunca é instanciado — `AppModule` não o importa. É observabilidade de nuvem para um produto que deixa de ser nuvem. |
| `config` | 680 | **Fora** | Dois sistemas de configuração paralelos (`ConfigService` e `getTezosConfig()` lendo `process.env`) e mais de vinte variáveis em `.env.production` que não existem em `configuration.ts`. Reescrito do zero, com a regra 4 valendo: segredo sem valor padrão, processo recusa subir. |
| `modules/wallet` | 550 | **Fora** | Custódia com salt literal `'salt'`, AES-256-CBC sem autenticação, verificação por SHA-512 de uma rodada, comparação sem tempo constante, e `encryptedPassphrase` em `VarChar(255)` que não cabe uma mnemônica cifrada. Substituído pelo `tezos-core` (BRES-41). Nada aqui se porta. |
| **Subtotal fora** | **4.101** | **30,3%** | |
| `modules/rewards` | 1.705 | **Porta-se com reescrita** | A decomposição (calculadora / validador / orquestrador) e o modelo de comissão sobrevivem. A aritmética não: float na borda, `validateCalculation()` tautológica, sem Adaptive Issuance nem `staked_balance`. |
| `modules/blockchain` | 1.380 | **Porta-se com reescrita** | O contrato TzKT está quebrado (campos pré-Tenderbake, `\|\| 0` em toda parte, paginação ignorada) e as constantes estão congeladas em 2019. Reescrito em BRES-42. O que se leva é a lista de chamadas necessárias, não o código. |
| `modules/jobs` | 868 | **Porta-se com reescrita** | Detecção de ciclo e políticas de disparo são domínio. Bull + Redis viram agendador embutido. `getPendingRewardsCycle()` sem filtro por baker é defeito, não regra. |
| `modules/bond-pool` | 545 | **Porta-se, quase literal** | Regra de negócio real e razoavelmente isolada. É o bloco com maior chance de porte direto — corrigindo `BondPoolMember.amount` de `Decimal(20,2)` para mutez inteiro. |
| `modules/settings` | 542 | **Porta-se com reescrita** | Os três modos (`off` / `simulation` / `on`) e as comissões padrão e individual são domínio puro. O armazenamento não. |
| `modules/payments` | 449 | **Porta-se com reescrita** | Controllers finos que acessam seis campos inexistentes em `PaymentEntity`. A superfície HTTP some; a intenção vira caso de uso local. |
| **Subtotal porta-se** | **5.489** | **40,5%** | |
| `database` | 1.855 | **Remodelar** | A decomposição em repositórios sobrevive como forma. O schema não: falta `@@unique([bakerId, cycle])`, `onDelete: Cascade` de Settings apaga todo o histórico financeiro, e não existe uma única migration. |
| `shared` | 1.955 | **Remodelar** | Metade é constante congelada que a regra 2 proíbe. A outra metade (validação de endereço — que hoje rejeita `tz4` —, formatação, DTOs) reescreve com `bigint`. |
| `src/*.ts` (bootstrap) | 141 | **Fora** | |
| **Subtotal remodelar** | **3.951** | **29,2%** | |

**Testes (4.201 LOC):** a estrutura sobrevive como forma — unit, integration, api, security, load, fixtures, com thresholds de cobertura configurados. O conteúdo não: os testes exercitam interfaces que o código não implementa, e passam com o sistema retornando zero para todos os delegadores. Reescritos junto com o que testam.

### 6.1 A leitura honesta desses números

A análise estimou "30–40% de aproveitamento". Os números confirmam a ordem de grandeza — 40,5% das linhas estão em blocos que carregam regra de negócio — mas a leitura precisa ser corrigida num ponto que importa:

**O aproveitamento literal de código é próximo de zero.** O que sobrevive são as **regras**, e as regras não ocupam 5.489 linhas: elas cabem numa especificação. É exatamente o que BRES-39 está extraindo, e é por isso que `migration-docs/BUSINESS_LOGIC.md` (981 linhas, descrevendo o comportamento do sistema ColdFusion original) é o ativo mais valioso do repositório — mais que os 13.541 de TypeScript.

**Consequência para a decisão:** nos dois finalistas o TypeScript continua dono da camada de cadeia, então o aproveitamento é praticamente idêntico entre A e B. Por isso ele está listado em 3.3 como algo que **não** é critério. Registrado aqui para que ninguém o use como argumento depois.

**Consequência para o cronograma:** BRES-39 (extração das regras) é independente da ADR e deveria correr agora, não depois. Se ela não for feita antes da reescrita, o conhecimento de domínio acumulado por bakers reais se perde — e essa perda é irreversível, ao contrário de qualquer escolha de stack.

---

## 7. Requisitos de desenho que valem em qualquer desfecho

Estes não dependem de qual finalista vencer, e a ADR os fixa agora porque são o que torna a decisão reversível (seção 9).

1. **O núcleo de chave é consumido exclusivamente através da interface `Signer` do Taquito.** Nenhum código de produto chama `invoke()` — ou o equivalente do Finalista B — diretamente. Essa interface é o que faz a troca de shell custar a UI e não o núcleo.
2. **Valor monetário é `bigint` em mutez do começo ao fim.** `number` em caminho de dinheiro é reprovação automática.
3. **Constante de protocolo se lê da cadeia** (`/context/constants`), com cache, nunca do código. Foi o erro estrutural dos dois sistemas.
4. **Nada de `|| 0` em campo vindo de API externa.** Campo ausente é erro alto, não zero silencioso.
5. **Nenhum segredo tem valor padrão.** Variável ausente, processo recusa subir.
6. **Nenhuma distribuição de pagamento sem idempotência provada** — teste que roda a mesma distribuição duas vezes e demonstra que a segunda não envia.

---

## 8. Risco aberto: iOS e macOS não verificados

**O risco.** Esta ADR decide sobre cinco alvos tendo verificado três. Sobre Apple, tudo que se pode afirmar vem de pesquisa: se os plugins declaram suporte, o que a App Store exige de um app com carteira cripto, e se existe caso público de app Tauri v2 publicado lá. Declaração de suporte em documentação de plugin não é build verde.

**Impacto imediato registrado.** BRES-49 (companion mobile do TAPS) tem como critério de aceite "publicável em iOS **e** Android, com build verificado nos dois". **Esse critério é insatisfazível hoje** e permanece assim enquanto não houver Mac. Ele não deve ser marcado como atendido por analogia com o Android.

**Plano para fechar, em três passos:**

1. **Conseguir acesso a macOS.** Duas formas: uma máquina (Mac mini de série M) ou um runner macOS hospedado em CI. As duas envolvem **gasto**, portanto é decisão de Rafael, não da squad. Some-se a conta Apple Developer, obrigatória para publicar (US$ 99/ano).
2. **Rodar o mesmo roteiro do spike nos dois alvos Apple** — a mesma lista de P1 a P6, com os mesmos limiares, produzindo hashes de Ghostnet a partir do iOS.
3. **Prazo: antes do início do estágio 5.** BRES-49 e BRES-48 dependem de empacotamento por plataforma; entrar no estágio 5 sem o lado Apple resolvido significa descobrir o problema no ponto mais caro possível.

**Até lá, três regras.** Nenhuma issue declara suporte a iOS ou macOS. Nenhum critério de aceite é dado como atendido em alvo Apple sem build verificado. E qualquer plano de publicação em loja Apple é escalado, não presumido.

**Se o iOS se mostrar inviável depois de existir um Mac:** ver RV-3 na seção 9. A decisão é parcialmente reversível por desenho, e essa reversibilidade é a razão do requisito 7.1.

---

## 9. Critérios de reversão

**Janela.** A decisão é barata de reverter **até o fim do estágio 4** — o primeiro payout completo ponta a ponta em Ghostnet (BRES-44 e BRES-46). Antes disso, trocar de framework custa a camada de UI e o wrapper. Depois, custa também empacotamento, migrations, matriz de QA e documentação de instalação. Passado o estágio 5, reverter deixa de ser reversão e vira uma segunda reescrita.

**O que torna a reversão possível** é o requisito 7.1: o núcleo de chave atrás da interface `Signer` e a camada de cadeia em TypeScript com Taquito. Sob esse desenho, trocar o shell é trocar a casca. Se esse requisito for violado em algum ponto da implementação, a janela de reversão fecha antes do prazo e isso precisa ser reportado, não descoberto.

**Gatilhos que abrem a discussão de reversão:**

| # | Gatilho | Reversão |
|---|---|---|
| **RV-1** | Build de alguma plataforma alvo quebrado por mais de duas semanas por causa do framework, não do nosso código. | Total, para o Finalista B. |
| **RV-2** | Plugin essencial (Stronghold ou Biometric) abandonado, ou incompatível com uma versão obrigatória de sistema operacional. | Total. |
| **RV-3** | Com Mac disponível, o alvo iOS se mostra inviável no framework escolhido. | **Parcial:** mobile migra para nativo ou RN+Expo; desktop permanece. O núcleo de chave é o mesmo nos dois casos. |
| **RV-4** | Exigência de loja que bloqueie a publicação e não tenha caminho de contorno. | Parcial ou total conforme a exigência. Escalado a Rafael. |
| **RV-5** | Descobre-se que existe baker rodando TAPS em produção. | Nenhuma reversão de stack, mas **muda a urgência de tudo**: as correções de segurança do sistema atual (JWT forjável, pagamento duplicado por retry) deixam de ser "não vale o esforço" e viram trabalho imediato, em paralelo com a reescrita. |

---

## 10. Consequências por papel da squad

**Tezos Core & Crypto.** Continua com veto sobre o perímetro da chave. Sob o Finalista A, o perímetro passa a ser Rust — o que significa que a revisão exige Rust e criptografia na mesma cabeça, e que os portões P3, P4 e P5 desta ADR são a definição do que ele vai ter que aprovar. Sob o Finalista B, o mesmo veto se exerce sobre três implementações nativas em vez de uma. Em qualquer desfecho: nenhuma linha de código que toque chave, semente, derivação, assinatura, KDF ou cifra de armazenamento abre PR sem passar por ele antes.

**Tezos Chain & Payouts.** Praticamente não é afetado pelo desfecho, e isso é de propósito: nos dois finalistas o TypeScript continua dono da camada de cadeia. O trabalho dele — constantes lidas de `/context/constants`, TzKT com paginação e sem `|| 0`, Adaptive Issuance com `staked_balance` separado de `delegated_balance`, `tz4`, `estimate.batch()`, idempotência de lote — é o mesmo nos dois casos e pode começar assim que o estágio 3 for promovido.

**Tezzet & TAPS Apps.** É quem paga a diferença entre A e B. Sob A, precisa de Rust suficiente para operar a fronteira (não para escrever cripto — isso é do Core & Crypto). Sob B, precisa de Kotlin e Swift para os módulos nativos, e de uma resposta separada para o desktop.

**Suite Design & Journey.** `suite/tokens/tokens.json` é neutro de plataforma por desenho, e é isso que faz o desfecho não afetar o trabalho dele. O que muda é o alvo de geração de tema: CSS e Tailwind para o shell web do Finalista A; tema de React Native para o B. O kit compartilhado — valor em XTZ, endereço truncado, hash com link, badge de status, número de ciclo, seletor de rede — é o mesmo nos dois.

**Tezos QA.** É onde a decisão pesa mais no dia a dia, e o plano muda em três pontos concretos:

1. **A matriz de plataforma vira parte da definição de pronto.** "Os testes unitários passaram" nunca é entrega validada nestes projetos. O que vale é build verificado em cada alvo, payout ponta a ponta em Ghostnet, e teste de idempotência rodando a mesma distribuição duas vezes.
2. **Sob o Finalista A, ganha-se um teste que hoje não existe em lugar nenhum:** o teste de fronteira — a chave não cruza para o JavaScript. Ele precisa virar regressão permanente no CI, não uma demonstração feita uma vez no spike. É o que impede K4 de acontecer por descuido seis meses depois.
3. **A matriz cresce assimetricamente.** Sob A: três alvos verificáveis hoje, dois adiados. Sob B: dois alvos mobile e um desktop empacotado à parte. Em ambos, iOS fica de fora até existir Mac.

**O que precisa ser auditado, em qualquer desfecho:** o núcleo de chave (geração de entropia, BIP-39 com checksum e wordlist, derivação `m/44'/1729'/0'/0'`, watermark correto por tipo de payload assinado); a cifra de armazenamento (AEAD, KDF Argon2id, comparação em tempo constante); a fronteira do `Signer`; e a cadeia de suprimento — npm sempre, crates.io também sob o Finalista A. Auditoria externa antes de qualquer versão pública que segure chave de usuário.

---

## 11. Registro da passada 2 — a preencher

Esta seção será preenchida quando BRES-36 entregar o relatório, aplicando a regra de decisão de 3.4 sem alterá-la.

- [ ] Relatório do spike recebido em: `____`
- [ ] Avaliação portão a portão: P1 `__` P2 `__` P3 `__` P4 `__` P5 `__` P6 `__` P7 `__`
- [ ] Eliminações disparadas: `____`
- [ ] Regra aplicada: `____`
- [ ] Decisão em uma frase: `____`
- [ ] Aprovação de Rafael em: `____`
