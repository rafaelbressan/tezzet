// §7.1.3 — tipo de segredo nao e clonavel: cada clone e uma copia que ninguem
// lembra de zerar.
fn main() {
    let s = tz_keys::secret::Scalar::zeroed();
    let _copia = s.clone();
}
