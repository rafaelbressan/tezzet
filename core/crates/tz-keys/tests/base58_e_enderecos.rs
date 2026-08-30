//! §9.3 — endereco e codificacao.
//!
//! Duas fontes independentes, de proposito:
//!
//! 1. **Vetores do Taquito** (`core/tools/prefixos-taquito.mjs`): a mesma carga
//!    de bytes codificada por outra implementacao tem que dar a mesma string.
//!    Isso confere os **bytes de prefixo** da `tz_params::base58`, que foram
//!    transcritos de `octez` `src/lib_crypto/base58.ml` — transcricao e
//!    exatamente o tipo de coisa que se erra em silencio.
//! 2. **Forma renderizada**: cada prefixo tem que produzir o texto humano
//!    esperado (`tz1…`, `edsk…`, `edsig…`) com o comprimento esperado. E o que
//!    cobre `tz5`, que o Taquito ainda nao conhece.

use tz_keys::address::{Address, AddressKind, Validation};
use tz_keys::base58;
use tz_keys::error::KeyError;
use tz_params::base58 as pfx;

const H20: &str = "0102030405060708090a0b0c0d0e0f1011121314";
const H32: &str = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";

fn h(s: &str) -> Vec<u8> {
    hex::decode(s).unwrap()
}

/// Cross-check contra o Taquito 25.0.0.
#[test]
fn prefixos_batem_com_o_taquito() {
    let h20 = h(H20);
    let h32 = h(H32);
    let h64 = h(&format!("{H32}{H32}"));
    let mut sppk = vec![0x02u8];
    sppk.extend_from_slice(&h32);
    let mut p2pk = vec![0x03u8];
    p2pk.extend_from_slice(&h32);

    let casos: &[(&str, &[u8], &[u8], &str)] = &[
        ("tz1", &pfx::TZ1, &h20, "tz1KjMn6Hb23eu1rNemou6ytAzzNxzvaYHyK"),
        ("tz2", &pfx::TZ2, &h20, "tz28QZkJtASQaeeieppeZjx8iaFPUtPpBrZd"),
        ("tz3", &pfx::TZ3, &h20, "tz3LRNhdn2ZwyH7255tuZhQWXw8uFiXNJRVw"),
        ("tz4", &pfx::TZ4, &h20, "tz496afrNbzJu2jtMFwkELNm5WPumbzCEh2S"),
        ("KT1", &pfx::KT1, &h20, "KT18g6ejmStajqDwZZ5ZwTfu1ZKzhYq5RboW"),
        ("edpk", &pfx::EDPK, &h32, "edpktefgU5pvCgmCHMBXebvUGbbXAkSXJgMMoCGDx3rXBQ2MfGexGx"),
        ("edsk(32)", &pfx::EDSK_SEED, &h32, "edsk2gM2LioC6YfkHSgkD1opuvCLS8Ao7ytPf4QXmaupPwVgF27wFW"),
        ("edsk(64)", &pfx::EDSK_EXPANDED, &h64, "edskRc9RaW6b4iCtwxcev9kvd2EdTA7soz8SQ8x47jV6bk1AMCDVeGKqPUdf4VRXRe5C73vJ4QusBihGz9HiMALgNnEdshxWSv"),
        ("spsk", &pfx::SPSK, &h32, "spsk1S1Ree7gaspotLbU2WkEvqCHZ1R6Gh5raPeJhJzH5KAxvEEuSB"),
        ("p2sk", &pfx::P2SK, &h32, "p2sk2MEYt93H37wHdnpkPYQ2hipLmSX4bnhocvAjxnnvnzvH7W76T2"),
        ("sppk", &pfx::SPPK, &sppk, "sppk7ZK5bkC7nq3kBaHj322AgW9nk1jBCxCcdpbaZc3wN3xbdSEL9Vt"),
        ("p2pk", &pfx::P2PK, &p2pk, "p2pk66XMJnFSjs99MnFw2tc1jdCrwM7AP3zPoy6NWT1wWDENp2Zj6wH"),
        ("edsig", &pfx::EDSIG, &h64, "edsigtXwQk8GtBeRkJZtgKxnSuxDENEHZaszQKM1s89PvPgR8BR2yABRMp5CjS5yQGBeaLGbLmqMNxiouTq9TNtp9GawSVmrQXx"),
        ("spsig", &pfx::SPSIG, &h64, "spsig15wcx8fEP4CrdYu9A5VQcZc6WDzCgJkWREPTAbZFCEKtJekBqraeg9Sg5rvhE7Y5ySrsbHReZEzrpKpNEd9fzkQT9hTkjh"),
        ("p2sig", &pfx::P2SIG, &h64, "p2sigMSAUA9Y1BAkiKA9SeXnkAPVynrrsLYEA72ynCrNgYrTR8N9yfZMxJ9EggJ8Q9foDM9EsPoxTboT6RoBTLvNWoZgYTDjaS"),
        ("sig", &pfx::GENERIC_SIG, &h64, "sigN7wd53yuiEiFNuPBvwFxevibQCdcF7owfG8PoPwPLQAsb6NfHWGj1xpPVMcAiUDtj7irKa286r8j37FikUB5XsLcrnrWC"),
        ("hash de operacao", &pfx::OPERATION_HASH, &h32, "onef1shcAkeuHdHJGckAYjbuzZSg4ZGPMyGxrc1L5RadvNJNNmM"),
    ];

    for (nome, prefixo, carga, esperado) in casos {
        assert_eq!(&base58::encode(prefixo, carga), esperado, "prefixo {nome}");
        let volta = base58::decode_exact(esperado, prefixo, carga.len()).expect(nome);
        assert_eq!(&volta, carga, "ida e volta: {nome}");
    }
}

/// `tz5` (ML-DSA-44) e `chain_id` nao existem no Taquito 25. A conferencia e a
/// forma renderizada: se os bytes de prefixo estivessem errados, o texto
/// humano nao sairia `tz5…` nem `Net…`.
#[test]
fn prefixos_sem_contraparte_no_taquito_renderizam_certo() {
    let tz5 = base58::encode(&pfx::TZ5, &h(H20));
    assert!(tz5.starts_with("tz5"), "prefixo tz5 errado: {tz5}");
    assert_eq!(tz5.len(), 36, "tz5 deveria ter 36 caracteres: {tz5}");

    let net = base58::encode(&pfx::CHAIN_ID, &h("7a06a770"));
    assert!(net.starts_with("Net"), "prefixo de chain_id errado: {net}");
}

/// §4.4 — **a nota que ja causou bug em producao em outros projetos.**
///
/// `edsk` tem dois prefixos: semente de 32 bytes e chave expandida de 64. Um
/// decodificador que so olha o texto `edsk` aceita um pelo outro.
#[test]
fn edsk_de_32_nao_passa_por_edsk_de_64() {
    let curta = base58::encode(&pfx::EDSK_SEED, &h(H32));
    let longa = base58::encode(&pfx::EDSK_EXPANDED, &h(&format!("{H32}{H32}")));
    assert!(curta.starts_with("edsk") && longa.starts_with("edsk"));

    assert_eq!(
        base58::decode_exact(&curta, &pfx::EDSK_EXPANDED, 64).err(),
        Some(KeyError::Base58Prefix),
        "a semente de 32 B passou como chave expandida de 64 B"
    );
    assert_eq!(
        base58::decode_exact(&longa, &pfx::EDSK_SEED, 32).err(),
        Some(KeyError::Base58Prefix),
        "a chave de 64 B passou como semente de 32 B"
    );
    // E com o prefixo certo e o comprimento errado, tambem recusa.
    assert_eq!(
        base58::decode_exact(&curta, &pfx::EDSK_SEED, 31).err(),
        Some(KeyError::Base58Prefix)
    );
}

/// §9.3 — checksum base58check invalido e rejeitado. Um caractere trocado
/// nunca passa.
#[test]
fn um_caractere_trocado_nunca_passa() {
    let bom = "tz1YegD188fgGzXotMUQMcM4UFCyNAvHtw6p";
    assert!(Address::parse(bom).is_ok());

    const B58: &[u8] = pfx::ALPHABET;
    let mut testados = 0usize;
    for i in 3..bom.len() {
        let mut bytes = bom.as_bytes().to_vec();
        // Troca por outro caractere valido do alfabeto: o erro tem que vir do
        // checksum, nao do parser de caractere.
        let atual = bytes[i];
        let substituto = *B58.iter().find(|&&c| c != atual).unwrap();
        bytes[i] = substituto;
        let texto = String::from_utf8(bytes).unwrap();
        assert!(
            Address::parse(&texto).is_err(),
            "aceitou endereco com o caractere {i} trocado: {texto}"
        );
        testados += 1;
    }
    assert!(testados >= 30);
}

/// §4.7 — `tz4` e aceito. O TAPS de hoje o rejeita, e isso significa **recusar
/// pagar um delegador legitimo**.
#[test]
fn tz4_e_aceito_para_receber() {
    let tz4 = base58::encode(&pfx::TZ4, &h(H20));
    match Address::parse(&tz4) {
        Ok(a) => assert_eq!(a.kind(), AddressKind::Tz4),
        Err(e) => panic!("tz4 recusado: {e}"),
    }
    assert_eq!(
        tz_keys::address::validate(&tz4),
        Validation::Ok(AddressKind::Tz4)
    );
}

/// §4.7 e §9.3 — `tz5` e **reconhecido e recusado como nao suportado**, nao
/// como endereco malformado. Uma e mensagem correta, a outra e um bug
/// reportado como corrupcao de dados.
#[test]
fn tz5_e_recusado_como_nao_suportado_e_nao_como_lixo() {
    let tz5 = base58::encode(&pfx::TZ5, &h(H20));
    assert_eq!(
        Address::parse(&tz5).err(),
        Some(KeyError::AddressTypeUnsupported)
    );
    assert_eq!(tz_keys::address::validate(&tz5), Validation::Unsupported);

    // E lixo continua sendo lixo.
    assert_eq!(
        tz_keys::address::validate("tz1nao-e-endereco"),
        Validation::Invalid
    );
    assert_eq!(tz_keys::address::validate(""), Validation::Invalid);
    assert_eq!(tz_keys::address::validate("0x1234"), Validation::Invalid);
}

#[test]
fn ida_e_volta_de_todos_os_tipos_de_endereco() {
    let h20: [u8; 20] = h(H20).try_into().unwrap();
    for kind in [
        AddressKind::Tz1,
        AddressKind::Tz2,
        AddressKind::Tz3,
        AddressKind::Tz4,
        AddressKind::Kt1,
    ] {
        let a = Address::new(kind, h20);
        let b = match Address::parse(a.as_str()) {
            Ok(x) => x,
            Err(e) => panic!("{} nao voltou: {e}", a.as_str()),
        };
        assert_eq!(a, b);
        assert_eq!(b.kind(), kind);
        assert_eq!(b.hash(), &h20);
    }
}

/// Somente `tz1`, `tz2` e `tz3` assinam na v1 (§4.7).
#[test]
fn tz4_nao_assina_na_v1() {
    assert!(!AddressKind::Tz4.can_sign_in_v1());
    assert!(AddressKind::Tz1.can_sign_in_v1());
    assert!(AddressKind::Tz2.can_sign_in_v1());
    assert!(AddressKind::Tz3.can_sign_in_v1());
}
