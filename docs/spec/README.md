# Especificações da Suíte Tezos

Especificações normativas que valem para a **suíte inteira** — Tezzet e TAPS — moram aqui, ao lado de `docs/adr/` (decisões de arquitetura) e de `suite/` (marca, narrativa e tokens).

A diferença entre os dois diretórios: uma **ADR** registra uma decisão e as alternativas rejeitadas; uma **SPEC** define o comportamento que o código precisa ter e os testes que provam isso. Uma ADR escolhe a stack; uma SPEC vale independentemente dela.

| # | Título | Status | Data | Dono |
|---|---|---|---|---|
| [0001](0001-nucleo-criptografico-compartilhado.md) | Núcleo criptográfico compartilhado (`tz-keys` + `tz-vault`) | Normativa — passada 1, emendada (BRES-68) | 2026-08-30 | Tezos Core & Crypto |

## Regra de revisão

Nada que toque chave, semente, derivação, assinatura, KDF, cifra de armazenamento, nonce, tag ou comparação de segredo entra em `main` sem revisão de **Tezos Core & Crypto**. A seção 10 da SPEC-0001 é a lista com que essa revisão é feita.
