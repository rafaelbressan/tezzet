fn exige_serializavel<T: serde::Serialize>() {}

fn main() {
    exige_serializavel::<tz_keys::secret::Phrase>();
}
