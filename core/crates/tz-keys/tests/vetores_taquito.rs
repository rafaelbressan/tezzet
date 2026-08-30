//! §9.2 e §9.4 — **cruzamento independente contra o Taquito**.
//!
//! *"Conferir contra si mesmo nao conta."* Estes vetores foram produzidos por
//! `@taquito/signer` **25.0.0** — a biblioteca que vai forjar as operacoes da
//! suite — rodando `core/tools/vetores-taquito.mjs`. Se o Rust e o Taquito
//! discordarem aqui, a assinatura nao vale nada por mais limpa que seja a
//! fronteira.
//!
//! Isto e a condicao (b) das tres que autorizam a composicao propria do
//! SLIP-0010 (§4.3), e e o que a §9.2 chama de cruzamento independente (P8 da
//! ADR-0001).
//!
//! Cobre `tz1` derivado de mnemonica (12 e 24 palavras, com e sem passphrase
//! BIP-39, contas 0 e 1), e `tz1`/`tz2`/`tz3` importados de chave crua
//! (`edsk`, `spsk`, `p2sk`) — incluindo assinatura, onde a normalizacao low-S
//! do ECDSA e o que faz `tz2` e `tz3` baterem.

use tz_keys::derive::{self, Curve};
use tz_keys::mnemonic::Mnemonic;
use tz_keys::secret::Scalar;
use tz_keys::sign::{ForgedOperation, SecretKey, Watermark};

/// Os bytes de operacao que o gerador assinou. Hex, como o Taquito recebe.
const OP_CURTA: &str = "aabb";
const OP_LONGA: &str = "03a5f2b8e4c6d0197b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6071829a6c00e0b4e4b60a3b0b0e1e2d3c4b5a69788796a5b4c3d2e1f00102030405060708";

struct VetorMnemonica {
    rotulo: &'static str,
    frase: &'static str,
    passphrase_bip39: &'static str,
    conta: u32,
    pkh: &'static str,
    pk: &'static str,
    sig_curta: &'static str,
    sig_generica: &'static str,
    sig_longa: &'static str,
}

struct VetorChaveCrua {
    rotulo: &'static str,
    sk: &'static str,
    pkh: &'static str,
    pk: &'static str,
    sig_curta: &'static str,
    sig_generica: &'static str,
    sig_longa: &'static str,
}

const MNEMONICAS: &[VetorMnemonica] = &[
    VetorMnemonica {
        rotulo: "ed25519/24/conta0",
        frase: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art",
        passphrase_bip39: "",
        conta: 0,
        pkh: "tz1YegD188fgGzXotMUQMcM4UFCyNAvHtw6p",
        pk: "edpkvRcttjBznD5zzTu8t4t4LJovkY28VEpoPAh2z4U4uHVvu5hXSh",
        sig_curta: "edsigu6vKQZPETpk8u3xFYC8gzrDdQSkGGssqrgoBAaqw3tpWe8cNCxU71MfcwQ8qF6EedTE6Svf8mPb87DJU5toG2TuCMgRjBe",
        sig_generica: "sigw6rHWALBtZ6qrxxQAHW3Yw7dcfLJF1FV13SSEqx3YoZLJfmi4Z1vJRhtoX39d4JBukUXQsmvmdMNRGGRkTHqQq6YAzQYQ",
        sig_longa: "edsigu4QtZ6Br3JmsAJrYuuYPF6nvhcJaPGgmpXZw8hMPG8AUF6NzgWpQUXgkcXnwr5XeJkPWUB9yLziJZPYnRRqAfRQi3XR6JY",
    },
    VetorMnemonica {
        rotulo: "ed25519/24/conta1",
        frase: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art",
        passphrase_bip39: "",
        conta: 1,
        pkh: "tz1X64XzuQM1yW3Hk994aXMk9nuEpCBnm2Ap",
        pk: "edpkuHAArbAfACcVNebKzMLikCarFE4mB6bT7hfvuFKSbT4RXLrhjm",
        sig_curta: "edsigtyzbFVSscyMEHStNdAUwjQ2pu9ADojSC6tPZnzySSKoTi8qzR4BTvMX6X5KB5MKTLddUJcif1nASn2fYhBRxMUCuo9DXXB",
        sig_generica: "sigpB88SDyM3ACEFu5V8dkn6kK8K5Hq6ZbjCdq4eyTRynWQJuPvAGNqJHBUUhNyt96u69rP6wJBACg3EdM335zAR8orR5mHj",
        sig_longa: "edsigtziwgvSYa2iXW9rAmvKHypf1oGQAzFs934bSNrq22Cbr1b5HhaAMfYuT68GDUNfUaYctrPpukgP8J5oYkcg7EjUHr2i69x",
    },
    VetorMnemonica {
        rotulo: "ed25519/12/conta0",
        frase: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
        passphrase_bip39: "",
        conta: 0,
        pkh: "tz1VQA4RP4fLjEEMW2FR4pE9kAg5abb5h5GL",
        pk: "edpku4US3ZykcZifjzSGFCmFr3zRgCKndE82estE4irj4d5oqDNDvf",
        sig_curta: "edsigtveKWA8iBtmM9R6hCG5Z8Z7ptfybhrVdKApq71hbEuz7wqwmof7jyHmA4YXo8oZKjgqbERaY4Qm5qSfSqfstXYsf7QyyeG",
        sig_generica: "sigkprP6uouxaK6E7Q4EENBFqK7qtfjDd2wV56NfhcEZyAe21BJmCetEXF1wv13LNyJ9MyJuoBDnoK6edFBXXvLVoZ9RVRXV",
        sig_longa: "edsigthGXLUViNZQexTWf8EHwKbSymvsNv84RGqXoeMdkQ3pQS3Ppbq7ZWCuDamcKgw3B83XNfhYiS3qbkNJ2obaFJCUhWGmZZf",
    },
    VetorMnemonica {
        rotulo: "ed25519/24/passphrase",
        frase: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art",
        passphrase_bip39: "hunter2",
        conta: 0,
        pkh: "tz1UZUdHCNTvHEXAdNg1btDAUqQ11nwquTbG",
        pk: "edpktmkW8c9BCMi4zwKttJswPUDc5nurAG6zsMRNStdKexCbkQCbem",
        sig_curta: "edsigthPEh2uzjAwC9hLfyd5eXXmn8UJzPTXpju9hSfApxVDS7LubGM8ejbmXz75KeGDnWHxZmrS8qF6iwtPUn7Ry8pYmFEtDBz",
        sig_generica: "sigXZmZyh6TEkA6WMNqbETaEVGMeE4QpfENDPxiKAqx9CUoWxzmTDZeYXcwWTXYo3S4kUwrLemzd8xD6MH7y5zwmUfLQvYor",
        sig_longa: "edsigtdn8Es8SajV8nncXDj3EDh1rNhRDT3Vpe31Xcj5x4YPdqC4wuvRhNX4pDapBetEAARhrAyuyKBxujJGyJhT9npdi8umb7h",
    },];

const CHAVES_CRUAS: &[VetorChaveCrua] = &[
    VetorChaveCrua {
        rotulo: "secp256k1/spsk1",
        sk: "spsk1S1Ree7gaspotLbU2WkEvqCHZ1R6Gh5raPeJhJzH5KAxvEEuSB",
        pkh: "tz2JMcJCm8XXZGqZDYEKqEQ81r29xfY8FgfX",
        pk: "sppk7aK6iq8vaTFNMrJd2LfjqYuEWzZCxB7n7UC4GRN1zN98vVwJDrV",
        sig_curta: "spsig1UxC2S1G4V3waperYgzEGuC8otxEEFbU4j8cL19ynEj9h65HRC5y47dDB4rR45Mo2DaEUFYaLuhLPgqTPCZDWniq2DyLic",
        sig_generica: "sigm8WhNQ1b95oCef6aYS5czWku5AfABxmbA1HZCzfyLoSG2RUEd1b6z9MUhHKzgHvwVq5jHgwumYcJQ8LsKsibaBiX9iFdy",
        sig_longa: "spsig1UJPNxecvfmT2NYenGWtM9Cmdh19PSiFqW7JyvsDPYXREGbco6kWR829aGw7xXvVH2deL4ENdEAxwcXxFKmcM262uhQY6v",
    },
    VetorChaveCrua {
        rotulo: "p256/p2sk1",
        sk: "p2sk2MEYt93H37wHdnpkPYQ2hipLmSX4bnhocvAjxnnvnzvH7W76T2",
        pkh: "tz3eMN7uTh8FG734or1EzSKwXKJQDdevUKLH",
        pk: "p2pk65BzdHxurDXXfTiRaiFJMwHXDB1mNi8z5Yr1ByoBZYRSXoXioBS",
        sig_curta: "p2sigUDNCK9gM9XerKdHX6Qr2YdzVs1qUTdBG8nii87T7iuDiUbk9NxDWXjqX9mNyz5t5Svz1DBvJhggJoBBCTfyu9JTMjpSxm",
        sig_generica: "sigUu9ME48FgbcPPNXGNpKF3BD7UMcDNCm3h1sKif1pWSwAwKxpzu8HFZRDxprkYtJkpuTz8wyyCjMwQVFTsDnTsc7Tctshv",
        sig_longa: "p2sigmsR5uNkxqkWwTBNTuTNrtN5E73kVWuH5pTnMdjLGdNJKGb22W8sg67zQ1KC9pH1HJxRBKJjHWub9rwWXK7WeTKjDP5znr",
    },
    VetorChaveCrua {
        rotulo: "secp256k1/spsk2",
        sk: "spsk213rC8ywu5mhknS32zJ3PgoeZKxenSHu79NDpmpWgF3RzaRSDB",
        pkh: "tz2CryhUPVWY6G4UnMmZoRB8qGoMskN1KDzv",
        pk: "sppk7Zu6CTV6s5GzSiczTupNHgqMMfErtha2FZ3bjwUBvjb4w63UvAn",
        sig_curta: "spsig1adZVrM1em1agScm6tB1J8xD6m2K3aBUPdbbrvoo3My3sPTh23v5vBJ57SWrLDLSEdTq1p8AagobKgvM55hih4iM4cUi3T",
        sig_generica: "sigrotAnjmBR3SJGd18jcreEGqBwEjyWYmv4UH68eVEU3LSKosqUqhy3pDR4wmGpGa9uigGrGY9YesEQDEZD2DmrBEXuNLDq",
        sig_longa: "spsig1AwoVYDfyx3UoHgfEWmA8e389eRio2yewQ5LSEC7ZPrMwZZZzh81Rv6xQDa5uJaLhi9Fha5iDbBMtSmoTK89RHUpS1JvHZ",
    },
    VetorChaveCrua {
        rotulo: "p256/p2sk2",
        sk: "p2sk2vGyRduYMKtBWEfKQ1wqAaRhmm4d7Xur9ftf6FdAPvnkHxqGK6",
        pkh: "tz3gRyTfbF1e62AZPzonmfJZQ6G6T9Tv9pPv",
        pk: "p2pk65u6oV1AE81Lp8ZXwQ2T3LBttDd8ip5P3WEscg59zNhbUqCVApY",
        sig_curta: "p2sigrjrEuRHKN91upe6KHho6kz2sSMFZwKmcomibwuMEptYtjG7rz5ufpumSDTAzbJjhPktTh7kFUpMuzJFTyL99RY39yTUJq",
        sig_generica: "sigsRdPpKjDuCyStPL4a7GKFXFV3h2JquMQMzsDYSuwcSGMBzLYc2pSYjM92WemA7ANmjNScsouys3YbcKjNswi9qh9r1Zwt",
        sig_longa: "p2sigoG9F2CX8FkjDBD84LZgDFD5Dzz2kciRMLs5wcnRYQY9E1ChkQwwhWwgGggnkkAtMKzo9rrwN7KFePqQUKt9ARqBV4WNB9",
    },
    VetorChaveCrua {
        rotulo: "ed25519/edsk32",
        sk: "edsk2gM2LioC6YfkHSgkD1opuvCLS8Ao7ytPf4QXmaupPwVgF27wFW",
        pkh: "tz1MsZxMSJdiUV9hVs4UKAMrXtksDvxWAZe2",
        pk: "edpkuZpp81M8NmaFbueXY8bk7EP9V54XTnwsFFt77Z5FTPs2QzLU9r",
        sig_curta: "edsigtgCAEnpHbXDqjMns4KhruuZx6dqSGBhcrAmTQJbN82xYo6stR7B7G9jCHG3mvryYxbKNo6Bog7aMWpxzrQSJ8YfWd8HCLV",
        sig_generica: "sigWNh7jbPKb2ogAoZvHrfxcHSKokWHYq2UV1ifxbP7gwbVGwHvDG2B6VHEfRyqPoCX3qksaQSqVcan2voCG6KwVbQdzpsje",
        sig_longa: "edsigu4txVd4m8r6WNdve8yaeGigfP9oszwxpFcSfTguF6FcGcRzAvdWaVniPTbvdLrdYjCLWfNNWHdKPw72MUwQqvqD72FXAr2",
    },];

fn assina(sk: &SecretKey, hex_op: &str) -> (String, String) {
    let op = ForgedOperation::from_locally_forged(hex::decode(hex_op).unwrap());
    let s = sk.sign(Watermark::GenericOperation, &op).expect("assinar");
    (s.to_base58(), s.to_generic_base58())
}

#[test]
fn mnemonica_bate_com_o_taquito() {
    for v in MNEMONICAS {
        let m = Mnemonic::parse(v.frase).expect(v.rotulo);
        let seed = m.to_seed(v.passphrase_bip39).expect(v.rotulo);
        let path = derive::tezos_path(v.conta).expect(v.rotulo);
        let no = derive::derive(Curve::Ed25519, &seed, &path).expect(v.rotulo);
        let sk = SecretKey::from_scalar(Curve::Ed25519, Scalar::from_bytes(*no.scalar.expose()))
            .expect(v.rotulo);

        assert_eq!(
            sk.address().unwrap().as_str(),
            v.pkh,
            "endereco: {}",
            v.rotulo
        );
        assert_eq!(
            sk.public_key().unwrap().to_base58(),
            v.pk,
            "chave publica: {}",
            v.rotulo
        );

        let (curta, generica) = assina(&sk, OP_CURTA);
        assert_eq!(curta, v.sig_curta, "assinatura curta: {}", v.rotulo);
        assert_eq!(
            generica, v.sig_generica,
            "assinatura generica: {}",
            v.rotulo
        );
        let (longa, _) = assina(&sk, OP_LONGA);
        assert_eq!(longa, v.sig_longa, "assinatura longa: {}", v.rotulo);
    }
    assert!(MNEMONICAS.len() >= 4);
}

#[test]
fn chave_crua_importada_bate_com_o_taquito() {
    for v in CHAVES_CRUAS {
        let sk = SecretKey::from_base58(v.sk).expect(v.rotulo);
        assert_eq!(
            sk.address().unwrap().as_str(),
            v.pkh,
            "endereco: {}",
            v.rotulo
        );
        assert_eq!(
            sk.public_key().unwrap().to_base58(),
            v.pk,
            "chave publica: {}",
            v.rotulo
        );

        let (curta, generica) = assina(&sk, OP_CURTA);
        assert_eq!(curta, v.sig_curta, "assinatura curta: {}", v.rotulo);
        assert_eq!(
            generica, v.sig_generica,
            "assinatura generica: {}",
            v.rotulo
        );
        let (longa, _) = assina(&sk, OP_LONGA);
        assert_eq!(longa, v.sig_longa, "assinatura longa: {}", v.rotulo);
    }
    // tz1 importado, tz2 e tz3 — as tres curvas que a v1 assina.
    assert!(CHAVES_CRUAS.len() >= 5);
}

/// §9.2 — **teste negativo explicito: o esquema do Cardano nao e o nosso.**
///
/// `ed25519-bip32` (BIP32-Ed25519, do Cardano) tem o mesmo nome de familia e
/// produz endereco **diferente** a partir da mesma mnemonica. Escolher a
/// biblioteca errada aqui gera uma carteira que nenhuma outra carteira Tezos
/// consegue restaurar — e o usuario so descobre quando tenta.
///
/// Aqui o desvio e simulado no ponto onde ele de fato acontece: a chave HMAC
/// do no mestre. O teste fixa **qual e o nosso** e mostra que o outro da outra
/// coisa. A barreira e vetor, nao atencao do revisor.
#[test]
fn nosso_esquema_nao_e_o_do_cardano() {
    let v = &MNEMONICAS[0];
    let m = Mnemonic::parse(v.frase).unwrap();
    let seed = m.to_seed("").unwrap();

    // O nosso, fixado pelo Taquito.
    let path = derive::tezos_path(0).unwrap();
    let nosso = derive::derive(Curve::Ed25519, &seed, &path).unwrap();
    let nosso_sk =
        SecretKey::from_scalar(Curve::Ed25519, Scalar::from_bytes(*nosso.scalar.expose())).unwrap();
    assert_eq!(nosso_sk.address().unwrap().as_str(), v.pkh);

    // Um esquema com outra chave de no mestre — a diferenca de familia que a
    // §4.3 nomeia — leva a outro endereco a partir da mesma frase.
    let outro = derive::derive_with_master_key(
        b"ed25519 cardano seed",
        Curve::Ed25519,
        seed.expose(),
        &path,
    )
    .unwrap();
    let outro_sk =
        SecretKey::from_scalar(Curve::Ed25519, Scalar::from_bytes(*outro.scalar.expose())).unwrap();
    assert_ne!(
        outro_sk.address().unwrap().as_str(),
        v.pkh,
        "um esquema de derivacao diferente produziu o MESMO endereco: o teste nao esta testando nada"
    );
}
