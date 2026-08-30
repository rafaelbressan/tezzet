# Documentação da Suíte Tezos

**Este diretório é o ponto de entrada do conhecimento do projeto.** Tudo que é decisão, análise ou especificação da suíte — Tezzet e TAPS — está indexado aqui e vive na `master`.

A regra, escrita para não se perder: **código pode viver em branch enquanto a stack não fecha; conhecimento não.** Decisão registrada só em branch de agente não registra decisão nenhuma — quem faz checkout da `master` não a encontra e a retoma do zero.

## Decisões de arquitetura (ADR)

Uma ADR registra o que foi decidido, quando, por quem, quais alternativas foram rejeitadas e por quê, e o que teria que ser verdade para voltar atrás.

| # | Documento | Status |
|---|---|---|
| ADR-0001 | [Stack unificada da Suíte Tezos](adr/0001-stack-unificada-tezzet-taps.md) | **Aceita** — Tauri v2 + núcleo Rust, aprovado em 2026-08-30 com override humano explícito de P5 |

Índice completo e as regras do formato: [`adr/README.md`](adr/README.md).

## Especificações (SPEC)

Uma SPEC define o comportamento que o código precisa ter e os testes que provam isso. Uma ADR escolhe a stack; uma SPEC vale independentemente dela.

| # | Documento | Dono |
|---|---|---|
| SPEC-0001 | [Núcleo criptográfico compartilhado (`tz-keys` + `tz-vault`)](spec/0001-nucleo-criptografico-compartilhado.md) | Tezos Core & Crypto |
| SPEC-0002 | [Camada de cadeia (`@tezos-suite/chain`)](spec/0002-camada-de-cadeia.md) | Tezos Chain & Payouts |

Índice e regra de revisão: [`spec/README.md`](spec/README.md).

## Evidência das medições

Relatório de spike não é documentação de produto, mas é o que sustenta uma ADR. Sem ele, "P5 atendido no mecanismo" é afirmação sem lastro para quem chegar depois. Fica em `master` pela mesma regra do topo desta página.

| Documento | O que sustenta |
|---|---|
| [`evidence/BRES-66-medicao-p5.md`](evidence/BRES-66-medicao-p5.md) | A medição que fechou P3.b/c/e, a entropia de P4 e P5 — incluindo o resultado ruim: `KeyInfo.getSecurityLevel() = Software` no emulador e `setInvalidatedByBiometricEnrollment(true)` sem efeito. É a base da ADR-0001 §12 e do BRES-67. |

## Análise dos sistemas herdados

| Documento | O que é |
|---|---|
| [`../ANALYSIS.md`](../ANALYSIS.md) | Análise do Tezzet: dívida técnica, segurança, necessidades criptográficas, e o que mudou na Tezos desde 2019 |
| `ANALYSIS.md` no repositório do **TAPS** | Análise do TAPS: o que impede o sistema de rodar, segurança, correção financeira |
| `docs/spec/REGRAS-DE-NEGOCIO.md` no repositório do **TAPS** | As regras de negócio extraídas do sistema original — o ativo mais valioso daquele repositório |

## Identidade compartilhada

| Diretório | O que é |
|---|---|
| [`../suite/`](../suite/) | Marca, narrativa, vocabulário e tokens de design dos dois produtos. Fonte única em `suite/tokens/tokens.json` |

`suite/` fica na raiz de propósito: ele é consumido como pacote (`@tezosrio/suite/tokens/tokens.css`), não lido como documentação.

## Onde as coisas moram

- **Este repositório (Tezzet)** guarda o que vale para a **suíte inteira** — ADRs, SPECs e `suite/` — porque é daqui que vem a identidade compartilhada.
- **O repositório do TAPS** guarda o que é só dele, mais ponteiros para os documentos de suíte.
