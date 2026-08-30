//! §9.7 — o erro que atravessa a fronteira de IPC.
//!
//! Enum fechado. As unicas variantes com payload carregam **outros enums
//! fechados sem dado** (`KeyError`, `VaultError`), nunca `String` e nunca
//! bytes. `tests/caminho_de_erro.rs` fixa o tamanho e varre o texto atras de
//! material vazado.

use core::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum CoreError {
    /// §8.1 — a verificacao de usuario nativa nao teve sucesso. Inclui "o
    /// usuario negou" **e** "esta plataforma nao tem mecanismo": as duas sao
    /// "nao verificou", e tratar a segunda como permissao e o item 15 do
    /// anti-catalogo.
    UserVerificationFailed,
    /// §5.9 — a sessao expirou por inatividade, ou foi trancada.
    SessionLocked,
    /// Vindo do cofre.
    Vault(tz_vault::VaultError),
    /// Vindo da identidade da chave.
    Key(tz_keys::KeyError),
}

impl fmt::Display for CoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UserVerificationFailed => f.write_str("verificacao de usuario nao concluida"),
            Self::SessionLocked => f.write_str("a carteira esta trancada"),
            Self::Vault(e) => write!(f, "{e}"),
            Self::Key(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for CoreError {}

impl From<tz_vault::VaultError> for CoreError {
    fn from(e: tz_vault::VaultError) -> Self {
        Self::Vault(e)
    }
}

impl From<tz_keys::KeyError> for CoreError {
    fn from(e: tz_keys::KeyError) -> Self {
        Self::Key(e)
    }
}

impl From<tz_rng::EntropyUnavailable> for CoreError {
    fn from(_: tz_rng::EntropyUnavailable) -> Self {
        Self::Vault(tz_vault::VaultError::EntropyUnavailable)
    }
}

/// O codigo estavel que atravessa a fronteira de IPC. E **isto** que o
/// JavaScript recebe — nunca uma mensagem formatada, nunca um `Debug`.
pub fn wire_code(e: &CoreError) -> &'static str {
    match e {
        CoreError::UserVerificationFailed => "USER_VERIFICATION_FAILED",
        CoreError::SessionLocked => "SESSION_LOCKED",
        CoreError::Key(_) => "KEY_ERROR",
        CoreError::Vault(v) => match v {
            tz_vault::VaultError::CannotOpen => "VAULT_CANNOT_OPEN",
            tz_vault::VaultError::PassphraseTooWeak => "PASSPHRASE_TOO_WEAK",
            tz_vault::VaultError::HardwareKeyRefused => "HARDWARE_KEY_REFUSED",
            tz_vault::VaultError::HardwareKeyUnsupported => "HARDWARE_KEY_UNSUPPORTED",
            tz_vault::VaultError::EntropyUnavailable => "ENTROPY_UNAVAILABLE",
            tz_vault::VaultError::Io => "VAULT_IO",
            _ => "VAULT_MALFORMED",
        },
    }
}

pub type Result<T> = core::result::Result<T, CoreError>;
