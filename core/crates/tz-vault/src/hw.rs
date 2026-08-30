//! §5.1(B), §6.2 e §6.3 — o embrulho `KEK_hw`, nas **duas** formas que as
//! plataformas realmente oferecem.
//!
//! O ponto criptografico que decide o desenho: **biometria nao decifra nada.**
//! Digital nao e chave. O que toda plataforma que faz isso direito oferece e o
//! sistema operacional guardar uma chave em hardware e **liberar o uso dela**
//! apos uma verificacao de usuario bem-sucedida. Biometria e sempre portao
//! sobre chave guardada em hardware, nunca entrada de KDF. E por isso que
//! `KEK_pass` sempre existe: e o unico fator que sobrevive a wipe do aparelho,
//! a digital reenrolada e a aparelho perdido.
//!
//! **Perder o `KEK_hw` nao custa nada: cai na passphrase.**
//!
//! # Por que sao duas interfaces e nao uma
//!
//! | Plataforma | Onde a cifra roda | Quem sorteia o nonce | Interface |
//! |---|---|---|---|
//! | Windows (`KeyCredentialManager`) | no **nosso** processo | nos | [`HardwareKek`] |
//! | Android (AndroidKeyStore) | **dentro** do Keystore | o Keystore | [`HardwareSealer`] |
//!
//! Colapsar as duas numa so obrigaria a fingir que a chave do Android sai do
//! Keystore — e ela nao sai, e e exatamente isso que faz o vinculo valer.
//!
//! # O que este modulo garante
//! - Que o `wrap_aead_id` e **perguntado a plataforma**, nao inferido do
//!   `wrap_type`.
//! - Que o IV devolvido pelo Keystore e conferido antes de ir para o arquivo:
//!   12 bytes e nao todo zero (§5.4). Nao confiamos cegamente.
//!
//! # O que ele nao garante
//! - Que a chave do sistema esta em hardware. O `KeyInfo.getSecurityLevel()`
//!   do aparelho e que diz, e o BRES-66 mediu `Software` num emulador. O
//!   override humano da ADR-0001 §12.3 aceitou esse risco explicitamente, e
//!   **nada neste nucleo pode depender de o Keystore ter respaldo de
//!   hardware** ate o BRES-67 medir em aparelho com TEE.
//! - Que negar o prompt biometrico feche a tela. O que ele garante e o
//!   contrario e melhor: o desembrulho **falha**.

use crate::aead::Algorithm;
use crate::error::Result;
use crate::kdf::Kek;

/// Plataforma que entrega a KEK ao nosso processo apos verificacao de usuario
/// nativa. Caso do Windows Hello (§6.2).
pub trait HardwareKek {
    /// Alias / handle que vai em `ctx`. **Nunca segredo.**
    fn ctx(&self) -> Vec<u8>;
    /// O AEAD deste embrulho — no Windows, XChaCha20-Poly1305, porque a cifra
    /// roda aqui e o nonce e nosso.
    fn aead(&self) -> Algorithm;
    /// Coleta a verificacao de usuario por **prompt nativo** e devolve a KEK.
    fn unlock(&self, ctx: &[u8]) -> Result<Kek>;
}

/// Plataforma que sela e abre **dentro** do proprio cofre de chaves, sem a
/// chave sair. Caso do AndroidKeyStore (§6.3).
pub trait HardwareSealer {
    fn ctx(&self) -> Vec<u8>;
    /// AES-256-GCM no Android: e o que o Keystore faz.
    fn aead(&self) -> Algorithm;
    /// Sela a DEK. Devolve `(iv sorteado pela plataforma, ciphertext ‖ tag)`.
    ///
    /// A implementacao **NAO DEVE** fornecer IV proprio e **NAO DEVE** desligar
    /// `setRandomizedEncryptionRequired(true)` para poder fornecer — desligar e
    /// o que reintroduz reuso de nonce, e e o item 19 do anti-catalogo.
    fn seal(&self, aad: &[u8], dek: &[u8; 32]) -> Result<(Vec<u8>, Vec<u8>)>;
    /// Abre a DEK. O prompt nativo prende o `Cipher` por `CryptoObject`, entao
    /// negar o prompt faz **esta** chamada falhar com
    /// [`crate::error::VaultError::HardwareKeyRefused`].
    fn open(&self, aad: &[u8], iv: &[u8], ct_and_tag: &[u8]) -> Result<Kek>;
}

/// Como esta plataforma faz o `KEK_hw`.
pub enum Hardware<'a> {
    /// A KEK vem para o nosso processo (Windows).
    Kek(&'a dyn HardwareKek),
    /// A cifra acontece dentro do cofre de chaves (Android).
    Sealer(&'a dyn HardwareSealer),
}

impl Hardware<'_> {
    pub fn ctx(&self) -> Vec<u8> {
        match self {
            Self::Kek(h) => h.ctx(),
            Self::Sealer(h) => h.ctx(),
        }
    }

    pub fn aead(&self) -> Algorithm {
        match self {
            Self::Kek(h) => h.aead(),
            Self::Sealer(h) => h.aead(),
        }
    }
}
