//! §9.2 — **vetores oficiais do SLIP-0010**, rodando no CI.
//!
//! Extraidos de `slip-0010.md` do repositorio `satoshilabs/slips`, secao
//! "Test vectors". Sao a condicao (a) das tres que autorizam a composicao
//! propria da derivacao (§4.3, e o cabecalho de `tz_keys::derive`): sem eles,
//! isto volta a ser reimplementacao de primitiva e e reprovado.
//!
//! Os encadeamentos **nao-endurecidos** dos vetores oficiais estao
//! deliberadamente de fora: esta implementacao nao tem derivacao
//! nao-endurecida, em curva nenhuma. O teste `nao_endurecido_e_recusado` fixa
//! que a ausencia e recusa explicita, e nao esquecimento.

use tz_keys::derive::{self, Curve};
use tz_keys::error::KeyError;
use tz_keys::secret::Scalar;
use tz_keys::sign::SecretKey;

use tz_params::derivation::hardened;

struct Vetor {
    rotulo: &'static str,
    curva: Curve,
    seed_hex: &'static str,
    path: &'static [u32],
    private: &'static str,
    chain_code: &'static str,
    public: &'static str,
}

const VETORES: &[Vetor] = &[
    Vetor {
        rotulo: "Test vector 1 for secp256k1 - m",
        curva: Curve::Secp256k1,
        seed_hex: "000102030405060708090a0b0c0d0e0f",
        path: &[],
        private: "e8f32e723decf4051aefac8e2c93c9c5b214313817cdb01a1494b917c8436b35",
        chain_code: "873dff81c02f525623fd1fe5167eac3a55a049de3d314bb42ee227ffed37d508",
        public: "0339a36013301597daef41fbe593a02cc513d0b55527ec2df1050e2e8ff49c85c2",
    },
    Vetor {
        rotulo: "Test vector 1 for secp256k1 - m/0'",
        curva: Curve::Secp256k1,
        seed_hex: "000102030405060708090a0b0c0d0e0f",
        path: &[hardened(0)],
        private: "edb2e14f9ee77d26dd93b4ecede8d16ed408ce149b6cd80b0715a2d911a0afea",
        chain_code: "47fdacbd0f1097043b78c63c20c34ef4ed9a111d980047ad16282c7ae6236141",
        public: "035a784662a4a20a65bf6aab9ae98a6c068a81c52e4b032c0fb5400c706cfccc56",
    },
    Vetor {
        rotulo: "Test vector 1 for nist256p1 - m",
        curva: Curve::NistP256,
        seed_hex: "000102030405060708090a0b0c0d0e0f",
        path: &[],
        private: "612091aaa12e22dd2abef664f8a01a82cae99ad7441b7ef8110424915c268bc2",
        chain_code: "beeb672fe4621673f722f38529c07392fecaa61015c80c34f29ce8b41b3cb6ea",
        public: "0266874dc6ade47b3ecd096745ca09bcd29638dd52c2c12117b11ed3e458cfa9e8",
    },
    Vetor {
        rotulo: "Test vector 1 for nist256p1 - m/0'",
        curva: Curve::NistP256,
        seed_hex: "000102030405060708090a0b0c0d0e0f",
        path: &[hardened(0)],
        private: "6939694369114c67917a182c59ddb8cafc3004e63ca5d3b84403ba8613debc0c",
        chain_code: "3460cea53e6a6bb5fb391eeef3237ffd8724bf0a40e94943c98b83825342ee11",
        public: "0384610f5ecffe8fda089363a41f56a5c7ffc1d81b59a612d0d649b2d22355590c",
    },
    Vetor {
        rotulo: "Test vector 1 for ed25519 - m",
        curva: Curve::Ed25519,
        seed_hex: "000102030405060708090a0b0c0d0e0f",
        path: &[],
        private: "2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7",
        chain_code: "90046a93de5380a72b5e45010748567d5ea02bbf6522f979e05c0d8d8ca9fffb",
        public: "00a4b2856bfec510abab89753fac1ac0e1112364e7d250545963f135f2a33188ed",
    },
    Vetor {
        rotulo: "Test vector 1 for ed25519 - m/0'",
        curva: Curve::Ed25519,
        seed_hex: "000102030405060708090a0b0c0d0e0f",
        path: &[hardened(0)],
        private: "68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3",
        chain_code: "8b59aa11380b624e81507a27fedda59fea6d0b779a778918a2fd3590e16e9c69",
        public: "008c8a13df77a28f3445213a0f432fde644acaa215fc72dcdf300d5efaa85d350c",
    },
    Vetor {
        rotulo: "Test vector 1 for ed25519 - m/0'/1'",
        curva: Curve::Ed25519,
        seed_hex: "000102030405060708090a0b0c0d0e0f",
        path: &[hardened(0), hardened(1)],
        private: "b1d0bad404bf35da785a64ca1ac54b2617211d2777696fbffaf208f746ae84f2",
        chain_code: "a320425f77d1b5c2505a6b1b27382b37368ee640e3557c315416801243552f14",
        public: "001932a5270f335bed617d5b935c80aedb1a35bd9fc1e31acafd5372c30f5c1187",
    },
    Vetor {
        rotulo: "Test vector 1 for ed25519 - m/0'/1'/2'",
        curva: Curve::Ed25519,
        seed_hex: "000102030405060708090a0b0c0d0e0f",
        path: &[hardened(0), hardened(1), hardened(2)],
        private: "92a5b23c0b8a99e37d07df3fb9966917f5d06e02ddbd909c7e184371463e9fc9",
        chain_code: "2e69929e00b5ab250f49c3fb1c12f252de4fed2c1db88387094a0f8c4c9ccd6c",
        public: "00ae98736566d30ed0e9d2f4486a64bc95740d89c7db33f52121f8ea8f76ff0fc1",
    },
    Vetor {
        rotulo: "Test vector 1 for ed25519 - m/0'/1'/2'/2'",
        curva: Curve::Ed25519,
        seed_hex: "000102030405060708090a0b0c0d0e0f",
        path: &[hardened(0), hardened(1), hardened(2), hardened(2)],
        private: "30d1dc7e5fc04c31219ab25a27ae00b50f6fd66622f6e9c913253d6511d1e662",
        chain_code: "8f6d87f93d750e0efccda017d662a1b31a266e4a6f5993b15f5c1f07f74dd5cc",
        public: "008abae2d66361c879b900d204ad2cc4984fa2aa344dd7ddc46007329ac76c429c",
    },
    Vetor {
        rotulo: "Test vector 1 for ed25519 - m/0'/1'/2'/2'/1000000000'",
        curva: Curve::Ed25519,
        seed_hex: "000102030405060708090a0b0c0d0e0f",
        path: &[hardened(0), hardened(1), hardened(2), hardened(2), hardened(1000000000)],
        private: "8f94d394a8e8fd6b1bc2f3f49f5c47e385281d5c17e65324b0f62483e37e8793",
        chain_code: "68789923a0cac2cd5a29172a475fe9e0fb14cd6adb5ad98a3fa70333e7afa230",
        public: "003c24da049451555d51a7014a37337aa4e12d41e485abccfa46b47dfb2af54b7a",
    },
    Vetor {
        rotulo: "Test vector 2 for secp256k1 - m",
        curva: Curve::Secp256k1,
        seed_hex: "fffcf9f6f3f0edeae7e4e1dedbd8d5d2cfccc9c6c3c0bdbab7b4b1aeaba8a5a29f9c999693908d8a8784817e7b7875726f6c696663605d5a5754514e4b484542",
        path: &[],
        private: "4b03d6fc340455b363f51020ad3ecca4f0850280cf436c70c727923f6db46c3e",
        chain_code: "60499f801b896d83179a4374aeb7822aaeaceaa0db1f85ee3e904c4defbd9689",
        public: "03cbcaa9c98c877a26977d00825c956a238e8dddfbd322cce4f74b0b5bd6ace4a7",
    },
    Vetor {
        rotulo: "Test vector 2 for nist256p1 - m",
        curva: Curve::NistP256,
        seed_hex: "fffcf9f6f3f0edeae7e4e1dedbd8d5d2cfccc9c6c3c0bdbab7b4b1aeaba8a5a29f9c999693908d8a8784817e7b7875726f6c696663605d5a5754514e4b484542",
        path: &[],
        private: "eaa31c2e46ca2962227cf21d73a7ef0ce8b31c756897521eb6c7b39796633357",
        chain_code: "96cd4465a9644e31528eda3592aa35eb39a9527769ce1855beafc1b81055e75d",
        public: "02c9e16154474b3ed5b38218bb0463e008f89ee03e62d22fdcc8014beab25b48fa",
    },
    Vetor {
        rotulo: "Test vector 2 for ed25519 - m",
        curva: Curve::Ed25519,
        seed_hex: "fffcf9f6f3f0edeae7e4e1dedbd8d5d2cfccc9c6c3c0bdbab7b4b1aeaba8a5a29f9c999693908d8a8784817e7b7875726f6c696663605d5a5754514e4b484542",
        path: &[],
        private: "171cb88b1b3c1db25add599712e36245d75bc65a1a5c9e18d76f9f2b1eab4012",
        chain_code: "ef70a74db9c3a5af931b5fe73ed8e1a53464133654fd55e7a66f8570b8e33c3b",
        public: "008fe9693f8fa62a4305a140b9764c5ee01e455963744fe18204b4fb948249308a",
    },
    Vetor {
        rotulo: "Test vector 2 for ed25519 - m/0'",
        curva: Curve::Ed25519,
        seed_hex: "fffcf9f6f3f0edeae7e4e1dedbd8d5d2cfccc9c6c3c0bdbab7b4b1aeaba8a5a29f9c999693908d8a8784817e7b7875726f6c696663605d5a5754514e4b484542",
        path: &[hardened(0)],
        private: "1559eb2bbec5790b0c65d8693e4d0875b1747f4970ae8b650486ed7470845635",
        chain_code: "0b78a3226f915c082bf118f83618a618ab6dec793752624cbeb622acb562862d",
        public: "0086fab68dcb57aa196c77c5f264f215a112c22a912c10d123b0d03c3c28ef1037",
    },
    Vetor {
        rotulo: "Test vector 2 for ed25519 - m/0'/2147483647'",
        curva: Curve::Ed25519,
        seed_hex: "fffcf9f6f3f0edeae7e4e1dedbd8d5d2cfccc9c6c3c0bdbab7b4b1aeaba8a5a29f9c999693908d8a8784817e7b7875726f6c696663605d5a5754514e4b484542",
        path: &[hardened(0), hardened(2147483647)],
        private: "ea4f5bfe8694d8bb74b7b59404632fd5968b774ed545e810de9c32a4fb4192f4",
        chain_code: "138f0b2551bcafeca6ff2aa88ba8ed0ed8de070841f0c4ef0165df8181eaad7f",
        public: "005ba3b9ac6e90e83effcd25ac4e58a1365a9e35a3d3ae5eb07b9e4d90bcf7506d",
    },
    Vetor {
        rotulo: "Test vector 2 for ed25519 - m/0'/2147483647'/1'",
        curva: Curve::Ed25519,
        seed_hex: "fffcf9f6f3f0edeae7e4e1dedbd8d5d2cfccc9c6c3c0bdbab7b4b1aeaba8a5a29f9c999693908d8a8784817e7b7875726f6c696663605d5a5754514e4b484542",
        path: &[hardened(0), hardened(2147483647), hardened(1)],
        private: "3757c7577170179c7868353ada796c839135b3d30554bbb74a4b1e4a5a58505c",
        chain_code: "73bd9fff1cfbde33a1b846c27085f711c0fe2d66fd32e139d3ebc28e5a4a6b90",
        public: "002e66aa57069c86cc18249aecf5cb5a9cebbfd6fadeab056254763874a9352b45",
    },
    Vetor {
        rotulo: "Test vector 2 for ed25519 - m/0'/2147483647'/1'/2147483646'",
        curva: Curve::Ed25519,
        seed_hex: "fffcf9f6f3f0edeae7e4e1dedbd8d5d2cfccc9c6c3c0bdbab7b4b1aeaba8a5a29f9c999693908d8a8784817e7b7875726f6c696663605d5a5754514e4b484542",
        path: &[hardened(0), hardened(2147483647), hardened(1), hardened(2147483646)],
        private: "5837736c89570de861ebc173b1086da4f505d4adb387c6a1b1342d5e4ac9ec72",
        chain_code: "0902fe8a29f9140480a00ef244bd183e8a13288e4412d8389d140aac1794825a",
        public: "00e33c0f7d81d843c572275f287498e8d408654fdf0d1e065b84e2e6f157aab09b",
    },
    Vetor {
        rotulo: "Test vector 2 for ed25519 - m/0'/2147483647'/1'/2147483646'/2'",
        curva: Curve::Ed25519,
        seed_hex: "fffcf9f6f3f0edeae7e4e1dedbd8d5d2cfccc9c6c3c0bdbab7b4b1aeaba8a5a29f9c999693908d8a8784817e7b7875726f6c696663605d5a5754514e4b484542",
        path: &[hardened(0), hardened(2147483647), hardened(1), hardened(2147483646), hardened(2)],
        private: "551d333177df541ad876a60ea71f00447931c0a9da16f227c11ea080d7391b8d",
        chain_code: "5d70af781f3a37b829f0d060924d5e960bdc02e85423494afc0b1a41bbe196d4",
        public: "0047150c75db263559a70d5778bf36abbab30fb061ad69f69ece61a72b0cfa4fc0",
    },
    Vetor {
        rotulo: "Test derivation retry for nist256p1 - m",
        curva: Curve::NistP256,
        seed_hex: "000102030405060708090a0b0c0d0e0f",
        path: &[],
        private: "612091aaa12e22dd2abef664f8a01a82cae99ad7441b7ef8110424915c268bc2",
        chain_code: "beeb672fe4621673f722f38529c07392fecaa61015c80c34f29ce8b41b3cb6ea",
        public: "0266874dc6ade47b3ecd096745ca09bcd29638dd52c2c12117b11ed3e458cfa9e8",
    },
    Vetor {
        rotulo: "Test derivation retry for nist256p1 - m/28578'",
        curva: Curve::NistP256,
        seed_hex: "000102030405060708090a0b0c0d0e0f",
        path: &[hardened(28578)],
        private: "06f0db126f023755d0b8d86d4591718a5210dd8d024e3e14b6159d63f53aa669",
        chain_code: "e94c8ebe30c2250a14713212f6449b20f3329105ea15b652ca5bdfc68f6c65c2",
        public: "02519b5554a4872e8c9c1c847115363051ec43e93400e030ba3c36b52a3e70a5b7",
    },
    Vetor {
        rotulo: "Test seed retry for nist256p1 - m",
        curva: Curve::NistP256,
        seed_hex: "a7305bc8df8d0951f0cb224c0e95d7707cbdf2c6ce7e8d481fec69c7ff5e9446",
        path: &[],
        private: "3b8c18469a4634517d6d0b65448f8e6c62091b45540a1743c5846be55d47d88f",
        chain_code: "7762f9729fed06121fd13f326884c82f59aa95c57ac492ce8c9654e60efd130c",
        public: "0383619fadcde31063d8c5cb00dbfe1713f3e6fa169d8541a798752a1c1ca0cb20",
    },];

#[test]
fn vetores_oficiais_slip10() {
    let mut visitados = 0usize;
    for v in VETORES {
        let seed = hex::decode(v.seed_hex).expect("vetor oficial em hex");
        let no = if v.path.is_empty() {
            derive::master_from_seed_bytes(v.curva, &seed).expect(v.rotulo)
        } else {
            derive::derive_from_seed_bytes(v.curva, &seed, v.path).expect(v.rotulo)
        };
        assert_eq!(
            hex::encode(no.scalar.expose()),
            v.private,
            "escalar: {}",
            v.rotulo
        );
        assert_eq!(
            hex::encode(no.chain_code.expose()),
            v.chain_code,
            "chain code: {}",
            v.rotulo
        );
        // A chave publica fecha o ciclo: escalar certo com serializacao errada
        // ainda produz endereco errado, e endereco errado e fundo perdido.
        let sk = SecretKey::from_scalar(v.curva, Scalar::from_bytes(*no.scalar.expose()))
            .expect("escalar do vetor oficial e valido");
        let esperado = match v.curva {
            // O SLIP-0010 escreve a publica ed25519 como `00 ‖ 32 bytes`.
            Curve::Ed25519 => v.public.trim_start_matches("00"),
            _ => v.public,
        };
        assert_eq!(
            hex::encode(sk.public_key().expect("publica").as_bytes()),
            esperado,
            "chave publica: {}",
            v.rotulo
        );
        visitados += 1;
    }
    assert!(visitados >= 20, "poucos vetores rodaram: {visitados}");
}

/// §4.3 — SLIP-0010 nao define derivacao nao-endurecida para ed25519, e o
/// caminho da suite e todo endurecido em qualquer curva. Uma implementacao que
/// "aceita" nao-endurecido e uma implementacao inventada.
#[test]
fn nao_endurecido_e_recusado() {
    let seed = hex::decode("000102030405060708090a0b0c0d0e0f").unwrap();
    for curva in [Curve::Ed25519, Curve::Secp256k1, Curve::NistP256] {
        let r = derive::derive_from_seed_bytes(curva, &seed, &[0]);
        assert!(
            matches!(r, Err(KeyError::DerivationPath)),
            "{curva:?} aceitou um nivel nao-endurecido"
        );
    }
}

/// O vetor "Test derivation retry for nist256p1" existe justamente porque o
/// primeiro `IL` sai invalido e o SLIP-0010 manda tentar de novo. Ele esta na
/// tabela acima; este teste so garante que ele nao suma dela numa edicao
/// distraida, porque e o unico que exercita esse ramo.
#[test]
fn o_ramo_de_nova_tentativa_esta_coberto() {
    assert!(
        VETORES
            .iter()
            .any(|v| v.rotulo.contains("derivation retry")),
        "o vetor de nova tentativa saiu da tabela"
    );
    assert!(
        VETORES.iter().any(|v| v.rotulo.contains("seed retry")),
        "o vetor de nova tentativa do no mestre saiu da tabela"
    );
}
