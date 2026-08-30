//! §9.1 e §7.1 — o **relatorio de build**, impresso pelo CI.
//!
//! A §9.1 nao pede "usamos um CSPRNG bom"; pede que o relatorio **nomeie a
//! chamada de sistema** que produziu os bits, e nao apenas a biblioteca de
//! fachada. A §7.1 pede saber se `mlock` pegou — e no Android ele **nao** pega,
//! e isso precisa aparecer em vez de ser presumido.
//!
//! Um relatorio que so diz "ok" nao serve para nada. Este diz nomes e diz
//! `NAO`.

fn main() {
    println!("{}", tezos_core::build_report());

    // O teste de falha da §9.1 vive em `tz-vault/tests/cofre.rs`
    // (`sem_csprng_o_cofre_nao_nasce`): com o CSPRNG indisponivel, criar
    // carteira **falha**, e nao degrada para outra fonte.
    let amostra: [u8; 8] = match tz_rng::bytes() {
        Ok(b) => b,
        Err(e) => {
            eprintln!("CSPRNG indisponivel neste alvo: {e}");
            std::process::exit(1);
        }
    };
    println!(
        "amostra do CSPRNG: {} bytes nao-zero em 8",
        amostra.iter().filter(|&&b| b != 0).count()
    );
}
