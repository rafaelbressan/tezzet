# Documentação da Suíte Tezos

**Este diretório é o ponto de entrada do conhecimento do projeto.** Tudo que é decisão, análise ou especificação da suíte — Tezzet e TAPS — está indexado aqui e vive na `master`.

A regra, escrita para não se perder: **código pode viver em branch enquanto a stack não fecha; conhecimento não.** Decisão registrada só em branch de agente não registra decisão nenhuma — quem faz checkout da `master` não a encontra e a retoma do zero.

## Decisões de arquitetura (ADR)

Uma ADR registra o que foi decidido, quando, por quem, quais alternativas foram rejeitadas e por quê, e o que teria que ser verdade para voltar atrás.

| # | Documento | Status |
|---|---|---|
| ADR-0001 | [Stack unificada da Suíte Tezos](adr/0001-stack-unificada-tezzet-taps.md) | Proposta — critérios pré-registrados, decisão pendente |

Índice completo e as regras do formato: [`adr/README.md`](adr/README.md).

## Especificações (SPEC)

Uma SPEC define o comportamento que o código precisa ter e os testes que provam isso. Uma ADR escolhe a stack; uma SPEC vale independentemente dela.

| # | Documento | Dono |
|---|---|---|
| SPEC-0001 | [Núcleo criptográfico compartilhado (`tz-keys` + `tz-vault`)](spec/0001-nucleo-criptografico-compartilhado.md) | Tezos Core & Crypto |

Índice e regra de revisão: [`spec/README.md`](spec/README.md).

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
