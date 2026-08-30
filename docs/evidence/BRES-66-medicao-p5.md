# BRES-66 — medição de P5, P3.b/c/e e a entropia de P4

Artefato: `tzvault66`, 3.037 linhas, descartável, fora dos dois repositórios de produto.
Medido contra `docs/spec/0001-nucleo-criptografico-compartilhado.md` em `master` do Tezzet.

## Resposta curta

**O vínculo com o Keystore se sustenta em Tauri.** App morto, reaberto, prompt negado, e o
desembrulho **falhou com recusa do AndroidKeyStore** — não com uma tela que não abre. Os outros
três itens fecharam e viraram teste de CI que fica vermelho quando quebra.

**O que não fecha, e é honesto dizer: o aparelho é emulador e o `KeyInfo.getSecurityLevel()` dele
é `SECURITY_LEVEL_SOFTWARE`.** Não é TEE nem StrongBox. P5 pede que o relatório diga qual dos
dois; a resposta medida é *nenhum*. Isso é fato do ambiente, não do desenho — mas é o único
ponto onde o portão, como escrito, não pode ser marcado sozinho.

---

## Portão a portão

| Item | Veredito | Evidência |
|---|---|---|
| **P5** — vínculo com o Keystore | **Mecanismo demonstrado; nível de hardware não** | `android.log` §5, §6, §12 |
| **P4** — entropia | **Fechado** | `getrandom(2)` direto + teste de falha no CI |
| **P3.b** — segredo não serializável | **Fechado** | 6 casos `trybuild`, todos não compilam |
| **P3.c** — caminho de erro e log | **Fechado** | Operação falha real, no CI e no aparelho |
| **P3.e** — varredor no CI | **Fechado** | Workflow verde, 5 mutantes vermelhos |

---

## 1. P5 — o cofre amarrado ao Keystore

### O que foi construído

Cofre no formato **TZVLT** da §5.2, byte a byte: cabeçalho de 48 bytes, tabela de embrulhos,
corpo, payload de 128 bytes com preenchimento. Dois embrulhos, como manda a §6.3 para Android:

- **`KEK_pass`** — Argon2id perfil `v1-mobile` (64 MiB, t=3, p=4) + XChaCha20-Poly1305.
- **`KEK_hw`** — chave AES-256-GCM no **AndroidKeyStore**, alias `tzvault.kek_hw.v1`, criada com
  `setUserAuthenticationRequired(true)`, `setInvalidatedByBiometricEnrollment(true)`,
  `setUserAuthenticationParameters(0, AUTH_BIOMETRIC_STRONG | AUTH_DEVICE_CREDENTIAL)` e
  `setIsStrongBoxBacked(true)` tentado com fallback.

O `Cipher` é preso ao `BiometricPrompt` por `CryptoObject`. Nada de booleano: o que o prompt
autoriza é a operação criptográfica em si.

### A demonstração negativa — é ela que decide

```
pid depois do force-stop: '' (vazio = morto)
prompt negado, codigo 10: Authentication canceled
tentativa sem autorizacao -> keystore recusou:
  javax.crypto.IllegalBlockSizeException
  causa raiz: android.security.KeyStoreException: Key user not authenticated
  (internal Keystore code: -26 ... Error::Km(r#KEY_USER_NOT_AUTHENTICATED))
```

O plugin **não desiste em silêncio quando o prompt é negado**: ele tenta decifrar com o mesmo
`Cipher` não autorizado e relata o que o Keystore respondeu. Sem isso o teste provaria apenas que
fechamos uma janela. Com isso ele prova que a chave não decifra.

O que o JavaScript recebe da mesma operação é só `HARDWARE_KEY_REFUSED` — o texto acima vive num
canal separado, de diagnóstico.

### A demonstração positiva

Mesmo botão, prompt aceito: abre, e devolve o mesmo `tz1gwSeXSJiVXRayVoCXuS3Ud716iyWyWGcM`
gravado na criação. Esse caminho **não roda KDF nenhum** — é a DEK saindo do Keystore.

### O arquivo puxado por `adb`

`-rw------- u0_a192 389 bytes`, em `filesDir` privado (§6.3), nunca em armazenamento externo.

```
magic=TZVLT\0  format=0x01  kdf=0x01(Argon2id)  profile=0x01(v1-mobile)
aead=0x01(XChaCha20-Poly1305)  wrap_count=2  reserved=0x00
argon2 = 65536 KiB / t=3 / p=4
embrulho 0: 0x01 KEK_pass  ctx_len=0
embrulho 1: 0x02 KEK_hw    ctx_len=17  ctx=b'tzvault.kek_hw.v1'

corpo cifrado    144 bytes, entropia 6,718 bits/byte
arquivo inteiro  entropia 7,198 bits/byte
trechos ASCII legíveis: ['tzvault.kek_hw.v1']   <- o alias, que a §5.2 diz não ser segredo
sequências BIP-39: 0     'edsk': 0     'edpk': 0     'tz1': 0
```

### O nível de segurança do aparelho — a parte que não passa

```
securityLevel = "Software"  (KeyInfo.getSecurityLevel() = 0)
strongboxRequested = true   strongboxBacked = false
userAuthenticationRequired = true
userAuthenticationValidityDurationSeconds = 0    <- autorização por operação
invalidatedByBiometricEnrollment = false         <- pedimos true
```

E não é só o `KeyInfo` discordando de nós. **Testei o comportamento:** cadastrei uma segunda
digital no aparelho e reabri o cofre. **Abriu.** O flag foi aceito na geração sem erro, o
`KeyInfo` devolve `false`, e cadastrar biometria nova não invalidou nada.

Num keystore de software isso é esperado. Mas é exatamente a classe de defeito que P5 existe para
pegar: **um flag que parece criptográfico, não levanta erro, e não faz nada.** Se ninguém tivesse
testado o comportamento em vez de ler o código, este relatório diria "flag ligado" e estaria
errado.

**Precisa ser refeito em aparelho com TEE.** Não afirmo nada sobre hardware real.

---

## 2. P4 — a lacuna da entropia

**A chamada de sistema é `getrandom(2)`**, chamada **direto** via `libc::getrandom` no build
Android — sem crate de fachada no meio, justamente para que a afirmação seja verificável por
`strace` e não por leitura de documentação. O app reporta isso no próprio boot:

```
"entropySyscall": "getrandom(2)"
```

**Não existe fallback.** Com o CSPRNG indisponível, criar carteira falha com
`EntropyUnavailable` — e o cofre também, porque o sal, a DEK e os nonces vêm da mesma fonte. Um
nonce previsível quebra o AEAD tão bem quanto uma semente previsível quebra a carteira.

O mutante que acrescenta um fallback "só para o app não quebrar" deixa o teste vermelho.

---

## 3. P3.b — o item que o compilador garante

Seis casos `trybuild`. Nenhum compila, e o `.stderr` fixado ao lado prova que o motivo é o certo:

| Caso | Erro |
|---|---|
| `serde_json::to_string(&Dek)` | `the trait bound Dek: Serialize is not satisfied` |
| idem `Seed` | idem |
| idem `Phrase` | idem |
| `Scalar::clone()` | `no method named clone found` |
| `println!("{:?}", Seed)` | `Seed doesn't implement Debug` |
| `CoreError::VaultWrapAuthFailed(String)` | `expected function, found CoreError` |

Nenhum tipo de segredo deriva `Serialize`, `Clone`, `Copy` ou `Debug`, e todos têm tamanho fixo.
Colocar `Serialize` na `Dek` deixa o portão vermelho.

---

## 4. P3.c — o caminho de erro, com uma operação deliberadamente falha

`CoreError` é enum fechado **sem payload** — `size_of::<CoreError>() == 1`, fixado por teste.

Abrindo o cofre com a senha errada de propósito, isto é tudo que sai:

```
Debug   = VaultWrapAuthFailed
Display = nao foi possivel abrir o cofre
JSON    = "VAULT_WRAP_AUTH_FAILED"
```

No aparelho, o que chega ao JavaScript é literalmente `VAULT_WRAP_AUTH_FAILED`.

O teste procura ativamente por vazamento: bytes do segredo, a senha tentada, a senha do cofre,
`edsk`, e até a geometria (`64`, `32`) que serviria de oráculo. O mutante que faz a mensagem
mencionar a senha fica vermelho.

**§9.5, sem oráculo:** senha errada e arquivo adulterado produzem a **mesma** variante e o
**mesmo** texto.

---

## 5. P3.e — o varredor virou regressão

O varredor do BRES-36 saiu do script e virou código da biblioteca (`tzcore::memscan`), chamado
**pelo CI e pelo app**, para que "passou no CI" e "passou no aparelho" queiram dizer a mesma
coisa.

| | regiões | varridos | mnemônica | `edsk` | endereço | chave pública |
|---|---|---|---|---|---|---|
| CI (Linux) | 9 | 2 MB | **0×** | **0×** | 3× | 3× |
| Aparelho (Android) | 513 | **669 MB** | **0×** | **0×** | 6× | 6× |

**Dois controles, nenhum opcional:**

1. **O varredor funciona** — em processo separado (senão contamina), uma mnemônica de verdade é
   plantada viva no heap e ele **acha**. Sem isso, "zero ocorrências" poderia ser um varredor
   quebrado.
2. **A varredura alcança a região certa** — endereço e chave pública **precisam** aparecer, e o
   `verdict()` reprova quando não aparecem. Sem isso, um dump vazio passa por engano.

O ciclo é o real: um **processo filho** cria o cofre e morre com a mnemônica; este processo
destrava, deriva e assina sem nunca ver a mnemônica. É o que acontece no aparelho quando o app é
morto e reaberto — e é a única forma honesta de testar a §7.1.4, porque o BRES-36 já mostrou que
um processo não consegue esquecer o que a `bip39` copiou.

### O workflow rodou de verdade

`.github/workflows/nucleo.yml`, executado com `act` sobre Docker (o artefato não entra em
repositório de produto, então não há GitHub Actions para apontar). **Job verde, 7 passos:**

```
✅ P4 entropia -- nomear a chamada e provar que nao ha fallback
✅ P3.b fronteira -- serializar segredo nao compila
✅ P3.c caminho de erro -- nada vaza por Debug, Display ou serde
✅ §9.6 controle -- o varredor acha uma mnemonica viva
✅ §9.6 portao -- depois de unlock + assinatura, memoria limpa
✅ cofre -- formato, faixa de KDF, bit virado, gravacao atomica
✅ derivacao conferida contra o Taquito
🏁 Job succeeded
```

### Os portões pegam o defeito que existem para pegar

`tools/mutantes.sh` insere um defeito real por vez e **exige** que o teste fique vermelho:

| Mutante | Portão ficou vermelho com |
|---|---|
| `Dek` ganha `Serialize` | trybuild: "should fail to compile but succeeded" |
| Conta destravada guarda a "frase de recuperação" | `§9.6 reprovou: mnemonica encontrada na memoria: 1x` |
| Varredor lê a região errada | `§9.6 reprovou: controle positivo ausente (endereco 0x, chave publica 0x)` |
| CSPRNG ganha fallback | `criou carteira com o CSPRNG fora do ar` |
| Erro carrega a senha tentada | `vazou a senha tentada: senha hunter2 ...` |

---

## 6. Números

| | |
|---|---|
| Cofre em disco | **389 bytes** |
| Argon2id `v1-mobile` (64 MiB, t=3, p=4) no emulador | **286–298 ms** |
| Mesma abertura no BRES-36 (Stronghold: Argon2i 19 MiB + scrypt 512 MiB) | **45–60 s** |
| Abertura por `KEK_hw` | não roda KDF |
| Varredura de memória no aparelho | 669 MB, 513 regiões |
| Bits virados no cofre, um por byte | 296 posições, nenhuma abriu |
| Parâmetros de KDF fora da faixa | recusados em **1,26 µs**, sem rodar o KDF |
| Artefato inteiro | 3.037 linhas |

O perfil da especificação é **~200× mais rápido** que o cofre que o BRES-36 mediu, e é nosso,
versionado e medível. A lentidão de 45–60 s que o spike reportou era do scrypt de 512 MiB fixo
numa crate transitiva do Stronghold, como a §5.3 já suspeitava.

---

## 7. O que foi difícil ou frágil

**1. `updateAAD` antes do prompt mata a operação, e o modo de falha imita o sucesso.**
Meu primeiro código chamava `cipher.updateAAD()` logo depois do `init()`, antes de mostrar o
prompt. Isso inicia a operação no Keystore **sem token de autenticação** — e aí nem uma biometria
bem-sucedida salva: dá `KEY_USER_NOT_AUTHENTICATED` do mesmo jeito. Passei uma rodada inteira
achando que era o portão funcionando. **É o pior tipo de bug para este trabalho:** o app "recusa
corretamente" pelo motivo errado, e quem só olha o resultado marca P5 como atendido. A AAD só
pode entrar depois que o prompt autorizou o `Cipher`. Não achei isso em nenhum tutorial.

**2. O flag que não pega.** `setInvalidatedByBiometricEnrollment(true)` foi aceito sem erro,
`KeyInfo` devolve `false`, e cadastrar digital nova não invalidou o cofre. Só descobri porque
testei o comportamento em vez de confiar no código.

**3. A DEK atravessa uma `String` de JVM.** A ponte de plugin Android do Tauri serializa em JSON,
então a DEK vira base64 numa `String` de Kotlin. A §7.2 da especificação diz, com todas as
letras, que segredo **nunca** vai em `String` porque `String` de JVM não é sobrescrevível. A
parede que importa continua de pé — nada disso passa pela webview —, mas neste caminho a §7
promete mais do que a plataforma entrega. Sair disso exige JNI com `ByteArray` fora do bridge do
Tauri, ou aceitar e escrever no modelo de ameaça.

**4. `mlockall` falha no Android.** `coreDumpsDisabled=true`, `mlockallOk=false`. A camada 1 da
§7.1 — a única que muda um vazamento de permanente em disco para transitório em RAM — não existe
hoje no nosso Android, porque o `RLIMIT_MEMLOCK` do app é pequeno.

**5. Meu próprio arnês de mutantes mentiu.** O `git checkout -- .` do script falhou em silêncio
numa árvore com `target/` versionado e deixou o mutante 2 preso no código. A rodada seguinte de
testes ficou vermelha e eu levei um tempo para entender por quê. Consertei com revert conferido
que aborta se a árvore não voltar limpa. Registro porque o erro é exatamente o que estes portões
existem para prevenir: um teste que mente.

**6. O prompt do sistema é `FLAG_SECURE`.** `screencap` devolve arquivo vazio enquanto ele está na
tela. Isso é ótimo para o produto — a webview não lê nem imita o prompt — e ruim para quem precisa
de print: a evidência do instante da negação sai por log, não por imagem. O print anexo mostra o
estado logo depois.

**7. A recusa lembrada não é limpa entre operações.** A UI reexibe o último
`last_hardware_refusal` em qualquer erro seguinte, o que me deu uma linha errada na primeira
colheita do passo 9. É defeito do artefato de medição, não do desenho, mas mostra como é fácil
uma tela de diagnóstico contar a história errada.

**8. O NDK do `sdkmanager` veio incompleto.** Faltava `lib/clang/18/lib/linux/`, e o link falhava
com `unable to find library -lunwind` — um erro que parece de Rust e é de download. Baixar o zip
`android-ndk-r27c-linux.zip` direto resolveu. Numa máquina de CI isso é meia hora atrás da pista
errada.

**9. O emulador precisou de reboot.** O serviço `package` sumiu e `adb install` respondia
`Can't find service: package`.

**O que foi surpreendentemente fácil:** o formato TZVLT da §5.2 é implementável direto do texto,
sem interpretação, e o `tezos.rs` do BRES-36 entrou sem uma linha de mudança de criptografia — os
7 testes de derivação contra o Taquito continuam passando.

---

## 8. Achados sobre a especificação — reportados, não trocados

Nenhum destes foi decidido por mim. São de Tezos Core & Crypto.

**1. Um `aead_id` só não cobre os dois AEADs do mesmo arquivo.** A §5.2 põe `aead_id` no
cabeçalho, um por arquivo. Mas a §6.3 obriga o `KEK_hw` do Android a ser AES-256-GCM (é o que o
AndroidKeyStore faz), enquanto a §5.4 põe XChaCha20-Poly1305 no corpo. Os dois convivem no mesmo
cofre. Implementei com o `aead_id` descrevendo o **corpo**, e o embrulho `KEK_hw` implicitamente
AES-GCM pelo `wrap_type = 0x02`. Sugestão: ou `aead_id` por embrulho, ou uma linha dizendo que
`wrap_type = 0x02` implica AES-256-GCM.

**2. `wrap_nonce` tem 24 bytes; o IV do AES-GCM tem 12.** Guardei alinhado à esquerda, resto em
zero. Funciona e não está escrito.

**3. No `KEK_hw` o nonce não é nosso.** `setRandomizedEncryptionRequired(true)` faz o Keystore
gerar o IV. A regra da §5.4 — "se o CSPRNG falhar, aborta" — não tem como ser cumprida nesse
embrulho, porque quem sorteia é o SO. Não é problema; é uma exceção que deveria estar escrita.

**4. §9.6 diz "zero ocorrências do material `edsk`".** Interpretei como a forma base58
`edsk...`, e é isso que o varredor conta. O escalar de 32 bytes **cru** está em memória, e tem
que estar — a §5.9 manda o cofre aberto guardar exatamente a DEK e o escalar. Vale desambiguar o
texto, senão duas leituras honestas dão veredictos opostos.

---

## 9. O que continua não medido

- **Aparelho real com TEE ou StrongBox.** Só houve emulador. Tudo que P5 afirma sobre *hardware*
  continua em aberto.
- **iOS e macOS** — fora do escopo por decisão de Rafael (ADR §8).
- **Desktop Linux e Windows do app Tauri** — não buildados aqui: falta GTK/WebKit e não há `sudo`
  nesta máquina, o mesmo obstáculo que o BRES-36 contornou com um prefixo local de 232 `.deb`.
  P1 já está atendido pelo BRES-36 e nada aqui o contradiz. O núcleo (`tzcore`) buildou e passou
  em Linux, que é onde os portões P3/P4 rodam.
- **P3.a** — a enumeração da superfície de IPC existe e está completa (11 comandos, cada um com
  tipo de retorno e ramo `Err`), mas é mantida à mão: não há teste que quebre se alguém
  acrescentar um comando e esquecer de listá-lo. Não estava no escopo desta issue; fica anotado.

---

## 10. Como reproduzir

```
tzvault66/crates/tzcore      cargo test --features fault-injection     # os 4 portões, 24 testes
tzvault66/tools/mutantes.sh                                            # prova que eles falham
tzvault66/.github/workflows/nucleo.yml                                 # os mesmos no CI
./medir-android.sh                                                     # a sequência no aparelho
```

Ambiente: WSL2, Rust 1.95, JDK 17.0.20-tem, Android SDK 34 + NDK r27c, emulador x86_64 API 34.
