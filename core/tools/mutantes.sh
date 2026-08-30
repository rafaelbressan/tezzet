#!/usr/bin/env bash
# Os portoes so valem se ficarem vermelhos quando deveriam.
#
# Cada mutante insere **um defeito real por vez** e exige que o portao
# correspondente falhe. Um portao que passa com o defeito no lugar e um portao
# decorativo, e um teste verde que nao significa nada e pior que nenhum teste.
#
# Licao herdada do BRES-66, item 5 do "o que foi dificil": *"meu proprio arnes
# de mutantes mentiu. O `git checkout -- .` falhou em silencio numa arvore com
# `target/` versionado e deixou o mutante preso no codigo."* Aqui o revert e
# **conferido**, e o script aborta se a arvore nao voltar limpa.
#
# Uso: ./tools/mutantes.sh          (na raiz do workspace `core/`)

set -uo pipefail

CORE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$CORE_DIR" || exit 1
REPO_ROOT="$(git -C "$CORE_DIR" rev-parse --show-toplevel)"

vermelho() { printf '\033[31m%s\033[0m\n' "$*"; }
verde()    { printf '\033[32m%s\033[0m\n' "$*"; }
cinza()    { printf '\033[90m%s\033[0m\n' "$*"; }

if ! git -C "$REPO_ROOT" diff --quiet -- "$CORE_DIR"; then
  vermelho "a arvore de core/ tem mudancas nao commitadas; commite ou guarde antes de rodar os mutantes"
  exit 1
fi

reverter() {
  git -C "$REPO_ROOT" checkout -- "$CORE_DIR" || { vermelho "o revert falhou"; exit 1; }
  if ! git -C "$REPO_ROOT" diff --quiet -- "$CORE_DIR"; then
    vermelho "ABORTANDO: a arvore nao voltou limpa depois do revert. Um mutante pode ter ficado preso no codigo."
    exit 1
  fi
}

FALHAS=0
TOTAL=0

# muta <nome> <arquivo> <de> <para> <comando-de-teste>
muta() {
  local nome="$1" arquivo="$2" de="$3" para="$4" cmd="$5"
  TOTAL=$((TOTAL + 1))
  printf '\n== mutante %d: %s\n' "$TOTAL" "$nome"

  if ! grep -qF -- "$de" "$arquivo"; then
    vermelho "  NAO APLICADO: o trecho a mutar sumiu de $arquivo — o mutante envelheceu e precisa ser reescrito"
    FALHAS=$((FALHAS + 1))
    return
  fi
  python3 - "$arquivo" "$de" "$para" <<'PY'
import sys
caminho, de, para = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(caminho).read()
assert de in s
open(caminho, 'w').write(s.replace(de, para, 1))
PY

  cinza "  portao: $cmd"
  if eval "$cmd" > /tmp/mutante-$TOTAL.log 2>&1; then
    vermelho "  PASSOU COM O DEFEITO NO LUGAR — o portao e decorativo"
    tail -5 /tmp/mutante-$TOTAL.log | sed 's/^/    /'
    FALHAS=$((FALHAS + 1))
  else
    verde "  o portao ficou vermelho, como deveria"
    grep -m1 -E "reprovou|panicked at|assertion|should fail to compile|error\[" /tmp/mutante-$TOTAL.log | sed 's/^/    /'
  fi
  reverter
}

echo "mutantes do nucleo criptografico — SPEC-0001 §9"

# 1. Um tipo de segredo volta a ser clonavel. Cada clone e uma copia que
#    ninguem lembra de zerar (§7.1.3).
muta "Scalar volta a ser clonavel" \
  crates/tz-keys/src/secret.rs \
  '        $(#[$meta])*
        pub struct $t(Box<[u8; $n]>);' \
  '        $(#[$meta])*
        #[derive(Clone)]
        pub struct $t(Box<[u8; $n]>);' \
  'cargo test -p tz-keys --test compilacao_deve_falhar'

# 2. Os segredos voltam para array direto. Em Rust, mover um valor e um memcpy
#    que **nao zera a origem** — e foi este mutante, na vida real, que a §9.6
#    pegou antes de o codigo ser commitado.
muta "segredo volta para array direto (a copia deixada pelo move)" \
  crates/tz-keys/src/secret.rs \
  'pub struct $t(Box<[u8; $n]>);' \
  'pub struct $t([u8; $n]);' \
  'cargo build -p tezos-core --features memscan-gate --example cria_cofre >/dev/null 2>&1; cargo test -p tezos-core --features memscan-gate --test memscan_portao -- --test-threads=1'

# 3. A sessao guarda a "frase de recuperacao" para mostrar depois. Item 1 da
#    lista de conta-zero da §9.6 (§7.1.4).
muta "a sessao aberta guarda a mnemonica" \
  crates/tezos-core/src/session.rs \
  '    Ok((session, frase))' \
  '    let mut session = session;
    let guardada = frase.expose().to_string();
    session.identity_mut().public_key = guardada;
    Ok((session, frase))' \
  'cargo build -p tezos-core --features memscan-gate --example cria_cofre >/dev/null 2>&1; cargo test -p tezos-core --features memscan-gate --test memscan_portao -- --test-threads=1'

# 4. O varredor le a regiao errada. Sem o controle positivo, um dump vazio
#    passaria por engano (§9.6).
muta "o varredor le a regiao errada" \
  crates/tz-memscan/src/lib.rs \
  '        if caminho.starts_with('"'"'/'"'"') || caminho == "[vvar]" || caminho == "[vsyscall]" {' \
  '        if !caminho.starts_with('"'"'/'"'"') || caminho == "[vvar]" || caminho == "[vsyscall]" {' \
  'cargo build -p tezos-core --features memscan-gate --example cria_cofre >/dev/null 2>&1; cargo test -p tezos-core --features memscan-gate --test memscan_portao -- --test-threads=1'

# 5. O CSPRNG ganha um fallback "so para o app nao quebrar". E o unico ponto do
#    sistema onde um erro produz carteira previsivel e silenciosa (§4.1).
muta "o CSPRNG ganha um fallback" \
  crates/tz-rng/src/lib.rs \
  '    if is_down() {
        return Err(EntropyUnavailable);
    }
    fill_from_os(buf)' \
  '    if is_down() {
        for (i, b) in buf.iter_mut().enumerate() {
            *b = (i as u8).wrapping_mul(31);
        }
        return Ok(());
    }
    fill_from_os(buf)' \
  'cargo test -p tz-vault --features fault-injection --test cofre sem_csprng'

# 6. O erro passa a carregar a senha tentada. Uma `String` de erro e o lugar
#    classico onde o segredo vaza para o log, o `Debug` e a UI ao mesmo tempo.
muta "o erro carrega a senha tentada" \
  crates/tz-vault/src/error.rs \
  '            Self::CannotOpen => "nao foi possivel abrir o cofre",' \
  '            Self::CannotOpen => "nao foi possivel abrir o cofre com a senha correto-Cavalo-Bateria-Grampo-2026!",' \
  'cargo test -p tezos-core --test caminho_de_erro a_senha_errada'

# 7. A validacao de faixa some do caminho de abertura. O arquivo passa a
#    mandar no processo: 8 GiB de memoria a pedido (§5.6).
muta "a faixa do KDF deixa de ser validada antes do KDF" \
  crates/tz-vault/src/kdf.rs \
  '        let na_faixa = (p::M_KIB_MIN..=p::M_KIB_MAX).contains(&m_kib)' \
  '        return Ok(());
        #[allow(unreachable_code)]
        let na_faixa = (p::M_KIB_MIN..=p::M_KIB_MAX).contains(&m_kib)' \
  'cargo test -p tz-vault --features fault-injection --test cofre parametros_fora_da_faixa'

# 8. O preenchimento do nonce do AES-GCM deixa de ser conferido. Item 20 do
#    anti-catalogo: 12 bytes por embrulho para esconder metadado (§5.2).
muta "o preenchimento do nonce deixa de ser conferido" \
  crates/tz-vault/src/aead.rs \
  '        if field[alg.nonce_len()..].iter().any(|&b| b != 0) {
            return Err(VaultError::BadNoncePadding);
        }' \
  '        // preenchimento nao conferido' \
  'cargo test -p tz-vault --features fault-injection --test cofre preenchimento_de_nonce'

# 9. Um `#[tauri::command]` novo entra sem ser enumerado. E o residuo de P3.a
#    da ADR-0001 §12.1, que esta issue existe para fechar.
muta "um #[tauri::command] novo nao enumerado" \
  crates/tezos-core/src/lib.rs \
  'pub fn build_report() -> String {' \
  '#[tauri::command]
pub fn export_secret_key() -> String {
    String::new()
}

pub fn build_report() -> String {' \
  'cargo test -p tz-ipc-guard --test portao a_superficie_declarada'

# 10. A assinatura deixa de exigir verificacao de usuario. Item 15 do
#     anti-catalogo, e o defeito exato do spike BRES-36 (`lib.rs:132`).
muta "assinar deixa de exigir verificacao de usuario" \
  crates/tezos-core/src/session.rs \
  '        prompt.verify_user(Purpose::SignOperation)?;' \
  '        let _ = prompt.verify_user(Purpose::SignOperation);' \
  'cargo test -p tezos-core --test caminho_de_erro assinar_sem_verificacao'

printf '\n'
if [ "$FALHAS" -eq 0 ]; then
  verde "os $TOTAL mutantes deixaram os portoes vermelhos. Os portoes pegam o que existem para pegar."
  exit 0
else
  vermelho "$FALHAS de $TOTAL mutantes NAO deixaram o portao vermelho."
  exit 1
fi
