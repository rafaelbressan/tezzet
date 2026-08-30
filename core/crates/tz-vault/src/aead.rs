//! §5.4 — AEAD, **por regiao e nao por arquivo**.
//!
//! Um cofre de Android tem, ao mesmo tempo, corpo em XChaCha20-Poly1305 e
//! embrulho `KEK_hw` em AES-256-GCM, porque e isso que o AndroidKeyStore faz.
//! Um `aead_id` so no cabecalho nao descreve esse arquivo — por isso cada
//! embrulho declara o seu em `wrap_aead_id`, e o cabecalho declara o do corpo
//! em `body_aead_id`.
//!
//! # O que este modulo garante
//! - Que o algoritmo **esta escrito no arquivo** e nao inferido do tipo de
//!   embrulho. A alternativa descartada era "`wrap_type = 0x02` implica
//!   AES-256-GCM", e ela **esta errada**: no Windows o `KEK_hw` tambem e
//!   `wrap_type = 0x02`, mas a KEK sai do `KeyCredentialManager` para o nosso
//!   processo e o embrulho e XChaCha20-Poly1305 (§6.2).
//! - Que a largura util do nonce e a do algoritmo, e que o **preenchimento e
//!   conferido**: o campo tem sempre 24 bytes, o AES-GCM usa 12, e os 12
//!   restantes **DEVEM** ser zero. Exigir zero fecha, de graca, um canal de 12
//!   bytes por embrulho para esconder metadado.
//! - Que a verificacao da tag e a da biblioteca — tempo constante, e nossa
//!   nenhuma. **Nao existe hash de verificacao separado:** a tag do AEAD *e* a
//!   verificacao da senha, o que substitui o `walletHash` SHA-512 do TAPS por
//!   algo mais forte e mais simples, e elimina a comparacao com `===`.
//!
//! # O que ele nao garante
//! - Contagem de gravacoes. O limite de 2³² gravacoes por chave do AES-256-GCM
//!   (§5.4) e folgado para um cofre e **nao** e contado aqui; ele esta escrito
//!   para nao ser descoberto depois. Como a DEK e nova a cada gravacao (§4.8),
//!   o limite por chave nunca chega perto.

use crate::error::{Result, VaultError};
use tz_params::vault as v;

/// Qual AEAD, escrito no arquivo.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Algorithm {
    XChaCha20Poly1305,
    Aes256Gcm,
}

impl Algorithm {
    pub fn from_id(id: u8) -> Result<Self> {
        match id {
            v::AEAD_XCHACHA20POLY1305 => Ok(Self::XChaCha20Poly1305),
            v::AEAD_AES256GCM => Ok(Self::Aes256Gcm),
            _ => Err(VaultError::UnknownAead),
        }
    }

    pub fn id(self) -> u8 {
        match self {
            Self::XChaCha20Poly1305 => v::AEAD_XCHACHA20POLY1305,
            Self::Aes256Gcm => v::AEAD_AES256GCM,
        }
    }

    /// Bytes uteis do campo de 24. O resto **DEVE** ser zero.
    pub fn nonce_len(self) -> usize {
        match self {
            Self::XChaCha20Poly1305 => v::NONCE_USED_XCHACHA,
            Self::Aes256Gcm => v::NONCE_USED_AES_GCM,
        }
    }
}

/// Campo de nonce de 24 bytes, com a largura util do algoritmo alinhada a
/// esquerda.
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct NonceField(pub [u8; v::NONCE_FIELD_LEN]);

impl NonceField {
    /// Sorteia um nonce novo do CSPRNG do sistema. **Sempre novo, nunca
    /// contador, nunca derivado do conteudo.** Se o CSPRNG falhar, aborta.
    pub fn fresh(alg: Algorithm) -> Result<Self> {
        let mut f = [0u8; v::NONCE_FIELD_LEN];
        tz_rng::fill(&mut f[..alg.nonce_len()])?;
        Ok(Self(f))
    }

    /// O IV que o cofre de chaves do sistema sorteou (§5.4, excecao unica do
    /// `KEK_hw` do Android). Conferimos o que veio: 12 bytes e nao todo zero.
    pub fn from_platform_iv(alg: Algorithm, iv: &[u8]) -> Result<Self> {
        if iv.len() != alg.nonce_len() || iv.iter().all(|&b| b == 0) {
            return Err(VaultError::BadHardwareIv);
        }
        let mut f = [0u8; v::NONCE_FIELD_LEN];
        f[..iv.len()].copy_from_slice(iv);
        Ok(Self(f))
    }

    /// §5.2 — leitura: largura certa e preenchimento zero, **antes** do KDF.
    pub fn validated(alg: Algorithm, field: [u8; v::NONCE_FIELD_LEN]) -> Result<Self> {
        if field[alg.nonce_len()..].iter().any(|&b| b != 0) {
            return Err(VaultError::BadNoncePadding);
        }
        Ok(Self(field))
    }

    pub fn used(&self, alg: Algorithm) -> &[u8] {
        &self.0[..alg.nonce_len()]
    }
}

/// Cifra e autentica. Devolve `ciphertext ‖ tag`.
pub fn seal(
    alg: Algorithm,
    key: &[u8; 32],
    nonce: &NonceField,
    aad: &[u8],
    pt: &[u8],
) -> Result<Vec<u8>> {
    use chacha20poly1305::aead::{Aead, KeyInit, Payload};
    match alg {
        Algorithm::XChaCha20Poly1305 => {
            let c = chacha20poly1305::XChaCha20Poly1305::new(key.into());
            c.encrypt(
                nonce
                    .used(alg)
                    .try_into()
                    .map_err(|_| VaultError::BadNoncePadding)?,
                Payload { msg: pt, aad },
            )
            .map_err(|_| VaultError::CannotOpen)
        }
        Algorithm::Aes256Gcm => {
            use aes_gcm::aead::{Aead as GcmAead, KeyInit as GcmKeyInit, Payload as GcmPayload};
            let c = aes_gcm::Aes256Gcm::new(key.into());
            GcmAead::encrypt(
                &c,
                nonce
                    .used(alg)
                    .try_into()
                    .map_err(|_| VaultError::BadNoncePadding)?,
                GcmPayload { msg: pt, aad },
            )
            .map_err(|_| VaultError::CannotOpen)
        }
    }
}

/// Verifica e decifra. **Qualquer** falha vira [`VaultError::CannotOpen`]:
/// senha errada e adulteracao sao indistinguiveis por desenho (§9.5).
pub fn open(
    alg: Algorithm,
    key: &[u8; 32],
    nonce: &NonceField,
    aad: &[u8],
    ct: &[u8],
) -> Result<Vec<u8>> {
    use chacha20poly1305::aead::{Aead, KeyInit, Payload};
    match alg {
        Algorithm::XChaCha20Poly1305 => {
            let c = chacha20poly1305::XChaCha20Poly1305::new(key.into());
            c.decrypt(
                nonce
                    .used(alg)
                    .try_into()
                    .map_err(|_| VaultError::CannotOpen)?,
                Payload { msg: ct, aad },
            )
            .map_err(|_| VaultError::CannotOpen)
        }
        Algorithm::Aes256Gcm => {
            use aes_gcm::aead::{Aead as GcmAead, KeyInit as GcmKeyInit, Payload as GcmPayload};
            let c = aes_gcm::Aes256Gcm::new(key.into());
            GcmAead::decrypt(
                &c,
                nonce
                    .used(alg)
                    .try_into()
                    .map_err(|_| VaultError::CannotOpen)?,
                GcmPayload { msg: ct, aad },
            )
            .map_err(|_| VaultError::CannotOpen)
        }
    }
}
