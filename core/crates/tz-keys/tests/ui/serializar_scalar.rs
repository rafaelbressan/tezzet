// §9.7 / principio 7 — segredo nao atravessa serializacao.
fn exige_serializavel<T: serde::Serialize>() {}

fn main() {
    exige_serializavel::<tz_keys::secret::Scalar>();
}
