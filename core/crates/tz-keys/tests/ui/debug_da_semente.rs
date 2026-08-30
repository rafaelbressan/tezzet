// Um `{:?}` de segredo vai para o log, para o crash report e para a tela.
fn main() {
    let s = tz_keys::secret::Seed::zeroed();
    println!("{s:?}");
}
