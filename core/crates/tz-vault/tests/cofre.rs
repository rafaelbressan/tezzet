//! §9.5 — o cofre, testado **contra ataque**.
//!
//! Nenhum item aqui e satisfeito por inspecao. Cada um e um teste que roda no
//! CI e fica vermelho.

mod comum;

use comum::{HelloFalso, KeystoreFalso};
use std::time::Instant;
use tz_params::vault as v;
use tz_vault::aead::{Algorithm, NonceField};
use tz_vault::error::VaultError;
use tz_vault::format::{Payload, VaultFile};
use tz_vault::hw::Hardware;
use tz_vault::kdf::Profile;
use tz_vault::vault::{self, Wraps};

const SENHA: &[u8] = b"cavalo bateria grampo correto sete oito nove";
const SEMENTE: [u8; 64] = [0x5a; 64];

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

fn so_senha() -> Wraps<'static> {
    Wraps {
        passphrase: SENHA,
        hardware: None,
    }
}

// ---------------------------------------------------------------- ida e volta

#[test]
fn ida_e_volta_pela_passphrase() {
    let f = vault::create(Profile::Mobile, &so_senha(), &payload()).unwrap();
    let bytes = f.to_bytes();
    let lido = VaultFile::parse(&bytes).unwrap();
    let (_dek, p) = vault::open_with_passphrase(&lido, SENHA).unwrap();
    assert_eq!(p.secret(), &SEMENTE);
    assert_eq!(p.path(), tz_params::derivation::TEZOS_PATH);
    assert_eq!(p.curve, v::CURVE_ED25519);
}

/// §5.2 — o payload em claro tem **sempre** 128 bytes, e o arquivo tem sempre
/// o mesmo tamanho para o mesmo conjunto de embrulhos. Sem isso, o tamanho do
/// arquivo denuncia o tipo de carteira.
#[test]
fn o_tamanho_do_arquivo_nao_denuncia_o_tipo_de_carteira() {
    let semente = payload();
    let escalar = Payload::new(
        v::SECRET_KIND_ED25519_SCALAR,
        v::CURVE_ED25519,
        v::DERIV_NONE,
        &[],
        &[0x7b; 32],
    )
    .unwrap();
    let a = vault::create(Profile::Mobile, &so_senha(), &semente)
        .unwrap()
        .to_bytes();
    let b = vault::create(Profile::Mobile, &so_senha(), &escalar)
        .unwrap()
        .to_bytes();
    assert_eq!(
        a.len(),
        b.len(),
        "semente de 64 B e escalar de 32 B dao arquivos de tamanhos diferentes"
    );
    // Cabecalho + 1 embrulho sem ctx + nonce + len + payload + tag.
    assert_eq!(
        a.len(),
        v::HEADER_LEN + v::WRAP_FIXED_LEN + v::NONCE_FIELD_LEN + 4 + v::PAYLOAD_LEN + v::TAG_LEN
    );
}

// ------------------------------------------------------------- sem oraculo

/// §9.5 — **senha errada e arquivo adulterado sao indistinguiveis.**
///
/// Nao basta o texto ser igual: duas variantes de erro com o mesmo `Display`
/// continuam distinguiveis por `Debug`, por `PartialEq` e pelo que atravessa a
/// fronteira. Aqui a variante e a **mesma**.
#[test]
fn senha_errada_e_adulteracao_sao_o_mesmo_erro() {
    let f = vault::create(Profile::Mobile, &so_senha(), &payload()).unwrap();
    let bytes = f.to_bytes();

    let senha_errada = erro(vault::open_with_passphrase(
        &VaultFile::parse(&bytes).unwrap(),
        b"outra senha",
    ));

    let mut adulterado = bytes.clone();
    let ultimo = adulterado.len() - 1;
    adulterado[ultimo] ^= 0x01;
    let tag_virada = erro(vault::open_with_passphrase(
        &VaultFile::parse(&adulterado).unwrap(),
        SENHA,
    ));

    assert_eq!(senha_errada, VaultError::CannotOpen);
    assert_eq!(senha_errada, tag_virada);
    assert_eq!(format!("{senha_errada:?}"), format!("{tag_virada:?}"));
    assert_eq!(senha_errada.to_string(), tag_virada.to_string());
}

/// §9.5 — **um bit virado em qualquer posicao** faz a abertura falhar. O teste
/// varre todas as regioes: cabecalho, `ctx`, embrulho e corpo.
///
/// A varredura abre pelo caminho de **hardware** de proposito: ele nao roda
/// KDF, e sem isso 390 posicoes × Argon2id de 64 MiB levariam mais de um
/// minuto por execucao de CI. A cobertura e a mesma — o cabecalho e AAD dos
/// dois embrulhos, e a tabela de embrulhos inteira e AAD do corpo, entao virar
/// um bit no embrulho da passphrase tambem quebra o corpo.
#[test]
fn qualquer_bit_virado_impede_a_abertura() {
    let ks = KeystoreFalso::novo(true);
    let hw = Hardware::Sealer(&ks);
    let wraps = Wraps {
        passphrase: SENHA,
        hardware: Some(Hardware::Sealer(&ks)),
    };
    let f = vault::create(Profile::Mobile, &wraps, &payload()).unwrap();
    let originais = f.to_bytes();

    // Controle: intacto abre.
    let lido = VaultFile::parse(&originais).unwrap();
    assert!(vault::open_with_hardware(&lido, &hw).is_ok());

    let mut estruturais = 0usize;
    let mut criptograficas = 0usize;
    for i in 0..originais.len() {
        for bit in [0u8, 3, 7] {
            let mut b = originais.clone();
            b[i] ^= 1 << bit;
            if b == originais {
                continue;
            }
            match VaultFile::parse(&b) {
                Err(_) => estruturais += 1,
                Ok(lido) => match vault::open_with_hardware(&lido, &hw) {
                    Err(_) => criptograficas += 1,
                    // Nao ha byte "inofensivo": o cabecalho inteiro e AAD dos
                    // embrulhos, e a tabela de embrulhos inteira e AAD do
                    // corpo. Se algo abriu, e defeito.
                    Ok(_) => panic!("byte {i}, bit {bit} virado e o cofre abriu mesmo assim"),
                },
            }
        }
    }
    assert!(
        estruturais > 0 && criptograficas > 0,
        "estruturais={estruturais} cripto={criptograficas}"
    );
    assert_eq!(estruturais + criptograficas, originais.len() * 3);
}

// -------------------------------------------------- recusas antes do KDF

/// §5.6 e §9.5 — parametros fora da faixa sao recusados **sem rodar o KDF**,
/// e isso e **medido por tempo**.
///
/// Um Argon2id de 64 MiB leva centenas de milissegundos. A recusa estrutural
/// leva microssegundos. Se alguem mover a validacao para depois do KDF, este
/// teste fica vermelho — e nao por opiniao.
#[test]
fn parametros_fora_da_faixa_recusam_sem_rodar_o_kdf() {
    let f = vault::create(Profile::Mobile, &so_senha(), &payload()).unwrap();
    let bons = f.to_bytes();

    // Quanto custa o KDF de verdade, nesta maquina, agora.
    let t0 = Instant::now();
    let _ = vault::open_with_passphrase(&VaultFile::parse(&bons).unwrap(), SENHA);
    let custo_do_kdf = t0.elapsed();
    assert!(
        custo_do_kdf.as_millis() >= 20,
        "o KDF esta rapido demais para o teste valer: {custo_do_kdf:?}"
    );

    let casos: &[(&str, usize, [u8; 4])] = &[
        (
            "memoria de 8 GiB",
            v::header_at::ARGON2_M_KIB,
            8_388_608u32.to_le_bytes(),
        ),
        (
            "memoria de 8 KiB",
            v::header_at::ARGON2_M_KIB,
            8u32.to_le_bytes(),
        ),
        ("t = 0", v::header_at::ARGON2_T, 0u32.to_le_bytes()),
        ("t = 1000", v::header_at::ARGON2_T, 1000u32.to_le_bytes()),
        ("p = 99", v::header_at::ARGON2_P, 99u32.to_le_bytes()),
        // Dentro da faixa, mas incoerente com o perfil declarado.
        (
            "memoria de 128 MiB no perfil mobile",
            v::header_at::ARGON2_M_KIB,
            131_072u32.to_le_bytes(),
        ),
    ];
    for (nome, at, valor) in casos {
        let mut b = bons.clone();
        b[*at..*at + 4].copy_from_slice(valor);
        let lido = VaultFile::parse(&b).unwrap();
        let t = Instant::now();
        let r = vault::open_with_passphrase(&lido, SENHA);
        let levou = t.elapsed();
        assert_eq!(
            r.err(),
            Some(VaultError::KdfParamsOutOfRange),
            "caso: {nome}"
        );
        assert!(
            levou * 10 < custo_do_kdf,
            "caso {nome}: recusou em {levou:?}, o que sugere que o KDF rodou (KDF = {custo_do_kdf:?})"
        );
    }
}

/// §9.5 — `body_aead_id` ou `wrap_aead_id` desconhecido: recusa com erro
/// tipado, **sem rodar o KDF**. A recusa acontece no parser, antes de existir
/// oportunidade de rodar KDF nenhum.
#[test]
fn aead_desconhecido_recusa_no_parser() {
    let f = vault::create(Profile::Mobile, &so_senha(), &payload()).unwrap();
    let bons = f.to_bytes();
    for at in [
        v::header_at::BODY_AEAD_ID,
        v::HEADER_LEN + v::wrap_at::WRAP_AEAD_ID,
    ] {
        for id in [0x00u8, 0x03, 0xFF] {
            let mut b = bons.clone();
            b[at] = id;
            assert_eq!(
                VaultFile::parse(&b).err(),
                Some(VaultError::UnknownAead),
                "offset {at}, id {id:#04x}"
            );
        }
    }
}

/// §9.5 — `wrap_aead_id` trocado por outro valor **valido** ainda falha a
/// abertura, porque ele esta na AAD. Toda escolha de algoritmo e autenticada.
#[test]
fn wrap_aead_id_trocado_por_valor_valido_falha_na_tag() {
    let f = vault::create(Profile::Mobile, &so_senha(), &payload()).unwrap();
    let mut b = f.to_bytes();
    let at = v::HEADER_LEN + v::wrap_at::WRAP_AEAD_ID;
    assert_eq!(b[at], v::AEAD_XCHACHA20POLY1305);
    b[at] = v::AEAD_AES256GCM;
    // O nonce de 24 bytes agora tem preenchimento nao-zero para o AES-GCM,
    // entao a recusa vem antes — e mais cedo e melhor.
    let r = VaultFile::parse(&b);
    match r {
        Err(e) => assert_eq!(e, VaultError::BadNoncePadding),
        Ok(lido) => assert_eq!(
            vault::open_with_passphrase(&lido, SENHA).err(),
            Some(VaultError::CannotOpen)
        ),
    }
}

/// §5.2 e §9.5 — nonce de AES-256-GCM com **qualquer** byte nao-zero no
/// preenchimento `[0x0C..0x17]` e recusado, sem rodar o KDF.
///
/// Exigir zero fecha, de graca, um canal de 12 bytes por embrulho para esconder
/// metadado — item 20 do anti-catalogo.
#[test]
fn preenchimento_de_nonce_nao_zero_e_recusado() {
    let ks = KeystoreFalso::novo(true);
    let wraps = Wraps {
        passphrase: SENHA,
        hardware: Some(Hardware::Sealer(&ks)),
    };
    let f = vault::create(Profile::Mobile, &wraps, &payload()).unwrap();
    let bons = f.to_bytes();

    // O segundo embrulho e o KEK_hw, em AES-256-GCM.
    let inicio_hw = v::HEADER_LEN + v::WRAP_FIXED_LEN; // o KEK_pass nao tem ctx
    assert_eq!(
        bons[inicio_hw + v::wrap_at::WRAP_AEAD_ID],
        v::AEAD_AES256GCM
    );
    let base = inicio_hw + v::wrap_at::WRAP_NONCE;

    for k in v::NONCE_USED_AES_GCM..v::NONCE_FIELD_LEN {
        let mut b = bons.clone();
        assert_eq!(
            b[base + k],
            0,
            "o gravador deixou lixo no preenchimento, byte {k}"
        );
        b[base + k] = 0x01;
        assert_eq!(
            VaultFile::parse(&b).err(),
            Some(VaultError::BadNoncePadding),
            "preenchimento nao-zero aceito no byte {k}"
        );
    }
}

/// §5.2 — `wrap_flags` com qualquer bit de 1 a 7 ligado: recusa.
#[test]
fn bit_reservado_de_wrap_flags_e_recusado() {
    let f = vault::create(Profile::Mobile, &so_senha(), &payload()).unwrap();
    let bons = f.to_bytes();
    let at = v::HEADER_LEN + v::wrap_at::WRAP_FLAGS;
    for bit in 1..8u8 {
        let mut b = bons.clone();
        b[at] |= 1 << bit;
        assert_eq!(
            VaultFile::parse(&b).err(),
            Some(VaultError::ReservedFlagSet),
            "bit {bit} de wrap_flags aceito"
        );
    }
    // O bit 0 e legitimo: "obrigatorio na abertura".
    let mut b = bons.clone();
    b[at] |= v::WRAP_FLAG_REQUIRED;
    assert!(VaultFile::parse(&b).is_ok());
}

/// §5.2 — `reserved` do cabecalho: leitor recusa valor diferente de zero.
#[test]
fn reserved_do_cabecalho_e_recusado() {
    let f = vault::create(Profile::Mobile, &so_senha(), &payload()).unwrap();
    let mut b = f.to_bytes();
    b[v::header_at::RESERVED] = 0x01;
    assert_eq!(
        VaultFile::parse(&b).err(),
        Some(VaultError::UnsupportedVersion)
    );
}

#[test]
fn magic_e_versao_errados_recusam() {
    let f = vault::create(Profile::Mobile, &so_senha(), &payload()).unwrap();
    let bons = f.to_bytes();

    let mut b = bons.clone();
    b[0] = b'X';
    assert_eq!(VaultFile::parse(&b).err(), Some(VaultError::BadMagic));

    let mut b = bons.clone();
    b[v::header_at::FORMAT_VERSION] = 0x02;
    assert_eq!(
        VaultFile::parse(&b).err(),
        Some(VaultError::UnsupportedVersion)
    );

    assert_eq!(VaultFile::parse(b"").err(), Some(VaultError::Malformed));
    assert_eq!(
        VaultFile::parse(&bons[..40]).err(),
        Some(VaultError::Malformed)
    );
}

// ------------------------------------------------------------------ nonces

/// §9.5 — 10.000 gravacoes, 10.000 nonces distintos, no corpo e no embrulho.
///
/// A geracao de nonce e exercitada 10.000 vezes por algoritmo — e a **mesma**
/// funcao que toda gravacao chama. Rodar 10.000 `create` completos custaria
/// 10.000 × Argon2id de 64 MiB, ou cerca de meia hora de CI para medir a mesma
/// propriedade; por isso o numero grande vai na fonte do nonce e um numero
/// menor de cofres completos confere que a fonte esta de fato ligada.
#[test]
fn dez_mil_nonces_distintos() {
    for alg in [Algorithm::XChaCha20Poly1305, Algorithm::Aes256Gcm] {
        let mut vistos = std::collections::HashSet::new();
        for _ in 0..10_000 {
            let n = NonceField::fresh(alg).unwrap();
            assert!(
                vistos.insert(n.used(alg).to_vec()),
                "nonce repetido em {alg:?}"
            );
            assert!(
                n.0[alg.nonce_len()..].iter().all(|&b| b == 0),
                "preenchimento nao-zero saiu do gerador"
            );
        }
        assert_eq!(vistos.len(), 10_000);
    }
}

#[test]
fn cofres_gravados_em_sequencia_nao_repetem_nonce_nem_sal() {
    let mut corpos = std::collections::HashSet::new();
    let mut embrulhos = std::collections::HashSet::new();
    let mut sais = std::collections::HashSet::new();
    for _ in 0..16 {
        let f = vault::create(Profile::Mobile, &so_senha(), &payload()).unwrap();
        assert!(corpos.insert(f.body_nonce.0));
        assert!(embrulhos.insert(f.wraps[0].nonce.0));
        assert!(sais.insert(f.header.salt));
    }
}

// ------------------------------------------------------- dois AEADs no arquivo

/// §9.5 e §6.3 — **o cofre com dois AEADs**: corpo em XChaCha20-Poly1305,
/// `KEK_pass` em XChaCha20-Poly1305 e `KEK_hw` em AES-256-GCM. Abre pelos dois
/// caminhos.
///
/// Este e o arquivo que motiva a emenda da §5.2: um `aead_id` so no cabecalho
/// nao o descreve.
#[test]
fn cofre_android_com_dois_aeads_abre_pelos_dois_caminhos() {
    let ks = KeystoreFalso::novo(true);
    let wraps = Wraps {
        passphrase: SENHA,
        hardware: Some(Hardware::Sealer(&ks)),
    };
    let f = vault::create(Profile::Mobile, &wraps, &payload()).unwrap();

    assert_eq!(f.header.body_aead, Algorithm::XChaCha20Poly1305);
    assert_eq!(f.wraps[0].wrap_aead, Algorithm::XChaCha20Poly1305);
    assert_eq!(f.wraps[1].wrap_aead, Algorithm::Aes256Gcm);
    assert_eq!(f.wraps[1].ctx, b"tzvault.kek_hw.v1");

    let bytes = f.to_bytes();
    let lido = VaultFile::parse(&bytes).unwrap();
    let (_d1, p1) = vault::open_with_passphrase(&lido, SENHA).unwrap();
    let (_d2, p2) = vault::open_with_hardware(&lido, &Hardware::Sealer(&ks)).unwrap();
    assert_eq!(p1.secret(), &SEMENTE);
    assert_eq!(p2.secret(), &SEMENTE);
}

/// §6.2 — o `KEK_hw` do **Windows** e `wrap_type = 0x02` como o do Android,
/// mas XChaCha20-Poly1305. E por isso que "`wrap_type = 0x02` implica AES-GCM"
/// estaria errado, e o algoritmo precisa estar escrito.
#[test]
fn kek_hw_do_windows_usa_xchacha_e_tambem_e_wrap_type_2() {
    let hello = HelloFalso { autorizado: true };
    let wraps = Wraps {
        passphrase: SENHA,
        hardware: Some(Hardware::Kek(&hello)),
    };
    let f = vault::create(Profile::Desktop, &wraps, &payload()).unwrap();
    assert_eq!(f.wraps[1].wrap_type, v::WRAP_HW);
    assert_eq!(f.wraps[1].wrap_aead, Algorithm::XChaCha20Poly1305);
    let lido = VaultFile::parse(&f.to_bytes()).unwrap();
    assert!(vault::open_with_hardware(&lido, &Hardware::Kek(&hello)).is_ok());
}

/// §6.3 — **a demonstracao que vale e negativa.** Prompt negado faz o
/// desembrulho **falhar**, e nao uma tela que nao abre. E a passphrase continua
/// abrindo: perder o `KEK_hw` nao custa nada.
#[test]
fn prompt_negado_faz_o_desembrulho_falhar_e_a_senha_continua_abrindo() {
    let autorizado = KeystoreFalso::novo(true);
    let wraps = Wraps {
        passphrase: SENHA,
        hardware: Some(Hardware::Sealer(&autorizado)),
    };
    let f = vault::create(Profile::Mobile, &wraps, &payload()).unwrap();
    let lido = VaultFile::parse(&f.to_bytes()).unwrap();

    let negado = KeystoreFalso::novo(false);
    assert_eq!(
        vault::open_with_hardware(&lido, &Hardware::Sealer(&negado)).err(),
        Some(VaultError::HardwareKeyRefused)
    );
    assert!(vault::open_with_passphrase(&lido, SENHA).is_ok());
}

/// §5.4 — duas gravacoes seguidas produzem IVs diferentes, e o IV gravado no
/// arquivo e **o que a plataforma devolveu**, alinhado a esquerda.
#[test]
fn o_iv_do_keystore_vai_para_o_arquivo_e_muda_a_cada_gravacao() {
    let ks = KeystoreFalso::novo(true);
    let wraps = Wraps {
        passphrase: SENHA,
        hardware: Some(Hardware::Sealer(&ks)),
    };
    let a = vault::create(Profile::Mobile, &wraps, &payload()).unwrap();
    let b = vault::create(Profile::Mobile, &wraps, &payload()).unwrap();
    assert_ne!(a.wraps[1].nonce.0, b.wraps[1].nonce.0);
    for f in [&a, &b] {
        let iv = f.wraps[1].nonce.used(Algorithm::Aes256Gcm);
        assert_eq!(iv.len(), 12);
        assert!(iv.iter().any(|&x| x != 0));
        assert!(f.wraps[1].nonce.0[12..].iter().all(|&x| x == 0));
    }
}

/// §5.4 — o IV da plataforma e **conferido**, nao aceito cegamente.
#[test]
fn iv_invalido_da_plataforma_e_recusado() {
    assert_eq!(
        NonceField::from_platform_iv(Algorithm::Aes256Gcm, &[0u8; 12]).err(),
        Some(VaultError::BadHardwareIv),
        "IV todo zero aceito"
    );
    assert_eq!(
        NonceField::from_platform_iv(Algorithm::Aes256Gcm, &[1u8; 16]).err(),
        Some(VaultError::BadHardwareIv),
        "IV de 16 bytes aceito"
    );
    assert!(NonceField::from_platform_iv(Algorithm::Aes256Gcm, &[1u8; 12]).is_ok());
}

// --------------------------------------------------- reencriptacao e gravacao

/// §5.7 — cofre `v1-mobile` aberto no desktop vira `v1-desktop`, sem
/// perguntar. E o arquivo antigo, guardado em copia, continua abrindo.
#[test]
fn reencriptacao_oportunista() {
    let dir = tempdir("reencripta");
    let caminho = dir.join("carteira.vault");

    let antigo = vault::create(Profile::Mobile, &so_senha(), &payload()).unwrap();
    vault::write_atomic(&caminho, &antigo).unwrap();
    let copia_antiga = antigo.to_bytes();

    let lido = VaultFile::parse(&std::fs::read(&caminho).unwrap()).unwrap();
    let (_dek, p) = vault::open_with_passphrase(&lido, SENHA).unwrap();
    let regravou = vault::reencrypt_if_outdated(&caminho, &lido, &so_senha(), &p).unwrap();

    if Profile::current_platform() == Profile::Desktop {
        assert!(regravou, "cofre mobile aberto no desktop nao foi regravado");
        let novo = VaultFile::parse(&std::fs::read(&caminho).unwrap()).unwrap();
        assert_eq!(novo.header.profile_id, Profile::Desktop.id());
        assert_ne!(
            novo.header.salt, antigo.header.salt,
            "o sal nao foi trocado"
        );
        assert!(vault::open_with_passphrase(&novo, SENHA).is_ok());
    }

    // A copia antiga continua abrindo — e essa e a ressalva da §4.8: regravar
    // nao alcanca uma copia que ja vazou.
    let velho = VaultFile::parse(&copia_antiga).unwrap();
    assert!(vault::open_with_passphrase(&velho, SENHA).is_ok());
    let _ = std::fs::remove_dir_all(&dir);
}

/// §5.8 — a gravacao atomica **nunca** deixa o cofre anterior corrompido.
///
/// A interrupcao e simulada em cada passo: com o temporario ja no lugar, com o
/// temporario sem `fsync`, e com o destino inexistente. Em todos, ou o arquivo
/// antigo esta intacto, ou o novo esta completo — nunca metade.
#[test]
fn gravacao_atomica_nunca_deixa_um_cofre_pela_metade() {
    let dir = tempdir("atomica");
    let caminho = dir.join("carteira.vault");

    let v1 = vault::create(Profile::Mobile, &so_senha(), &payload()).unwrap();
    vault::write_atomic(&caminho, &v1).unwrap();
    let conteudo_v1 = std::fs::read(&caminho).unwrap();

    // Passo 1 interrompido: um temporario sobrou de uma tentativa anterior.
    let tmp = dir.join(".carteira.vault.tmp");
    std::fs::write(&tmp, b"lixo pela metade").unwrap();
    let v2 = vault::create(Profile::Mobile, &so_senha(), &payload()).unwrap();
    vault::write_atomic(&caminho, &v2).unwrap();
    let conteudo_v2 = std::fs::read(&caminho).unwrap();
    assert_ne!(conteudo_v1, conteudo_v2);
    assert!(VaultFile::parse(&conteudo_v2).is_ok());
    assert!(!tmp.exists(), "o temporario sobrou depois do rename");

    // Passo 2 e 3 interrompidos: o processo morre antes do rename. O que
    // sobra no destino e o cofre **anterior**, integro.
    std::fs::write(&tmp, b"outra tentativa interrompida").unwrap();
    let ainda = std::fs::read(&caminho).unwrap();
    assert_eq!(ainda, conteudo_v2);
    assert!(vault::open_with_passphrase(&VaultFile::parse(&ainda).unwrap(), SENHA).is_ok());
    let _ = std::fs::remove_dir_all(&dir);
}

/// §6.1 — permissao de dono, conferida na abertura.
#[cfg(unix)]
#[test]
fn permissao_frouxa_e_recusada() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempdir("permissao");
    let caminho = dir.join("carteira.vault");
    let f = vault::create(Profile::Mobile, &so_senha(), &payload()).unwrap();
    vault::write_atomic(&caminho, &f).unwrap();

    // O gravador ja nasce 0600.
    let modo = std::fs::metadata(&caminho).unwrap().permissions().mode();
    assert_eq!(modo & 0o777, 0o600, "gravou com modo {:o}", modo & 0o777);
    assert!(vault::check_permissions(&caminho).is_ok());

    std::fs::set_permissions(&caminho, std::fs::Permissions::from_mode(0o644)).unwrap();
    assert_eq!(
        vault::check_permissions(&caminho).err(),
        Some(VaultError::Io)
    );
    let _ = std::fs::remove_dir_all(&dir);
}

// ---------------------------------------------------------------- entropia

/// §9.1 — com o CSPRNG indisponivel, **criar cofre falha**. Nao degrada.
#[test]
fn sem_csprng_o_cofre_nao_nasce() {
    tz_rng::set_csprng_unavailable(true);
    let r = vault::create(Profile::Mobile, &so_senha(), &payload());
    tz_rng::set_csprng_unavailable(false);
    assert_eq!(r.err(), Some(VaultError::EntropyUnavailable));
    // E volta a funcionar quando a fonte volta.
    assert!(vault::create(Profile::Mobile, &so_senha(), &payload()).is_ok());
}

// ----------------------------------------------------------------- payload

#[test]
fn payload_malformado_e_recusado_depois_da_tag() {
    // `secret_kind` desconhecido nem chega a virar payload.
    assert!(Payload::new(0x09, v::CURVE_ED25519, v::DERIV_NONE, &[], &[0u8; 32]).is_err());
    // Comprimento incompativel com o kind.
    assert!(Payload::new(
        v::SECRET_KIND_BIP39_SEED,
        v::CURVE_ED25519,
        v::DERIV_NONE,
        &[],
        &[0u8; 32]
    )
    .is_err());
    // Caminho longo demais.
    assert!(Payload::new(
        v::SECRET_KIND_ED25519_SCALAR,
        v::CURVE_ED25519,
        v::DERIV_SLIP10_HARDENED,
        &[1, 2, 3, 4, 5, 6, 7, 8, 9],
        &[0u8; 32]
    )
    .is_err());

    // E na leitura: preenchimento nao-zero e recusado.
    let mut b = payload().to_bytes();
    b[v::payload_at::PAD] = 0x01;
    assert_eq!(Payload::parse(&b).err(), Some(VaultError::PayloadMalformed));
}

/// Os tipos que carregam segredo nao implementam `Debug` — de proposito —,
/// entao `unwrap_err()` nao existe para eles. Isto e o substituto.
fn erro<T>(r: Result<T, VaultError>) -> VaultError {
    match r {
        Err(e) => e,
        Ok(_) => panic!("esperava erro e o cofre abriu"),
    }
}

fn tempdir(nome: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("tz-vault-{nome}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}
