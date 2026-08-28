# SPEC-0001 — Núcleo criptográfico compartilhado da Suíte Tezos

| | |
|---|---|
| **Status** | Especificação normativa — passada 1, aberta a revisão |
| **Data** | 2026-08-27 |
| **Autor** | Tezos Core & Crypto |
| **Issue** | BRES-37 |
| **Origem** | Mandato escrito pelo Tezos Suite Lead em BRES-37, autorizado por Rafael no thread de revisão do spike BRES-36 (`01a045b8`) |
| **Vale para** | Tezzet e TAPS. Alvos: **Linux, Windows e Android** (ADR-0001 §8 — Apple fora do escopo) |
| **Relação com a ADR-0001** | Independente. Esta especificação é escrita em **primitivas e parâmetros**, não em linguagem. Ela vale se a stack for Rust e vale se não for. Nomes de biblioteca aparecem só na seção 12, rotulados como *implementação de referência candidata*. |
| **O que ela NÃO decide** | A custódia da chave de payout do TAPS. Isso está escalado para Rafael. A seção 11 escreve a recomendação e para aí. |

---

## Como ler este documento

Cada decisão tem três partes: **o quê**, **o número exato** e **por quê**. Onde não há número, há um nome de algoritmo ou de mecanismo do sistema operacional. Não há adjetivo em lugar nenhum de norma — "KDF forte" não é decisão, é opinião.

As palavras **DEVE**, **NÃO DEVE**, **PODE** têm o sentido do RFC 2119.

Onde a especificação diz que algo é impossível de garantir, isso está escrito como impossível, não maquiado. Foi exatamente o inverso disso — um comentário afirmando que a memória era limpa quando não era — que produziu metade dos achados de `ANALYSIS.md` nos dois repositórios.

---

## 0. Por que este documento existe antes do código

Os dois sistemas herdados erraram criptografia, e nenhum dos erros é exótico. Todos vêm de decidir cripto **durante** a implementação, quando a pressão é entregar a tela.

No TAPS, em `backend/src/modules/auth/services/wallet-encryption.service.ts` (branch `agent/cartier/de00c8b0eb47`):

| Linha | O erro |
|---|---|
| `:151`, `:182` | `crypto.scryptSync(password, 'salt', 32)` — o sal é a string literal `'salt'`, idêntica para todos os usuários de todas as instalações. |
| `:28`, `:157` | AES-256-**CBC** sem autenticação, guardando uma semente de carteira. Ciphertext maleável, sujeito a padding oracle. |
| `:121-128` | Hash de verificação = SHA-512 de **uma rodada**. Rápido por desenho, portanto ideal para força bruta offline. |
| `:138-139` | `computedHash === hash.toUpperCase()` — comparação de segredo com `===`, canal lateral de tempo. |
| `:64-69` | A "dupla criptografia" devolve `phrase` **e** `appPhrase`, e o `schema.prisma` guarda as duas na mesma linha da mesma tabela. A segunda camada não protege nada. |

No Tezzet, toda a criptografia está delegada a um SDK Java abandonado desde 2019 — as decisões criptográficas do produto são hoje **invisíveis e não auditáveis a partir do repositório**. Somam-se: ausência de `FLAG_SECURE`, mnemônica exibida em `EditText` (selecionável, copiável, cacheada pelo teclado), segredos em `String` imutável, e uma trava de carteira que é só visibilidade de `LinearLayout`.

Este documento existe para que a próxima linha de código de chave da suíte seja escrita contra um número, e não contra uma intuição.

---

## 1. Os dois componentes, e a fronteira entre eles

A suíte tem **um** núcleo criptográfico, dividido em dois componentes com responsabilidades distintas. Auditados uma vez, usados nos dois produtos.

**`tz-keys` — identidade da chave.** Entropia, mnemônica, derivação, curvas, endereços, assinatura, watermark. É determinístico, não tem estado, não toca disco e não conhece o sistema operacional. É a parte que se testa contra vetor conhecido.

**`tz-vault` — o cofre.** Formato de arquivo, KDF, AEAD, envelope de DEK, embrulhos por plataforma, política de verificação de usuário, ciclo de vida em memória. É a parte que se testa contra ataque.

**A fronteira, escrita como regra:** `tz-keys` **NÃO DEVE** ler nem escrever arquivo, nem chamar API do sistema operacional. `tz-vault` **NÃO DEVE** conter nenhuma primitiva criptográfica própria além da composição descrita na seção 5. Um bug em um não deve exigir reauditar o outro.

**Consumo.** Todo código de produto fala com o núcleo através da interface `Signer` do Taquito (ADR-0001 §7, requisito 1). Nenhum caminho de produto chama o núcleo diretamente. É isso que permite trocar o shell sem tocar no núcleo, e é isso que permite que `octez-signer` seja apenas outra implementação da mesma interface.

---

## 2. Modelo de ameaça

Uma especificação que só diz do que protege é propaganda. Esta diz as duas coisas.

### 2.1 Contra o que isto protege

| # | Adversário | Como o desenho responde |
|---|---|---|
| **T1** | **Aparelho ou laptop furtado, desligado ou bloqueado.** Atacante tem o arquivo do cofre. | O corpo do cofre está sob AEAD com DEK aleatória de 256 bits. A DEK está embrulhada por `KEK_pass = Argon2id(passphrase)`. O custo por tentativa é o da seção 5.3. **A força real é a entropia da passphrase** (§2.3), não o KDF. |
| **T2** | **Banco de dados vazado.** | No desenho novo **nenhum banco guarda chave**. O cofre é arquivo local com permissão de dono. Onde houver banco (console do TAPS), ele guarda sessão de operador, nunca `edsk`. Este é o cenário exato que o TAPS falhou. |
| **T3** | **Backup na nuvem** — Google Backup, OneDrive, `rsync` para NAS, snapshot de VM. | O arquivo é opaco sem passphrase (T1 vale). Além disso, o cofre é marcado como não-elegível a backup em cada plataforma (§6). O embrulho de hardware (`KEK_hw`) **não** viaja no backup, o que é a propriedade desejada: um backup restaurado em outro aparelho só abre com a passphrase. |
| **T4** | **Outro usuário do mesmo sistema operacional.** | Permissão `0600` no arquivo, `0700` no diretório (Linux/Android), ACL só-dono (Windows). Isto **não** protege contra `root`/administrador — ver T9. |
| **T5** | **Swap, hibernação e dump de crash.** | `mlock`/`VirtualLock` nas páginas de segredo, `RLIMIT_CORE = 0` no Linux, WER desabilitado para o processo no Windows (§7). Converte um vazamento **permanente em disco** num vazamento transitório em RAM. |
| **T6** | **Ciphertext adulterado** — alguém com escrita no arquivo tenta padding oracle, troca de parâmetros, ou downgrade de perfil. | AEAD em tudo; o header inteiro é AAD; os parâmetros do KDF passam por validação de faixa **antes** de o KDF rodar (§5.6). Adulteração vira falha de abertura, nunca decifragem parcial. |
| **T7** | **Segredo digitado sendo lido pela camada web.** | Passphrase e PIN são coletados por **prompt nativo do sistema operacional**, nunca por `<input>` HTML. Nenhum comando da fronteira aceita senha como parâmetro (§8). |
| **T8** | **Força bruta online no aparelho** (alguém com o aparelho destravado tentando o PIN). | O PIN é portão com contador de bloqueio **no sistema operacional**, onde existe: Keystore no Android, anti-hammering do TPM via Hello no Windows. No Linux é contador em software e isso é **advisory** (§8.4). |

### 2.2 Contra o que isto NÃO protege — e é honesto dizer

| # | Fora do modelo | Por quê, sem rodeio |
|---|---|---|
| **N1** | **Dispositivo comprometido com malware ativo enquanto o cofre está aberto.** | Keylogger captura a passphrase no momento em que ela é digitada; `ptrace`/injeção lê a DEK da RAM do processo. Nenhum software puro resolve isto. O teto de segurança de qualquer carteira em software é este, e o que passa do teto é **assinador em hardware** (Ledger, `octez-signer` em host separado). |
| **N2** | **`root` / administrador local.** | Quem é root lê a memória de qualquer processo. `mlock` protege contra swap, não contra root. |
| **N3** | **Supply chain de dependências.** | Uma dependência maliciosa roda **dentro do mesmo processo** e tem acesso a tudo que o processo tem, inclusive à DEK destrancada. Mitigações são de custo/probabilidade, nunca de garantia: lockfile fixado e commitado, `cargo-deny`/`cargo audit` e `npm audit` **bloqueantes** no CI (hoje o TAPS roda `npm audit` com `continue-on-error: true` — portão decorativo), superfície mínima de dependência no caminho da chave, revisão humana de toda bump de crate desse conjunto, e build reprodutível quando a stack permitir. **Isto reduz a probabilidade. Não elimina a classe.** |
| **N4** | **Atacante que já tem a passphrase.** | Coerção, phishing, reuso de senha vazada, ou o usuário anotando a senha. Fora do alcance de qualquer parâmetro deste documento. |
| **N5** | **Backup da mnemônica feito pelo humano** — foto no celular, arquivo no Drive, print. | A mnemônica é formato de backup para humano por desenho (§4.2). O que o produto faz é reduzir a chance: sem `EditText`, sem clipboard, com `FLAG_SECURE`, com aviso explícito. O que o humano faz depois disso é dele. |
| **N6** | **Keylogging sob X11 no Linux.** | Sob X11, qualquer cliente da mesma sessão lê o teclado de qualquer outro; um diálogo GTK **não** está protegido. Sob Wayland, está. O prompt nativo continua estritamente melhor que a webview, mas **não é blindado** — e isso precisa estar escrito, não presumido. |
| **N7** | **Cold boot / ataque a DRAM.** | Fora de escopo. Não há contramedida viável em software de propósito geral. |
| **N8** | **Provar que não sobrou cópia nenhuma do segredo em RAM.** | É impossível num sistema operacional de propósito geral: o alocador realoca, o coletor copia, o compilador otimiza, o kernel migra páginas. O que este documento exige é a **limitação verificável** da seção 7 e o teste da seção 9.6 — não uma garantia que não existe. |
| **N9** | **Ladrão com o aparelho já destravado, com o cofre aberto.** | Mitigado apenas por *timeout* de sessão e PIN por transação (§8), que são portões, não criptografia. Explicitamente fora do modelo em repouso. |
| **N10** | **Comprometimento do RPC / nó Tezos.** | Um RPC hostil pode mentir sobre saldo e sobre o resultado de uma injeção, e pode devolver bytes forjados diferentes do que o usuário pediu. A defesa é a suíte **forjar e conferir localmente** os bytes que assina, nunca assinar bytes vindos prontos da rede (§4.6). |

### 2.3 O que o modelo diz sobre a passphrase, com números

O KDF não conserta passphrase fraca. Ele compra margem, e a margem é mensurável.

Premissas explícitas, para que o número possa ser contestado: Argon2id no perfil `v1-desktop` (256 MiB, t=3) é limitado por **largura de banda de memória**, não por ALU; uma GPU de topo com ~1 TB/s sustenta na ordem de **10³–10⁴ tentativas/s**; uma fazenda de 100 GPUs, **10⁵–10⁶/s**. Adotamos o pior caso para nós, 10⁶/s.

| Entropia da passphrase | Tempo esperado a 10⁶ tentativas/s |
|---|---|
| 30 bits (senha humana curta típica) | **~9 minutos** |
| 40 bits | ~13 dias |
| 50 bits | ~35 anos |
| **60 bits (piso desta especificação)** | **~36 mil anos** |
| 77 bits (6 palavras diceware, recomendado) | ~10¹⁰ anos |

**Regra normativa:** a criação de cofre **DEVE** recusar passphrase com entropia estimada **< 60 bits**, medida por estimador de força tipo zxcvbn (não por regra de composição do tipo "uma maiúscula e um símbolo", que mede outra coisa). A interface **DEVE** oferecer geração de frase de 6 palavras como caminho padrão. Sem valor padrão, sem passphrase vazia, sem "pular por enquanto".

---

## 3. Princípios inegociáveis

Estes valem em qualquer stack, e a violação de qualquer um é reprovação de revisão, não observação.

1. **AEAD sempre.** Cifra sem autenticação é reprovação. Não existe "só um blob de configuração" no perímetro da chave.
2. **Sal e nonce aleatórios por registro e por gravação**, do CSPRNG do sistema operacional. Nenhum valor fixo, nenhum contador, nenhuma derivação determinística de nonce.
3. **Parâmetros de KDF vivem no arquivo, não no código.** Nunca `Default::default()` de terceiro, nunca constante de compilação lida no caminho de abertura. Esta regra é o que torna a troca de default de uma dependência um não-evento.
4. **Comparação de segredo, hash ou tag é em tempo constante.** Sempre.
5. **Não se reimplementa primitiva.** Biblioteca mantida, superfície própria mínima. *Composição de primitivas segundo padrão publicado, com vetores oficiais no CI, não é reimplementar primitiva* — a distinção está na seção 4.3.
6. **Nenhum segredo tem valor padrão.** Ausente = o processo recusa subir.
7. **Segredo não atravessa serialização.** Tipo que carrega segredo não implementa serialização, não deriva `Debug`, não é clonável.
8. **Watermark é argumento obrigatório e tipado.** Não existe default e não existe "assinar bytes".
9. **Falha é `Result`, nunca `panic`/`unwrap`/`assert` no caminho de chave.** Um `.expect()` no caminho do KDF transforma disco cheio em crash de app.
10. **Se a linguagem não permite zerar de verdade, isso vai escrito no código e no modelo de ameaça** — em vez de um comentário afirmando que apaga.

---

## 4. `tz-keys` — ciclo de vida da identidade da chave

### 4.1 Entropia

| Item | Decisão |
|---|---|
| Fonte | **CSPRNG do sistema operacional**, exclusivamente. Linux/Android: `getrandom(2)` (fallback `/dev/urandom` só se o syscall não existir). Windows: `BCryptGenRandom` com `BCRYPT_USE_SYSTEM_PREFERRED_RNG`. |
| Bits, criação nova | **256 bits** → mnemônica de **24 palavras**. |
| Bits, aceitos na importação | 128, 160, 192, 224, 256 (12/15/18/21/24 palavras), porque carteira alheia existe. |
| Proibido | Qualquer PRNG de espaço de usuário com estado próprio, `Math.random`, `java.util.Random`, `rand::thread_rng` sem lastro no SO, e qualquer "mistura" caseira de fontes. |
| Falha | Se a chamada ao CSPRNG falhar, **aborta**. Nunca degrada para outra fonte. |

**Por quê 256 e não 128:** 128 bits já é inquebrável, e a diferença de custo é zero. Mas 24 palavras também comunicam ao usuário que aquilo é o backup real, e a suíte precisa de um formato só para a instrução de backup. É a única razão, e ela é de produto — está escrita para não ser confundida com uma alegação de segurança.

**Este é o único ponto onde um erro produz carteira previsível e silenciosa.** Por isso o critério de aceite 9.1 exige que o relatório de build **nomeie** o RNG efetivamente usado em cada alvo, e não apenas a crate de fachada.

### 4.2 Mnemônica — BIP-39

| Item | Decisão |
|---|---|
| Padrão | BIP-39, wordlist **inglesa** |
| Normalização | NFKD antes de qualquer processamento, em geração e importação |
| Checksum | **Obrigatoriamente validado na importação** — os primeiros ENT/32 bits do SHA-256 da entropia |
| Wordlist | **Obrigatoriamente validada na importação** — toda palavra pertence à wordlist, comparação por índice |
| Contagem de palavras | 12/15/18/21/24. **Contar palavras não é validar** |
| Semente | PBKDF2-HMAC-SHA512, **2048 iterações**, sal = `"mnemonic"` ‖ passphrase BIP-39, saída de **64 bytes** |
| Passphrase BIP-39 ("25ª palavra") | **Aceita na importação. NÃO oferecida na criação na v1** |
| Tempo de vida | A mnemônica existe **na criação e na importação, por milissegundos**. Nunca é rematerializada |

**Por que a validação de checksum é bloqueante e não um aviso:** uma palavra digitada errada que ainda esteja na wordlist gera silenciosamente **outra carteira, válida**, com outro endereço e saldo zero. O usuário conclui que perdeu os fundos. Esse é o defeito exato apontado em `ANALYSIS.md` do Tezzet, e é a diferença entre um erro visível e uma perda irreversível.

**Por que a passphrase BIP-39 não é oferecida na criação:** ela é um segundo segredo que **não está escrito nas 24 palavras**. Um usuário que anota as palavras e esquece a passphrase perde tudo, e o backup parece correto. Aceitar na importação é obrigação (carteiras alheias a usam); oferecer na criação, sem uma cerimônia de backup separada que a v1 não tem, é criar uma armadilha silenciosa. Reentrada: quando houver cerimônia de backup própria para ela.

**Por que 2048 iterações de PBKDF2, se isso é fraco hoje:** porque é o padrão BIP-39 e mudá-lo torna a carteira incompatível com toda a indústria — o usuário não conseguiria restaurar em outra carteira, o que é pior que o risco. A proteção em repouso **não é** este PBKDF2; é o Argon2id do cofre (§5.3). Está escrito aqui para que ninguém confunda os dois e ache que já existe um KDF caro no caminho.

**A mnemônica é formato de backup para humano, não objeto de runtime.** O cofre guarda a **semente de 64 bytes** (ou o escalar de 32 bytes numa chave importada em bruto), e destravar devolve isso — nunca 24 palavras. Esta única regra elimina a classe inteira de "duas cópias da mnemônica na RAM a cada unlock" encontrada no spike.

### 4.3 Derivação

| Item | Decisão |
|---|---|
| Caminho | **`m/44'/1729'/0'/0'`** — BIP-44, `coin_type` 1729 = Tezos. Todos os níveis **endurecidos** |
| Esquema, Ed25519 (`tz1`) | **SLIP-0010** para ed25519: master = HMAC-SHA512(chave `"ed25519 seed"`, dados = semente); filho = HMAC-SHA512(chain code, `0x00` ‖ k_par ‖ ser32(i)), com `i ≥ 2³¹` **sempre** |
| Esquema, secp256k1 (`tz2`) | BIP-32 padrão sobre secp256k1 |
| Esquema, P-256 (`tz3`) | SLIP-0010 para nist256p1 |
| Múltiplas contas | Variar o **último** nível: `m/44'/1729'/0'/0'`, `.../1'`, `.../2'`. Documentado assim porque é o que Ledger, Kukai e Temple usam para Tezos, e compatibilidade de caminho é o que decide se o usuário recupera a carteira em outro cliente |
| Não-endurecido | **Proibido em Ed25519.** SLIP-0010 não define derivação não-endurecida para ed25519, e uma implementação que "aceita" é uma implementação inventada |

**Armadilha nomeada, para não ser descoberta por acidente:** o esquema **BIP32-Ed25519 do Cardano** (crates e pacotes com nome `ed25519-bip32`) **não é** SLIP-0010 e produz endereços diferentes a partir da mesma mnemônica. Escolher a biblioteca errada aqui gera uma carteira que nenhuma outra carteira Tezos consegue restaurar. Isso **DEVE** ser barrado por vetor de teste, não por atenção do revisor.

**Sobre implementar a derivação em casa.** SLIP-0010 endurecido é uma cadeia de HMAC-SHA512 — na ordem de 30 linhas. Isso **não é reimplementar primitiva** (o HMAC e o SHA-512 vêm de biblioteca); é compor segundo padrão publicado. Como a seção 12.2 mostra, todas as bibliotecas de derivação disponíveis hoje são de mantenedor único, poucas estrelas, ou com repositório fora do ar — depender delas é pior. **Decisão: composição própria, condicionada a (a) vetores oficiais do SLIP-0010 no CI, (b) o cruzamento independente do §9.2, e (c) revisão de Tezos Core & Crypto.** Sem os três, volta a ser reimplementação e é reprovada.

### 4.4 Curvas, endereços e codificação

| Curva | Endereço | Padrão da suíte |
|---|---|---|
| **Ed25519** | `tz1` | **Padrão para toda carteira criada pela suíte** |
| **secp256k1** | `tz2` | **Importação apenas** |
| **P-256** | `tz3` | **Importação apenas** |
| **BLS12-381** | `tz4` | Posição na §4.7 |
| **ML-DSA-44** | `tz5` | Posição na §4.7 |

**Endereço** = base58check(prefixo ‖ **BLAKE2b-160** (20 bytes) da chave pública serializada). Chave pública serializada = 32 bytes para Ed25519, 33 bytes comprimidos para secp256k1 e P-256.

**Prefixos**, lidos de `octez` `src/lib_crypto/base58.ml` em 2026-08-27 e reproduzidos aqui como norma:

| Objeto | Prefixo (bytes) | Renderiza |
|---|---|---|
| Hash de chave pública Ed25519 | `06 A1 9F` | `tz1…` (36 car.) |
| Hash de chave pública secp256k1 | `06 A1 A1` | `tz2…` |
| Hash de chave pública P-256 | `06 A1 A4` | `tz3…` |
| Hash de chave pública BLS12-381 | `06 A1 A6` | `tz4…` |
| Hash de chave pública ML-DSA-44 | `06 A1 A9` | `tz5…` |
| Chave pública Ed25519 | `0D 0F 25 D9` | `edpk…` |
| **Semente** Ed25519 (32 B) | `0D 0F 3A 07` | `edsk…` (54 car.) |
| **Chave secreta** Ed25519 (64 B) | `2B F6 4E 07` | `edsk…` (98 car.) |
| Assinatura Ed25519 | `09 F5 CD 86 12` | `edsig…` |
| Assinatura genérica | `04 82 2B` | `sig…` |
| `chain_id` | `57 52 00` | `Net…` |

**Nota que já causou bug em produção em outros projetos:** `edsk` tem **dois** prefixos diferentes — 32 bytes (semente) e 64 bytes (chave expandida). Um decodificador que só olha o texto `edsk` e não confere o comprimento aceita um pelo outro. O decodificador **DEVE** casar prefixo **e** comprimento, e recusar o que não bate.

**Validação de endereço** (usada nas duas UIs, e hoje quebrada nos dois sistemas — o TAPS rejeita `tz4`): checar prefixo conhecido, comprimento, e **checksum base58check**. Um endereço com um caractere trocado que passe só por regex vira fundos perdidos.

### 4.5 Assinatura

Tezos assina o **digest**, não a mensagem. A composição, conferida em `octez` `src/lib_crypto/ed25519.ml:329-334`:

```
assinatura = Sign(sk, BLAKE2b-256(watermark ‖ mensagem))
```

| Curva | Regras |
|---|---|
| Ed25519 | Ed25519 padrão (RFC 8032), determinístico por construção |
| secp256k1 | ECDSA com nonce determinístico **RFC 6979**, e **normalização low-S obrigatória** |
| P-256 | ECDSA com nonce determinístico **RFC 6979**, e **normalização low-S obrigatória** |

**Por que low-S é obrigatório:** sem normalizar, `(r, s)` e `(r, n−s)` são as duas assinaturas válidas da mesma mensagem — maleabilidade. Num sistema de payout que decide idempotência olhando o que já foi enviado, duas representações da mesma coisa é uma classe de bug de dinheiro.

### 4.6 Watermark — o argumento que não tem default

Valores conferidos em `octez` `src/lib_crypto/signature_v1.ml:766-772`:

| Tipo de payload | Watermark |
|---|---|
| Operação genérica | `0x03` |
| Cabeçalho de bloco | `0x01` ‖ `chain_id` (4 bytes) |
| Attestation (ex-endorsement) | `0x02` ‖ `chain_id` (4 bytes) |
| `Custom` | bytes arbitrários, **sem tag** |

Regras normativas:

1. O watermark é **parâmetro obrigatório e tipado** da função de assinar. Não existe valor default e não existe sobrecarga que o omita.
2. A v1 da suíte assina **apenas** operação genérica (`0x03`). Bloco e attestation existem no perfil de baker e **não** entram na v1; a API os aceita somente com `chain_id` explícito, nunca inferido.
3. **`Custom` é proibido na v1.** É o buraco por onde "assinar uma mensagem" vira "transferir fundos". Habilitá-lo exige nova passada desta especificação.
4. Assinatura de mensagem para login em dApp **NÃO DEVE** usar watermark de operação. O caminho correto é Micheline empacotado (prefixo `0x05`), e a v1 **recusa** até existir caso de uso escrito.
5. O núcleo **recusa assinar bytes arbitrários**. Ele recebe uma operação forjada e conferida localmente, nunca bytes prontos vindos de um RPC.

### 4.7 Posição sobre `tz4` (BLS) e `tz5` (ML-DSA)

**`tz4` — suporte de leitura na v1; assinatura fora da v1.**

- **Leitura obrigatória agora:** validar, exibir e **enviar para** endereços `tz4`. O TAPS hoje rejeita `tz4` na validação de endereço, o que significa recusar pagar um delegador legítimo. Isso é defeito, não escopo futuro.
- **Assinar com `tz4` fica fora da v1.** BLS12-381 acrescenta uma primitiva grande ao perímetro auditado, e a única biblioteca madura disponível (`blst`) é C com FFI. O ganho para uma carteira de usuário e para um payout é hoje inexistente — `tz4` serve a agregação de assinaturas e a casos de consenso/rollup.
- **Condição de reentrada, escrita:** quando houver demanda concreta de produto (uma operação da suíte que exija chave `tz4`), com auditoria do FFI incluída no escopo.

**`tz5` — registrado, não suportado.** O `octez` já tem prefixo para ML-DSA-44 (`06 A1 A9`, chave pública `mdpk`, assinatura `mdsig`). É a entrada pós-quântica do ecossistema. **A suíte não implementa `tz5` na v1** e o decodificador de endereço **DEVE** reconhecê-lo como prefixo válido e recusar explicitamente ("tipo de endereço ainda não suportado"), em vez de tratar como endereço malformado. A diferença importa: uma é mensagem correta, a outra é um bug reportado como corrupção de dados.

### 4.8 Rotação e destruição

**Rotação de passphrase:** re-deriva `KEK_pass` com sal novo e re-embrulha a DEK. O corpo não é redecifrado. **Ressalva que precisa estar escrita:** trocar a passphrase **não** protege contra uma cópia antiga do arquivo que já tenha vazado — aquela cópia continua abrindo com a senha antiga. Só a rotação da chave em si resolve, e ela é a próxima linha.

**Rotação da DEK:** acontece em toda regravação do corpo. Barata, e limita o alcance de uma DEK que tenha ficado exposta em RAM.

**Rotação da chave Tezos: não existe.** Em Tezos, para `tz1`, o endereço **é** o hash da chave pública. "Rotacionar a chave" significa criar outra carteira e **mover os fundos**, com todas as consequências operacionais (revelação da nova conta, atualização do delegador, atualização da chave de payout do baker). Isso **DEVE** estar dito na UI com essas palavras, porque a expectativa importada de outros sistemas ("é só trocar a senha") é falsa aqui.

**Destruição.** Apagar o arquivo do cofre e apagar a chave do sistema operacional (`KEK_hw`). **O que isso realmente garante:** o material vira inútil para quem não tem a passphrase — é *crypto-erasure*, e é a única forma de destruição confiável em armazenamento flash, onde sobrescrever não garante nada (wear leveling, cópia-na-escrita, blocos remapeados). **O que isso não garante:** que não exista cópia do arquivo num backup, e que a passphrase não esteja comprometida. Um "apagar carteira" que promete mais que isso está mentindo.

---

## 5. `tz-vault` — o cofre, byte a byte

### 5.1 Desenho em uma figura

```
arquivo do cofre ── AEAD ── DEK (32 B aleatória)  ← cifra o segredo (semente/escalar)
                              ▲ embrulhada N vezes, independentes:
   (A) KEK_pass = Argon2id(passphrase, sal, params do header)   ← SEMPRE presente; raiz de recuperação
   (B) KEK_hw   = chave do SO respaldada por hardware           ← conveniência; opcional por plataforma
   (C) KEK_prf  = WebAuthn `prf` / CTAP2 `hmac-secret`          ← RESERVADO; entra sem migração
```

**O ponto criptográfico que decide o desenho inteiro: biometria não decifra nada.** Digital não é chave. O que toda plataforma que faz isso direito oferece é: o SO guarda uma chave em hardware (TEE/TPM) e **libera o uso dela** após uma verificação de usuário bem-sucedida. Biometria é sempre **portão sobre chave guardada em hardware**, nunca entrada de KDF. É por isso que (A) sempre existe: é o único fator que sobrevive a wipe do aparelho, a digital reenrolada, a aparelho perdido.

Perder (B) não custa nada: cai em (A).

### 5.2 Formato do arquivo

Todos os inteiros são **little-endian**. Todos os offsets em hexadecimal.

**Header — 48 bytes, tamanho fixo**

| Offset | Tam. | Campo | Valor / regra |
|---|---|---|---|
| `0x00` | 6 | `magic` | `54 5A 56 4C 54 00` (`"TZVLT\0"`) |
| `0x06` | 1 | `format_version` | `0x01` |
| `0x07` | 1 | `kdf_id` | `0x01` = Argon2id, versão `0x13` |
| `0x08` | 1 | `profile_id` | `0x01` = `v1-mobile`, `0x02` = `v1-desktop` |
| `0x09` | 1 | `aead_id` | `0x01` = XChaCha20-Poly1305, `0x02` = AES-256-GCM |
| `0x0A` | 1 | `wrap_count` | 1 a 3 |
| `0x0B` | 1 | `reserved` | `0x00`. Leitor **recusa** valor diferente |
| `0x0C` | 4 | `argon2_m_kib` | memória em KiB |
| `0x10` | 4 | `argon2_t` | passagens |
| `0x14` | 4 | `argon2_p` | paralelismo |
| `0x18` | 16 | `kdf_salt` | **aleatório por cofre**, do CSPRNG do SO |
| `0x28` | 8 | `created_at` | segundos Unix. Metadado, não secreto |

**Tabela de embrulhos — `wrap_count` entradas, 76 bytes + `ctx_len` cada**

| Offset | Tam. | Campo | Regra |
|---|---|---|---|
| `+0x00` | 1 | `wrap_type` | `0x01` = `KEK_pass`, `0x02` = `KEK_hw`, `0x03` = `KEK_prf` (reservado) |
| `+0x01` | 1 | `wrap_flags` | bit 0 = obrigatório na abertura |
| `+0x02` | 2 | `ctx_len` | comprimento do contexto opaco |
| `+0x04` | 24 | `wrap_nonce` | **aleatório por gravação** |
| `+0x1C` | 32 | `wrapped_dek` | ciphertext da DEK |
| `+0x3C` | 16 | `wrap_tag` | tag de autenticação |
| `+0x4C` | `ctx_len` | `ctx` | alias da chave no Keystore, handle do TPM, credential id do WebAuthn. **Nunca segredo** |

Cada embrulho: `AEAD(chave = KEK_x, nonce = wrap_nonce, aad = header ‖ wrap_type ‖ wrap_flags ‖ ctx, texto = DEK)`.

**Corpo**

| Offset | Tam. | Campo |
|---|---|---|
| `+0x00` | 24 | `body_nonce` — **aleatório por gravação** |
| `+0x18` | 4 | `body_len` — comprimento do ciphertext, sem a tag |
| `+0x1C` | `body_len` | `body_ct` |
| — | 16 | `body_tag` |

Corpo: `AEAD(chave = DEK, nonce = body_nonce, aad = header ‖ tabela de embrulhos inteira, texto = payload)`.

**Payload em claro — sempre 128 bytes, com preenchimento**

| Offset | Tam. | Campo |
|---|---|---|
| `0x00` | 1 | `payload_version` = `0x01` |
| `0x01` | 1 | `secret_kind` — `0x01` semente BIP-39 (64 B), `0x02` escalar Ed25519 (32 B), `0x03` secp256k1 (32 B), `0x04` P-256 (32 B) |
| `0x02` | 1 | `curve` — `0x01` Ed25519, `0x02` secp256k1, `0x03` P-256 |
| `0x03` | 1 | `deriv_scheme` — `0x01` SLIP-0010 endurecido, `0x00` chave importada sem derivação |
| `0x04` | 1 | `path_len` — níveis, ≤ 8 |
| `0x05` | 32 | `path` — 8 × u32, já com o bit endurecido; níveis não usados = `0` |
| `0x25` | 64 | `secret` — alinhado à esquerda; bytes não usados = `0` |
| `0x65` | 27 | `pad` — zeros |

**Por que o payload é sempre 128 bytes:** sem preenchimento, o tamanho do arquivo distingue uma semente de 64 bytes de um escalar de 32 e, por consequência, denuncia o tipo de carteira. Custa 27 bytes e fecha um canal de metadado de graça.

### 5.3 Perfis de KDF

**Argon2id, versão `0x13`, saída de 32 bytes, sal de 16 bytes aleatório por cofre.**

| Perfil | `profile_id` | Memória | `t` | `p` | Alvo |
|---|---|---|---|---|---|
| `v1-mobile` | `0x01` | **64 MiB** | **3** | **4** | Android |
| `v1-desktop` | `0x02` | **256 MiB** | **3** | **4** | Linux, Windows |

**Números medidos** — `argon2` 0.6.0, build release, WSL2, 8 vCPU, 15 GiB RAM, melhor de 3 execuções, 2026-08-27:

| Configuração | 1 thread | 4 threads (rayon) |
|---|---:|---:|
| Piso OWASP (19 MiB, t=2, p=1) | 21,7 ms | 26,1 ms |
| **`v1-mobile` (64 MiB, t=3, p=4)** | **205,1 ms** | **90,4 ms** |
| `v1-mobile+` (128 MiB, t=3, p=4) | 404,9 ms | 169,9 ms |
| **`v1-desktop` (256 MiB, t=3, p=4)** | **853,9 ms** | **333,0 ms** |
| RFC 9106, 1ª opção (2 GiB, t=1, p=4) | 2841,3 ms | 1765,4 ms |

Medição anterior, mesma configuração, `argon2` 0.5 single-thread (BRES-36): 170 ms e 751 ms. A variação entre as duas medidas é de carga da máquina, não de algoritmo; a ordem de grandeza é a mesma e é ela que decide.

**Justificativa dos números:**

- `v1-mobile` = **a segunda opção recomendada da RFC 9106 §4**, literalmente (t=3, p=4, m=2¹⁶ KiB). Também é o default do Bitwarden. Cabe em qualquer Android moderno sem risco de o *low memory killer* matar o app, e é ordens de grandeza mais caro que o piso da OWASP quando se multiplica memória × tempo.
- `v1-desktop` = 256 MiB porque desktop tem RAM e o usuário está no teclado. **Memória é o botão que encarece ataque com GPU**, não `t`; subir `t` custa o mesmo para nós e para o atacante, subir `m` custa desproporcionalmente mais para quem paraleliza.
- A 1ª opção da RFC (2 GiB) foi **rejeitada**: 2,8 s no desktop e inviável em mobile, e a suíte precisa de um único formato de arquivo que abra nos dois.
- **`p` é parâmetro da função, não dica de threading.** Mudar `p` muda o hash. Fica em 4 e não se mexe.

**Para calibrar:** o cofre de hoje no spike custa Argon2id 19 MiB **mais** scrypt com `N = 2¹⁹, r = 8` (512 MiB, ~1,72 s medidos) da camada `age` do Stronghold — nenhum desses parâmetros escolhido por nós, e os 512 MiB são a causa provável da lentidão de 45–60 s no Android. O desenho desta especificação é **mais barato** e ao mesmo tempo **nosso, versionado e medível**.

### 5.4 AEAD

| Item | Decisão |
|---|---|
| Padrão | **XChaCha20-Poly1305** (`aead_id = 0x01`) |
| Chave | 256 bits |
| Nonce | **24 bytes, aleatórios por gravação** |
| Tag | 16 bytes |
| Alternativa aceita | AES-256-GCM (`aead_id = 0x02`), **somente** com nonce de 12 bytes aleatório e limite de 2³² gravações por chave |
| Política de nonce | Aleatório a cada gravação, sempre. **Nunca** contador, **nunca** derivado do conteúdo, **nunca** reutilizado numa regravação. Se o CSPRNG falhar, **aborta** |

**Por que XChaCha20 e não AES-GCM como padrão:** o nonce de 24 bytes torna a colisão por acaso irrelevante (~2⁹⁶ de margem), o que permite gerar nonce aleatório sem contabilidade de estado — e contabilidade de estado é exatamente o que se erra. Além disso, ChaCha20 não depende de AES-NI, o que importa num Android de entrada. AES-256-GCM continua aceito porque em algumas plataformas ele é o que o hardware acelera; com nonce de 12 bytes aleatório o limite de 2³² gravações é folgado para um cofre, mas o limite **precisa estar escrito** para não ser descoberto depois.

**Não existe hash de verificação separado.** A tag do AEAD **é** a verificação da senha: senha errada → `KEK_pass` errada → o desembrulho da DEK falha na tag. Isso substitui o `walletHash` SHA-512 do TAPS por algo que é ao mesmo tempo mais forte e mais simples, e elimina de vez a comparação com `===`.

### 5.5 Comparações e tempo constante

Nenhum caminho compara segredo, hash ou tag com igualdade de linguagem. A verificação de tag é feita **dentro** da biblioteca de AEAD, que já é de tempo constante. Onde uma comparação própria for inevitável (por exemplo, casar `ctx` de embrulho), usa-se comparação de tempo constante.

**O erro que isto elimina:** `wallet-encryption.service.ts:138-139`.

### 5.6 Validação de faixa dos parâmetros — a sutileza que importa

Os parâmetros do KDF vivem no header, e o header é AAD — portanto adulteração quebra a tag. **Mas o KDF roda antes de a tag ser verificada.** Um atacante com escrita no arquivo pode então: (a) pedir 8 GiB de memória e derrubar o processo, ou (b) pedir 8 KiB e observar o comportamento.

Regra normativa: **antes de rodar o KDF**, o leitor **DEVE** validar:

| Campo | Faixa aceita |
|---|---|
| `argon2_m_kib` | 19.456 (19 MiB) ≤ m ≤ 1.048.576 (1 GiB) |
| `argon2_t` | 1 ≤ t ≤ 10 |
| `argon2_p` | 1 ≤ p ≤ 8 |
| `profile_id` | Pertence à tabela de perfis conhecidos |
| Coerência | Os três valores **DEVEM** ser exatamente os do perfil declarado em `profile_id` |

Fora da faixa: recusa, sem rodar KDF, com erro tipado. O parâmetro no header existe para **subir** o custo no futuro sem quebrar cofre antigo, não para o arquivo mandar no processo.

### 5.7 Reencriptação oportunista

Ao abrir com sucesso: se `profile_id` do header for **menor** que o perfil corrente da plataforma, o cofre é **regravado** com o perfil corrente, na hora, sem perguntar. Nova DEK, novos nonces, novo sal.

Não existe migração manual, não existe tela de "atualize seu cofre", não existe cofre antigo que fica para trás porque o usuário não clicou. Subir os parâmetros no futuro passa a ser trocar uma constante.

### 5.8 Gravação atômica

Um cofre corrompido **é** fundo perdido. Toda gravação:

1. Escreve num arquivo temporário no **mesmo diretório** (mesmo sistema de arquivos).
2. `fsync` no arquivo temporário.
3. `rename` atômico sobre o destino.
4. `fsync` no diretório.
5. Só então o arquivo antigo deixa de existir.

Se qualquer passo falhar, o cofre anterior continua íntegro e a operação retorna erro. **Nunca** se trunca o arquivo original para escrever por cima.

### 5.9 Estado em memória do cofre aberto

Quando aberto, o processo mantém: a DEK (32 B) e o escalar da chave (32 B). **Não** mantém: a passphrase, a `KEK_pass`, a mnemônica, a semente de 64 bytes depois da derivação.

O cofre fecha e todo esse material é zerado em: bloqueio manual, *timeout* de inatividade (padrão **5 minutos**, configurável entre 1 e 30), suspensão/hibernação do sistema, o app ir para segundo plano no Android, e encerramento do processo.

---

## 6. Armazenamento e fator por plataforma

As respostas são diferentes por plataforma e a especificação admite isso em vez de inventar simetria.

### 6.1 Linux

| Item | Decisão |
|---|---|
| Local | `$XDG_DATA_HOME/tz-vault/<id>.vault` (padrão `~/.local/share/tz-vault/`) |
| Permissões | Arquivo `0600`, diretório `0700`, verificadas na abertura; recusa se estiverem mais frouxas |
| Perfil | `v1-desktop` |
| Embrulhos | **Somente `KEK_pass`.** Sem `KEK_hw` na v1 |
| Prompt | Diálogo GTK nativo, campo em modo senha, na thread principal |
| Backup | O diretório é documentado como "não sincronize sem entender o que está aqui" |

**Por que só passphrase no Linux, dito sem rodeio:** não existe equivalente ao Keystore/Hello. As opções reais são (i) só passphrase, (ii) o Secret Service / `libsecret`, que é destravado pela sessão de login — qualquer processo da sessão pede e recebe, portanto **mais fraco** que a passphrase que ele substituiria, e (iii) chave selada no TPM2 via `tpm2-tss`, que funciona na maioria dos laptops modernos, é trabalho de verdade e falha em máquina sem TPM. **v1 = só passphrase. TPM2 é caminho opcional posterior, e entra como `KEK_hw` sem mudar o formato.** Não se inventa história de biometria para Linux.

**Ressalva de N6 repetida aqui porque é onde ela morde:** sob X11 o diálogo GTK não está protegido contra keylogger de outro cliente X; sob Wayland está.

### 6.2 Windows

| Item | Decisão |
|---|---|
| Local | `%LOCALAPPDATA%\TezosSuite\vault\<id>.vault` |
| Permissões | ACL só-dono, herança desabilitada |
| Perfil | `v1-desktop` |
| Embrulhos | `KEK_pass` + `KEK_hw` |
| `KEK_hw` | **`KeyCredentialManager`** (Windows Hello), que devolve uma **chave respaldada por TPM**, não um booleano |
| Prompt | `UserConsentVerifier.RequestVerificationAsync` — diálogo nativo do Hello (face, digital ou **PIN do Hello**) |
| Backup | Excluído dos perfis de sincronização; nunca em `%APPDATA%` roaming |

**Por que `KeyCredentialManager` e não DPAPI:** DPAPI é destravado pela sessão de login — sem portão de verificação de usuário e sem contador de bloqueio. É o mesmo defeito estrutural do Secret Service no Linux. O `KeyCredentialManager` dá chave em TPM com anti-hammering do próprio TPM, que é o que faz o PIN de 6 dígitos ser defensável.

**Por que isso cobre máquina sem câmera nem leitor:** o Hello **PIN** funciona sem hardware biométrico e continua respaldado pelo TPM.

### 6.3 Android

| Item | Decisão |
|---|---|
| Local | `filesDir` privado do app. **Nunca** armazenamento externo |
| Backup | `android:allowBackup="false"` **e** `dataExtractionRules` excluindo o diretório do cofre |
| Perfil | `v1-mobile` |
| Embrulhos | `KEK_pass` + `KEK_hw` |
| `KEK_hw` | Chave AES-256-GCM no **AndroidKeyStore**, com `setUserAuthenticationRequired(true)`, `setInvalidatedByBiometricEnrollment(true)`, `setUserAuthenticationParameters(0, AUTH_BIOMETRIC_STRONG \| AUTH_DEVICE_CREDENTIAL)`, e `setIsStrongBoxBacked(true)` quando o aparelho oferecer |
| Prompt | `BiometricPrompt` — diálogo do SO; a webview não lê nem imita |
| Telas | `FLAG_SECURE` em **toda** tela que mostre mnemônica, endereço destravado ou saldo |
| Relatório | O app **DEVE** registrar `KeyInfo.getSecurityLevel()` do aparelho. StrongBox não é obrigatório; **TEE basta**. Obrigatório é o app **saber e dizer** qual dos dois |

**A demonstração que vale é negativa** (ADR-0001 §3.1.3): matar o app, negar o prompt biométrico e mostrar **falha de desembrulho** — não uma tela que não abre. E puxar o arquivo por `adb` mostrando-o opaco. Uma trava que é visibilidade de layout é exatamente o achado do Tezzet reimportado com nome melhor.

**Permissões:** `WRITE_EXTERNAL_STORAGE` sai do manifesto. O app não escreve em armazenamento externo e nunca deve.

### 6.4 Web

**Posição: a v1 da suíte não guarda chave no navegador.** A superfície web é somente-leitura mais Beacon/WalletConnect, com a assinatura acontecendo na carteira do usuário, fora do nosso código.

**Por quê, sem meio-termo:** num navegador, um único XSS tem acesso a tudo que a página tem. Não há fronteira de processo entre o código que vê a chave e o código que não vê — e é justamente essa fronteira que o resto desta especificação usa como estrutura. Guardar chave quente ali é escolher o único ambiente onde nenhuma das mitigações da §7 existe.

**Se e quando isso mudar**, as regras mínimas, escritas agora: cofre em IndexedDB (nunca `localStorage`); DEK nunca persistida; chaves de sessão como `CryptoKey` **não-extraível** do WebCrypto; `KEK_prf` do WebAuthn como único embrulho de hardware aceitável; e o modelo de ameaça reescrito, porque N1 deixa de ser "malware no aparelho" e passa a ser "qualquer script na página".

**CSP — o perímetro fica sob esta especificação:**

```
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:;
connect-src 'self' <RPC configurado> <indexador configurado>;
frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'none'
```

Sem `'unsafe-inline'` em lugar nenhum — o TAPS hoje o permite em `styleSrc`, e isso sai. Em shell Tauri, a modificação de CSP do asset protocol permanece **desabilitada**.

---

## 7. Memória

### 7.1 As quatro camadas, obrigatórias

1. **`mlock` / `VirtualLock` nas páginas de segredo.** Impede que a semente vá parar em swap, arquivo de hibernação ou dump. É o que converte um vazamento **permanente em disco** num vazamento **transitório em RAM** — a única camada que muda de categoria. Referência de setor: `sodium_mlock` do libsodium, `LockedPool` do Bitcoin Core (desde 2013), gpg-agent.
2. **Core dump desligado.** `setrlimit(RLIMIT_CORE, 0)` no Linux/Android; WER desabilitado para o processo no Windows. O vazamento acidental de semente mais comum do mundo é um arquivo de crash.
3. **Tipos de tamanho fixo que nunca realocam**, com zeroização no drop. Nunca buffer que cresce, nunca formatação de string, nunca serialização, nunca `Debug` derivado, nunca clonável.
4. **A mnemônica só existe na criação e na importação.** O cofre guarda semente ou escalar. Destravar devolve isso. Esta regra sozinha elimina a maior fonte de cópias.

### 7.2 O que "zerar" quer dizer em cada linguagem candidata

| Linguagem | O que é possível | O que precisa estar escrito |
|---|---|---|
| **Rust** | Real. Array de tamanho fixo com zeroização no drop, escrita volátil com barreira de compilador, `mlock` via libc. | Depender de uma crate de zeroize **não é** zerar: a forma verificável é o **tipo** — sem clonagem, sem cópia implícita, sem serialização, sem `Debug` derivado. |
| **Kotlin / Java** | **Parcial.** `ByteArray`/`CharArray` são sobrescrevíveis; `String` **não é** — é imutável e vive no heap até o GC, que ainda pode tê-la copiado ao compactar. | Segredo **nunca** em `String`. O GC pode ter deixado cópias que nenhum código alcança — **isso vai escrito no modelo de ameaça, não maquiado**. É exatamente o defeito do Tezzet de hoje. |
| **TypeScript / JavaScript** | **Praticamente nenhuma.** `String` é imutável; o GC copia; não há `mlock`. `Uint8Array` pode ser sobrescrito, mas o motor pode ter movido o buffer. | Nenhum segredo de longo prazo em JS. É a razão estrutural da fronteira do §6.4 e da política do §8.2. O laço sobre uma string imutável do TAPS (`clearSensitiveData()`) é o exemplo canônico de placebo. |
| **Swift / Objective-C** | Fora de escopo (ADR-0001 §8). | — |

### 7.3 O que é impossível, dito como impossível

Não existe, em sistema operacional de propósito geral, prova de que não sobrou cópia do segredo em RAM. O alocador realoca, o coletor copia, o compilador otimiza, o kernel migra páginas. **Obrigatório** é: trancar a memória, matar core dump, tipos fixos, mnemônica só na criação. **Impossível** é a garantia. É por isso que o teto de segurança de qualquer carteira em software é um assinador em hardware — e é por isso que a §11 recomenda o que recomenda para o TAPS.

---

## 8. Verificação de usuário — login e PIN

O modelo é o do banco, e ele foi escolhido por Rafael no thread de BRES-36: **verificação para entrar, PIN para transacionar.** Ele é o mesmo nas três plataformas; o que muda é o mecanismo por baixo, e a UI admite isso.

### 8.1 Política (d) — a regra

> **Toda assinatura exige verificação de usuário nativa. Biometria é substituto aceito do PIN onde a plataforma oferece prompt respaldado por hardware. Onde não oferece, o mecanismo é o PIN em janela nativa. Nunca cai em silêncio.**

Não existe `if (biometria_disponível)`. **Ausência de mecanismo não é permissão — é erro.** O portão é "uma verificação de usuário nativa teve sucesso", e essa é a proposição que o código testa.

### 8.2 Prompt nativo — obrigatório, não melhoria

Passphrase e PIN **NÃO DEVEM** ser coletados por HTML. Segredo digitado numa webview é inútil contra a ameaça que motivou a fronteira.

**Consequência direta e verificável na API:** nenhum comando da fronteira aceita senha como parâmetro. Depois desta mudança, `create_wallet`, `unlock` e `sign` **não recebem senha nenhuma** — o núcleo coleta.

Custo honesto por plataforma: Android, de graça (`BiometricPrompt` já é do SO). Windows, moderado e documentado. **Linux, nós escrevemos** — diálogo GTK, ordem de 100–200 linhas, com cuidado de foco e *grab*, e com a ressalva N6 escrita.

### 8.3 Login (entrar)

Destrava o cofre: `KEK_hw` onde existe (Android, Windows), `KEK_pass` sempre disponível como caminho de recuperação. Depois de um `KEK_hw` bem-sucedido, a DEK está em memória e a sessão está aberta pelo *timeout* do §5.9.

### 8.4 PIN de transação

Criado no primeiro acesso, junto com a carteira.

**A restrição que precisa estar escrita: um PIN de 6 dígitos vale ~20 bits.** 10⁶ tentativas é questão de segundos, mesmo atrás de Argon2id. Portanto:

| Regra | Detalhe |
|---|---|
| O PIN **nunca** é proteção em repouso | Ele não deriva chave, não embrulha DEK, não entra em KDF |
| O PIN é **portão online com contador de bloqueio no SO** | Android: limite de tentativas no Keystore. Windows: anti-hammering do TPM via Hello |
| **No Linux o contador é software e isso é *advisory*** | Está escrito assim, e o modelo de ameaça o registra |
| O PIN é conferido **dentro do núcleo**, no caminho de assinar | Nunca no TypeScript, nunca numa camada de UI |
| O PIN é coletado por **prompt nativo** | `<input>` HTML não acrescenta nada contra o XSS que motivou o §8.2 |
| O PIN **nunca é armazenado** | Ele destrava a chave em hardware; a verificação e o contador são do sistema operacional |

### 8.5 Unificação — o que é compartilhado e o que não é

**Compartilhado entre Tezzet e TAPS:** a cerimônia. Prompt nativo sempre, separação login × PIN, verificação nativa sem fallback silencioso, mesma gramática de erro, mesma política de sessão e *timeout*. O baker que usa os dois produtos não aprende duas coisas.

**Não compartilhado:** o mecanismo por baixo (Keystore, Hello, só passphrase) e — isto é o limite duro — **o modelo de custódia**. "Mesma interface de login" nunca vira "a mesma credencial assina dinheiro". A sessão do operador autoriza o console do TAPS; ela não autoriza payout.

---

## 9. Critérios de aceite

Nenhum item abaixo é satisfeito por inspeção. Todos são testes que rodam no CI e falham em vermelho.

### 9.1 Entropia
O relatório de build de cada alvo **nomeia** a chamada de sistema que produziu os bits (`getrandom(2)`, `BCryptGenRandom`), não apenas a biblioteca de fachada. Teste de falha: com o CSPRNG indisponível, a criação de carteira **falha** — não cai em outra fonte.

### 9.2 Mnemônica e derivação
- Vetores oficiais BIP-39 (Trezor) completos, incluindo **casos de checksum inválido que devem ser rejeitados**.
- Vetores oficiais **SLIP-0010** para ed25519 e nist256p1.
- **Cruzamento independente (P8 da ADR):** a partir de mnemônica de teste publicada, derivar `m/44'/1729'/0'/0'` e mostrar que `tz1…` e `edpk…` batem com `InMemorySigner` do Taquito **ou** com `octez-client`. Conferir contra si mesmo não conta.
- Teste negativo explícito: derivação estilo **Cardano** (BIP32-Ed25519) produz endereço **diferente** — o teste fixa qual é o nosso.

### 9.3 Endereço e codificação
- Vetores de ida e volta para `tz1`, `tz2`, `tz3`, `tz4`, `KT1`, `edpk`, `edsk` (32 B), `edsk` (64 B), `edsig`.
- `tz5` é reconhecido e **recusado com erro tipado de "não suportado"**, não como endereço malformado.
- Checksum base58check inválido é rejeitado. Um caractere trocado nunca passa.

### 9.4 Assinatura e watermark
- Assinatura sobre bytes de operação conhecidos **bate com `octez-client`**.
- Chamar a função de assinar **sem** watermark não compila, ou não existe a sobrecarga.
- `Custom` recusado.
- secp256k1 e P-256: teste de normalização low-S sobre vetor que produz S alto.

### 9.5 Cofre
- Senha errada → falha, com **erro indistinguível** de arquivo adulterado (nenhum oráculo).
- Um bit virado em qualquer posição — header, `ctx`, embrulho, corpo — → falha de abertura. Teste varre todas as regiões.
- Parâmetros fora da faixa do §5.6 → recusa **sem rodar o KDF** (medido por tempo).
- 10.000 gravações → 10.000 nonces distintos, `body` e `wrap`.
- Reencriptação oportunista: cofre `v1-mobile` aberto no desktop vira `v1-desktop`; o arquivo antigo, guardado em cópia, continua abrindo.
- Gravação atômica: interrupção simulada em cada passo do §5.8 deixa um cofre íntegro.
- **Fuzzing do parser do cofre** — nenhuma entrada causa pânico, laço infinito ou alocação ilimitada.
- Android: negar o prompt biométrico faz o **desembrulho falhar**; o arquivo puxado por `adb` é opaco.

### 9.6 Memória — o scanner do spike vira portão
Depois de `unlock` + assinatura, um varredor sobre o dump do processo mostra:

- **zero** sequências da wordlist BIP-39;
- **zero** ocorrências do material `edsk`;
- **e o controle positivo é obrigatório:** o **endereço** e a **chave pública** **DEVEM** aparecer no dump.

Sem o controle positivo, um dump vazio passa por engano — o varredor pode estar simplesmente lendo a região errada. Este teste é o melhor subproduto do spike BRES-36 e entra como **regressão permanente**, não demonstração de uma vez.

### 9.7 Fronteira
- Enumeração exaustiva da superfície de comandos, com o tipo de retorno de cada um, **incluindo o ramo de erro**.
- Nenhum tipo que carrega segredo é serializável — teste de **compilação que deve falhar**.
- Caminho de erro e de log auditados, com uma operação deliberadamente falha mostrando o que chega à camada de UI.
- Tudo isso no CI, falhando quando um comando novo passar a devolver segredo.

### 9.8 Cadeia de suprimento
- Lockfile commitado e fixado; nenhuma dependência do caminho da chave com faixa aberta.
- `cargo audit`/`cargo deny` e `npm audit` **bloqueantes** — `continue-on-error: true` é proibido no portão de segurança.
- Portão de lint: nenhuma ocorrência de construção de parâmetro de KDF a partir de default de biblioteca no caminho de abertura.
- Revisão humana obrigatória de Tezos Core & Crypto em qualquer bump das dependências da §12.

---

## 10. Anti-catálogo — o que esta especificação proíbe por nome

Escrito assim para que uma revisão possa ser feita com esta lista na mão.

| # | Proibido | Onde já aconteceu |
|---|---|---|
| 1 | Sal fixo, literal, por instalação ou derivado do usuário | TAPS `wallet-encryption.service.ts:151,182` |
| 2 | Cifra sem autenticação (CBC, CTR, ECB puros) no perímetro da chave | TAPS `:28,157` |
| 3 | Hash rápido (SHA-2/SHA-3 de uma rodada) como verificador de senha | TAPS `:121-128` |
| 4 | Comparação de segredo com igualdade de linguagem | TAPS `:138-139` |
| 5 | Guardar as duas camadas da "dupla criptografia" no mesmo lugar | TAPS, `schema.prisma` |
| 6 | Coluna curta demais para o que guarda (`VarChar(255)`) | TAPS, `encryptedPassphrase` |
| 7 | Função que afirma limpar memória e não limpa | TAPS `clearSensitiveData()`; Tezzet `myWallet = null` |
| 8 | Trava de carteira que é visibilidade de UI | Tezzet `WalletActivity` |
| 9 | Mnemônica em campo de texto padrão | Tezzet `NewWalletActivity.java:41` |
| 10 | Tela com segredo sem `FLAG_SECURE` | Tezzet, todas |
| 11 | Segredo em tipo imutável de string | Tezzet, ambos os fluxos |
| 12 | Parâmetro de KDF vindo de `Default::default()` de dependência | spike BRES-36, via `tauri-plugin-stronghold` |
| 13 | `unwrap`/`expect`/`panic` no caminho de chave | spike BRES-36, `kdf.rs:24,31,32,37` |
| 14 | Senha como parâmetro de comando da fronteira | spike BRES-36, `lib.rs:53,79,162` |
| 15 | `if (biometria_disponível)` como portão de assinatura | spike BRES-36, `lib.rs:132` |
| 16 | Assinar bytes sem watermark tipado, ou com `Custom` | risco estrutural, ADR-0001 §7.7 |
| 17 | Segredo cruzando serialização | ver §12.1 — acontece por **default de biblioteca**, sem ninguém escrever nada errado |
| 18 | `npm audit` / `cargo audit` com `continue-on-error` | TAPS, CI atual |

---

## 11. Chave quente do TAPS — recomendação, não decisão

**Esta seção recomenda e para. A decisão de custódia é de Rafael** (ADR-0001 §7 e mandato do Suite Lead em BRES-37).

**A posição técnica, sem suavizar: guardar uma `edsk` quente para o payout do TAPS é o modelo de maior risco possível para um sistema que move fundos.**

O raciocínio é curto e não depende de qual stack a ADR escolher. Um agendador de payout roda desatendido — não há humano no teclado às 3h da manhã. Logo a chave precisa ser utilizável sem humano. Logo ela é quente. Trocar "quente no Postgres multi-tenant" por "quente no disco do baker" é progresso real e **continua sendo o mesmo modelo**.

E há uma segunda razão, que é a mais importante: **a pressão operacional é que produz o defeito.** Uma chave de cofre derivada de passphrase que só vive em RAM não sobrevive a um restart não assistido; alguém então coloca a passphrase numa variável de ambiente, e o KDF inteiro vira decoração. Foi exatamente assim que o TAPS chegou ao `appPassphrase` na mesma linha da mesma tabela que o ciphertext. Não foi maldade nem incompetência — foi essa pressão, e ela vai existir de novo.

**O que se recomenda:**

1. **`octez-signer` em host separado, com allow-list de operação**, ou **Ledger**. O serviço nunca vê a chave; ele pede assinatura e recebe assinatura.
2. Como a ADR-0001 §7 já manda tudo passar pela interface `Signer` do Taquito, um assinador remoto é **apenas outra implementação da mesma interface** — daí o requisito 8 da ADR, que exige as duas implementações **desde o começo**. Com as duas desde o dia um, a abstração fica provada em vez de presumida.
3. **A chave embutida vira modo degradado, opt-in e documentado como tal**, nunca o default silencioso.

**O que muda no produto se isso for adotado:** o baker passa a operar um host (ou um dispositivo) a mais, com instalação, atualização e monitoramento próprios. É custo real de operação e de suporte, e ele precisa aparecer na decisão em vez de ser descoberto pelo primeiro usuário. Em troca, o pior caso deixa de ser "vazou o banco, perderam-se os fundos de todos os delegadores".

**O que este documento entrega independentemente da decisão:** o `tz-vault` como componente compartilhado. No TAPS ele protege a **sessão do operador no console**. Ele não é, e não deve virar, a resposta para a chave de payout.

---

## 12. Bibliotecas candidatas — estado de manutenção verificado

**Verificado em 2026-08-27** por consulta direta à API do crates.io, ao registro do npm e à API do GitHub. Nenhuma linha desta seção é "presumida viva porque é popular".

**Critério (P4 da ADR-0001):** último release ≤ 12 meses **ou** commit no repositório ≤ 6 meses.

### 12.1 Implementação de referência candidata — Rust

| Biblioteca | Versão | Último release | Último commit | Veredito |
|---|---|---|---|---|
| `argon2` (RustCrypto) | 0.6.0 | 2026-08-27 | 2026-08-27 | ✅ **Aprovada.** KDF |
| `chacha20poly1305` (RustCrypto) | 0.11.0 | 2026-06-28 | 2026-08-24 | ✅ **Aprovada.** AEAD padrão |
| `aes-gcm` (RustCrypto) | 0.11.1 | 2026-08-21 | 2026-08-24 | ✅ Aprovada. AEAD alternativo |
| `zeroize` / `zeroize_derive` | 1.9.0 / 1.5.0 | 2026-06-12 | 2026-08-27 | ✅ Aprovada |
| `getrandom` | 0.4.3 | 2026-06-17 | 2026-08-11 | ✅ **Aprovada.** Entropia |
| `bip39` (rust-bitcoin) | 2.2.2 | 2025-12-04 | 2026-08-20 | ⚠️ **Aprovada com ressalva** — ver abaixo |
| `ed25519-dalek` | 3.0.0 | 2026-07-06 | 2026-08-24 | ✅ Aprovada. `tz1` |
| `k256` (RustCrypto) | 0.14.0 | 2026-07-08 | 2026-07-17 | ✅ Aprovada. `tz2` |
| `p256` (RustCrypto) | 0.14.0 | 2026-07-03 | 2026-07-17 | ✅ Aprovada. `tz3` |
| `blake2` (RustCrypto) | 0.11.0 | 2026-08-26 | 2026-08-27 | ✅ Aprovada. Endereço e digest |
| `sha2`, `hmac` (RustCrypto) | 0.11.0 / 0.13.0 | 2026-03-25 / 2026-03-29 | 2026-08-27 | ✅ Aprovadas. SLIP-0010, PBKDF2 |
| `secrecy` | 0.10.3 | 2024-10-09 | 2026-07-15 | ✅ Aprovada por commit (release atrasado) |
| `constant_time_eq` | 0.5.0 | 2026-04-20 | — | ✅ Aprovada |
| `subtle` | 2.6.1 | 2024-06-24 | 2024-08-03 | ⚠️ **Falha o critério P4** (25 meses sem commit). Entra assim mesmo por vir transitivamente com `ed25519-dalek`/RustCrypto; **preferir `constant_time_eq` no código próprio** e registrar `subtle` como risco de dependência transitiva |
| `bs58` | 0.5.1 | 2024-03-19 | 2024-05-24 | ❌ **Falha P4** (27 meses). **Substituir por `base58ck`** |
| `base58ck` (rust-bitcoin) | 0.5.0 | 2026-08-05 | 2026-08-27 | ✅ **Aprovada.** base58check com organização por trás |
| `memsec` | 0.7.0 | 2024-06-06 | 2025-01-21 | ❌ **Falha P4.** Usar `libc::mlock` / `VirtualLock` direto — a superfície é de duas chamadas |
| `windows` (microsoft) | 0.62.2 | 2025-10-06 | — | ✅ Aprovada. Hello / `KeyCredentialManager` |
| `blst` | 0.3.17 | 2026-07-24 | 2026-08-18 | ✅ Viva — **mas fora da v1** (`tz4`, §4.7) |
| `bls12_381` (zkcrypto) | 0.8.0 | 2023-02-27 | 2025-04-16 | ❌ Falha P4. Irrelevante enquanto `tz4` estiver fora |
| `tezos_crypto_rs` (trilitech) | 0.6.0 | 2024-07-02 | 2024-07-02 | ❌ **Falha P4** (25 meses, 7 estrelas). **Reprovada** — é a K5 da ADR |

**A ressalva do `bip39`, verificada empiricamente e não por leitura:**

1. **Com features default, `Mnemonic` implementa serialização.** A feature `std` (que é default) lista `serde/std` **sem** o prefixo opcional, o que **habilita a dependência `serde`**. Verificado compilando `fn assert_ser<T: serde::Serialize>()` contra `bip39::Mnemonic`: **compila**. Isso viola o princípio 7 e o item P3.b da ADR **sem que ninguém tenha escrito uma linha errada** — é o default da biblioteca.
2. **Forma correta de declarar:** `default-features = false, features = ["zeroize", "alloc"]`. Verificado: nessa configuração a mesma asserção **não compila** (`the trait bound Mnemonic: serde::Serialize is not satisfied`), o checksum é validado (`abandon×11 abandon` → `InvalidChecksum`) e o vetor oficial produz a semente correta (`5eb00bbd…`).
3. Sob a feature `zeroize`, `Mnemonic` deriva zeroização no drop. **Ela está desligada por padrão** e precisa ser ligada explicitamente.
4. `Mnemonic` deriva `Clone`. O tipo **DEVE** ser embrulhado por um tipo próprio não-clonável antes de circular pelo código.

**A lacuna de derivação.** Nenhuma biblioteca de SLIP-0010 passa o critério com folga:

| Candidata | Estado verificado | Veredito |
|---|---|---|
| `slip10` (wusyong) | Release 2021-06-15; commit 2024-06-20; 9 estrelas | ❌ Reprovada |
| `slipped10` | Release 2026-04-04, mas o **repositório declarado retorna 404** | ❌ Reprovada — código publicado sem fonte pública é o oposto de auditável |
| `near-slip10` | Release 2026-05-07; commit 2026-08-25; **0 estrelas**, fork de propósito específico | ❌ Reprovada para nosso uso |
| `hd-wallet` (LFDT-Lockness) | Release 2026-03-23; commit 2026-07-02; 6 estrelas | ⚠️ Viva, mas superfície muito maior que a necessidade |
| `ed25519-bip32` | Viva | ❌ **Esquema errado** — é o BIP32-Ed25519 do Cardano, não SLIP-0010 |

**Decisão: composição própria de SLIP-0010 endurecido**, sob as três condições do §4.3. Trinta linhas de HMAC-SHA512 com vetores oficiais no CI e cruzamento independente são mais auditáveis que uma dependência de mantenedor único com repositório fora do ar.

### 12.2 Mapeamento para as outras stacks

Esta especificação vale se a ADR-0001 escolher o Finalista B. Os parâmetros são os mesmos; muda quem os implementa.

**TypeScript / JavaScript** — para a camada de cadeia em qualquer desfecho, e para o núcleo se a stack for JS:

| Papel | Pacote | Verificado |
|---|---|---|
| Curvas (Ed25519, secp256k1, P-256) | `@noble/curves` 2.4.0 | 2026-08-27 ✅ |
| Hashes (SHA-2, BLAKE2, HMAC, PBKDF2) | `@noble/hashes` 2.4.0 | 2026-08-27 ✅ |
| AEAD (XChaCha20-Poly1305, AES-GCM) | `@noble/ciphers` 2.4.0 | 2026-08-27 ✅ |
| BIP-39 com checksum | `@scure/bip39` 2.3.0 | 2026-08-08 ✅ |
| BIP-32 / SLIP-0010 | `@scure/bip32` 2.3.0 | 2026-08-08 ✅ |
| Camada Tezos | `@taquito/*` 25.0.0 | 2026-06-29 ✅ |
| Argon2 em WASM | `hash-wasm` 4.12.0 | 2024-11-19 ⚠️ 21 meses sem release — **verificar antes de adotar** |
| ~~`argon2-browser`~~ | 1.18.0 | 2021-06-05 ❌ **Reprovada, 5 anos** |
| ~~`bip39` (npm clássico)~~ | 3.1.0 | 2023-02-25 ❌ Preferir `@scure/bip39` |
| ~~`tweetnacl`~~ | 1.0.3 | 2020-02-10 ❌ Preferir `@noble/curves` |

**JVM / Kotlin** — se o Finalista B exigir módulo nativo Android:

| Papel | Biblioteca | Verificado |
|---|---|---|
| AEAD, primitivas gerais | Tink (`tink-crypto/tink-java`) | commit 2026-08-27 ✅ |
| Curvas, BLAKE2, base58 | BouncyCastle (`bcgit/bc-java`) | commit 2026-08-27 ✅ |
| Argon2id | `argon2-jvm` (phxql) | push 2025-11-24 ✅ (dentro de 12 meses) |
| Armazenamento e portão | AndroidKeyStore + `BiometricPrompt` (plataforma) | — |

**Regra que vale em qualquer stack:** o conjunto acima é o **conjunto auditado**. Acrescentar uma dependência ao caminho da chave é decisão de revisão, não de quem está implementando.

---

## 13. Auditoria externa — recomendação e ponto do roadmap

**Recomendação: sim, e em dois momentos. Custo é decisão de Rafael.**

**Momento 1 — antes da primeira versão pública que segure chave de usuário.** Concretamente: antes de BRES-45/BRES-50 (Tezzet com custódia própria) sair de Ghostnet para qualquer distribuição pública. Escopo fechado e pequeno, que é o que torna isto pagável: `tz-keys` + `tz-vault` + a fronteira do `Signer` + o embrulho por plataforma. É deliberadamente **um núcleo de 1.500 a 2.500 linhas que muda raramente** — BIP-39 e Ed25519 não mudam a cada upgrade de protocolo.

**Momento 2 — antes de o TAPS mover fundos reais em mainnet**, e o escopo depende inteiramente da decisão de custódia do §11. Com `octez-signer`, a auditoria é da política de allow-list e da fronteira. Com chave embutida, é da custódia inteira — mais cara, e essa diferença de custo é um argumento a favor do assinador remoto que deveria entrar na decisão de Rafael.

**O que fazer antes disso, que é barato e reduz o que a auditoria vai encontrar:** os critérios de aceite da §9 rodando no CI desde o primeiro commit do núcleo; período obrigatório só-Ghostnet; e o núcleo público antes da auditoria, para revisão da comunidade Tezos.

**Casas com trabalho publicado no perímetro relevante** (carteira, KDF, custódia): Trail of Bits, NCC Group, Least Authority, Cure53, Radically Open Security. Uma revisão de escopo fechado deste tamanho está tipicamente na casa de dezenas de milhares de dólares — número a confirmar por cotação, não por este documento.

**Escalado a Rafael, porque é gasto e é decisão de custódia:** contratar ou não, quando, e com qual escopo.

---

## 14. O que fica aberto

Registrado para não ser descoberto como surpresa.

| # | Aberto | Quem decide | Quando |
|---|---|---|---|
| 1 | **Custódia da chave de payout do TAPS** | Rafael | Antes de BRES-46 (motor de payout) |
| 2 | **Auditoria externa** — contratar, quando, escopo | Rafael | Antes de qualquer build público com chave |
| 3 | Stack (Finalista A ou B) | ADR-0001, Rafael | Depende de BRES-37 e BRES-38 |
| 4 | `KEK_prf` do WebAuthn como terceiro embrulho | Tezos Core & Crypto | Pós-v1. O campo já existe no formato; entra **sem migração** |
| 5 | TPM2 como `KEK_hw` no Linux | Tezos Core & Crypto | Pós-v1, opcional |
| 6 | Assinatura `tz4` (BLS) | Tezos Core & Crypto | Quando houver demanda de produto (§4.7) |
| 7 | Passphrase BIP-39 na criação | Tezos Core & Crypto | Quando houver cerimônia de backup própria |
| 8 | `v1-mobile+` (128 MiB) | Tezos Core & Crypto | Depois de medir em aparelho físico, não em emulador |

---

## Apêndice A — Pseudocódigo normativo

Neutro de linguagem. O que importa é a **ordem** das operações e onde estão as recusas.

```
ABRIR(caminho, obter_passphrase, obter_kek_hw):
    bytes  ← ler(caminho)
    header ← parse_header(bytes[0..48])

    # (1) validação estrutural ANTES de qualquer trabalho caro
    exigir header.magic == "TZVLT\0"
    exigir header.format_version == 0x01
    exigir header.reserved == 0x00
    exigir header.kdf_id, header.aead_id, header.profile_id conhecidos
    exigir faixa(header.argon2_m_kib, header.argon2_t, header.argon2_p)     # §5.6
    exigir params == tabela_de_perfis[header.profile_id]

    wraps ← parse_wraps(bytes, header.wrap_count)                          # recusa ctx_len absurdo

    # (2) tenta o embrulho de hardware primeiro; passphrase é sempre o fallback
    dek ← nulo
    para w em wraps onde w.tipo == KEK_hw:
        kek ← obter_kek_hw(w.ctx)                                          # prompt NATIVO do SO
        dek ← aead_abrir(kek, w.nonce, aad(header, w), w.ct ‖ w.tag)  ou  nulo
    se dek == nulo:
        pass ← obter_passphrase()                                          # prompt NATIVO do SO
        kek  ← Argon2id(pass, header.kdf_salt, params do header) → 32 B
        zerar(pass)
        w    ← wraps[tipo == KEK_pass]
        dek  ← aead_abrir(kek, w.nonce, aad(header, w), w.ct ‖ w.tag)
        zerar(kek)
        se dek == nulo: recusar(ErroDeAbertura)     # MESMO erro de adulteração — sem oráculo

    corpo   ← parse_corpo(bytes)
    payload ← aead_abrir(dek, corpo.nonce, aad(header, wraps), corpo.ct ‖ corpo.tag)
    se payload == nulo: recusar(ErroDeAbertura)

    segredo ← extrair(payload)                    # em memória travada, tamanho fixo
    zerar(payload)

    # (3) reencriptação oportunista — sem perguntar, sem migração manual   §5.7
    se header.profile_id < perfil_corrente_da_plataforma:
        GRAVAR(caminho, segredo, perfil_corrente_da_plataforma, embrulhos existentes)

    devolver Sessao{ dek, segredo }


GRAVAR(caminho, segredo, perfil, embrulhos):
    salt ← csprng(16)          # falha do CSPRNG ⇒ ABORTA, nunca degrada
    dek  ← csprng(32)          # DEK nova a cada gravação
    header ← montar(magic, v1, kdf_id, perfil, aead_id, |embrulhos|, params[perfil], salt, agora)

    para cada e em embrulhos:
        kek ← (e.tipo == KEK_pass) ? Argon2id(pass, salt, params[perfil]) : chave_do_SO(e.ctx)
        e.nonce ← csprng(24)                       # nonce novo, sempre
        e.ct, e.tag ← aead_selar(kek, e.nonce, aad(header, e), dek)
        zerar(kek)

    payload ← montar_payload_128B(segredo, curva, esquema, caminho_de_derivacao)
    corpo.nonce ← csprng(24)
    corpo.ct, corpo.tag ← aead_selar(dek, corpo.nonce, aad(header, embrulhos), payload)
    zerar(payload); zerar(dek)

    escrita_atomica(caminho, header ‖ embrulhos ‖ corpo)                    # §5.8


ASSINAR(sessao, operacao_forjada_localmente, watermark):
    exigir watermark ∈ { OperacaoGenerica }                                 # v1: só 0x03  §4.6
    exigir verificacao_de_usuario_nativa()          # SEM fallback silencioso  §8.1
    digest ← BLAKE2b-256(bytes_do_watermark(watermark) ‖ operacao_forjada_localmente)
    devolver Sign(sessao.chave, digest)
```

---

## Apêndice B — Fontes verificadas

Tudo abaixo foi conferido em **2026-08-27**, não citado de memória.

| O quê | Onde |
|---|---|
| Watermarks e seus bytes | `octez` `src/lib_crypto/signature_v1.ml:766-772`; tipo em `signature_v0.ml:45-49` |
| Composição da assinatura (`BLAKE2b-256(watermark ‖ msg)`) | `octez` `src/lib_crypto/ed25519.ml:329-334` |
| Prefixos base58, incluindo `tz4` e `tz5` | `octez` `src/lib_crypto/base58.ml:378-475` |
| Parâmetros recomendados de Argon2id | RFC 9106 §4 (1ª opção 2 GiB/t=1/p=4; 2ª opção 64 MiB/t=3/p=4) |
| Piso de servidor | OWASP Password Storage Cheat Sheet — Argon2id 19 MiB/t=2/p=1 |
| Derivação Ed25519 | SLIP-0010; caminho BIP-44 com `coin_type` 1729 |
| Estado das crates | API do crates.io e API do GitHub, consultadas diretamente |
| `bip39` e serialização por default | Compilação de asserção de trait, resultado nas duas configurações — §12.1 |
| Medições de Argon2id | `argon2` 0.6.0, release, WSL2, 8 vCPU, 15 GiB, melhor de 3 |
| Achados do TAPS | `taps@agent/cartier/de00c8b0eb47` `ANALYSIS.md` §2.3 e o próprio `wallet-encryption.service.ts` |
| Achados do Tezzet | `tezzet@agent/cartier/de00c8b0eb47` `ANALYSIS.md` §1.2 e §2 |
| Portões e escopo | `tezzet@agent/tezos-suite-lead/7362c45f1762` `docs/adr/0001-stack-unificada-tezzet-taps.md` |
| Vereditos do spike | BRES-36, thread `01a045b8` |
