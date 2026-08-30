//! `tz-keys` — **identidade da chave** (SPEC-0001 §1).
//!
//! Deterministico, sem estado. **Nao le nem escreve arquivo e nao chama API do
//! sistema operacional.** Essa nao e uma promessa de comentario: a crate nao
//! depende de `libc`, de `tz-rng` nem de nada do sistema, e
//! `tests/fronteira.rs` reprova quando alguem acrescenta uma dessas coisas. Um
//! bug aqui nao deve exigir reauditar o `tz-vault`, e vice-versa.
//!
//! Entropia entra como argumento ([`mnemonic::Mnemonic::from_entropy`]) porque
//! sortear e falar com o sistema operacional, e isso e de `tz-rng`.
//!
//! # A superficie publica, e o que ela garante
//!
//! | Chamada | Garante | **Nao** garante |
//! |---|---|---|
//! | [`mnemonic::Mnemonic::parse`] | wordlist, checksum e contagem validados (§4.2) | que a frase e a do usuario |
//! | [`mnemonic::Mnemonic::to_seed`] | PBKDF2-HMAC-SHA512, 2048, sal `"mnemonic"‖pass` | protecao em repouso — isso e o Argon2id do `tz-vault` |
//! | [`derive::derive`] | SLIP-0010 **so endurecido**, vetores oficiais no CI | caminho nao-endurecido, que nao existe aqui |
//! | [`address::validate`] | prefixo, comprimento e checksum; `tz4` aceito; `tz5` recusado como *nao suportado* | nada sobre a cadeia |
//! | [`sign::SecretKey::sign`] | watermark obrigatorio, low-S, so `0x03` na v1 | que os bytes sao a operacao que o usuario pediu |
//! | [`secret`] | tamanho fixo, sem `Clone`/`Debug`/serializacao, zera no drop | que nao sobrou copia em RAM (§7.3 — essa prova nao existe) |
//!
//! # O que esta crate nunca faz
//! - Reimplementar primitiva. HMAC, SHA-512, BLAKE2b, PBKDF2, Ed25519, ECDSA e
//!   base58check vem de biblioteca mantida (§12.1). O que e nosso e a
//!   **composicao** do SLIP-0010 endurecido, sob as tres condicoes escritas em
//!   [`derive`].
//! - `panic`, `unwrap` ou `expect` no caminho da chave (§3 item 9).

#![forbid(unsafe_op_in_unsafe_fn)]
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

pub mod address;
pub mod base58;
pub mod derive;
pub mod error;
pub mod mnemonic;
pub mod secret;
pub mod sign;

pub use error::{KeyError, Result};
pub use tz_params as params;
