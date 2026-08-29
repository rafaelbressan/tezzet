# ADR-0001 — Stack unificada da Suíte Tezos (Tezzet + TAPS)

| | |
|---|---|
| **Status** | **Proposta — passada 2 avaliada. Nenhuma eliminação disparada; decisão retida por um portão não medido (P5).** |
| **Data desta passada** | Passada 1: 2026-08-27. Passada 2: 2026-08-28. |
| **Quem decide** | Rafael Miranda Bressan (portão humano) |
| **Quem recomenda** | Squad Suíte Tezos — recomendação redigida pelo Tezos Suite Lead |
| **Issue** | BRES-40 |
| **Depende de** | BRES-36 — **entregue em 2026-08-27**, avaliado na seção 11. Falta fechar a medição de P5 contra o container especificado em BRES-37. |
| **Substitui** | Nada. É a primeira ADR da suíte. |
| **Emendas** | 2026-08-27 — P3, P4, P5 e K4 reescritos, P8 e requisitos 7.7/7.8 acrescentados, após revisão de Tezos Core & Crypto.<br>2026-08-27 — Apple retirada do escopo e ausência de usuários em produção confirmada, ambas por decisão direta de Rafael. Emendas anteriores ao relatório do spike, conforme permitido por 3. **Nada foi alterado na seção 3 depois do relatório.** |

---

## Decisão

**RETIDA por um portão não medido.** Nenhum critério de eliminação foi disparado e, em tudo que o spike mediu, o Finalista A (Tauri v2 + núcleo Rust) passou. O portão que carrega a tese de segurança em mobile — P5, vínculo do cofre com o Android Keystore — não foi medido, por falha de processo descrita em 11.4. A regra pré-registrada para esse estado é R5: não decidir.

Avaliação completa na **seção 11**. O que falta é nomeável e pequeno; a expectativa honesta é aprovação; e escrever "aprovado" antes de medir seria a racionalização que a seção 3 existe para impedir.

Os critérios foram congelados em 2026-08-27, **antes** de o relatório do spike existir, e não foram alterados depois dele. O histórico do git deste arquivo é a prova da ordem — e a seção 11.1 mostra onde essa ordem já decidiu um caso concreto (K4) que, sem pré-registro, seria discutível para os dois lados hoje.

## Aviso que precisa estar na primeira página

**Os alvos da suíte são três: Linux, Windows e Android. Apple está fora do escopo.**

Decisão de Rafael em 2026-08-27, em resposta à recomendação da squad: sem máquina macOS por agora, e iOS e macOS desktop saem do escopo em vez de ficarem pendurados como risco aberto. Isso é melhor que adiar — um alvo que ninguém consegue verificar e que continua listado vira critério de aceite insatisfazível espalhado por várias issues.

**Consequência:** esta ADR decide sobre exatamente os alvos que o spike verifica. Nenhum critério de aceite da suíte menciona iOS ou macOS. A condição de reentrada está na seção 8.

Ninguém deve escrever "suporta iOS" em lugar nenhum — nem como pendência.

---

## 1. Contexto

Dois produtos, dois lados da mesma relação econômica na rede Tezos: **Tezzet** (carteira, "guardar") e **TAPS** (distribuição de recompensas para bakers, "pagar"). Os dois estão parados, cada um por um motivo diferente, e os dois foram analisados em 2026-08-26 (`ANALYSIS.md` em cada repositório).

O estado verificado:

- **Tezzet** — app Android Java, commit `1c5f0c9` de 01/11/2019, ~1.286 linhas em 7 activities. Não compila (`jcenter()` e `dl.bintray.com` desligados levaram junto o `TezosJ_SDK`), não é publicável (`targetSdkVersion 28`), e assina com premissas do protocolo Babylon. Conclusão da análise: **reescrever, não migrar**. O código Java não é reaproveitável; a marca, o fluxo de telas e a decisão de ser não-custodial são.
- **TAPS** — backend NestJS de 26/11/2025, 13.541 linhas TypeScript em `src/` e 4.201 em `test/`. **Não compila** (12 erros `TS2300` em `tzkt-client.service.ts`, confirmados rodando `tsc`). Não tem migration nenhuma (`prisma/migrations/` só tem `.gitkeep`). O segredo JWT efetivo é o literal `'your-secret-key-change-in-production'`, publicado no repositório. O cálculo de recompensa retorna zero para todos os delegadores, em silêncio, porque todo acesso a campo da TzKT usa `|| 0`.

### 1.1 Restrições confirmadas em 2026-08-27

Estas três mudam o espaço de decisão e precisam aparecer explicitamente, porque várias conclusões abaixo dependem delas:

**Não há usuários em produção em nenhum dos dois sistemas.** Nenhuma compatibilidade a preservar, nenhuma migração obrigatória, nenhuma janela de manutenção, nenhuma urgência de segurança por exposição real. Decorre daí, diretamente, que **consertar o build e o JWT do TAPS atual não vale o esforço**: são correções em código que a reescrita passa por cima, e ninguém depende delas hoje. **Confirmado diretamente por Rafael em 2026-08-27**, em resposta à pergunta explícita: não há baker rodando TAPS em produção hoje. Deixa de ser premissa herdada e passa a ser fato declarado pelo dono do produto. O gatilho RV-5 da seção 9 permanece registrado para o caso de a situação mudar.

**Apple fora do escopo.** Não há máquina macOS, e Rafael decidiu em 2026-08-27 retirar iOS e macOS do escopo em vez de mantê-los como pendência. Ver o aviso da primeira página e a seção 8.

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

Ela permanece disponível como **reversão parcial** (RV-3): se Apple voltar ao escopo e o alvo iOS se mostrar inviável no framework escolhido, o mobile pode virar nativo sem que o desktop mude.

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

Os portões abaixo se aplicam ao **Finalista A (Tauri v2)**. P8 foi acrescentado na emenda de 2026-08-27. Eles não são uma lista de desejos: cada um mapeia um critério de aceite de BRES-36, para que o relatório do spike possa ser lido contra eles sem interpretação.

### 3.1 Portões bloqueantes (todos precisam passar)

| # | Portão | Limiar verificável |
|---|---|---|
| **P1** | Um código, três plataformas | Build verde **e app funcionando** em Linux, Windows e Android — 3 de 3, do mesmo código-fonte. Fork de código por plataforma conta como falha. |
| **P2** | Operação real na cadeia | Pelo menos **2 hashes** de operação injetada em Ghostnet, um de alvo desktop e um do **Android**, cada um verificável num explorador público. Hash não conferível = não conta. |
| **P3** | A fronteira da chave se sustenta | **Cinco itens em conjunção — P3.a a P3.e da seção 3.1.1. Todos precisam passar.** Não se prova que a chave não saiu; prova-se que não existe caminho por onde ela sairia. |
| **P4** | Dependências de cripto mantidas | O núcleo Rust se monta com crates **mantidas** — critério: último release ≤ 12 meses **ou** commit no repositório ≤ 6 meses. `tezos_crypto_rs` e `tezos_data_encoding` estão parados há ~2 anos; depender deles reprova P4. **Conjunto mínimo e as duas lacunas nomeadas na seção 3.1.2.** |
| **P5** | Armazenamento seguro no Android | **Vínculo criptográfico com o Keystore, demonstrado por falha — seção 3.1.3.** Biometria que devolve booleano não atende. Barcode Scanner é desejável e **não** bloqueia. |
| **P6** | Custo de operação no runtime real (WSL) | Build limpo ≤ **30 min** por alvo e incremental ≤ **5 min**; binário desktop ≤ **40 MB**; APK ≤ **50 MB**. Nenhum passo manual não documentável em cada build. |
| **P7** | Relatório honesto | O relatório tem uma seção do que foi **difícil ou frágil**. Um relatório só com sucessos não permite decidir e reprova P7 por si só. |
| **P8** | Derivação conferida contra implementação independente | Partindo de mnemônica de teste publicada, derivar `m/44'/1729'/0'/0'` e mostrar que `tz1...` e `edpk...` batem com `InMemorySigner` do Taquito **ou** `octez-client`. Conferir contra si mesmo não conta. |

Os limiares de P6 são generosos de propósito: eles não existem para escolher o framework mais rápido, existem para reprovar um desfecho absurdo. Se um build Android limpo levar duas horas no WSL, isso é um imposto diário sobre a squad e precisa aparecer na decisão em vez de virar folclore.

#### 3.1.1 P3 em detalhe — os cinco itens

Redação anterior reprovada por Tezos Core & Crypto em 2026-08-27, e o motivo é bom: "a semente não aparece em nenhum ponto do lado JavaScript" é uma proposição universal negativa, e dump de heap só prova o instante amostrado. Grep de bundle prova menos ainda — a semente é dado de runtime, não literal de build, então bundle limpo é compatível com vazamento total. Listar métodos como alternativa faz o portão aceitar a evidência mais fraca da lista. São conjunção.

| | Item |
|---|---|
| **P3.a** | **Enumeração exaustiva da superfície IPC.** Lista de todo `#[tauri::command]` exposto e, para cada um, o tipo de retorno. Nenhum comando retorna, em nenhuma variante do seu tipo — **incluindo o ramo `Err`** —, bytes de semente, mnemônica, chave privada ou material estendido BIP-32. É o único item exaustivo; os outros amostram. |
| **P3.b** | **Nenhum tipo que carrega segredo implementa `Serialize`.** Tudo que atravessa o IPC do Tauri passa por `serde`, e o `String`/`Vec` intermediário da serialização é cópia que `zeroize` não alcança. Se o tipo não é serializável, ele não atravessa — garantido pelo compilador, não pela disciplina de quem escreve. |
| **P3.c** | **Caminho de erro e de log auditados.** O vazamento típico não é o caminho feliz: é `Debug`/`Display` de um erro que carrega a semente, mensagem de `panic`, ou build de dev. `Debug` implementado à mão com redação (`derive` proibido em tipo de segredo), erro que cruza a fronteira é enum fechado sem payload, e a demonstração inclui **uma operação deliberadamente falha**, mostrando o que chega ao JS. |
| **P3.d** | **Teste positivo do fluxo real** — destravar → derivar → assinar → injetar, com os payloads IPC serializados para log e asserção de que nenhum contém os 64 bytes da semente, a mnemônica ou o `edsk`. Fluxo real, não caminho de demonstração. |
| **P3.e** | **Regressão de CI, não demonstração única.** O teste de P3.d entra no CI e falha quando um comando novo passa a devolver segredo. Fronteira que só vale na data do spike não é fronteira. |

Dump de heap do webview entra como corroboração opcional e **nunca** como justificativa de P3: resultado negativo dele não é evidência.

#### 3.1.2 P4 em detalhe — conjunto mínimo e as duas lacunas

Conjunto mínimo do spike: `bip39`, `ed25519-dalek`, `blake2`, `bs58` (com feature `check`), `argon2`, `zeroize`, mais `sha2` e `hmac`, que entram no conjunto auditado por estarem no caminho da chave.

Duas lacunas que a lista original tinha e que empurravam para reimplementação por omissão:

- **Derivação.** `bip39` dá a semente, `ed25519-dalek` assina a partir de 32 bytes, e **nenhum dos dois faz `m/44'/1729'/0'/0'`** — para Ed25519 isso é **SLIP-0010**, cadeia HMAC-SHA512, só derivação endurecida. P4 exige que o relatório **nomeie a crate de derivação**. Derivação escrita à mão só passa com os **vetores oficiais do SLIP-0010 rodando no CI** e revisão de Tezos Core & Crypto.
- **Fonte de entropia.** O relatório diz **nominalmente qual RNG** produziu os 128/256 bits da mnemônica no build Android (`getrandom`/CSPRNG do sistema). É o único ponto onde um erro produz carteira previsível e silenciosa.

Duas notas sem mudança de limiar: a lista é o mínimo do **spike**, não o conjunto auditado final — `tz2`/`tz3` acrescentam `k256`/`p256` depois, com normalização low-S; e depender de `zeroize` não é zerar: a forma verificável é o tipo (`ZeroizeOnDrop`, sem `Clone`, sem `Copy`, sem `Serialize` — o mesmo requisito de P3.b por outro lado).

**Carve-out de R4:** base58check de endereço e chave pública **não é forjamento e vive do lado Rust**, porque é o Rust que devolve `tz1...`/`edpk...` ao JS. `bs58` mais a tabela de prefixos é pequeno e testável — contra vetor conhecido (P8), nunca contra si mesmo.

#### 3.1.3 P5 em detalhe — vínculo criptográfico, demonstrado por falha

Redação anterior reprovada pelo mesmo motivo estrutural: "Stronghold guardando e Biometric destravando" é satisfeito por uma trava que não é criptográfica. Stronghold é snapshot cifrado em arquivo com chave derivada de senha em espaço de usuário — não ganha respaldo de hardware por si. E se o plugin de biometria devolver apenas um booleano, P5 passa com um `if (authOk) mostrarTela()`, com a chave ainda decifrável por quem tem arquivo e senha.

Isso é o achado do Tezzet — "a trava da carteira é só visibilidade de layout" — reimportado para a stack nova com nome melhor. Um portão que não exclui o defeito que motivou o projeto não é portão.

- A chave do snapshot é envelopada por chave do **Android Keystore** criada com `setUserAuthenticationRequired(true)` e `setInvalidatedByBiometricEnrollment(true)`. Falhar a biometria faz o *unwrap* falhar — não faz uma tela não abrir.
- **Demonstração aceita é negativa:** matar o app, negar o prompt biométrico e mostrar **falha de decifragem**. Complementarmente, puxar o snapshot por `adb` e mostrá-lo opaco sem a chave do Keystore.
- O relatório diz o nível de segurança real do device (`KeyInfo.getSecurityLevel()`; StrongBox via `setIsStrongBoxBacked` quando houver). **StrongBox não bloqueia — TEE basta.** Bloqueante é o relatório **dizer qual dos dois**.
- **Sal e parâmetros do Argon2id escritos.** Se o spike usar `Builder::with_argon2(&salt_path)` do exemplo da documentação, o relatório diz **como o arquivo de sal é criado e com que entropia**. Sal constante é o `scryptSync(password, 'salt', 32)` do TAPS renascido, desta vez com a nossa assinatura embaixo. Parâmetros justificados para o alvo mais fraco (Android mediano), não os default.
- **Alternativa honesta, também aceita:** Stronghold destravado só por senha com Argon2id, e a biometria documentada como **conveniência que não guarda nada** — desde que esteja escrito assim e o modelo de ameaça diga que ladrão com aparelho destravado está fora dele. O que se reprova é a terceira via: biometria que parece criptográfica e não é.
- **Delimitação permanente:** o Barcode Scanner fica fora do perímetro da chave porque só lê **endereço e pedido de pagamento**. Ler mnemônica ou chave privada por QR está fora de escopo em definitivo.

### 3.2 Critérios de eliminação (qualquer um reprova o Finalista A)

| # | Eliminação |
|---|---|
| **K1** | Android não builda, ou só builda com fork de código-fonte. |
| **K2** | Nenhuma operação injetada em Ghostnet a partir do Android. |
| **K3** | Stronghold indisponível ou instável no Android. |
| **K4** | Material de chave — semente, mnemônica, chave privada, material estendido BIP-32 — sai do Rust para o lado JavaScript em algum ponto do fluxo real de assinatura. **Delimitação pré-registrada: K4 é sobre material de chave saindo, não sobre senha entrando.** A senha do usuário é digitada na UI e atravessa JS → Rust nos **dois** finalistas, logo não discrimina entre eles; fica como risco residual comum, com o requisito de atravessar uma vez, como parâmetro do comando de destravar, sem permanecer em estado do JS. |
| **K5** | A camada de cadeia só funciona dependendo de crate Tezos abandonada. |

K4 é o mais importante e merece ser dito por extenso: **se a fronteira vaza, a razão principal para adotar Rust deixa de existir.** Todo o custo da seção 5 é pago em troca dessa fronteira. Sem ela, o Finalista B faz o mesmo trabalho sem cobrar Rust.

### 3.3 O que explicitamente **não** é critério

Registrado para que não seja usado como argumento depois:

- **iOS e macOS** não entram em portão nenhum: estão **fora do escopo** por decisão de Rafael (seção 8). Reprovar o Tauri por causa de Apple seria reprovar qualquer alternativa pelo mesmo motivo, já que nenhuma delas é verificável em Apple hoje.
- **Ausência de caso público de app Tauri v2 publicado na App Store** não reprova, e com Apple fora do escopo deixou de ter peso na decisão. O dado, se o spike o produzir, é arquivado para a eventual reentrada.
- **Aproveitamento de código do TAPS** não é critério, e a seção 6 mostra por quê: nos dois finalistas o TypeScript continua dono da camada de cadeia, então o aproveitamento é praticamente o mesmo. Usar aproveitamento para escolher entre A e B seria um argumento vazio.
- **Preferência estética, elegância da arquitetura e "o que é mais moderno"** não são critérios.

### 3.4 Regra de decisão (a decisão é uma função destes portões, assinada antes do dado)

- **R1 — Aprovar Tauri.** P1–P8 todos atendidos e nenhum K disparado → recomendar **Tauri v2 + núcleo Rust** para os dois produtos: Tezzet (desktop + mobile), TAPS desktop local-first e TAPS companion mobile.
- **R2 — Rejeitar Tauri.** Qualquer K disparado, ou P3 ou P5 não atendidos → **Finalista B**: React Native + Expo com módulo de chave nativo por plataforma; TAPS desktop vira serviço local em Node empacotado por sistema operacional.
- **R3 — Falha parcial de plataforma.** P1 verde em Linux e Android mas falho no Windows (ou o inverso entre desktops) → **não decidir agora**. Devolver ao spike com escopo reduzido ao alvo que falhou e prazo definido. Windows é alvo real, não opcional.
- **R4 — P4 falho por motivo restrito.** Se as crates genéricas (`ed25519-dalek`, `bip39`, `blake2`, `bs58`, `argon2`, `zeroize`) bastam para chave e armazenamento, e a única lacuna é encoding/forjamento Tezos em Rust, **P4 é considerado atendido** — porque a proposta já deixa forjamento no Taquito, do lado TypeScript. Se, e só se, o desenho exigir reimplementar encoding Tezos em Rust, P4 reprova e vale R2.
- **R5 — Evidência insuficiente.** Se o relatório não permitir avaliar P1–P8 → **não decidir**. Devolver o spike com a lista do que falta. Nesta ADR, adiar é um desfecho válido; decidir sem evidência não é.
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

**O que também precisa ser dito sobre o Finalista B:** ele não é gratuito. Ele troca Rust por **módulos nativos** de chave — Kotlin para Keystore/StrongBox, Swift para Keychain/Secure Enclave se Apple existir, mais WebCrypto na web. São várias implementações do ciclo de vida da chave em vez de uma, e a auditoria precisa cobrir todas.

**Emenda de 2026-08-27, registrada porque anda contra a proposta em avaliação:** retirar Apple do escopo **barateia o Finalista B mais que o A**. B deixa de precisar de Swift e cai de três implementações de chave para duas (Kotlin e WebCrypto); A economiza um alvo de build, que é menos. Isso estreita a diferença de custo entre os dois, e fica escrito aqui, antes do relatório do spike, para que não seja descoberto depois como argumento conveniente. **Não muda portão nenhum** — a decisão continua sendo função de P1 a P8 e de K1 a K5. A pergunta que os portões respondem não é "Rust custa caro?", é **"a fronteira única de Rust custa menos que três fronteiras nativas?"**

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
7. **Watermark é argumento obrigatório e tipado — não existe default.** O núcleo recusa assinar bytes arbitrários. Assinar um "texto" com watermark de operação é a forma clássica de transformar assinatura de mensagem em transferência, e P2 só prova o watermark de operação por consequência.
8. **A interface `Signer` nasce com duas implementações: núcleo local e `octez-signer` remoto.** Motivo logo abaixo. **Para o TAPS isto deixou de ser opção:** Rafael aprovou `octez-signer` sem Ledger em 2026-08-28, e o TAPS não guarda chave.
9. **Segredo nunca é coletado por `<input>` de HTML.** Senha, passphrase e PIN são pedidos por prompt nativo, fora da webview. Decisão de Rafael em 2026-08-28, em resposta ao achado de que a senha do vault atravessa para o JavaScript. A parede que protege a semente não vale nada se a chave que a abre nasce do lado errado dela.
10. **Login e transação são fatores separados,** no modelo de banco: biometria ou senha para **entrar**, PIN interno para **transacionar**, criado no primeiro acesso. Mesma cerimônia nos dois produtos; o fator por plataforma sai de BRES-37 e a linguagem de UI, de BRES-43. Isso remove a política silenciosa (c) — assinar porque o cofre já foi destravado antes — que era o comportamento padrão do código ingênuo.

### O buraco que nenhum portão cobre — chave quente no desktop

Levantado por Tezos Core & Crypto em 2026-08-27, e registrado aqui porque é **ortogonal aos dois finalistas**: P5 é Android, e o armazenamento em **desktop** não é gatilhado por portão nenhum — é justamente onde vai morar a chave de payout do TAPS.

A tese local-first melhora muito o modelo atual (chave em linha de banco multi-tenant, com a "segunda camada" guardada na mesma linha). Mas não resolve o problema de fundo: **um agendador de payout que roda desatendido não pode exigir humano para destravar, logo a chave precisa ser utilizável sem humano — ou seja, quente.** Trocar "quente no Postgres" por "quente no disco do baker" é progresso real e continua sendo o modelo de maior risco possível para um sistema que move fundos.

O padrão do ecossistema para payout é **remote signer (`octez-signer`) ou Ledger**, com o serviço nunca vendo a chave. Como o requisito 1 acima manda tudo passar pela interface `Signer`, um signer remoto é só outra implementação dela — daí o requisito 8. Com as duas implementações desde o começo, a abstração fica provada em vez de presumida, e o baker avesso a risco tem caminho. **A chave embutida vira modo degradado, opt-in e documentado como tal**, não o default silencioso.

Isto não é objeção a nenhum dos dois finalistas. É onde Tezos Core & Crypto exerce veto quando o código chegar.

---

## 8. Apple fora do escopo — decisão, e a condição de reentrada

**A decisão.** Rafael, em 2026-08-27: iOS e macOS desktop saem do escopo da suíte por agora. Não é adiamento com prazo; é retirada, com condição de reentrada escrita abaixo.

**Por que retirar é melhor que adiar.** Um alvo que ninguém consegue verificar e que continua listado nos critérios de aceite não fica parado: ele vira trabalho que o QA não pode aprovar e que alguém eventualmente marca como atendido por analogia com o Android. Era exatamente o que estava para acontecer em BRES-49, cujo critério "publicável em iOS **e** Android, com build verificado nos dois" era insatisfazível na data em que foi escrito.

**O que muda, concretamente:**

- Os alvos da suíte são **Linux, Windows e Android**. Os três são verificáveis hoje.
- **BRES-49** (companion mobile do TAPS) passa a ser **Android**, com o critério de build verificado valendo só para ele.
- Nenhum critério de aceite, em nenhuma issue, menciona iOS ou macOS.
- A pesquisa sobre Apple que BRES-36 já produzir — suporte declarado dos plugins, exigências da App Store, existência de caso público de app Tauri v2 publicado — **é arquivada, não acionada**. Ela serve à reentrada, se houver.

**Condição de reentrada.** Apple volta ao escopo quando as duas coisas forem verdade: existir acesso a macOS (máquina ou runner hospedado em CI, mais conta Apple Developer a US$ 99/ano — gasto, portanto decisão de Rafael), **e** houver demanda de produto que justifique o alvo. Nesse dia, o roteiro é o mesmo: rodar P1 a P8 nos alvos Apple, com os mesmos limiares, produzindo hashes de Ghostnet a partir do iOS.

**O que preserva a opção de voltar** é o requisito 1 da seção 7 — núcleo de chave atrás da interface `Signer`, camada de cadeia em TypeScript com Taquito. Sob esse desenho, acrescentar um alvo é acrescentar um shell, não reescrever o núcleo. Retirar Apple do escopo hoje **não** fecha a porta; violar o requisito 1 fecharia.

---

## 9. Critérios de reversão

**Janela.** A decisão é barata de reverter **até o fim do estágio 4** — o primeiro payout completo ponta a ponta em Ghostnet (BRES-44 e BRES-46). Antes disso, trocar de framework custa a camada de UI e o wrapper. Depois, custa também empacotamento, migrations, matriz de QA e documentação de instalação. Passado o estágio 5, reverter deixa de ser reversão e vira uma segunda reescrita.

**O que torna a reversão possível** é o requisito 1 da seção 7: o núcleo de chave atrás da interface `Signer` e a camada de cadeia em TypeScript com Taquito. Sob esse desenho, trocar o shell é trocar a casca. Se esse requisito for violado em algum ponto da implementação, a janela de reversão fecha antes do prazo e isso precisa ser reportado, não descoberto.

**Gatilhos que abrem a discussão de reversão:**

| # | Gatilho | Reversão |
|---|---|---|
| **RV-1** | Build de alguma plataforma alvo quebrado por mais de duas semanas por causa do framework, não do nosso código. | Total, para o Finalista B. |
| **RV-2** | Plugin essencial (Stronghold ou Biometric) abandonado, ou incompatível com uma versão obrigatória de sistema operacional. | Total. |
| **RV-3** | Apple volta ao escopo (seção 8) e o alvo iOS se mostra inviável no framework escolhido. | **Parcial:** mobile migra para nativo ou RN+Expo; desktop permanece. O núcleo de chave é o mesmo nos dois casos. Enquanto Apple estiver fora do escopo, este gatilho está dormente. |
| **RV-4** | Exigência de loja que bloqueie a publicação e não tenha caminho de contorno. | Parcial ou total conforme a exigência. Escalado a Rafael. |
| **RV-5** | Descobre-se que existe baker rodando TAPS em produção. | Nenhuma reversão de stack, mas **muda a urgência de tudo**: as correções de segurança do sistema atual (JWT forjável, pagamento duplicado por retry) deixam de ser "não vale o esforço" e viram trabalho imediato, em paralelo com a reescrita. |

---

## 10. Consequências por papel da squad

**Tezos Core & Crypto.** Continua com veto sobre o perímetro da chave. Sob o Finalista A, o perímetro passa a ser Rust — o que significa que a revisão exige Rust e criptografia na mesma cabeça, e que os portões P3, P4 e P5 desta ADR são a definição do que ele vai ter que aprovar. Sob o Finalista B, o mesmo veto se exerce sobre três implementações nativas em vez de uma. Em qualquer desfecho: nenhuma linha de código que toque chave, semente, derivação, assinatura, KDF ou cifra de armazenamento abre PR sem passar por ele antes.

**Tezos Chain & Payouts.** Praticamente não é afetado pelo desfecho, e isso é de propósito: nos dois finalistas o TypeScript continua dono da camada de cadeia. O trabalho dele — constantes lidas de `/context/constants`, TzKT com paginação e sem `|| 0`, Adaptive Issuance com `staked_balance` separado de `delegated_balance`, `tz4`, `estimate.batch()`, idempotência de lote — é o mesmo nos dois casos e pode começar assim que o estágio 3 for promovido.

**Tezzet & TAPS Apps.** É quem paga a diferença entre A e B. Sob A, precisa de Rust suficiente para operar a fronteira (não para escrever cripto — isso é do Core & Crypto). Sob B, precisa de Kotlin para o módulo nativo do Android — Swift sai junto com o escopo Apple — e de uma resposta separada para o desktop.

**Suite Design & Journey.** `suite/tokens/tokens.json` é neutro de plataforma por desenho, e é isso que faz o desfecho não afetar o trabalho dele. O que muda é o alvo de geração de tema: CSS e Tailwind para o shell web do Finalista A; tema de React Native para o B. O kit compartilhado — valor em XTZ, endereço truncado, hash com link, badge de status, número de ciclo, seletor de rede — é o mesmo nos dois.

**Tezos QA.** É onde a decisão pesa mais no dia a dia, e o plano muda em três pontos concretos:

1. **A matriz de plataforma vira parte da definição de pronto.** "Os testes unitários passaram" nunca é entrega validada nestes projetos. O que vale é build verificado em cada alvo, payout ponta a ponta em Ghostnet, e teste de idempotência rodando a mesma distribuição duas vezes.
2. **Sob o Finalista A, ganha-se um teste que hoje não existe em lugar nenhum:** o teste de fronteira — a chave não cruza para o JavaScript. Ele precisa virar regressão permanente no CI, não uma demonstração feita uma vez no spike. É o que impede K4 de acontecer por descuido seis meses depois.
3. **A matriz é fechada e pequena, e isso é uma vantagem.** Três alvos, todos verificáveis, sem alvo pendurado que o QA não possa aprovar. Sob A: Linux, Windows e Android do mesmo código. Sob B: dois alvos mobile mais um desktop empacotado à parte, o que dá ao QA uma matriz maior que a de A, não menor.

**O que precisa ser auditado, em qualquer desfecho:** o núcleo de chave (geração de entropia, BIP-39 com checksum e wordlist, derivação `m/44'/1729'/0'/0'`, watermark correto por tipo de payload assinado); a cifra de armazenamento (AEAD, KDF Argon2id, comparação em tempo constante); a fronteira do `Signer`; e a cadeia de suprimento — npm sempre, crates.io também sob o Finalista A. Auditoria externa antes de qualquer versão pública que segure chave de usuário.

---

## 11. Passada 2 — avaliação portão a portão

**Relatório do spike BRES-36 recebido em 2026-08-27T21:24Z**, com dois comentários de correção do próprio executor até 2026-08-28T01:17Z. Avaliado contra os portões como estavam congelados, sem alteração posterior ao relatório.

### 11.1 Resultado

| Portão | Veredito | Evidência |
|---|---|---|
| **P1** | **ATENDIDO** | Build verde e app rodando em Linux (WebKitGTK 2.52), Windows (WebView2 151) e Android (API 34). Mesmo `lib.rs` e mesmo `main.ts`; a única diferença é o registro dos plugins móveis atrás de `#[cfg(mobile)]`. Não há fork por plataforma. |
| **P2** | **ATENDIDO, com desvio de rede registrado em 11.2** | 7 operações injetadas e confirmadas `applied` — 2 Linux, 1 Windows, 4 Android. Limiar pedia 2, com um desktop e um Android. Duas delas partem da mesma conta, a segunda destravando o vault gravado pela primeira, o que fecha o ciclo gravar → cifrar → destravar → assinar. |
| **P3** | **PARCIAL** | Detalhe em 11.3. |
| **P4** | **ATENDIDO, menos a fonte de entropia** | Zero crates específicas de Tezos. A lacuna 1 de 3.1.2 está fechada: a crate de derivação foi nomeada — `slipped10` 0.4.7, release 2026-04-04. `bip39` 2.2, `ed25519-dalek` 2.2, `blake2`/`bs58`/`zeroize`/`argon2` ativas. `tezos_crypto_rs` e `tezos_data_encoding` confirmados parados desde 2024-07-02, e nada específico de Tezos precisou ser reimplementado. **A lacuna 2 continua aberta:** o relatório não nomeia o RNG que produziu os 128/256 bits da mnemônica no build Android. |
| **P5** | **NÃO AVALIADO** | Não é reprovação. Detalhe e consequência em 11.4. |
| **P6** | **ATENDIDO** | Linux 16 MB (12 MB stripped) em 3m43s, incremental 33s. Windows 11 MB em 5m39s. APK release universal **25 MB** em 6m38s. Todos os limiares eram ≤ 40 MB desktop, ≤ 50 MB APK, ≤ 30 min a frio, ≤ 5 min incremental. Passa com folga. O APK de **debug** tem 279 MB por causa dos símbolos, o que torna o laço de desenvolvimento no Android pesado — é imposto diário, não tamanho de artefato, e P6 mede o artefato. |
| **P7** | **ATENDIDO** | A seção "o que foi difícil ou frágil" tem nove itens, incluindo os que andam contra a proposta: o caminho documentado do Stronghold colocaria a semente no JavaScript, `Zeroizing` não zerou, e a senha do vault atravessa para o JS. O executor ainda voltou por conta própria para corrigir uma afirmação errada dele mesmo sobre a causa da lentidão do unlock. Isso é o oposto de um relatório só com sucessos. |
| **P8** | **ATENDIDO** | Mnemônica de teste derivada em `m/44'/1729'/0'/0'` no Rust e no Taquito 25 (`InMemorySigner.fromMnemonic`): endereço, chave pública e assinatura de `0xaabb` batem exatamente, e os valores estão fixados como asserções em 7 testes. É conferência contra implementação independente, como o portão exige. |

**Critérios de eliminação: nenhum disparado.** K1 e K2 não, o Android buildou do mesmo código e injetou 4 operações. K3 não, o Stronghold funcionou no Android. K5 não, zero crates de Tezos.

**K4 não disparado, e vale dizer por quê.** O spike encontrou a senha do vault 1× no heap do renderer Chromium — a semente, zero. A delimitação de K4 foi escrita em 2026-08-27, **antes** do relatório existir: "K4 é sobre material de chave saindo, não sobre senha entrando", porque a senha atravessa JS nos dois finalistas e portanto não discrimina entre eles. Sem essa linha pré-registrada, este exato achado seria hoje discutível para os dois lados. É o pré-registro fazendo o trabalho para o qual existe.

### 11.2 Desvio de rede — Ghostnet deixou de existir

O portão P2 dizia "Ghostnet". O spike reportou que Ghostnet não está no registro `teztnets.json` e que nenhum RPC conhecido resolve DNS, e rodou em **Shadownet**.

**Verificado de forma independente por esta ADR, em 2026-08-28:** o registro lista `bakingnet`, `currentnet`, `mainnet`, `shadownet`, `snet`, `ushuaianet` e `weeklynet`. Não lista Ghostnet. `rpc.ghostnet.teztnets.com` e `ghostnet.tezos.ecadinfra.com` dão NXDOMAIN.

O desvio **não** desqualifica P2: a intenção do portão era operação real numa cadeia pública de teste, verificável por terceiro, e é isso que os 7 hashes são. Ghostnet ter sumido é fato do ambiente, não falha do spike.

**A consequência é maior que P2 e vale para a suíte inteira.** "Ghostnet" estava escrito como critério de aceite em sete issues. É o mesmo erro estrutural que esta ADR já registra duas vezes — valor de rede escrito no código em vez de lido da fonte. Desta vez o valor congelado era a própria rede.

A correção não é substituir uma constante por outra, porque os dois produtos não vão para a mesma rede:

- **Tezzet** (carteira) → **Shadownet**. É o que o registro indica para teste de aplicação.
- **TAPS** (payout de baker) → **Bakingnet**. O próprio registro do Shadownet pede que não se teste baker nele: *"We prefer that you don't test bakers on this network - please use bakingnet"*. Bakingnet está no ar, protocolo `PsUshuai9Qap…`, mesmo protocolo do Shadownet.

Isso vira mandato de **BRES-38** (levantamento de rede), promovida para `todo` nesta passada: fixar rede, RPC e endpoint de TzKT por produto, lidos de configuração, e nunca mais escritos em critério de aceite como constante.

### 11.3 P3 — parcial, e o que falta é nomeável

O que foi entregue é, em dois pontos, **mais forte** do que o portão pedia. A varredura de memória no Android trouxe **controle positivo**, que o portão nem exigia: no heap do renderer o endereço público aparece 55× e a chave pública 15×, e a mnemônica **0×**. Um dump que claramente alcança o heap do JS e ainda assim não acha o segredo vale muito mais que um dump vazio. No Linux, 664 MB do heap do WebKit varridos, zero ocorrências. E o snapshot em disco tem entropia de 7,281 bits/byte, sem sequência tipo BIP-39.

Cobertos na substância:

- **P3.a** — parcialmente. O app tem uma sonda que tenta extrair o segredo pelos nomes que um chamador plausível tentaria (`get_mnemonic`, `get_seed`, `get_secret_key`, `export_mnemonic`, `secret_key`), e todos respondem "Command not found"; `wallet_info` devolve só `address`, `publicKey`, `derivationPath`; e o `secretKey()` que o `Signer` do Taquito exige **lança exceção em vez de devolver `undefined`**, o que é a decisão certa — `undefined` deixaria um chamador seguir em silêncio por outro caminho. Mas isso é sonda por amostragem, não a enumeração exaustiva de todo `#[tauri::command]` com o tipo de retorno e o ramo `Err` que P3.a pede. É justamente o item que não pode ser amostrado.
- **P3.d** — coberto por evidência diferente e mais forte (varredura de memória com controle positivo) em vez da asserção sobre payload de IPC.

Não demonstrados:

- **P3.b** — nenhum tipo que carrega segredo implementa `Serialize`. Não reportado. É o item que o compilador garante, e portanto o mais barato de fechar.
- **P3.c** — caminho de erro e de log auditados, com uma operação deliberadamente falha mostrando o que chega ao JS. Não reportado.
- **P3.e** — regressão de CI. O spike tem 7 testes, mas do acordo de derivação Rust ↔ Taquito, não da fronteira. Sem isso, a fronteira vale na data do spike e não depois.

### 11.4 P5 — não avaliado, e a causa é minha

P5, como emendado, exige vínculo criptográfico com o Android Keystore (`setUserAuthenticationRequired`), demonstrado por **falha** de decifragem quando a biometria é negada, mais o nível de segurança do device e os parâmetros do KDF escritos.

Nada disso foi medido, e o relatório não permite avaliar. O que ele traz sobre o assunto é o contrário de aprovação: o portão biométrico do spike está no Rust, dentro de `sign_operation` — decisão certa —, mas `status()` responde `is_available=false` com `"Biometrics not enrolled"` mesmo com PIN de dispositivo válido, então o portão escrito da forma óbvia **não dispara e assina**.

**Três fatos que decidem como tratar isto, e o primeiro é uma falha de processo minha:**

1. **O spike nunca recebeu a pergunta.** A emenda que reescreveu P5 foi commitada em 2026-08-27, com BRES-36 já em execução, e **não foi propagada para a descrição da issue**. O critério de aceite que o executor tinha era o original — "guardar a semente cifrada usando o plugin Stronghold, destravado pelo plugin Biometric onde a plataforma oferece" — e esse ele cumpriu. Julgar o relatório contra uma barra que ele nunca recebeu seria injusto e, pior, produziria uma decisão errada.
2. **O artefato que P5 media foi rejeitado depois.** Tezos Core & Crypto reprovou o Stronghold como container do cofre, com linha e arquivo: parâmetros de KDF herdados de `Default::default()` de terceiro, três `.expect()`/`.unwrap()` no caminho do KDF, sal em arquivo separado, e um scrypt de 512 MiB fixo em crate transitiva que não cabe em Android de entrada. Reexecutar P5 contra o Stronghold seria medir um desenho que ninguém vai entregar.
3. **Nada no relatório indica que o vínculo com o Keystore seja impossível em Tauri.** Ele indica que não foi tentado. Reprovar o Finalista A por uma propriedade não medida, enquanto o Finalista B tem exatamente a mesma propriedade não medida, não é decisão — é sorteio com aparência de regra.

Portanto o estado de P5 é o descrito em **R5** ("o relatório não permite avaliar"), não o de R2 ("não atendido"). A diferença entre os dois não é conveniência: R2 pressupõe medição com resultado negativo, e não houve medição.

**Escopo real do que P5 trava.** Menor do que parece, por duas razões:

- **TAPS saiu do escopo do cofre.** Rafael aprovou `octez-signer` sem Ledger em 2026-08-28. O TAPS deixa de guardar chave — todo o `WalletEncryptionService` é apagado, não consertado. P5 não gateia nada no TAPS.
- **As duas primeiras ondas do Tezzet não custodiam nada.** BRES-45 (leitura e Beacon) e BRES-47 (delegação e staking) entregam valor sem o app segurar chave. P5 gateia **BRES-50** (custódia própria), que a sequência do épico já deixou por último de propósito.

### 11.5 Regra aplicada e decisão

**Regra aplicada: R5, restrita a P5.**

- [x] Relatório do spike recebido em: **2026-08-27T21:24Z**
- [x] Avaliação portão a portão: P1 **ok** · P2 **ok** · P3 **parcial** · P4 **ok, menos entropia** · P5 **não avaliado** · P6 **ok** · P7 **ok** · P8 **ok**
- [x] Eliminações disparadas: **nenhuma**
- [x] Regra aplicada: **R5** — não decidir enquanto P5 não for medido
- [ ] Decisão em uma frase: **pendente de uma medição nomeada**
- [ ] Aprovação de Rafael em: `____`

**Não é reprovação e não é aprovação.** Em tudo que foi medido, o Finalista A passou — três plataformas do mesmo código, sete operações reais na cadeia, a semente ausente do lado JS com controle positivo, crates genéricas mantidas, derivação conferida contra implementação independente, e custo de build folgado. A expectativa honesta é aprovação. Escrever "aprovado" antes de medir o portão que carrega a tese de segurança seria exatamente a racionalização que a seção 3 existe para impedir.

**O que fecha, e é pequeno:** medir o vínculo com o Keystore contra o container que Tezos Core & Crypto especificou em BRES-37 — não contra o Stronghold —, mais os itens `b`, `c` e `e` de P3 e a fonte de entropia de P4.

**Estado em 2026-08-29.** BRES-37 entregou e está fechada: `docs/spec/0001-nucleo-criptografico-compartilhado.md`, em `master` deste repositório. Ela resolve metade do problema — **diz o que é certo**, e diz com precisão suficiente para ser medido. A §6.3 especifica o embrulho `KEK_hw` no AndroidKeyStore com `setUserAuthenticationRequired(true)` e `setInvalidatedByBiometricEnrollment(true)`, e a §9.5 repete a exigência desta ADR de que **a demonstração seja negativa**: negar a biometria faz o desembrulho falhar, não faz uma tela não abrir. As §§9.1, 9.6 e 9.7 cobrem, na mesma forma, a entropia de P4 e os três itens de P3 — e as transformam em teste de CI em vez de demonstração única, que é o que P3.e pedia.

Não há conflito entre a especificação e esta ADR, e vale registrar a direção: a especificação **codifica** os portões como critério de aceite executável, em vez de apenas referenciá-los. Isso é melhor que o que a ADR pediu.

**O que continua faltando é a medição, e só ela.** Despachada em **BRES-66**, estágio 1, com o mesmo enquadramento do BRES-36: artefato descartável, o relatório é a entrega, e nada entra nos repositórios de produto enquanto esta ADR não fechar.

**A alternativa legítima é de Rafael, e precisa ser exercida como tal.** Ele pode aprovar agora, aceitando P5 e os itens abertos de P3/P4 como risco registrado. Isso é um **override humano explícito** do portão, é legítimo, e fica escrito nesta seção como override — nunca lavado como "os portões passaram".

### 11.6 Decisões humanas já tomadas que esta ADR incorpora

Registradas aqui porque foram tomadas na thread de BRES-36 e valem para a suíte:

| Data | Decisão de Rafael |
|---|---|
| 2026-08-27 | **Apple cortada.** Alvos: Linux, Windows, Android. Ver seção 8. |
| 2026-08-27 | **Sem baker em produção.** Ver 1.1. |
| 2026-08-28 | **A senha não passa pela webview.** Prompt nativo é requisito, não opção. Fecha o furo do item 4 do relatório antes da primeira linha de produto. |
| 2026-08-28 | **Modelo de banco para autenticação:** biometria/login para entrar, **PIN interno para transacionar**, criado no primeiro acesso. Mesma cerimônia nos dois produtos; o fator por plataforma sai de BRES-37. |
| 2026-08-28 | **Custódia do TAPS: `octez-signer`, sem Ledger.** O TAPS deixa de guardar chave. |
| 2026-08-28 | **Tempo de abertura no Android** não é bloqueio; medir quando houver aparelho real. |

Duas dessas mudam o requisito 7 desta ADR e ficam registradas como tal: o prompt nativo (a senha nunca em `<input>` de HTML) e a separação login × PIN de transação.
