//! §9.7 / P3.c — o erro carrega a **variante**, nunca o material.
//!
//! Enum fechado e **sem payload**. Nao existe `Error(String)` aqui: uma
//! `String` de erro e o lugar classico onde a semente vaza para o log, para o
//! `Debug` e para a UI ao mesmo tempo. `size_of::<KeyError>() == 1`, e isso e
//! fixado por teste.
//!
//! `Debug` e seguro **porque o tipo nao carrega dado**. Se algum dia uma
//! variante ganhar payload, o teste de tamanho reprova.

use core::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum KeyError {
    /// Contagem de palavras fora de 12/15/18/21/24.
    MnemonicWordCount,
    /// Alguma palavra nao pertence a wordlist inglesa.
    MnemonicUnknownWord,
    /// §4.2 — checksum BIP-39 nao fecha. **Bloqueante, nunca aviso:** uma
    /// palavra errada que ainda esteja na wordlist gera silenciosamente outra
    /// carteira valida, com saldo zero, e o usuario conclui que perdeu tudo.
    MnemonicChecksum,
    /// Entropia com tamanho fora de 16/20/24/28/32 bytes.
    EntropyLength,
    /// Caminho de derivacao vazio, longo demais, ou com nivel nao-endurecido
    /// onde a curva nao admite (§4.3: proibido em Ed25519).
    DerivationPath,
    /// SLIP-0010 pediu uma nova tentativa mais vezes que o razoavel, ou a
    /// curva recusou o escalar. Probabilidade ~2^-127; existe para nao virar
    /// `panic`.
    DerivationFailed,
    /// Texto que nao e base58, ou cujo checksum nao fecha. §9.3 — um caractere
    /// trocado nunca passa.
    Base58Checksum,
    /// Prefixo desconhecido, ou prefixo conhecido com o comprimento errado.
    /// §4.4 — `edsk` tem dois prefixos e um decodificador que so olha o texto
    /// aceita um pelo outro.
    Base58Prefix,
    /// §4.7 — `tz5` (ML-DSA) e reconhecido e **recusado como nao suportado**.
    /// Isto nao e `Base58Prefix`: a diferenca entre "endereco de um tipo que
    /// ainda nao suportamos" e "dado corrompido" e a diferenca entre uma
    /// mensagem correta e um bug reportado como perda de dados.
    AddressTypeUnsupported,
    /// §4.7 — assinar com `tz4` (BLS) esta fora da v1. Ler, validar e pagar
    /// para `tz4` funciona; assinar nao.
    SigningCurveUnsupported,
    /// §4.6 — a v1 assina apenas operacao generica (`0x03`). Cabecalho de
    /// bloco e attestation existem no perfil de baker e nao entram na v1.
    WatermarkRefused,
    /// Chave publica ou assinatura com tamanho invalido.
    MalformedKeyMaterial,
    /// §4.2 — passphrase BIP-39 fora do que a normalizacao aceita.
    InvalidPassphrase,
}

impl fmt::Display for KeyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Texto fixo por variante. Nada interpolado a partir de dado.
        f.write_str(match self {
            Self::MnemonicWordCount => "numero de palavras invalido",
            Self::MnemonicUnknownWord => "palavra fora da lista BIP-39",
            Self::MnemonicChecksum => "a frase de recuperacao nao confere",
            Self::EntropyLength => "tamanho de entropia invalido",
            Self::DerivationPath => "caminho de derivacao invalido",
            Self::DerivationFailed => "derivacao falhou",
            Self::Base58Checksum => "endereco ou chave com checksum invalido",
            Self::Base58Prefix => "prefixo desconhecido ou comprimento errado",
            Self::AddressTypeUnsupported => "tipo de endereco ainda nao suportado",
            Self::SigningCurveUnsupported => "assinatura nesta curva nao e suportada",
            Self::WatermarkRefused => "watermark recusada",
            Self::MalformedKeyMaterial => "material de chave malformado",
            Self::InvalidPassphrase => "passphrase invalida",
        })
    }
}

impl std::error::Error for KeyError {}

pub type Result<T> = core::result::Result<T, KeyError>;
