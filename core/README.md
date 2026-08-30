# `tezos-core` — núcleo criptográfico compartilhado da Suíte Tezos

Implementa a [SPEC-0001](../docs/spec/0001-nucleo-criptografico-compartilhado.md)
na versão emendada pelo BRES-68. Auditado uma vez, usado nos dois produtos:
**Tezzet** (carteira) e **TAPS** (pagamento para bakers).

Stack decidida pela [ADR-0001](../docs/adr/0001-stack-unificada-tezzet-taps.md):
Tauri v2 + núcleo Rust.

```
crates/
  tz-params    todo parâmetro criptográfico, num lugar só. Sem dependência, sem lógica.
  tz-rng       a única porta para o CSPRNG do sistema operacional. Sem fallback.
  tz-keys      identidade da chave. Determinístico. Não toca disco nem SO.
  tz-vault     o cofre. Formato, KDF, AEAD, embrulhos, gravação atômica.
  tz-memscan   o portão de memória da §9.6, em duas fases.
  tz-ipc-guard o portão da superfície de IPC.
  tezos-core   fachada: ciclo de vida da carteira e da sessão. É o que o produto consome.
```

A divisão em crates não é organização de arquivo: é a fronteira da §1 posta onde
o compilador a verifica. `tz-keys` **não depende** de `libc`, de `tz-rng` nem de
`std::fs`, e `tz-keys/tests/fronteira.rs` fica vermelho quando alguém atravessa
a linha. Um bug num não deve exigir reauditar o outro.

---

## O que esta API garante, e o que ela não garante

Esta tabela é a parte do README que mais importa. Uma biblioteca de cripto que
só lista o que faz é propaganda.

| Chamada | **Garante** | **Não** garante |
|---|---|---|
| `tezos_core::create_wallet` | 256 bits do CSPRNG do sistema (`getrandom(2)` / `BCryptGenRandom`); mnemônica devolvida **uma vez**, para a cerimônia de backup; cofre gravado atomicamente | que o usuário guardou a frase — N5 do modelo de ameaça, e é dele |
| `tezos_core::import_wallet` | wordlist **e** checksum BIP-39 validados antes de virar carteira | que a frase é do usuário: uma frase válida de outra pessoa é válida |
| `tezos_core::unlock` | hardware primeiro, passphrase **sempre** como recuperação; validação estrutural antes do KDF; reencriptação oportunista sem perguntar | nada contra malware ativo com o cofre aberto (N1) |
| `Session::sign` | verificação de usuário nativa **antes** de assinar, sem fallback silencioso; watermark obrigatório e tipado; low-S no ECDSA | que os bytes são a operação que o usuário pediu — isso é a camada de cadeia |
| `Session::lock` | DEK e escalar zerados de verdade — medido na memória do processo, não afirmado no comentário | que não sobrou cópia em RAM (§7.3: essa prova não existe) |
| `tz_keys::address::validate` | prefixo, comprimento e checksum base58check; **`tz4` aceito**; `tz5` recusado como *não suportado*, não como lixo | nada sobre a cadeia: um endereço válido pode nunca ter existido |
| `tz_vault::policy::accept_passphrase` | piso de 60 bits, sem valor padrão, sem "pular por enquanto" | que a senha não foi reusada de um vazamento (N4) |
| `tz_vault::memory::harden` | o que a plataforma deixou fazer, **reportado** — inclusive quando `mlock` falha, que é o caso do Android | as camadas que dependem de desenho e não de syscall |

### O que este núcleo nunca faz

- **Receber senha por parâmetro.** §8.2 e o item 14 do anti-catálogo. A
  passphrase entra por `prompt::UserPrompt`, que é o diálogo nativo do sistema
  operacional — nunca um `<input>` HTML. Nenhuma função pública tem um argumento
  de senha, e isso é verificável lendo as assinaturas.
- **Assinar bytes arbitrários.** O que entra é uma `ForgedOperation`, forjada e
  conferida localmente. Nunca bytes prontos vindos de um RPC (§4.6 item 5).
- **Guardar hash de verificação de senha.** A tag do AEAD **é** a verificação.
  Isso substitui o `walletHash` SHA-512 do TAPS por algo mais forte e mais
  simples, e elimina de vez a comparação com `===`.
- **Forjar operação, falar RPC ou estimar gas.** Camada de cadeia (BRES-42),
  deliberadamente separada: ela muda a cada upgrade de protocolo e este núcleo
  não deve mudar junto.
- **Guardar chave de payout do TAPS.** §11: `octez-signer` em host separado, o
  backend nunca vê a chave. O `tz-vault` no TAPS protege **apenas** a sessão do
  operador no console.

### A posição de fundo, registrada

Guardar uma chave `edsk` quente num banco de dados é o modelo de maior risco
possível para um sistema de payout. O teto de segurança de qualquer carteira em
software é "malware ativo com o cofre aberto lê a chave" (N1), e o que passa
desse teto é assinador em hardware — Ledger ou `octez-signer` em host separado.

---

## Os números, e de onde eles vêm

Todos vivem em `tz-params`, e **em nenhum outro lugar**. O teste
`tezos-core/tests/portoes_de_codigo.rs::parametro_criptografico_so_vive_em_tz_params`
fica vermelho quando um deles é escrito noutro arquivo.

| Item | Valor | Seção |
|---|---|---|
| Entropia, criação nova | 256 bits → 24 palavras | §4.1 |
| KDF | Argon2id v`0x13`, `v1-mobile` 64 MiB/t=3/p=4, `v1-desktop` 256 MiB/t=3/p=4 | §5.3 |
| Faixa aceita do KDF | 19 MiB ≤ m ≤ 1 GiB, 1 ≤ t ≤ 10, 1 ≤ p ≤ 8 | §5.6 |
| AEAD | XChaCha20-Poly1305 padrão; AES-256-GCM aceito, **por região** | §5.4 |
| Nonce | campo de 24 B sempre; 24 úteis no XChaCha, 12 no AES-GCM, resto zero **e recusado se não for** | §5.2 |
| Derivação | SLIP-0010 endurecido, `m/44'/1729'/0'/0'` | §4.3 |
| BIP-39 → semente | PBKDF2-HMAC-SHA512, 2048 iterações, sal `"mnemonic" ‖ passphrase` | §4.2 |
| Piso da passphrase | 60 bits | §2.3 |
| Timeout de sessão | 5 min, configurável entre 1 e 30 | §5.9 |

---

## Os portões, e como rodá-los

Nenhum item da §9 é satisfeito por inspeção.

```sh
cd core

# Tudo: vetores oficiais BIP-39 e SLIP-0010, cruzamento com o Taquito,
# endereços, assinatura, cofre, fuzzing do parser, superfície de IPC e os
# casos `trybuild` que NÃO PODEM compilar.
cargo test --workspace --features tezos-core/fault-injection,tz-vault/fault-injection

# §9.6 — o portão de memória, nas duas fases. Processo próprio, sem
# paralelismo: outro teste ao lado contamina o dump.
cargo build -p tezos-core --features memscan-gate --example cria_cofre
cargo test  -p tezos-core --features memscan-gate --test memscan_portao -- --nocapture --test-threads=1
cargo test  -p tezos-core --test memscan_controle -- --nocapture --test-threads=1

# §9.1 — o relatório de build NOMEIA a chamada de sistema.
cargo run --example relatorio -p tezos-core

# Os portões só valem se ficarem vermelhos quando deveriam.
./tools/mutantes.sh
```

### O que cada portão prova

| Arquivo | §  | Prova |
|---|---|---|
| `tz-keys/tests/vetores_bip39.rs` | 9.2 | os 24 vetores oficiais do Trezor, **e** que checksum inválido é **rejeitado** |
| `tz-keys/tests/vetores_slip10.rs` | 9.2 | os 21 vetores oficiais hardened do SLIP-0010, nas três curvas, incluindo os dois de *retry* |
| `tz-keys/tests/vetores_taquito.rs` | 9.2 / 9.4 | endereço, chave pública e assinatura batem com `@taquito/signer` 25.0.0 — **cruzamento independente**; e que o esquema do Cardano dá outro endereço |
| `tz-keys/tests/base58_e_enderecos.rs` | 9.3 | prefixos conferidos contra o Taquito; `tz4` aceito; `tz5` recusado como *não suportado*; um caractere trocado nunca passa; `edsk` de 32 B não passa por `edsk` de 64 B |
| `tz-keys/tests/assinatura_e_watermark.rs` | 9.4 | low-S em 512 assinaturas; a v1 recusa watermark de baker; determinismo nas três curvas |
| `tz-keys/tests/compilacao_deve_falhar.rs` | 9.7 | 7 casos que **não compilam**: serializar, clonar ou imprimir segredo; assinar sem watermark; `Watermark::Custom` **não existe** |
| `tz-keys/tests/fronteira.rs` | 1 | `tz-keys` não fala com o sistema operacional — nem no código, nem no `Cargo.toml` |
| `tz-vault/tests/cofre.rs` | 9.5 | 23 testes: sem oráculo, bit virado em **toda** posição, faixa do KDF recusada **sem rodar o KDF** (medido por tempo), 10 000 nonces distintos, dois AEADs no mesmo cofre, gravação atômica, permissão |
| `tz-vault/tests/vetor_de_bytes.rs` | 9.5 | o cofre Android de dois AEADs, **fixo no repositório**, abre pelos dois caminhos |
| `tz-vault/tests/fuzz_parser.rs` | 9.5 | 200 000 entradas: nenhum pânico, nenhuma alocação guiada pelo arquivo |
| `tz-vault/tests/passphrase.rs` | 2.3 | o piso de 60 bits, e que uma estimativa otimista vinda de fora **não** afrouxa o portão |
| `tezos-core/tests/memscan_portao.rs` | 9.6 | as duas listas exaustivas e as **duas fases**, com controle positivo obrigatório |
| `tezos-core/tests/memscan_controle.rs` | 9.6 | o varredor acha o que existe — sem isso, "zero ocorrências" pode ser um varredor quebrado |
| `tezos-core/tests/caminho_de_erro.rs` | 9.7 | operação deliberadamente falha: nada vaza por `Debug`, `Display` ou pelo código de fio |
| `tezos-core/tests/portoes_de_codigo.rs` | 3 / 9.8 | parâmetro num lugar só, nenhum `panic` no caminho da chave, nenhuma comparação de segredo com `==`, versões fixadas, CI sem portão decorativo |
| `tz-ipc-guard/tests/portao.rs` | 9.7 | um `#[tauri::command]` novo não enumerado **reprova** — o resíduo de P3.a da ADR-0001 §12.1 |

---

## Como esta biblioteca é usada

O produto **não** chama o núcleo direto: ele fala com a interface `Signer` do
Taquito (ADR-0001 §7, requisito 1), e o núcleo é uma implementação dela. É isso
que permite trocar o shell sem tocar no núcleo, e é isso que permite que
`octez-signer` seja apenas outra implementação da mesma interface.

```rust
use tezos_core::prompt::{Purpose, UserPrompt};
use tezos_core::session::VaultLocation;

// O produto implementa o diálogo NATIVO do sistema operacional:
// `BiometricPrompt` no Android, `UserConsentVerifier` no Windows, GTK no Linux.
struct MeuPrompt;

impl UserPrompt for MeuPrompt {
    fn passphrase(&self, p: Purpose) -> tezos_core::Result<tz_keys::secret::Phrase> {
        /* diálogo nativo — nunca um <input> HTML */
        # unimplemented!()
    }
    fn verify_user(&self, p: Purpose) -> tezos_core::Result<()> {
        /* biometria ou PIN nativo. Ausência de mecanismo é ERRO, não permissão. */
        # unimplemented!()
    }
}

let loc = VaultLocation { path: &caminho, hardware: None }; // Linux: só passphrase (§6.1)
let (sessao, frase) = tezos_core::create_wallet(&loc, &MeuPrompt, None)?;
// `frase` existe aqui, na cerimônia de backup, e nunca é rematerializada.
```

---

## Limitações conhecidas, escritas como limitações

1. **`mlock` falha no Android.** Medido no BRES-66: o `RLIMIT_MEMLOCK` do app é
   pequeno, então a camada 1 da §7.1 — a única que converte um vazamento
   permanente em disco num transitório em RAM — hoje não existe naquele alvo.
   `build_report()` diz isso em vez de presumir.
2. **O nível de hardware do Keystore não foi medido.** A ADR-0001 §12.3 registra
   um **override humano explícito de P5**: o mecanismo foi demonstrado, o
   respaldo em TEE não. Nada neste núcleo pode depender de o Keystore ter
   respaldo de hardware até o BRES-67 medir em aparelho real.
3. **Derivação só endurecida.** Não há derivação não-endurecida em curva
   nenhuma. Carteiras que derivem em caminho não-endurecido entram pela
   importação de chave crua (`spsk`, `p2sk`), não pela mnemônica.
4. **`tz4` lê e recebe, não assina.** BLS12-381 acrescenta uma primitiva grande
   ao perímetro auditado e a única biblioteca madura é C com FFI (§4.7).
5. **A §9.6 literal dispara em prosa em inglês.** A regra "3+ palavras
   consecutivas da wordlist" acusa `"this option can"` — medido no texto de
   ajuda do próprio `libtest`, num processo sem carteira nenhuma. O veredito usa
   duas condições mais estreitas e, somadas, mais fortes que o "≥ 8 palavras" do
   BRES-66; a contagem literal continua no relatório. Está documentado em
   `tz-memscan/src/lib.rs`, com a medição.
6. **O estimador de força de senha não é zxcvbn.** A crate `zxcvbn` arrasta seis
   dependências transitivas para o caminho da chave, contra a regra de superfície
   mínima da §2.2 N3. O estimador de verdade fica no produto e entra aqui como
   **número**; o embutido é um piso grosseiro que erra para baixo.

---

## Auditoria externa

**Adiada** por decisão de Rafael (§13), e o que substitui o adiamento é
obrigação, não sugestão: os critérios da §9 rodando no CI desde o primeiro
commit, período só em rede de teste, e núcleo público antes de qualquer
auditoria paga.

A conversa volta quando uma build pública passar a segurar chave de terceiro, ou
quando o TAPS mover fundos reais em mainnet.
