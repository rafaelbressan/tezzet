//! §9.6, **controle 1 do varredor: ele funciona.**
//!
//! Em processo separado de proposito. O harness do Rust roda os `#[test]` de um
//! mesmo arquivo em threads do **mesmo** processo; se este controle morasse
//! junto do portao de verdade, a mnemonica plantada aqui apareceria na
//! varredura de la e o teste falharia por contaminacao, nao por vazamento.
//! Arquivo separado = binario separado = processo separado.
//!
//! Sem este controle, o "zero ocorrencias" do outro arquivo poderia ser
//! simplesmente um varredor quebrado.

#![cfg(any(target_os = "linux", target_os = "android"))]

use tz_memscan::{scan_self, Needles, Phase};

/// Vetor publico do Trezor. Nao guarda valor nenhum.
const PLANTADA: &str =
    "legal winner thank year wave sausage worth useful legal winner thank yellow";

#[test]
fn o_varredor_acha_uma_mnemonica_viva() {
    // No heap, nao em `.rodata`: `.rodata` tem arquivo por tras e o varredor
    // pula, de proposito.
    let plantada = std::hint::black_box(PLANTADA.to_string());
    let mut agulhas = Needles::new();
    let r = scan_self(Phase::Unlocked, &mut agulhas);
    println!("controle 1 — {}", r.summary());
    assert!(
        r.bip39_phrase_like >= 1,
        "o varredor nao achou uma mnemonica viva e plantada: {r:?}"
    );
    assert!(
        r.bip39_long_runs >= 1,
        "12 palavras seguidas nao contaram como corrida longa: {r:?}"
    );
    assert!(
        r.verdict().is_err(),
        "mnemonica viva na memoria e o veredito passou"
    );
    assert!(r.regions_scanned > 0 && r.bytes_scanned > 0);
    std::hint::black_box(&plantada);
}

/// E acha a forma base58 de uma chave privada, que e o item 2 da lista de
/// conta-zero.
#[test]
fn o_varredor_acha_uma_chave_privada_em_base58() {
    let plantada =
        std::hint::black_box("edsk3gUfUPyBSfrS9CCgmCiQsTCWSkkHt32rZLuFsPRTKSjE2XTGeS".to_string());
    let mut agulhas = Needles::new();
    let r = scan_self(Phase::Unlocked, &mut agulhas);
    println!("controle 1b — {}", r.summary());
    assert!(
        r.base58_private_forms >= 1,
        "o varredor nao achou um `edsk` vivo e plantado: {r:?}"
    );
    std::hint::black_box(&plantada);
}

/// Controle do proprio mascaramento: uma agulha de conta-zero cujo valor
/// **esta** vivo no processo tem que ser encontrada. Se o mascaramento
/// escondesse a agulha do proprio varredor, todo item de conta-zero passaria
/// sempre — e o portao seria decorativo.
#[test]
fn a_agulha_mascarada_ainda_encontra_o_que_existe() {
    let vivo = std::hint::black_box(vec![0x5au8; 48]);
    let mut agulhas = Needles::new();
    agulhas.always_zero("bloco-plantado", &vivo);
    let r = scan_self(Phase::Unlocked, &mut agulhas);
    println!("controle 1c — {}", r.summary());
    let achou = r
        .hits
        .iter()
        .find(|(l, _)| *l == "bloco-plantado")
        .map(|(_, n)| *n);
    assert!(
        achou.unwrap_or(0) >= 1,
        "o varredor nao achou um bloco plantado e vivo: {r:?}"
    );
    assert!(
        r.verdict().is_err(),
        "um item de conta-zero presente deveria reprovar"
    );
    std::hint::black_box(&vivo);
}
