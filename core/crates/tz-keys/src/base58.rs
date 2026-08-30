//! §4.4 — codificacao e validacao base58check.
//!
//! # O que este modulo garante
//! - Que decodificar casa **prefixo e comprimento**, os dois. A §4.4 nomeia o
//!   bug que isso evita: `edsk` tem dois prefixos diferentes — 32 bytes
//!   (semente) e 64 bytes (chave expandida) — e um decodificador que so olha o
//!   texto `edsk` aceita um pelo outro. Ja aconteceu em producao em outros
//!   projetos.
//! - Que o checksum e conferido. Um caractere trocado nunca passa: sem isso,
//!   um endereco que passa por regex vira fundos enviados para o vazio.
//!
//! # O que ele nao garante
//! - Que o endereco existe na cadeia, que tem saldo, ou que e de quem o
//!   usuario pensa. Isso e a camada de cadeia (BRES-42), nao esta.
//!
//! A primitiva vem de `base58ck` (rust-bitcoin). A §12.1 reprovou `bs58` por
//! P4 — 27 meses sem commit — e nomeou esta substituta.

use crate::error::{KeyError, Result};

/// `base58check(prefixo ‖ carga)`.
pub fn encode(prefix: &[u8], payload: &[u8]) -> String {
    let mut buf = Vec::with_capacity(prefix.len() + payload.len());
    buf.extend_from_slice(prefix);
    buf.extend_from_slice(payload);
    base58ck::Base58CkString::encode_unbounded(&buf)
        .as_str()
        .to_owned()
}

/// Decodifica exigindo **este** prefixo e **este** comprimento de carga.
///
/// Nao existe versao que aceite "qualquer prefixo que comece com `edsk`". Essa
/// funcao seria o bug.
pub fn decode_exact(text: &str, prefix: &[u8], payload_len: usize) -> Result<Vec<u8>> {
    let raw = base58ck::decode_check(text).map_err(|_| KeyError::Base58Checksum)?;
    if raw.len() != prefix.len() + payload_len {
        return Err(KeyError::Base58Prefix);
    }
    if &raw[..prefix.len()] != prefix {
        return Err(KeyError::Base58Prefix);
    }
    Ok(raw[prefix.len()..].to_vec())
}

/// Decodifica so ate o checksum, sem opinar sobre prefixo. Uso interno de quem
/// precisa **descobrir** qual e o prefixo — o parser de endereco, que tem que
/// distinguir "tipo que nao suportamos" de "dado corrompido".
pub(crate) fn decode_checked(text: &str) -> Result<Vec<u8>> {
    base58ck::decode_check(text).map_err(|_| KeyError::Base58Checksum)
}

/// Comeca com este prefixo de bytes?
pub(crate) fn starts_with(raw: &[u8], prefix: &[u8]) -> bool {
    raw.len() > prefix.len() && &raw[..prefix.len()] == prefix
}
