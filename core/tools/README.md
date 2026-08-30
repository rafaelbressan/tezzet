# `core/tools`

Ferramentas de **geracao de vetor** e de **prova de portao**. Nenhuma delas
entra no build do nucleo.

| Arquivo | O que faz |
|---|---|
| `mutantes.sh` | Insere um defeito real por vez e **exige** que o portao correspondente fique vermelho. Um portao que passa com o defeito no lugar e decorativo. |
| `vetores-taquito.mjs` | Gera os vetores de `tz-keys/tests/vetores_taquito.rs` com `@taquito/signer` 25.0.0 — o cruzamento independente da §9.2. Conferir contra si mesmo nao conta. |
| `prefixos-taquito.mjs` | Gera os vetores de prefixo base58 de `tz-keys/tests/base58_e_enderecos.rs`. Confere os bytes transcritos de `octez` `src/lib_crypto/base58.ml` contra outra implementacao — transcricao e exatamente o tipo de coisa que se erra em silencio. |

## Regerar os vetores

```sh
mkdir -p /tmp/tzvec && cd /tmp/tzvec
npm init -y >/dev/null
npm i @taquito/signer@25 @taquito/utils@25
node <caminho>/core/tools/vetores-taquito.mjs   > vetores.json
node <caminho>/core/tools/prefixos-taquito.mjs  > prefixos.json
```

Depois cole os valores nos arquivos de teste. **Nao automatize esse ultimo
passo:** um gerador que reescreve o teste sozinho transforma "o Rust concorda
com o Taquito" em "o Rust concorda consigo mesmo", que e o que a §9.2 proibe
com todas as letras.
