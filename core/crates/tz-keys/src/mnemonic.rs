//! §4.2 — BIP-39, com a validacao que decide se o usuario recupera a carteira.
//!
//! # O que este modulo garante
//! - **Wordlist validada na importacao.** Toda palavra pertence a lista
//!   inglesa, comparada por indice.
//! - **Checksum validado na importacao, e bloqueante.** Nao e aviso. Uma
//!   palavra digitada errada que ainda esteja na wordlist gera silenciosamente
//!   **outra carteira valida**, com outro endereco e saldo zero — e o usuario
//!   conclui que perdeu os fundos. Esse e o defeito exato apontado no
//!   `ANALYSIS.md` do Tezzet, e e a diferenca entre um erro visivel e uma
//!   perda irreversivel.
//! - **Contar palavras nao e validar.** A contagem e a primeira porta, nao a
//!   ultima.
//! - Normalizacao **NFKD** antes de qualquer processamento, em geracao e em
//!   importacao.
//! - PBKDF2-HMAC-SHA512, 2048 iteracoes, sal `"mnemonic" ‖ passphrase`, saida
//!   de 64 bytes — os numeros vivem em `tz_params::bip39`.
//!
//! # O que ele nao garante
//! - Que a frase e a **do usuario**. Uma frase valida de outra pessoa e valida.
//! - Que 2048 iteracoes de PBKDF2 protegem alguma coisa em repouso. **Nao
//!   protegem**, e esta escrito assim na §4.2: 2048 e o padrao BIP-39 e mudar
//!   torna a carteira irrestauravel em qualquer outra carteira, o que e pior
//!   que o risco. A protecao em repouso e o Argon2id do cofre (`tz-vault`).
//!   Este comentario existe para ninguem confundir os dois e achar que ja tem
//!   um KDF caro no caminho.
//!
//! A geracao **nao** sorteia entropia: `tz-keys` e deterministico e nao fala
//! com o sistema operacional (§1). Quem sorteia e `tz-rng`, e a entropia entra
//! aqui como argumento.

use crate::error::{KeyError, Result};
use crate::secret::{Entropy, Phrase, Seed};
use tz_params::bip39 as p;
use unicode_normalization::UnicodeNormalization;

/// Uma frase **ja validada**: wordlist, checksum e contagem.
///
/// O tipo e a garantia. Uma funcao que recebe `Mnemonic` sabe que a validacao
/// aconteceu; uma que recebe `&str` nao sabe de nada.
pub struct Mnemonic {
    phrase: Phrase,
}

impl Mnemonic {
    /// Constroi a partir da entropia. §4.1: criacao nova usa 32 bytes → 24
    /// palavras.
    pub fn from_entropy(entropy: &Entropy) -> Result<Self> {
        let m = bip39::Mnemonic::from_entropy(entropy.expose()).map_err(map_bip39)?;
        // A `String` que a `bip39` monta e uma copia que nao controlamos.
        // Copiamos para o buffer fixo e zeramos a dela — e menos do que a §7
        // promete, e esta registrado como tal no relatorio de build.
        let mut s = m.to_string();
        let phrase = Phrase::new(&s).ok_or(KeyError::MnemonicWordCount)?;
        zeroize_string(&mut s);
        Ok(Self { phrase })
    }

    /// **O caminho da importacao.** Normaliza, confere contagem, wordlist e
    /// checksum, nesta ordem, e recusa em qualquer uma delas.
    pub fn parse(input: &str) -> Result<Self> {
        let mut normalized = normalize_words(input);
        let count = normalized.split(' ').filter(|w| !w.is_empty()).count();
        if !p::WORD_COUNTS_ACCEPTED.contains(&count) {
            zeroize_string(&mut normalized);
            return Err(KeyError::MnemonicWordCount);
        }
        // A wordlist e o checksum sao conferidos aqui dentro. A crate declarada
        // sem `default-features` valida os dois e devolve variantes distintas.
        let parsed = bip39::Mnemonic::parse_in_normalized(bip39::Language::English, &normalized);
        let phrase = match parsed {
            Ok(_) => Phrase::new(&normalized).ok_or(KeyError::MnemonicWordCount)?,
            Err(e) => {
                zeroize_string(&mut normalized);
                return Err(map_bip39(e));
            }
        };
        zeroize_string(&mut normalized);
        Ok(Self { phrase })
    }

    /// A semente de 64 bytes — **o que o cofre guarda** (§4.2).
    ///
    /// `passphrase` e a "25ª palavra" do BIP-39: aceita na importacao, **nao
    /// oferecida na criacao na v1**, porque e um segundo segredo que nao esta
    /// escrito nas 24 palavras e o backup pareceria correto sem ela.
    pub fn to_seed(&self, passphrase: &str) -> Result<Seed> {
        let mut salt = Vec::with_capacity(p::SEED_SALT_PREFIX.len() + passphrase.len() * 2);
        salt.extend_from_slice(p::SEED_SALT_PREFIX);
        for c in passphrase.nfkd() {
            let mut b = [0u8; 4];
            salt.extend_from_slice(c.encode_utf8(&mut b).as_bytes());
        }
        let mut seed = Seed::zeroed();
        pbkdf2::pbkdf2_hmac::<sha2::Sha512>(
            self.phrase.expose().as_bytes(),
            &salt,
            p::PBKDF2_ITERATIONS,
            seed.expose_mut(),
        );
        zeroize_bytes(&mut salt);
        Ok(seed)
    }

    pub fn phrase(&self) -> &Phrase {
        &self.phrase
    }

    pub fn word_count(&self) -> usize {
        self.phrase.word_count()
    }
}

/// A wordlist inglesa. Usada tambem pelo varredor de memoria da §9.6, que
/// procura sequencias dela no heap.
pub fn english_wordlist() -> &'static [&'static str; 2048] {
    bip39::Language::English.word_list()
}

/// NFKD e colapso de espaco em branco, na ordem da §4.2: normalizar **antes**
/// de qualquer processamento.
fn normalize_words(input: &str) -> String {
    let folded: String = input.nfkd().collect();
    folded
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn map_bip39(e: bip39::Error) -> KeyError {
    match e {
        bip39::Error::BadWordCount(_) => KeyError::MnemonicWordCount,
        bip39::Error::UnknownWord(_) => KeyError::MnemonicUnknownWord,
        bip39::Error::InvalidChecksum => KeyError::MnemonicChecksum,
        bip39::Error::BadEntropyBitCount(_) => KeyError::EntropyLength,
        _ => KeyError::MnemonicUnknownWord,
    }
}

fn zeroize_string(s: &mut String) {
    use zeroize::Zeroize;
    // SAFETY: escrevemos zeros, que sao UTF-8 valido, e a `String` e
    // descartada logo em seguida.
    unsafe { s.as_mut_vec().zeroize() };
    s.clear();
}

fn zeroize_bytes(v: &mut Vec<u8>) {
    use zeroize::Zeroize;
    v.zeroize();
}
