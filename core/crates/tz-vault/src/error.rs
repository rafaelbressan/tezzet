//! §9.5 e P3.c — o erro do cofre carrega a variante, nunca o material, e
//! **nunca um oraculo**.
//!
//! A regra que decide o desenho deste enum: *"Senha errada → falha, com erro
//! indistinguivel de arquivo adulterado."* Por isso existe **uma** variante
//! para os dois — [`VaultError::CannotOpen`] — e nao duas com o mesmo texto.
//! Duas variantes com o mesmo `Display` continuam distinguiveis por `Debug`,
//! por `PartialEq` e pelo JSON que atravessa a fronteira, e um oraculo que so
//! aparece no log ainda e um oraculo.
//!
//! As demais variantes descrevem a **forma do arquivo**, nao o segredo: recusar
//! um `magic` errado com erro proprio nao conta nada sobre a senha, e ajuda o
//! usuario a entender que apontou para o arquivo errado.

use core::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum VaultError {
    /// **A unica falha criptografica.** Senha errada, arquivo adulterado, byte
    /// virado, `wrap_aead_id` trocado por outro valor valido — tudo cai aqui,
    /// de proposito.
    CannotOpen,

    /// O arquivo nao comeca com `"TZVLT\0"`.
    BadMagic,
    /// `format_version` ou `reserved` fora do que este leitor aceita.
    UnsupportedVersion,
    /// Truncado, ou campo de comprimento maior que o arquivo.
    Malformed,
    /// §5.6 — Argon2id fora da faixa, ou incoerente com o perfil declarado.
    /// Recusado **antes** de rodar o KDF.
    KdfParamsOutOfRange,
    /// `body_aead_id` ou `wrap_aead_id` que este leitor nao conhece.
    UnknownAead,
    /// §5.2 — preenchimento de nonce nao-zero, ou largura errada para o AEAD
    /// declarado.
    BadNoncePadding,
    /// §5.2 — `wrap_flags` com algum bit de 1 a 7 ligado.
    ReservedFlagSet,
    /// Payload decifrado que nao tem a forma da §5.2. Diferente de
    /// [`Self::CannotOpen`] porque so acontece **depois** de a tag fechar:
    /// quem chegou aqui ja provou que tem a chave.
    PayloadMalformed,
    /// Nenhum embrulho do tipo pedido existe neste cofre.
    NoSuchWrap,
    /// §6.3 — o sistema operacional recusou a operacao com a chave de
    /// hardware. **E aqui que a demonstracao negativa de P5 aterrissa.**
    HardwareKeyRefused,
    /// §6.1 — esta plataforma nao tem `KEK_hw` (Linux e so `KEK_pass` na v1).
    HardwareKeyUnsupported,
    /// §5.4 — o cofre de chaves do sistema devolveu um IV que nao confere: nao
    /// tem 12 bytes, ou e todo zero. Nao confiamos cegamente.
    BadHardwareIv,
    /// §4.1 — CSPRNG do sistema indisponivel. Nunca degrada para outra fonte.
    EntropyUnavailable,
    /// §2.3 — passphrase com entropia estimada abaixo do piso de 60 bits.
    PassphraseTooWeak,
    /// §5.8 — falha de leitura ou da gravacao atomica.
    Io,
    /// Erro vindo de `tz-keys` (mnemonica, derivacao, codificacao).
    Key(tz_keys::KeyError),
}

impl fmt::Display for VaultError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Texto fixo por variante. Nada interpolado a partir de dado, e o
        // texto de `CannotOpen` e o mesmo para senha errada e para arquivo
        // adulterado porque a variante tambem e.
        let t = match self {
            Self::CannotOpen => "nao foi possivel abrir o cofre",
            Self::BadMagic => "este arquivo nao e um cofre",
            Self::UnsupportedVersion => "versao de cofre nao suportada",
            Self::Malformed => "cofre malformado",
            Self::KdfParamsOutOfRange => "parametros de KDF fora da faixa",
            Self::UnknownAead => "algoritmo de cifra desconhecido",
            Self::BadNoncePadding => "campo de nonce invalido",
            Self::ReservedFlagSet => "bit reservado ligado no embrulho",
            Self::PayloadMalformed => "conteudo do cofre malformado",
            Self::NoSuchWrap => "este cofre nao tem esse tipo de embrulho",
            Self::HardwareKeyRefused => "o sistema recusou a chave de hardware",
            Self::HardwareKeyUnsupported => "esta plataforma nao tem chave de hardware",
            Self::BadHardwareIv => "o cofre de chaves do sistema devolveu um IV invalido",
            Self::EntropyUnavailable => "CSPRNG do sistema indisponivel",
            Self::PassphraseTooWeak => "senha fraca demais para proteger uma carteira",
            Self::Io => "falha de leitura ou gravacao do cofre",
            Self::Key(e) => return write!(f, "{e}"),
        };
        f.write_str(t)
    }
}

impl std::error::Error for VaultError {}

impl From<tz_keys::KeyError> for VaultError {
    fn from(e: tz_keys::KeyError) -> Self {
        Self::Key(e)
    }
}

impl From<tz_rng::EntropyUnavailable> for VaultError {
    fn from(_: tz_rng::EntropyUnavailable) -> Self {
        Self::EntropyUnavailable
    }
}

pub type Result<T> = core::result::Result<T, VaultError>;
