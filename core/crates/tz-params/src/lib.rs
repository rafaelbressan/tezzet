//! **O unico modulo de configuracao criptografica da suite.**
//!
//! Criterio de aceite do BRES-41: *"Nenhum parametro criptografico hardcoded
//! fora de um unico modulo de configuracao."* Esta crate e esse modulo, e o
//! teste `tz-vault/tests/parametros_num_lugar_so.rs` reprova quando um numero
//! de cripto aparece em outro lugar.
//!
//! Nada aqui executa. Sao constantes, e cada uma cita a secao da SPEC-0001 que
//! a decidiu. Se um numero desta crate discordar da especificacao, a
//! especificacao ganha e o numero e um defeito.
//!
//! # O que esta crate garante
//! - Que existe **um** lugar para mudar um parametro.
//! - Que a mudanca aparece no diff de um arquivo, revisavel por quem entende de
//!   cripto sem ler o resto do sistema.
//!
//! # O que ela nao garante
//! - Que o valor esta certo. Isso e a especificacao e a revisao humana.
//! - Que ninguem escreveu o numero de novo noutro arquivo. Isso e o teste.

#![no_std]
#![forbid(unsafe_code)]

/// §5.2 — cabecalho e tabela de embrulhos do arquivo de cofre (`TZVLT`).
pub mod vault {
    /// `"TZVLT\0"`.
    pub const MAGIC: [u8; 6] = *b"TZVLT\0";
    /// §5.2 — continua `0x01` porque nao ha cofre de usuario em producao
    /// (BRES-35). So anda quando existir.
    pub const FORMAT_VERSION: u8 = 0x01;
    /// `kdf_id` — Argon2id, versao `0x13`.
    pub const KDF_ARGON2ID: u8 = 0x01;

    /// `body_aead_id` / `wrap_aead_id` — XChaCha20-Poly1305.
    pub const AEAD_XCHACHA20POLY1305: u8 = 0x01;
    /// `body_aead_id` / `wrap_aead_id` — AES-256-GCM.
    pub const AEAD_AES256GCM: u8 = 0x02;

    /// `wrap_type` — `KEK_pass`, derivada da passphrase. Sempre presente.
    pub const WRAP_PASS: u8 = 0x01;
    /// `wrap_type` — `KEK_hw`, chave do sistema operacional.
    pub const WRAP_HW: u8 = 0x02;
    /// `wrap_type` — `KEK_prf` do WebAuthn. **Reservado**, §14 item 5.
    pub const WRAP_PRF: u8 = 0x03;

    /// `wrap_flags` bit 0 — embrulho obrigatorio na abertura.
    pub const WRAP_FLAG_REQUIRED: u8 = 0b0000_0001;
    /// §5.2 — bits 1 a 7 **DEVEM** ser zero; leitor recusa.
    pub const WRAP_FLAGS_RESERVED_MASK: u8 = 0b1111_1110;

    /// Cabecalho: 48 bytes fixos.
    pub const HEADER_LEN: usize = 0x30;
    /// §5.2 emendada (BRES-68): **77**, nao 76. O byte novo e `wrap_aead_id`.
    pub const WRAP_FIXED_LEN: usize = 0x4D;
    /// Campo de nonce: 24 bytes sempre, qualquer que seja o AEAD.
    pub const NONCE_FIELD_LEN: usize = 24;
    /// Tag Poly1305 / GCM.
    pub const TAG_LEN: usize = 16;
    /// DEK.
    pub const DEK_LEN: usize = 32;
    /// Sal do Argon2id, aleatorio por cofre.
    pub const KDF_SALT_LEN: usize = 16;
    /// §5.2 — payload em claro, sempre 128 bytes, com preenchimento.
    pub const PAYLOAD_LEN: usize = 128;
    /// Um cabecalho declara de 1 a 3 embrulhos.
    pub const WRAP_COUNT_MIN: u8 = 1;
    pub const WRAP_COUNT_MAX: u8 = 3;
    /// Teto de `ctx_len`. Alias de Keystore e credential id do WebAuthn cabem
    /// com folga; o teto existe para o parser nao alocar o que o arquivo mandar.
    pub const CTX_LEN_MAX: usize = 512;

    /// Largura util do nonce, em bytes, por AEAD. §5.2.
    pub const NONCE_USED_XCHACHA: usize = 24;
    pub const NONCE_USED_AES_GCM: usize = 12;

    /// Offsets do cabecalho.
    pub mod header_at {
        pub const MAGIC: usize = 0x00;
        pub const FORMAT_VERSION: usize = 0x06;
        pub const KDF_ID: usize = 0x07;
        pub const PROFILE_ID: usize = 0x08;
        pub const BODY_AEAD_ID: usize = 0x09;
        pub const WRAP_COUNT: usize = 0x0A;
        pub const RESERVED: usize = 0x0B;
        pub const ARGON2_M_KIB: usize = 0x0C;
        pub const ARGON2_T: usize = 0x10;
        pub const ARGON2_P: usize = 0x14;
        pub const KDF_SALT: usize = 0x18;
        pub const CREATED_AT: usize = 0x28;
    }

    /// Offsets de uma entrada da tabela de embrulhos, relativos ao inicio dela.
    pub mod wrap_at {
        pub const WRAP_TYPE: usize = 0x00;
        pub const WRAP_FLAGS: usize = 0x01;
        pub const WRAP_AEAD_ID: usize = 0x02;
        pub const CTX_LEN: usize = 0x03;
        pub const WRAP_NONCE: usize = 0x05;
        pub const WRAPPED_DEK: usize = 0x1D;
        pub const WRAP_TAG: usize = 0x3D;
        pub const CTX: usize = 0x4D;
    }

    /// Offsets do payload em claro de 128 bytes.
    pub mod payload_at {
        pub const PAYLOAD_VERSION: usize = 0x00;
        pub const SECRET_KIND: usize = 0x01;
        pub const CURVE: usize = 0x02;
        pub const DERIV_SCHEME: usize = 0x03;
        pub const PATH_LEN: usize = 0x04;
        pub const PATH: usize = 0x05;
        pub const SECRET: usize = 0x25;
        pub const PAD: usize = 0x65;
    }

    pub const PAYLOAD_VERSION: u8 = 0x01;
    /// `secret_kind`.
    pub const SECRET_KIND_BIP39_SEED: u8 = 0x01;
    pub const SECRET_KIND_ED25519_SCALAR: u8 = 0x02;
    pub const SECRET_KIND_SECP256K1: u8 = 0x03;
    pub const SECRET_KIND_P256: u8 = 0x04;
    /// `curve`.
    pub const CURVE_ED25519: u8 = 0x01;
    pub const CURVE_SECP256K1: u8 = 0x02;
    pub const CURVE_P256: u8 = 0x03;
    /// `deriv_scheme`.
    pub const DERIV_NONE: u8 = 0x00;
    pub const DERIV_SLIP10_HARDENED: u8 = 0x01;
    /// §5.2 — `path_len` ≤ 8.
    pub const PATH_LEVELS_MAX: usize = 8;
}

/// §5.3 — perfis de Argon2id, e §5.6 — a faixa validada antes de rodar o KDF.
pub mod kdf {
    /// `profile_id = 0x01`. Android.
    pub const PROFILE_MOBILE_ID: u8 = 0x01;
    /// `profile_id = 0x02`. Linux e Windows.
    pub const PROFILE_DESKTOP_ID: u8 = 0x02;

    /// `v1-mobile`: 64 MiB, t=3, p=4. Segunda opcao recomendada da RFC 9106 §4.
    pub const PROFILE_MOBILE: (u32, u32, u32) = (65_536, 3, 4);
    /// `v1-desktop`: 256 MiB, t=3, p=4.
    pub const PROFILE_DESKTOP: (u32, u32, u32) = (262_144, 3, 4);

    /// Saida do Argon2id = a KEK, 32 bytes.
    pub const KEK_LEN: usize = 32;

    /// §5.6 — faixa aceita. Fora dela o leitor recusa **sem rodar o KDF**.
    pub const M_KIB_MIN: u32 = 19_456; // 19 MiB, piso da OWASP
    pub const M_KIB_MAX: u32 = 1_048_576; // 1 GiB
    pub const T_MIN: u32 = 1;
    pub const T_MAX: u32 = 10;
    pub const P_MIN: u32 = 1;
    pub const P_MAX: u32 = 8;

    /// §2.3 — piso de entropia da passphrase, em bits. Abaixo disso a criacao
    /// de cofre recusa. O KDF nao conserta senha fraca; ele compra margem.
    pub const PASSPHRASE_MIN_ENTROPY_BITS: f64 = 60.0;
}

/// §4.2 — BIP-39.
pub mod bip39 {
    /// Iteracoes do PBKDF2-HMAC-SHA512. **2048 e o padrao BIP-39**; mudar
    /// quebra a compatibilidade com toda a industria, que e pior que o risco.
    /// A protecao em repouso e o Argon2id do cofre, nao isto.
    pub const PBKDF2_ITERATIONS: u32 = 2048;
    /// Sal = `"mnemonic"` ‖ passphrase.
    pub const SEED_SALT_PREFIX: &[u8] = b"mnemonic";
    /// Semente BIP-39.
    pub const SEED_LEN: usize = 64;
    /// §4.1 — criacao nova: 256 bits → 24 palavras.
    pub const ENTROPY_BITS_NEW: usize = 256;
    /// §4.1 — aceitos na importacao, porque carteira alheia existe.
    pub const ENTROPY_BITS_ACCEPTED: [usize; 5] = [128, 160, 192, 224, 256];
    pub const WORD_COUNTS_ACCEPTED: [usize; 5] = [12, 15, 18, 21, 24];
}

/// §4.3 — derivacao SLIP-0010 / BIP-32.
pub mod derivation {
    /// Chave HMAC do master node, por curva (SLIP-0010).
    pub const MASTER_KEY_ED25519: &[u8] = b"ed25519 seed";
    pub const MASTER_KEY_NIST256P1: &[u8] = b"Nist256p1 seed";
    pub const MASTER_KEY_SECP256K1: &[u8] = b"Bitcoin seed";

    /// Bit de endurecimento do BIP-32.
    pub const HARDENED: u32 = 0x8000_0000;

    /// O nivel `index` **endurecido**. Existe para o caminho ser escrito como
    /// se le — `hardened(44)` — em vez de `44 | HARDENED`, que o compilador
    /// avisa ser sem efeito quando `index` e zero.
    pub const fn hardened(index: u32) -> u32 {
        index | HARDENED
    }
    /// `coin_type` do Tezos.
    pub const COIN_TYPE_TEZOS: u32 = 1729;
    /// §4.3 — `m/44'/1729'/0'/0'`. Todos os niveis endurecidos. E o caminho que
    /// Ledger, Kukai e Temple usam; compatibilidade decide se o usuario
    /// recupera a carteira em outro cliente.
    pub const TEZOS_PATH: [u32; 4] = [
        hardened(44),
        hardened(COIN_TYPE_TEZOS),
        hardened(0),
        hardened(0),
    ];
    pub const TEZOS_PATH_TEXT: &str = "m/44'/1729'/0'/0'";
    /// §4.3 — multiplas contas variam o **ultimo** nivel.
    pub const ACCOUNT_LEVEL_INDEX: usize = 3;
}

/// §4.4 — prefixos base58check, lidos de `octez` `src/lib_crypto/base58.ml` em
/// 2026-08-27 e reproduzidos aqui como norma.
pub mod base58 {
    /// Hash de chave publica Ed25519 → `tz1…`.
    pub const TZ1: [u8; 3] = [0x06, 0xA1, 0x9F];
    /// secp256k1 → `tz2…`.
    pub const TZ2: [u8; 3] = [0x06, 0xA1, 0xA1];
    /// P-256 → `tz3…`.
    pub const TZ3: [u8; 3] = [0x06, 0xA1, 0xA4];
    /// BLS12-381 → `tz4…`.
    pub const TZ4: [u8; 3] = [0x06, 0xA1, 0xA6];
    /// ML-DSA-44 → `tz5…`. Reconhecido, **nao suportado** (§4.7).
    pub const TZ5: [u8; 3] = [0x06, 0xA1, 0xA9];
    /// Endereco de contrato originado → `KT1…`.
    pub const KT1: [u8; 3] = [0x02, 0x5A, 0x79];

    /// Chave publica Ed25519 → `edpk…`.
    pub const EDPK: [u8; 4] = [0x0D, 0x0F, 0x25, 0xD9];
    /// Chave publica secp256k1 → `sppk…`.
    pub const SPPK: [u8; 4] = [0x03, 0xFE, 0xE2, 0x56];
    /// Chave publica P-256 → `p2pk…`.
    pub const P2PK: [u8; 4] = [0x03, 0xB2, 0x8B, 0x7F];

    /// **Semente** Ed25519, 32 bytes → `edsk…` de 54 caracteres.
    pub const EDSK_SEED: [u8; 4] = [0x0D, 0x0F, 0x3A, 0x07];
    /// **Chave secreta** Ed25519 expandida, 64 bytes → `edsk…` de 98
    /// caracteres. §4.4: `edsk` tem **dois** prefixos; o decodificador casa
    /// prefixo **e** comprimento, ou recusa.
    pub const EDSK_EXPANDED: [u8; 4] = [0x2B, 0xF6, 0x4E, 0x07];
    /// Chave secreta secp256k1 → `spsk…`.
    pub const SPSK: [u8; 4] = [0x11, 0xA2, 0xE0, 0xC9];
    /// Chave secreta P-256 → `p2sk…`.
    pub const P2SK: [u8; 4] = [0x10, 0x51, 0xEE, 0xBD];

    /// Assinatura Ed25519 → `edsig…`.
    pub const EDSIG: [u8; 5] = [0x09, 0xF5, 0xCD, 0x86, 0x12];
    /// Assinatura secp256k1 → `spsig…`.
    pub const SPSIG: [u8; 5] = [0x0D, 0x73, 0x65, 0x13, 0x3F];
    /// Assinatura P-256 → `p2sig…`.
    pub const P2SIG: [u8; 4] = [0x36, 0xF0, 0x2C, 0x34];
    /// Assinatura generica → `sig…`.
    pub const GENERIC_SIG: [u8; 3] = [0x04, 0x82, 0x2B];

    /// Hash de operacao → `o…`.
    pub const OPERATION_HASH: [u8; 2] = [0x05, 0x74];
    /// `chain_id` → `Net…`.
    pub const CHAIN_ID: [u8; 3] = [0x57, 0x52, 0x00];

    /// Checksum do base58check: 4 bytes do SHA-256 duplo.
    pub const CHECKSUM_LEN: usize = 4;
    /// Alfabeto base58 do Bitcoin, que e o do Tezos.
    pub const ALPHABET: &[u8; 58] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
}

/// §4.4 / §4.5 — tamanhos das primitivas.
pub mod sizes {
    /// BLAKE2b-160 do hash de chave publica que vira endereco.
    pub const PKH_HASH_LEN: usize = 20;
    /// BLAKE2b-256 do digest assinado.
    pub const DIGEST_LEN: usize = 32;
    pub const ED25519_PUBLIC_LEN: usize = 32;
    pub const ED25519_SCALAR_LEN: usize = 32;
    pub const ED25519_SIGNATURE_LEN: usize = 64;
    /// Chave publica comprimida de secp256k1 e P-256.
    pub const COMPRESSED_PUBLIC_LEN: usize = 33;
    pub const ECDSA_SCALAR_LEN: usize = 32;
    /// `(r, s)` cru, 32 + 32.
    pub const ECDSA_SIGNATURE_LEN: usize = 64;
    pub const CHAIN_ID_LEN: usize = 4;
    pub const OPERATION_HASH_LEN: usize = 32;
}

/// §4.6 — watermark, conferido em `octez` `src/lib_crypto/signature_v1.ml:766-772`.
pub mod watermark {
    /// Operacao generica. **O unico que a v1 assina.**
    pub const GENERIC_OPERATION: u8 = 0x03;
    /// Cabecalho de bloco. Seguido de `chain_id` (4 bytes).
    pub const BLOCK_HEADER: u8 = 0x01;
    /// Attestation (ex-endorsement). Seguido de `chain_id` (4 bytes).
    pub const ATTESTATION: u8 = 0x02;
    /// Micheline empacotado. §4.6 item 4 — a v1 **recusa**.
    pub const MICHELINE_PACKED: u8 = 0x05;
}

/// §5.9 — ciclo de vida da sessao aberta.
pub mod session {
    /// Padrao de 5 minutos, configuravel entre 1 e 30.
    pub const IDLE_TIMEOUT_SECS_DEFAULT: u64 = 300;
    pub const IDLE_TIMEOUT_SECS_MIN: u64 = 60;
    pub const IDLE_TIMEOUT_SECS_MAX: u64 = 1_800;
}
