# Tezzet — app

Carteira Tezos da suíte Tezos.Rio. **Primeira onda: leitura e Beacon, sem
custódia.** O app lê a cadeia e monta as operações; quem assina é a carteira
que a pessoa já usa. Não há chave privada, semente nem frase de recuperação em
lugar nenhum deste código — e há um teste que reprova se alguém trouxer uma
(`test/sem-chave.test.ts`).

Stack: Tauri v2 + React + TypeScript, decidida na
[ADR-0001](../../docs/adr/0001-stack-unificada-tezzet-taps.md).

## O que tem

| | |
|---|---|
| Conectar | Beacon (TZIP-10), pela carteira do usuário |
| Saldo | total, **em stake** e **delegado** separados — desde o Adaptive Issuance são coisas diferentes |
| Histórico | TzKT com paginação por cursor (`lastId`), não por `offset` |
| Receber | QR, endereço inteiro, e **cópia que expira em 45 s** |
| Enviar | estimativa na rede, conferência de saldo, assinatura na carteira, confirmação Tenderbake |
| Rede | seletor lido de `public/networks.json`; rede de teste grita, mainnet fica quieta |

## Rodar

```bash
npm install
npm run dev            # http://localhost:1420
npm run tauri dev      # a janela de verdade
```

`npm install` não basta sozinho para os testes e o build: eles chamam
`npm run chain:fetch` antes (via `pre*`), que busca a camada de cadeia.

## Verificar

```bash
npm run verify         # cadeia + portão de desenho + tipos + testes + build
npm run test:contract  # fala com a Shadownet de verdade (rede necessária)
```

`npm run check:design` reprova cor escrita à mão, `border-radius` diferente de
zero e valor monetário tipado como `number`.

## Camada de cadeia

A aritmética de dinheiro, o cliente TzKT e a confirmação Tenderbake são de
`@tezos-suite/chain` (SPEC-0002), que hoje mora em `packages/tezos-chain` no
repositório do TAPS. **Não há cópia dela aqui.** Como o npm não instala
subdiretório de repositório git, `scripts/fetch-chain.mjs` busca o commit
fixado em `chain.pin.json` e monta em `vendor/` (fora do git).

Trocar esse commit é revisão do Tezos Chain & Payouts.

## Redes

`public/networks.json` é configuração, lida em execução — trocar endpoint não
pede recompilação, e o app **não abre** se o arquivo faltar ou vier
incompleto. Nenhuma constante de protocolo entra ali: `blocks_per_cycle` é
14400 em mainnet e Shadownet e 3600 em Bakingnet, e se lê da cadeia.

A rede padrão é a Shadownet. Mainnet move dinheiro de verdade e é escolha
explícita, toda vez.

## Desenho

Todo valor visual vem de [`suite/tokens/`](../../suite/). O `app.css` importa
`tokens.css` direto — não há uma segunda cópia de cor, espaço ou tipo.

## Alvos

| Alvo | Como | Situação |
|---|---|---|
| Linux | `npm run tauri build` | verificado |
| Android | `npm run tauri android init && npm run tauri android build --apk` | verificado (APK sem assinatura) |
| Windows | `npm run tauri build` num host Windows, ou o cruzado abaixo | verificado: compila, e o `.exe` abre a janela no Windows |
| iOS / macOS | — | adiado: não há máquina Apple (CLAUDE.md) |

`src-tauri/gen/` não entra no git: `tauri android init` o regenera a partir de
`tauri.conf.json`.

### Windows a partir do Linux

Não precisa de máquina Windows para saber se compila. `cargo-xwin` busca o CRT
e o SDK da Microsoft, e o LLVM entra no lugar das ferramentas da MSVC:

```bash
rustup target add x86_64-pc-windows-msvc
cargo install cargo-xwin
# clang-cl, lld-link, llvm-lib e llvm-rc precisam estar no PATH.
# llvm-rc é obrigatório: sem ele o build script do tauri-winres aborta com
# NotAttempted("llvm-rc") ao embutir o ícone e a versão no executável.
npm run tauri build -- --runner cargo-xwin --target x86_64-pc-windows-msvc --no-bundle
```

Sai `src-tauri/target/x86_64-pc-windows-msvc/release/tezzet.exe`. O que isso
prova é que o código compila e liga para Windows — **não** que a interface se
comporta lá. Para isso o `.exe` tem que rodar num Windows de verdade, com o
runtime do WebView2 instalado (o Tauri usa o WebView2, não o WebKitGTK).
