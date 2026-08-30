//! §2.3 — o piso de entropia da passphrase, com numero.
//!
//! O KDF nao conserta senha fraca. A 10⁶ tentativas/s (o pior caso adotado pela
//! especificacao), 30 bits caem em **~9 minutos** e 60 bits levam **~36 mil
//! anos**. Por isso o piso e 60, e por isso ele e bloqueante.

use tz_vault::error::VaultError;
use tz_vault::policy;

#[test]
fn a_frase_gerada_e_o_caminho_padrao_e_passa_com_folga() {
    for _ in 0..8 {
        let f = policy::generate_passphrase().unwrap();
        assert_eq!(f.word_count(), policy::GENERATED_WORDS);
        assert!(
            policy::accept_passphrase(f.expose(), None).is_ok(),
            "{}",
            f.expose()
        );
        assert!(policy::conservative_entropy_bits(f.expose()) >= 60.0);
    }
    assert!(policy::generated_entropy_bits() >= 77.0);
}

#[test]
fn duas_frases_geradas_nao_sao_iguais() {
    let a = policy::generate_passphrase().unwrap();
    let b = policy::generate_passphrase().unwrap();
    assert_ne!(a.expose(), b.expose());
}

/// §2.3 — sem valor padrao, sem passphrase vazia, sem "pular por enquanto".
#[test]
fn senhas_fracas_sao_recusadas() {
    let fracas = [
        "",
        " ",
        "senha",
        "hunter2",
        "Password1!",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "abcdefghijklmnopqrstuvwxyz",
        "123456789012345678901234567890",
        // Frase de duas palavras da wordlist: 22 bits.
        "abandon ability",
        // Sete palavras, mas todas iguais: continua sendo uma escolha.
        "abandon abandon abandon abandon abandon abandon abandon",
    ];
    for f in fracas {
        assert_eq!(
            policy::accept_passphrase(f, None).err(),
            Some(VaultError::PassphraseTooWeak),
            "aceitou a senha fraca {f:?} ({} bits)",
            policy::conservative_entropy_bits(f)
        );
    }
}

/// A estimativa que vem de fora do perimetro auditado **nao pode afrouxar** o
/// portao: o veredito e o menor dos dois numeros.
#[test]
fn estimativa_otimista_do_produto_nao_afrouxa_o_portao() {
    assert_eq!(
        policy::accept_passphrase("hunter2", Some(999.0)).err(),
        Some(VaultError::PassphraseTooWeak),
        "uma estimativa otimista de fora conseguiu aprovar uma senha fraca"
    );
    // E o contrario funciona: uma estimativa pessimista de fora **aperta**.
    let boa = policy::generate_passphrase().unwrap();
    assert!(policy::accept_passphrase(boa.expose(), None).is_ok());
    assert_eq!(
        policy::accept_passphrase(boa.expose(), Some(10.0)).err(),
        Some(VaultError::PassphraseTooWeak)
    );
}

/// A estimativa embutida erra **para baixo**, e esta escrito que erra. Este
/// teste fixa a direcao do erro: ela nunca pode dar mais bits que a conta
/// ingenua de `comprimento × log2(alfabeto)`.
#[test]
fn a_estimativa_embutida_nunca_superestima() {
    let casos = [
        "Tr0ub4dor&3",
        "correcthorsebatterystaple",
        "aA1!aA1!aA1!aA1!",
    ];
    for c in casos {
        let nossa = policy::conservative_entropy_bits(c);
        let ingenua = c.chars().count() as f64 * (26.0f64 + 26.0 + 10.0 + 33.0).log2();
        assert!(
            nossa <= ingenua + 0.001,
            "{c:?}: nossa estimativa ({nossa}) passou da ingenua ({ingenua})"
        );
    }
}

/// Uma senha longa e variada de verdade passa — o portao nao e "so a frase
/// gerada".
#[test]
fn senha_longa_e_variada_passa() {
    let boas = [
        "correto-Cavalo-Bateria-Grampo-2026!",
        "9x#Kq2$Lp7@Wz4&Rm8!Tn",
    ];
    for b in boas {
        assert!(
            policy::accept_passphrase(b, None).is_ok(),
            "recusou {b:?} com {} bits",
            policy::conservative_entropy_bits(b)
        );
    }
}
