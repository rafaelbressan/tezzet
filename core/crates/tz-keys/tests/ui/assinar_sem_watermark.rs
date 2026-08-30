// §4.6 item 1 — o watermark e argumento obrigatorio. Nao existe sobrecarga
// que o omita, e "assinar bytes" nao e uma funcao desta biblioteca.
use tz_keys::derive::Curve;
use tz_keys::secret::Scalar;
use tz_keys::sign::{ForgedOperation, SecretKey};

fn main() {
    let sk = SecretKey::from_scalar(Curve::Ed25519, Scalar::from_bytes([7u8; 32])).unwrap();
    let op = ForgedOperation::from_locally_forged(vec![0xaa]);
    let _ = sk.sign(&op);
}
