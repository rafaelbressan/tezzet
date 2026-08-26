# Tezzet — análise técnica e plano de evolução

Análise feita em 2026-08-26 sobre o commit `1c5f0c9` ("Fixes for Babylon protocol compatibility", 01/11/2019).

## Sumário

Tezzet é uma carteira Tezos Android nativa, escrita em Java, com 7 activities e ~1.286 linhas de código. O escopo funcional é: criar carteira, importar carteira, ver saldo, enviar XTZ, receber XTZ (QR Code).

**Estado real: o projeto não compila mais e não pode ser publicado.** Não é uma questão de dívida acumulada — são três bloqueios independentes, cada um suficiente para parar o projeto sozinho:

1. **O build não resolve.** `jcenter()` e `dl.bintray.com` foram desligados em 2021. A dependência principal (`com.milfont.tezos:tezosj_android:0.9.992`) era distribuída por lá.
2. **A Play Store não aceita.** `targetSdkVersion 28` (Android 9). O Google exige alvos muito mais recentes para qualquer atualização de app existente há vários anos. O app está congelado na loja.
3. **A rede mudou embaixo do app.** O último commit fala em compatibilidade com Babylon (protocolo de outubro de 2019). Desde então a Tezos passou por mais de uma dezena de upgrades de protocolo, incluindo mudanças estruturais — Tenderbake (finalidade determinística), Adaptive Issuance e staking direto por delegador, endereços `tz4`, novas regras de fee/gas. Uma carteira parada em Babylon assina operações com premissas que não valem mais.

A conclusão honesta: **isto não é um projeto para migrar, é um projeto para reescrever, preservando a identidade e o aprendizado de produto.** O que tem valor duradouro aqui é a marca, o fluxo de telas (que é enxuto e correto) e a decisão de ser uma carteira não-custodial simples. O código Java não é reaproveitável.

---

## 1. Dívida técnica

### 1.1 Build e toolchain — bloqueante

| Item | Valor no repo | Situação |
|---|---|---|
| Android Gradle Plugin | 3.5.1 | 2019 |
| Gradle | 5.4.1 | 2019 |
| `compileSdkVersion` / `targetSdkVersion` | 28 | Android 9 |
| `minSdkVersion` | 26 | Android 8 |
| Bibliotecas de suporte | `com.android.support:*:28.0.0` | Pré-AndroidX, descontinuada |
| Repositório | `jcenter()` + `http://dl.bintray.com/journeyapps/maven` | Desligados |
| SDK Tezos | `com.milfont.tezos:tezosj_android:0.9.992` | Sem manutenção desde ~2019 |
| ZXing | `2.0.1` (2013) | Muito antigo |

Detalhes que agravam:

- O repositório maven do journeyapps está declarado em **HTTP puro** (`build.gradle:11`). AGP 7+ bloqueia repositórios não-HTTPS por padrão.
- `versionCode`/`versionName` estão declarados **duas vezes** e com valores divergentes: `AndroidManifest.xml` diz 4 / "1.0.3", `app/build.gradle` diz 5 / "1.0.4". O Gradle vence, mas a duplicação é ruído.
- `minifyEnabled false` no build de release — o APK vai para produção sem ofuscação nem shrinking.
- Nenhum CI. Nenhum teste real (apenas os `ExampleUnitTest`/`ExampleInstrumentedTest` gerados pelo Android Studio).

### 1.2 Segurança — o mais grave

Uma carteira é software de custódia. Os problemas abaixo não são estilísticos.

**Sem `FLAG_SECURE` em nenhuma tela.** Consequências diretas:
- A tela que exibe as **palavras mnemônicas** (`NewWalletActivity`) pode ser capturada por screenshot e aparece no thumbnail da tela de apps recentes.
- A tela de carteira destravada (saldo + endereço) idem.
- Malware com permissão de acessibilidade ou captura de tela lê a seed.

**A mnemônica é exibida em um `EditText`** (`activity_new_wallet.xml` / `NewWalletActivity.java:41`). Isso a torna selecionável, copiável para a área de transferência e sujeita ao cache de sugestões do teclado e ao autofill. Uma seed nunca deve passar por um campo de entrada de texto padrão.

**Segredos vivem em `String` Java.** Passphrase e mnemônica são `String` imutáveis (`editTextPassphrase.getText().toString()`), que ficam no heap até o GC decidir coletá-las e não podem ser zeradas. O padrão correto é `char[]`/`CharSequence` sobrescrito após o uso.

**O comentário mente sobre o que o código faz.** Em `NewWalletActivity.java:106` e `ImportWalletActivity.java:57`:
```java
// Erases wallet from memory.
myWallet = null;
```
Isso apenas descarta a referência. Não apaga nada. Comentários de segurança que afirmam garantias inexistentes são piores que nenhum comentário — eles impedem que alguém volte e faça a coisa certa.

**Trava da carteira é só visual.** `WalletActivity` controla o estado travado com o booleano `locked`, que apenas alterna a visibilidade de dois `LinearLayout`. O objeto `myWallet` — já descriptografado — permanece em memória o tempo todo. E há um bug concreto: `onActivityResult` (`WalletActivity.java:390`) começa com

```java
public void onActivityResult(int requestCode, int resultCode, Intent data) {
    // Unlocks wallet.
    WalletActivity.this.locked = false;
```

antes de qualquer verificação de `requestCode` ou `resultCode`. Qualquer retorno de activity — inclusive um cancelamento — destrava a carteira.

**Área de transferência sem expiração.** O endereço é copiado com `ClipboardManager` (`WalletActivity.java:262`) e nunca é limpo. Troca de endereço na área de transferência por malware é um dos vetores mais explorados contra usuários de cripto.

**Exceções engolidas em toda parte.** O padrão `catch (Exception e) { e.printStackTrace(); }` aparece 9 vezes. Em `getWalletBalance()` há um `catch` completamente vazio. O usuário nunca descobre por que algo falhou, e stack traces em logcat podem vazar contexto sensível.

**Faltam controles esperados numa carteira de 2026:** biometria, autenticação atrelada ao Android Keystore com `setUserAuthenticationRequired`, detecção de root/emulador, timeout de sessão, verificação de integridade (Play Integrity), e um segundo fator para transações acima de um limite.

**Permissão desnecessária.** `WRITE_EXTERNAL_STORAGE` está no manifesto e o app não escreve em armazenamento externo. Além de desnecessária, é incompatível com o modelo de escopo de armazenamento moderno.

### 1.3 Correção de transações

**Taxa fixa, hardcoded** (`WalletActivity.java:436`):
```java
BigDecimal myFee = new BigDecimal("0.00294");
operationResult = myWallet.send(myWallet.getPublicKeyHash(), dest_address, bdAmount, myFee, null, null, null);
```
Os três `null` finais são gas limit, storage limit e parâmetros. A carteira não estima nada: manda uma taxa fixa de 2019 e deixa o SDK preencher limites com defaults. Numa rede que reprecificou gas várias vezes, isso significa transação rejeitada (taxa baixa demais) ou desperdício (taxa alta demais). Estimativa via `/helpers/scripts/run_operation` antes de assinar é obrigatória hoje.

**Sem tratamento de conta não revelada.** Uma conta Tezos que nunca enviou nada precisa de uma operação `reveal` antes da primeira transferência, e um destinatário não alocado exige o burn de alocação. Nada disso é tratado.

**Detecção de erro por substring** (`WalletActivity.java:466`):
```java
status = (String) operationResult.get("result");
if (status.contains("error") == true)
```
O sucesso ou fracasso de uma transferência de valor é decidido procurando a palavra "error" dentro de uma string. Se o hash da operação contiver essa sequência, ou se o formato de resposta do SDK mudar, o resultado é lido errado — nos dois sentidos.

**Confirmação por polling cego** (`checkForBalanceUpdates`): um `CountDownTimer` consulta o saldo a cada 30 segundos por 5 minutos. Não observa o hash da operação, não distingue "ainda no mempool" de "rejeitada", e some se o usuário sair da tela.

**Sem histórico de transações.** A carteira mostra apenas o saldo atual. Não há como o usuário verificar se um envio anterior chegou.

### 1.4 Arquitetura e UI

- **Zero separação de camadas.** Toda a lógica está dentro de `onCreate`, em listeners anônimos aninhados. `WalletActivity` tem 606 linhas com quatro níveis de aninhamento de callbacks. Não há ViewModel, repositório, nem sequer uma classe de serviço.
- **`AsyncTask`** — descontinuado desde a API 30.
- **Strings hardcoded em Java.** Existe um `strings.xml` bem feito, e ainda assim todas as mensagens de erro (`"Wrong passphrase"`, `"Invalid destination address"`, `"Sorry, funds could not be sent..."`) estão escritas direto no código. Isso impede tradução — inclusive para português, o que é notável para um produto brasileiro.
- **`Toast` para tudo**, inclusive para erros que exigem ação do usuário.
- **`android:screenOrientation="portrait"`** travado em todas as activities; sem layouts para tablet, dobrável ou modo paisagem.
- **Sem tema escuro**, sem `contentDescription` na maioria dos elementos, sem suporte a fonte ampliada.
- `MyAsyncTask` testa `Build.VERSION_CODES.HONEYCOMB` (API 11) num app com `minSdk 26`. Código morto.

### 1.5 Lacunas funcionais para uma carteira Tezos

O que falta não é refinamento, é o essencial da rede:

- **Delegação e staking.** Tezos é proof-of-stake; delegar é a ação econômica central de um detentor de XTZ. Uma carteira Tezos sem delegação é uma carteira que não faz a coisa mais importante que se faz com XTZ. Após o Adaptive Issuance, há ainda o staking direto do delegador, que é uma segunda ação distinta.
- **Tokens FA1.2 (TZIP-7) e FA2 (TZIP-12)** e NFTs.
- **Beacon / WalletConnect (TZIP-10)** para conectar a dApps. Sem isso a carteira é uma ilha.
- **Múltiplas contas** e derivação HD por caminho.
- **Ledger** (hardware wallet).
- **Troca de rede** (mainnet / ghostnet) — hoje o endpoint é fixo dentro do SDK.
- **Livro de endereços** e apelidos.
- **RPC configurável.** O README admite que o app usa o servidor RPC de terceiros de Stephen Andrews. Isso é um ponto único de falha e de privacidade que hoje quase certamente não existe mais.

---

## 2. Necessidades criptográficas

A carteira delega toda a criptografia ao `TezosJ_SDK`, que está sem manutenção. Isso significa que as decisões criptográficas do produto são hoje **invisíveis e não auditáveis** a partir deste repositório. Qualquer reescrita precisa trazer essas decisões para dentro, explicitamente.

**O que precisa existir e ser verificável:**

| Necessidade | Requisito |
|---|---|
| Geração de entropia | CSPRNG do sistema (`SecureRandom` com provider do Android), nunca `Random` |
| Mnemônica | BIP-39 com **validação de checksum e wordlist** na importação — hoje não há validação nenhuma, e uma palavra digitada errada gera silenciosamente uma carteira diferente e válida |
| Derivação | BIP-32/BIP-44 com o caminho Tezos `m/44'/1729'/0'/0'` |
| Assinatura | Ed25519 (`tz1`) como padrão; suportar `tz2` (secp256k1) e `tz3` (P-256) na importação; considerar `tz4` (BLS) conforme o uso na rede se consolida |
| Watermark | Byte de watermark correto por tipo de payload assinado (operação, bloco, endorsement). Assinar bytes sem watermark é um erro de segurança clássico |
| Armazenamento da chave | Chave derivada **no Android Keystore**, com `setUserAuthenticationRequired(true)`, `StrongBox` quando disponível, e a seed cifrada com AEAD (AES-256-GCM) sob essa chave |
| KDF da passphrase | Argon2id (ou scrypt com custo alto). SHA-512 de rodada única não serve para derivar chave de carteira |
| Comparações | Tempo constante para qualquer comparação de hash ou tag |
| Higiene de memória | `char[]`/`ByteArray` zerados após uso; nunca `String` |
| Transporte | TLS com pinning para o RPC, ou RPC próprio |

**Recomendação central:** não reimplemente primitivas. Use uma biblioteca Tezos mantida e mantenha a superfície criptográfica própria mínima — apenas o armazenamento e o ciclo de vida da chave, que é onde o app realmente tem responsabilidade.

---

## 3. O que mudou na Tezos desde 2019

Este repositório parou em Babylon. A lista abaixo é o que quebra premissas do código atual:

- **Tenderbake** substituiu Emmy* — finalidade determinística em 2 blocos. O modelo de "esperar N blocos e torcer" não é mais como se confirma uma operação.
- **Constantes de protocolo foram renomeadas e revalorizadas.** `time_between_blocks` e `endorsers_per_block` deixaram de existir na forma antiga. Duração de ciclo e tempo de bloco mudaram várias vezes.
- **Adaptive Issuance e staking** (era Paris em diante): o delegador passa a poder *stakear* diretamente, com `staked_balance` separado do `delegated_balance`. Isso muda o que uma carteira precisa mostrar e oferecer.
- **Endereços `tz4` (BLS)** entraram no ecossistema.
- **Reprecificação de gas e de taxas** em múltiplos upgrades.
- **Smart Rollups e DAL** — não afetam uma carteira simples diretamente, mas mudam o que o ecossistema espera de um cliente.

**A lição de arquitetura:** o erro estrutural do Tezzet não foi ter valores desatualizados, foi ter **valores fixos**. Duração de ciclo, limites de gas, taxa e delays devem ser lidos de `/chains/main/blocks/head/context/constants` em tempo de execução, com cache. Um app que lê as constantes da cadeia sobrevive a upgrades de protocolo; um app que as escreve no código morre a cada um.

---

## 4. Stack proposta — Tezzet Web (e o caminho para o mobile)

O pedido é dar ao Tezzet uma versão web. A recomendação é mais forte que isso: **fazer da web a base, e reconstruir o mobile a partir dela**, em vez de manter dois produtos independentes.

### 4.1 Proposta

| Camada | Escolha | Por quê |
|---|---|---|
| Framework | **Next.js 15+ (App Router)**, TypeScript estrito | Ecossistema Tezos em JS/TS é o mais vivo; SSR desligado nas rotas de carteira |
| Renderização | **Estático / client-only nas rotas com chave** | Chave privada nunca deve tocar um servidor. Exportar as rotas de carteira como client components puros |
| SDK Tezos | **Taquito** (`@taquito/taquito`, `@taquito/signer`, `@taquito/beacon-wallet`, `@taquito/utils`) | É o SDK mantido e de referência do ecossistema |
| Conexão a dApps | **Beacon SDK** (TZIP-10) | Padrão do ecossistema |
| Dados indexados | **TzKT API** | Histórico, delegadores, tokens — muito mais barato que varrer o RPC |
| Estado servidor | **TanStack Query** | Cache, revalidação e retry para dados de cadeia |
| Estado cliente | **Zustand** | Leve; nada de estado global pesado numa carteira |
| Estilo | **Tailwind CSS v4** consumindo os tokens de `suite/tokens/tokens.css` | Ver seção 5 |
| Componentes | **Radix UI** (primitivos sem estilo) + camada própria | Acessibilidade correta de graça; visual 100% nosso |
| Validação | **Zod** | Mesmo validador do TAPS — parte do que os dois repos compartilham |
| Precisão numérica | **BigInt em mutez** em todo o caminho de valor; formatação só na borda | Nunca `number` para dinheiro |
| Testes | **Vitest** + **Playwright** | E2E contra Ghostnet |
| Empacotamento mobile | **Capacitor** ou, se o produto exigir mais nativo, **React Native + Expo** reaproveitando a camada de domínio | Ver 4.3 |

### 4.2 Regras não-negociáveis para a versão web

Uma carteira no navegador tem riscos que o Android não tem. Sem estas regras, a versão web é pior que não ter versão web:

1. **A chave nunca sai do dispositivo e nunca vai para um servidor.** Zero endpoints que recebam seed, passphrase ou chave.
2. **Armazenamento local via WebCrypto:** seed cifrada com AES-GCM sob chave derivada por Argon2id/PBKDF2 de alto custo, guardada em IndexedDB. Nunca `localStorage`. Nunca em texto claro.
3. **Preferir WebAuthn/passkey** como fator de destravamento onde disponível.
4. **CSP rígida**, sem `unsafe-inline` e sem `unsafe-eval`; SRI em qualquer script externo.
5. **Dependências travadas e auditadas.** O vetor real contra carteiras web é supply chain — um pacote transitivo comprometido lê a seed. Lockfile, `npm audit` bloqueante no CI, e o mínimo possível de dependências no bundle que toca a chave.
6. **Sem telemetria de terceiros nas rotas de carteira.** Nenhum script de analytics na mesma origem que a chave.
7. **Suporte a Beacon como caminho preferencial** — deixar o usuário usar a carteira que ele já confia é mais seguro do que convencê-lo a colar a seed.

### 4.3 O caminho do mobile

Três opções, com uma recomendação:

- **Reescrever nativo (Kotlin + Compose).** Melhor segurança (Keystore/StrongBox, biometria de verdade), maior custo, código não compartilhado com a web.
- **React Native + Expo.** Compartilha a camada de domínio (Taquito, validações, formatação, tokens de design) com a web; usa `expo-secure-store` e biometria nativa. Bom equilíbrio.
- **Capacitor sobre a web.** Mais barato e mais rápido, mas coloca a chave dentro de uma WebView — para uma carteira, é o pior dos três.

**Recomendação: React Native + Expo**, com um pacote `@tezzet/core` em TypeScript compartilhado entre web e mobile contendo domínio, validação e formatação — e a criptografia de armazenamento implementada separadamente em cada plataforma (WebCrypto na web, Keystore/Keychain no mobile), porque essa é justamente a parte que **não** deve ser compartilhada.

### 4.4 Sequência sugerida

1. **Fundação** — repo TypeScript, tokens do `suite/`, CI (lint, typecheck, teste, audit), CSP.
2. **Somente leitura** — conectar via Beacon, mostrar saldo, histórico (TzKT), endereço com QR. Nenhuma chave gerenciada pelo app. Isso já é um produto útil e tem risco quase zero.
3. **Delegação e staking** — a funcionalidade que mais falta hoje, e ainda sem custódia.
4. **Custódia própria** — criar/importar carteira, cifrar localmente, assinar. Só depois de 1–3 estarem sólidos e auditados.
5. **Tokens FA1.2/FA2 e NFTs.**
6. **Mobile** a partir do núcleo compartilhado.

O ponto da ordem: as etapas 2 e 3 entregam valor **sem** o app custodiar chave nenhuma. A parte perigosa vem por último, depois que o resto estiver estável.

---

## 5. Interface: padronização com o TAPS

Ver `suite/` neste repositório — é o espaço unificado de marca, narrativa e tokens de design para os dois produtos, com `suite/index.html` como referência viva. Resumo do que ele define:

- **Uma identidade só**, derivada do próprio logotipo do Tezzet: preto pesado condensado, dourado `#C8B08B`, cantos retos, sombra dura deslocada, e o corte diagonal como elemento estrutural.
- **Tokens em `suite/tokens/tokens.json`** (neutro de plataforma) e `suite/tokens/tokens.css` (web). O mesmo arquivo JSON alimenta Tailwind na web e pode gerar tema para React Native ou Compose.
- **Um kit compartilhado** dos componentes que os dois produtos têm em comum e que são específicos de Tezos: exibição de valor em XTZ, endereço truncado com cópia, hash de operação com link para explorador, badge de status, número de ciclo, seletor de rede.
- **Regras de escrita** comuns, incluindo o vocabulário fixo em português.

O ganho concreto não é estético: é que "endereço", "valor" e "status de pagamento" passam a ter **uma** implementação correta — com truncamento, precisão decimal e estados de erro resolvidos uma vez — em vez de duas implementações divergentes.

---

## 6. Prioridades

**Antes de qualquer coisa — decisão de produto:** o app publicado na Play Store está congelado, aponta para infraestrutura que provavelmente não existe mais e não recebe correção de segurança desde 2019. Se ainda estiver listado, considere despublicar ou marcar como descontinuado. Usuários com fundos numa carteira abandonada é um risco real, não hipotético.

**Curto prazo**
1. Avisar usuários existentes e documentar o caminho de exportação da seed.
2. Congelar este repositório como referência histórica (a marca e o fluxo continuam valendo).
3. Abrir o repositório da versão web com a fundação da seção 4.4.

**Médio prazo**
4. Web somente-leitura + Beacon (etapas 2–3).
5. Custódia própria com auditoria externa antes de qualquer versão pública que segure chave.

**Longo prazo**
6. Mobile a partir do núcleo compartilhado.
7. Tokens, NFTs e integração com dApps.
