//! §9.5 — **o vetor de bytes do cofre de dois AEADs, fixo no repositorio.**
//!
//! *"um cofre no perfil Android (`body_aead_id = 0x01`, `KEK_pass` com
//! `wrap_aead_id = 0x01`, `KEK_hw` com `wrap_aead_id = 0x02`) abre pelos dois
//! caminhos, e o vetor de bytes desse arquivo entra fixo no repositorio de
//! testes."*
//!
//! Por que um arquivo gravado e nao um cofre criado na hora: um cofre criado
//! na hora testa o codigo de hoje contra si mesmo. **Este arquivo foi gravado
//! uma vez e nao muda.** Se alguem mudar um offset, um campo ou a ordem da
//! AAD, ele para de abrir — que e exatamente o que "formato estavel" quer
//! dizer. Sem ele, uma mudanca de formato passaria verde porque o gravador e o
//! leitor mudaram juntos.
//!
//! Para regravar o vetor (so quando o formato mudar **de proposito**, com a
//! especificacao emendada antes):
//!
//! ```text
//! TZVAULT_VETOR=regravar cargo test -p tz-vault --test vetor_de_bytes
//! ```

mod comum;

use comum::KeystoreFalso;
use tz_params::vault as v;
use tz_vault::aead::Algorithm;
use tz_vault::format::{Payload, VaultFile};
use tz_vault::hw::Hardware;
use tz_vault::kdf::Profile;
use tz_vault::vault::{self, Wraps};

const SENHA: &[u8] = b"vetor fixo do cofre de dois aeads";
const SEMENTE: [u8; 64] = [
    0x40, 0x8b, 0x28, 0x5c, 0x12, 0x38, 0x36, 0x00, 0x4f, 0x4b, 0x88, 0x42, 0xc8, 0x93, 0x24, 0xc1,
    0xf0, 0x13, 0x82, 0x45, 0x0c, 0x0d, 0x43, 0x9a, 0xf3, 0x45, 0xba, 0x7f, 0xc4, 0x9a, 0xcf, 0x70,
    0x54, 0x89, 0xc6, 0xfc, 0x77, 0xdb, 0xd4, 0xe3, 0xdc, 0x1d, 0xd8, 0xcc, 0x6b, 0xc9, 0xf0, 0x43,
    0xdb, 0x8a, 0xda, 0x1e, 0x24, 0x3c, 0x4a, 0x0e, 0xaf, 0xb2, 0x90, 0xd3, 0x99, 0x48, 0x08, 0x40,
];

fn caminho() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/android-dois-aeads.vault")
}

fn payload() -> Payload {
    Payload::new(
        v::SECRET_KIND_BIP39_SEED,
        v::CURVE_ED25519,
        v::DERIV_SLIP10_HARDENED,
        &tz_params::derivation::TEZOS_PATH,
        &SEMENTE,
    )
    .unwrap()
}

#[test]
fn o_vetor_fixo_abre_pelos_dois_caminhos() {
    let ks = KeystoreFalso::novo(true);

    if std::env::var("TZVAULT_VETOR").as_deref() == Ok("regravar") {
        let wraps = Wraps {
            passphrase: SENHA,
            hardware: Some(Hardware::Sealer(&ks)),
        };
        let f = vault::create(Profile::Mobile, &wraps, &payload()).unwrap();
        std::fs::create_dir_all(caminho().parent().unwrap()).unwrap();
        std::fs::write(caminho(), f.to_bytes()).unwrap();
        println!("vetor regravado em {}", caminho().display());
    }

    let bytes = std::fs::read(caminho()).expect(
        "o vetor de bytes sumiu; regrave com TZVAULT_VETOR=regravar so se o formato mudou de proposito",
    );
    let f = VaultFile::parse(&bytes).expect("o vetor fixo nao parseia com o leitor de hoje");

    // A forma, campo a campo — para o diagnostico dizer **o que** mudou.
    assert_eq!(f.header.profile_id, Profile::Mobile.id());
    assert_eq!(
        f.header.body_aead,
        Algorithm::XChaCha20Poly1305,
        "body_aead_id"
    );
    assert_eq!(f.header.wrap_count, 2);
    assert_eq!(f.header.m_kib, tz_params::kdf::PROFILE_MOBILE.0);
    assert_eq!(f.wraps[0].wrap_type, v::WRAP_PASS);
    assert_eq!(
        f.wraps[0].wrap_aead,
        Algorithm::XChaCha20Poly1305,
        "wrap_aead_id do KEK_pass"
    );
    assert!(f.wraps[0].ctx.is_empty());
    assert_eq!(f.wraps[1].wrap_type, v::WRAP_HW);
    assert_eq!(
        f.wraps[1].wrap_aead,
        Algorithm::Aes256Gcm,
        "wrap_aead_id do KEK_hw"
    );
    assert_eq!(f.wraps[1].ctx, b"tzvault.kek_hw.v1");
    // O preenchimento do nonce do AES-GCM: 12 uteis, 12 em zero.
    assert!(f.wraps[1].nonce.0[v::NONCE_USED_AES_GCM..]
        .iter()
        .all(|&b| b == 0));

    // E os dois caminhos abrem o mesmo segredo.
    let (_a, p1) = vault::open_with_passphrase(&f, SENHA).expect("abrir pela passphrase");
    let (_b, p2) =
        vault::open_with_hardware(&f, &Hardware::Sealer(&ks)).expect("abrir pelo KEK_hw");
    assert_eq!(p1.secret(), &SEMENTE);
    assert_eq!(p2.secret(), &SEMENTE);
    assert_eq!(p1.path(), tz_params::derivation::TEZOS_PATH);
}

/// A entrada da tabela de embrulhos tem **77** bytes fixos, nao 76 — e a
/// emenda do BRES-68. Um arquivo no formato antigo nao abre, e nao ha migracao.
#[test]
fn o_tamanho_da_entrada_de_embrulho_e_o_da_emenda() {
    assert_eq!(v::WRAP_FIXED_LEN, 77);
    let bytes = std::fs::read(caminho()).unwrap();
    let esperado = v::HEADER_LEN
        + v::WRAP_FIXED_LEN            // KEK_pass, ctx vazio
        + v::WRAP_FIXED_LEN + 17       // KEK_hw, ctx = "tzvault.kek_hw.v1"
        + v::NONCE_FIELD_LEN + 4 + v::PAYLOAD_LEN + v::TAG_LEN;
    assert_eq!(
        bytes.len(),
        esperado,
        "o vetor fixo tem {} bytes",
        bytes.len()
    );
}
