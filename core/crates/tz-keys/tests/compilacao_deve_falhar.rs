//! §9.7 — **o portao que o compilador garante.**
//!
//! *"Nenhum tipo que carrega segredo e serializavel — teste de compilacao que
//! deve falhar."* Sete casos. Nenhum compila, e o `.stderr` fixado ao lado
//! prova que o motivo e o certo — sem ele, um erro de digitacao no arquivo de
//! caso passaria por "nao compilou, portanto o portao funciona".
//!
//! Os dois ultimos casos cobrem o watermark: assinar sem ele nao compila, e
//! `Watermark::Custom` **nao existe**.

#[test]
fn casos_que_nao_podem_compilar() {
    let t = trybuild::TestCases::new();
    t.compile_fail("tests/ui/*.rs");
}
