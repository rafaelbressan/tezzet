//! `tz-vault` — **o cofre** (SPEC-0001 §1).
//!
//! Formato de arquivo, KDF, AEAD, envelope de DEK, embrulhos por plataforma,
//! ciclo de vida em memoria. E a parte que se testa **contra ataque**, enquanto
//! `tz-keys` e a que se testa contra vetor conhecido.
//!
//! Esta crate **nao contem nenhuma primitiva criptografica propria** alem da
//! composicao descrita na §5 — a regra de fronteira da §1.
//!
//! # A superficie publica, e o que ela garante
//!
//! | Chamada | Garante | **Nao** garante |
//! |---|---|---|
//! | [`vault::create`] | DEK, sal e nonces novos do CSPRNG do sistema; AEAD em tudo | que a passphrase e boa — isso e [`policy`] |
//! | [`vault::open_with_passphrase`] | validacao estrutural **antes** do KDF; erro sem oraculo | resistencia a malware ativo (N1) |
//! | [`vault::open_with_hardware`] | que negar o prompt nativo faz o **desembrulho falhar** | que a chave do SO esta em hardware — ADR §12.3, aberto ate BRES-67 |
//! | [`vault::write_atomic`] | temporario, `fsync`, `rename`, `fsync` do diretorio | que o disco nao mentiu sobre o `fsync` |
//! | [`policy::accept_passphrase`] | piso de 60 bits, sem "pular por enquanto" | que a senha nao foi reusada de um vazamento (N4) |
//! | [`memory::harden`] | o que a plataforma deixou fazer, **reportado** | que nao sobrou copia em RAM (§7.3: essa prova nao existe) |
//!
//! # O que esta crate nunca faz
//! - Guardar hash de verificacao de senha. A tag do AEAD **e** a verificacao,
//!   o que elimina de vez o `walletHash` SHA-512 e a comparacao com `===` do
//!   TAPS.
//! - Ler parametro de KDF de `Default::default()` de dependencia (§3 item 3).
//!   Todo numero vem de `tz-params`.
//! - `panic` no caminho da chave (§3 item 9).

#![forbid(unsafe_op_in_unsafe_fn)]
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

pub mod aead;
pub mod error;
pub mod format;
pub mod hw;
pub mod kdf;
pub mod memory;
pub mod policy;
pub mod vault;

pub use error::{Result, VaultError};
pub use tz_params as params;
