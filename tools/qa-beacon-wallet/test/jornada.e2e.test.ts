import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { correrJornada, type JornadaResultado } from '../src/jornada';

/**
 * O teste que a QA da BRES-45 não conseguiu fazer: assinar e enviar de
 * verdade, sem humano em nenhum passo.
 *
 * Ele sobe o `dist/` no Chromium, conecta pelo Beacon com uma carteira de
 * teste headless, envia, e confere a confirmação **contra a cadeia**, pelo
 * critério do Tenderbake — incluída no nível L, cabeça em L+2, e relida
 * confirmando bloco e situação.
 *
 * Se a torneira estiver fora, ele reprova alto dizendo isso. Um teste que
 * pula em silêncio quando a dependência cai deixa de reprovar qualquer coisa
 * e continua verde enquanto o app quebra.
 */
const dist = fileURLToPath(new URL('../../../apps/tezzet/dist', import.meta.url));

describe('Tezzet na Shadownet, sem humano no caminho', () => {
  let resultado: JornadaResultado;

  beforeAll(() => {
    if (!existsSync(`${dist}/index.html`)) {
      throw new Error(
        `${dist}/index.html não existe — rode "npm run build" em apps/tezzet antes deste teste`,
      );
    }
  });

  it('gera chave, pede à torneira, pareia, assina, envia e confirma', async () => {
    resultado = await correrJornada({ dist, log: (linha) => console.log(`  · ${linha}`) });

    // Rede de teste, sempre. A jornada recusa mainnet, e o teste diz por quê.
    expect(resultado.network.kind).toBe('test');

    // A torneira financiou a chave desta execução, não uma de antes.
    expect(resultado.torneira.hash).toMatch(/^o[1-9A-HJ-NP-Za-km-z]{50}$/);
    expect(resultado.endereco).toMatch(/^tz1[1-9A-HJ-NP-Za-km-z]{33}$/);

    // O hash que o app mostrou é o mesmo que a carteira injetou. Se o app
    // inventasse um hash, a tela mentiria e a cadeia não saberia.
    expect(resultado.hashNaTela).toBe(resultado.hash);
    expect(resultado.hash).toMatch(/^o[1-9A-HJ-NP-Za-km-z]{50}$/);

    // Confirmação pelo critério do Tenderbake, lida da cadeia por este
    // processo — não pelo que a tela disse.
    expect(resultado.outcome.status).toBe('confirmed');
    expect(resultado.outcome.level).toBeGreaterThan(0);
    expect(resultado.outcome.headLevel).toBeGreaterThanOrEqual(resultado.outcome.level! + 2);

    // E a tela chegou na mesma conclusão sozinha.
    expect(resultado.statusNaTela).toContain('Confirmada');

    console.log(`\n  operação: ${resultado.hash}\n  explorador: ${resultado.explorador}\n`);
  });

  it('o app mandou assinar exatamente o que mostrou na revisão', () => {
    // Uma transferência, e nada além dela. Um app que trocasse o destino entre
    // a tela e a carteira passaria por todo o resto deste teste.
    expect(resultado.detalhes).toHaveLength(1);
    const transacao = resultado.detalhes[0]!;
    expect(transacao.kind).toBe('transaction');
    expect(transacao).toMatchObject({
      destination: resultado.destino,
      amount: String(resultado.amountMutez),
    });
  });

  it('o valor atravessou em mutez, sem passar por ponto flutuante', () => {
    // 1.000001 XTZ é 1000001 mutez. `1.000001 * 1e6` em ponto flutuante dá
    // 1000000.9999999999, e um `Math.floor` transformaria isso em 1000000.
    expect(resultado.amountMutez).toBe(1_000_001n);
  });
});
