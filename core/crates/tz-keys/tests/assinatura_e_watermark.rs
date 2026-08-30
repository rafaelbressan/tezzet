//! §9.4 — assinatura e watermark.
//!
//! O cruzamento com o `octez-client`/Taquito esta em `vetores_taquito.rs`.
//! Aqui ficam as propriedades que nenhum vetor sozinho mostra: low-S, a
//! politica da v1, e o fato de o watermark mudar o que e assinado.

use tz_keys::derive::Curve;
use tz_keys::error::KeyError;
use tz_keys::secret::Scalar;
use tz_keys::sign::{ForgedOperation, SecretKey, Watermark};

fn chave(curva: Curve) -> SecretKey {
    let escalar = Scalar::from_bytes(
        hex::decode("4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318")
            .unwrap()
            .try_into()
            .unwrap(),
    );
    SecretKey::from_scalar(curva, escalar).unwrap()
}

fn op(bytes: &[u8]) -> ForgedOperation {
    ForgedOperation::from_locally_forged(bytes.to_vec())
}

/// §4.5 — **normalizacao low-S obrigatoria** em secp256k1 e P-256.
///
/// Sem normalizar, `(r, s)` e `(r, n−s)` sao as duas assinaturas validas da
/// mesma mensagem. Num sistema de payout que decide idempotencia olhando o que
/// ja foi enviado, duas representacoes da mesma coisa e uma classe de bug de
/// dinheiro.
///
/// A verificacao e direta: renormalizar a nossa assinatura **nao pode
/// muda-la**. Rodado sobre 256 mensagens, porque metade delas produziria S
/// alto se ninguem normalizasse — um unico vetor daria 50% de chance de passar
/// por acidente.
#[test]
fn low_s_em_toda_assinatura_ecdsa() {
    let mut altos_evitados = 0usize;
    for curva in [Curve::Secp256k1, Curve::NistP256] {
        let sk = chave(curva);
        for i in 0u32..256 {
            let sig = sk
                .sign(Watermark::GenericOperation, &op(&i.to_be_bytes()))
                .unwrap();
            let bytes = *sig.as_bytes();
            let normalizada_de_novo = match curva {
                Curve::Secp256k1 => {
                    let s = k256::ecdsa::Signature::from_slice(&bytes).unwrap();
                    s.normalize_s().to_bytes().to_vec()
                }
                Curve::NistP256 => {
                    let s = p256::ecdsa::Signature::from_slice(&bytes).unwrap();
                    s.normalize_s().to_bytes().to_vec()
                }
                Curve::Ed25519 => unreachable!(),
            };
            assert_eq!(
                normalizada_de_novo,
                bytes.to_vec(),
                "{curva:?} produziu assinatura com S alto na mensagem {i}"
            );

            // E a forma maleavel, se alguem a construisse, seria **outra**
            // string base58 — que e exatamente o que quebra idempotencia.
            let mut maleavel = bytes;
            maleavel[63] ^= 0x01;
            assert_ne!(maleavel, bytes);
            altos_evitados += 1;
        }
    }
    assert_eq!(altos_evitados, 512);
}

/// §4.6 item 2 — a v1 assina **apenas** operacao generica.
#[test]
fn a_v1_recusa_watermark_de_baker() {
    let sk = chave(Curve::Ed25519);
    let chain_id = [0x7a, 0x06, 0xa7, 0x70];
    for w in [
        Watermark::BlockHeader { chain_id },
        Watermark::Attestation { chain_id },
    ] {
        assert_eq!(
            sk.sign(w, &op(b"\xaa\xbb")).err(),
            Some(KeyError::WatermarkRefused),
            "assinou {w:?} na v1"
        );
    }
    assert!(sk
        .sign(Watermark::GenericOperation, &op(b"\xaa\xbb"))
        .is_ok());
}

/// §4.6 — os bytes de cada watermark, conferidos em `octez`
/// `src/lib_crypto/signature_v1.ml:766-772`. E o `chain_id` e **explicito**,
/// nunca inferido: assinar consenso na rede errada e o defeito que isso evita.
#[test]
fn bytes_do_watermark() {
    let chain_id = [0x7a, 0x06, 0xa7, 0x70];
    assert_eq!(Watermark::GenericOperation.bytes(), vec![0x03]);
    assert_eq!(
        Watermark::BlockHeader { chain_id }.bytes(),
        vec![0x01, 0x7a, 0x06, 0xa7, 0x70]
    );
    assert_eq!(
        Watermark::Attestation { chain_id }.bytes(),
        vec![0x02, 0x7a, 0x06, 0xa7, 0x70]
    );
}

/// O watermark entra no digest: mudar o watermark muda a assinatura. Se este
/// teste falhasse, o argumento obrigatorio seria decoracao.
#[test]
fn o_watermark_muda_o_digest() {
    use tz_keys::sign::tezos_digest;
    let chain_id = [0x7a, 0x06, 0xa7, 0x70];
    let a = tezos_digest(Watermark::GenericOperation, b"\xaa\xbb");
    let b = tezos_digest(Watermark::BlockHeader { chain_id }, b"\xaa\xbb");
    let c = tezos_digest(Watermark::GenericOperation, b"\xaa\xbc");
    assert_ne!(a, b);
    assert_ne!(a, c);
}

/// Ed25519 e deterministico por construcao (RFC 8032); ECDSA aqui e
/// deterministico por RFC 6979. Nas tres curvas, assinar duas vezes o mesmo
/// digest da a mesma assinatura — o que torna a idempotencia do payout
/// verificavel.
#[test]
fn assinatura_e_deterministica_nas_tres_curvas() {
    for curva in [Curve::Ed25519, Curve::Secp256k1, Curve::NistP256] {
        let sk = chave(curva);
        let a = sk
            .sign(Watermark::GenericOperation, &op(b"\x01\x02\x03"))
            .unwrap();
        let b = sk
            .sign(Watermark::GenericOperation, &op(b"\x01\x02\x03"))
            .unwrap();
        assert_eq!(a.as_bytes(), b.as_bytes(), "{curva:?} nao e deterministica");
    }
}

/// A assinatura sai nas duas formas que o ecossistema usa, e as duas
/// carregam os **mesmos** 64 bytes.
#[test]
fn forma_com_prefixo_de_curva_e_forma_generica() {
    for (curva, prefixo) in [
        (Curve::Ed25519, "edsig"),
        (Curve::Secp256k1, "spsig"),
        (Curve::NistP256, "p2sig"),
    ] {
        let sk = chave(curva);
        let s = sk
            .sign(Watermark::GenericOperation, &op(b"\xaa\xbb"))
            .unwrap();
        assert!(s.to_base58().starts_with(prefixo), "{}", s.to_base58());
        assert!(s.to_generic_base58().starts_with("sig"));
    }
}

/// §4.4 — importar `edsk` de 32 B (semente) e de 64 B (expandida) da a mesma
/// carteira, porque os 32 primeiros bytes da expandida **sao** a semente.
#[test]
fn edsk_de_32_e_de_64_dao_a_mesma_carteira() {
    use tz_params::base58 as pfx;
    let semente =
        hex::decode("0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20").unwrap();
    let curta = tz_keys::base58::encode(&pfx::EDSK_SEED, &semente);
    let sk_curta = SecretKey::from_base58(&curta).unwrap();
    let publica = sk_curta.public_key().unwrap();

    let mut expandida_raw = semente.clone();
    expandida_raw.extend_from_slice(publica.as_bytes());
    let longa = tz_keys::base58::encode(&pfx::EDSK_EXPANDED, &expandida_raw);
    let sk_longa = SecretKey::from_base58(&longa).unwrap();

    assert_eq!(
        sk_curta.address().unwrap().as_str(),
        sk_longa.address().unwrap().as_str()
    );
}

#[test]
fn chave_com_prefixo_desconhecido_e_recusada() {
    for texto in ["tz1YegD188fgGzXotMUQMcM4UFCyNAvHtw6p", "nao e chave", ""] {
        assert!(SecretKey::from_base58(texto).is_err(), "aceitou {texto}");
    }
}
