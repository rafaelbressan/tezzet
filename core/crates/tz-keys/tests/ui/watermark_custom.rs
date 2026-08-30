// §4.6 item 3 — `Custom` e proibido na v1. A proibicao e a ausencia da
// variante: e o buraco por onde "assinar uma mensagem" vira "transferir
// fundos".
use tz_keys::sign::Watermark;

fn main() {
    let _ = Watermark::Custom(vec![0x05]);
}
