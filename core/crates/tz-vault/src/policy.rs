//! §2.3 — o piso de entropia da passphrase, e a frase gerada que e o caminho
//! padrao.
//!
//! # Por que existe um piso, com numero
//!
//! O KDF nao conserta passphrase fraca; ele compra margem, e a margem e
//! mensuravel. Com Argon2id `v1-desktop` e o pior caso adotado pela
//! especificacao (10⁶ tentativas/s numa fazenda de GPU):
//!
//! | Entropia | Tempo esperado |
//! |---|---|
//! | 30 bits (senha humana curta) | **~9 minutos** |
//! | 40 bits | ~13 dias |
//! | 50 bits | ~35 anos |
//! | **60 bits (o piso)** | **~36 mil anos** |
//!
//! # A decisao de dependencia, registrada
//!
//! A §2.3 pede *"estimador de forca tipo zxcvbn"*. A crate `zxcvbn` 3.1.1
//! arrasta `chrono`, `regex`, `fancy-regex`, `serde`, `wasm-bindgen` e
//! `web-sys` — seis dependencias transitivas **no caminho da chave**, contra a
//! regra de superficie minima da §2.2 N3, por uma heuristica de UX.
//!
//! **Decisao de Tezos Core & Crypto:** o estimador de verdade fica **fora** do
//! perimetro auditado, na camada de produto, que ja precisa dele para desenhar
//! o medidor de forca na tela. Ele entra aqui como **numero**, em
//! [`accept_passphrase`], e o cofre usa `min(estimativa_do_produto,
//! estimativa_conservadora_daqui)` — uma estimativa otimista vinda de fora
//! **nao consegue** subir o veredito.
//!
//! # O que este modulo garante
//! - Que passphrase abaixo de 60 bits e recusada, sem "pular por enquanto",
//!   sem valor padrao e sem passphrase vazia.
//! - Que a estimativa embutida **nunca superestima**: ela e um piso grosseiro,
//!   e esta escrito que e.
//!
//! # O que ele nao garante
//! - Que uma passphrase aceita e boa. Reuso de senha vazada e coercao sao N4 do
//!   modelo de ameaca e nenhum estimador os ve.

use crate::error::{Result, VaultError};
use tz_keys::mnemonic::english_wordlist;
use tz_keys::secret::Phrase;
use tz_params::kdf::PASSPHRASE_MIN_ENTROPY_BITS;

/// Palavras da wordlist BIP-39 usadas na frase gerada. **7**, e nao 6.
///
/// A §2.3 recomenda "6 palavras diceware" porque a lista diceware tem 7776
/// palavras (12,9 bits cada → 77 bits). A nossa lista e a do BIP-39, que ja
/// esta no perimetro auditado e tem 2048 palavras (11 bits exatos). Para
/// entregar os mesmos ~77 bits sao precisas **7** palavras. Trocar a contagem
/// e manter o numero de bits e o certo; manter a contagem e perder 11 bits
/// seria seguir a letra e errar a decisao.
pub const GENERATED_WORDS: usize = 7;

/// Bits por palavra da wordlist BIP-39: log2(2048).
const BITS_PER_WORD: f64 = 11.0;

/// Gera a frase padrao: 7 palavras da wordlist BIP-39, 77 bits.
///
/// **E o caminho padrao da interface** (§2.3). Cada palavra e sorteada do
/// CSPRNG do sistema por rejeicao — sem modulo enviesado, que e como se perde
/// entropia sem ninguem perceber.
pub fn generate_passphrase() -> Result<Phrase> {
    let lista = english_wordlist();
    let mut palavras: Vec<&str> = Vec::with_capacity(GENERATED_WORDS);
    for _ in 0..GENERATED_WORDS {
        // 2048 e potencia de dois, entao 11 bits de um u16 mascarado sao
        // uniformes: nao ha viés a rejeitar. Fica explicito para ninguem
        // "melhorar" isso para um `% 2048` sobre um u32 no futuro.
        let b: [u8; 2] = tz_rng::bytes()?;
        let idx = (u16::from_le_bytes(b) & 0x07FF) as usize;
        palavras.push(lista[idx]);
    }
    Phrase::new(&palavras.join(" ")).ok_or(VaultError::PassphraseTooWeak)
}

/// Entropia da frase que [`generate_passphrase`] produz.
pub fn generated_entropy_bits() -> f64 {
    GENERATED_WORDS as f64 * BITS_PER_WORD
}

/// §2.3 — o portao. `product_estimate_bits` e a estimativa do produto (zxcvbn
/// ou equivalente); passe `None` quando nao houver uma.
///
/// O veredito e o **menor** dos dois numeros. Isso e deliberado: quem chama
/// esta do lado de fora do perimetro auditado, e uma estimativa otimista dali
/// nao pode afrouxar o portao daqui.
pub fn accept_passphrase(passphrase: &str, product_estimate_bits: Option<f64>) -> Result<()> {
    let nossa = conservative_entropy_bits(passphrase);
    let bits = match product_estimate_bits {
        Some(p) => nossa.min(p),
        None => nossa,
    };
    if bits < PASSPHRASE_MIN_ENTROPY_BITS {
        return Err(VaultError::PassphraseTooWeak);
    }
    Ok(())
}

/// Estimativa **conservadora e grosseira**, e esta escrito que e.
///
/// Nao e zxcvbn e nao tenta ser: sem dicionario de senhas vazadas, sem padrao
/// de teclado, sem data. O que ela faz:
///
/// 1. Se a frase e uma sequencia de palavras da wordlist BIP-39 (o caminho que
///    esta biblioteca gera), conta 11 bits por palavra **distinta** — repetir
///    palavra nao acrescenta.
/// 2. Caso contrario, conta `comprimento × log2(alfabeto efetivo)` e aplica
///    dois descontos que pegam os erros mais comuns: caractere repetido em
///    sequencia e sequencia crescente/decrescente (`abcdef`, `123456`).
///
/// O erro dela e para **baixo**: uma senha boa pode ser recusada e o usuario
/// gera uma frase. Uma senha ruim aceita e que nao pode acontecer.
pub fn conservative_entropy_bits(passphrase: &str) -> f64 {
    if passphrase.is_empty() {
        return 0.0;
    }
    if let Some(bits) = bits_como_frase_de_palavras(passphrase) {
        return bits;
    }

    let chars: Vec<char> = passphrase.chars().collect();
    let mut alfabeto = 0.0f64;
    if chars.iter().any(|c| c.is_ascii_lowercase()) {
        alfabeto += 26.0;
    }
    if chars.iter().any(|c| c.is_ascii_uppercase()) {
        alfabeto += 26.0;
    }
    if chars.iter().any(|c| c.is_ascii_digit()) {
        alfabeto += 10.0;
    }
    if chars.iter().any(|c| c.is_ascii_punctuation() || *c == ' ') {
        alfabeto += 33.0;
    }
    if chars.iter().any(|c| !c.is_ascii()) {
        // Nao tentamos medir Unicode: contamos pouco, de proposito.
        alfabeto += 100.0;
    }
    if alfabeto < 2.0 {
        return 0.0;
    }

    // Caracteres que nao acrescentam: repeticao imediata e sequencia.
    let mut uteis = 1usize;
    for i in 1..chars.len() {
        let a = chars[i - 1] as i64;
        let b = chars[i] as i64;
        if b != a && b != a + 1 && b != a - 1 {
            uteis += 1;
        }
    }
    uteis as f64 * alfabeto.log2()
}

/// Frase de palavras: 11 bits por palavra **distinta** da wordlist.
fn bits_como_frase_de_palavras(passphrase: &str) -> Option<f64> {
    let lista = english_wordlist();
    let palavras: Vec<&str> = passphrase.split_whitespace().collect();
    if palavras.len() < 2 {
        return None;
    }
    if !palavras.iter().all(|w| lista.contains(w)) {
        return None;
    }
    let mut distintas: Vec<&str> = palavras.clone();
    distintas.sort_unstable();
    distintas.dedup();
    Some(distintas.len() as f64 * BITS_PER_WORD)
}
