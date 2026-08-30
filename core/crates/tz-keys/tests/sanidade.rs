use tz_keys::derive::{self, Curve};
use tz_keys::mnemonic::Mnemonic;
use tz_keys::secret::Scalar;
use tz_keys::sign::{ForgedOperation, SecretKey, Watermark};

const PHRASE: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";

#[test]
fn cruzamento_taquito() {
    let m = Mnemonic::parse(PHRASE).unwrap();
    let seed = m.to_seed("").unwrap();
    println!("seed = {}", hex::encode(seed.expose()));
    let path = derive::tezos_path(0).unwrap();
    let d = derive::derive(Curve::Ed25519, &seed, &path).unwrap();
    let sk =
        SecretKey::from_scalar(Curve::Ed25519, Scalar::from_bytes(*d.scalar.expose())).unwrap();
    println!("addr = {}", sk.address().unwrap());
    println!("edpk = {}", sk.public_key().unwrap().to_base58());
    let op = ForgedOperation::from_locally_forged(vec![0xaa, 0xbb]);
    let sig = sk.sign(Watermark::GenericOperation, &op).unwrap();
    println!("edsig = {}", sig.to_base58());
    println!("sig   = {}", sig.to_generic_base58());
}
