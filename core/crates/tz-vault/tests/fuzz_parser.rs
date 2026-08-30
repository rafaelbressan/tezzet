//! §9.5 — **fuzzing do parser do cofre**: nenhuma entrada causa panico, laco
//! infinito ou alocacao ilimitada.
//!
//! O parser e a unica superficie do nucleo que come bytes de origem
//! nao-confiavel — o arquivo pode ter sido escrito por qualquer um. Um `panic`
//! aqui e negacao de servico; uma alocacao guiada pelo arquivo e negacao de
//! servico com memoria.
//!
//! O fuzzer e deterministico de proposito: mesmo `seed`, mesma sequencia, e
//! uma falha no CI e reproduzivel na maquina de quem for consertar. Nao
//! substitui `cargo-fuzz` com cobertura — substitui **nada**, porque hoje nao
//! ha nenhum.

mod comum;

use comum::KeystoreFalso;
use tz_params::vault as v;
use tz_vault::format::VaultFile;
use tz_vault::hw::Hardware;
use tz_vault::kdf::Profile;
use tz_vault::vault::{self, Wraps};

/// xorshift64*, para a sequencia ser a mesma em toda maquina.
struct Prng(u64);

impl Prng {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    fn byte(&mut self) -> u8 {
        (self.next() >> 33) as u8
    }

    fn upto(&mut self, n: usize) -> usize {
        if n == 0 {
            0
        } else {
            (self.next() >> 1) as usize % n
        }
    }
}

fn base() -> Vec<u8> {
    let ks = KeystoreFalso::novo(true);
    let payload = tz_vault::format::Payload::new(
        v::SECRET_KIND_BIP39_SEED,
        v::CURVE_ED25519,
        v::DERIV_SLIP10_HARDENED,
        &tz_params::derivation::TEZOS_PATH,
        &[0x5a; 64],
    )
    .unwrap();
    let wraps = Wraps {
        passphrase: b"senha do fuzz",
        hardware: Some(Hardware::Sealer(&ks)),
    };
    vault::create(Profile::Mobile, &wraps, &payload)
        .unwrap()
        .to_bytes()
}

#[test]
fn o_parser_nao_entra_em_panico_com_entrada_arbitraria() {
    let valido = base();
    let mut r = Prng(0x7a06_a770_0bad_c0de);
    let mut aceitos = 0usize;

    for i in 0..200_000u32 {
        let entrada = match i % 4 {
            // 1) Lixo puro, de comprimento arbitrario ate um pouco mais que um
            //    cofre real.
            0 => (0..r.upto(600)).map(|_| r.byte()).collect::<Vec<u8>>(),
            // 2) Prefixo valido + lixo: passa do `magic` e chega ao parser de
            //    embrulhos, que e onde moram os campos de comprimento.
            1 => {
                let mut b = valido[..v::HEADER_LEN.min(valido.len())].to_vec();
                b.extend((0..r.upto(400)).map(|_| r.byte()));
                b
            }
            // 3) Cofre valido truncado em qualquer ponto.
            2 => valido[..r.upto(valido.len() + 1)].to_vec(),
            // 4) Cofre valido com de 1 a 8 bytes trocados.
            _ => {
                let mut b = valido.clone();
                for _ in 0..1 + r.upto(8) {
                    let at = r.upto(b.len());
                    b[at] = r.byte();
                }
                b
            }
        };

        // O parser nao pode entrar em panico, e nao pode alocar guiado pelo
        // arquivo: `ctx_len` e `body_len` tem teto (§5.2).
        let res = std::panic::catch_unwind(|| VaultFile::parse(&entrada));
        match res {
            Err(_) => panic!(
                "panico no parser com a entrada #{i} ({} bytes)",
                entrada.len()
            ),
            Ok(Ok(f)) => {
                aceitos += 1;
                assert!(f.wraps.len() <= v::WRAP_COUNT_MAX as usize);
                for w in &f.wraps {
                    assert!(w.ctx.len() <= v::CTX_LEN_MAX);
                }
                assert_eq!(f.body.len(), v::PAYLOAD_LEN + v::TAG_LEN);
                // Um arquivo aceito pelo parser continua sem abrir com a senha
                // errada — o parser aprova a **forma**, nunca o conteudo. So
                // as tres primeiras vezes: cada tentativa custa um Argon2id de
                // 64 MiB, e o que se mede aqui e o parser, nao o KDF.
                if aceitos <= 3 {
                    assert_eq!(
                        vault::open_with_passphrase(&f, b"nao e a senha").err(),
                        Some(tz_vault::VaultError::CannotOpen)
                    );
                }
            }
            Ok(Err(_)) => {}
        }
    }
    // Sanidade do proprio fuzzer: se **nada** foi aceito, ele nao esta chegando
    // ao parser de embrulhos e o teste nao esta testando o que promete.
    assert!(
        aceitos > 0,
        "o fuzzer nunca produziu um arquivo estruturalmente valido"
    );
}

/// `ctx_len` e o campo classico de alocacao ilimitada: 16 bits, controlado
/// pelo arquivo. O teto da §5.2 e conferido aqui de forma direta.
#[test]
fn ctx_len_absurdo_nao_aloca() {
    let valido = base();
    let at = v::HEADER_LEN + v::wrap_at::CTX_LEN;
    for valor in [u16::MAX, 60_000, (v::CTX_LEN_MAX + 1) as u16] {
        let mut b = valido.clone();
        b[at..at + 2].copy_from_slice(&valor.to_le_bytes());
        assert!(VaultFile::parse(&b).is_err(), "ctx_len {valor} aceito");
    }
}

/// `body_len` idem: 32 bits vindos do arquivo.
#[test]
fn body_len_absurdo_nao_aloca() {
    let valido = base();
    let f = VaultFile::parse(&valido).unwrap();
    let inicio_do_corpo = valido.len() - (v::NONCE_FIELD_LEN + 4 + v::PAYLOAD_LEN + v::TAG_LEN);
    let _ = f;
    let at = inicio_do_corpo + v::NONCE_FIELD_LEN;
    for valor in [u32::MAX, 1_000_000_000u32, 0] {
        let mut b = valido.clone();
        b[at..at + 4].copy_from_slice(&valor.to_le_bytes());
        assert!(VaultFile::parse(&b).is_err(), "body_len {valor} aceito");
    }
}
