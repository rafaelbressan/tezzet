import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatMutezAsTez } from '@tezos-suite/chain';
import { correrJornada, type JornadaOptions } from './jornada';

/**
 * `npm run enviar` — a jornada inteira, do zero, sem humano.
 *
 * Cada execução gera uma chave nova, pede à torneira, pareia com o app,
 * aprova, assina e confirma. Rodar de novo não reaproveita nada.
 */
const USO = `
uso: npm run enviar -- [opções]

  --dist <caminho>      pasta construída do app        (padrão: ../../apps/tezzet/dist)
  --rede <id>           id em networks.json            (padrão: o default do catálogo)
  --destino <tz1…>      para onde enviar               (padrão: o endereço da torneira)
  --xtz <valor>         quanto enviar, em XTZ          (padrão: 1.000001)
  --torneira <url>      base da torneira               (padrão: shadownet.teztnets.com)
  --torneira-xtz <n>    quanto pedir à torneira        (padrão: 10)
  --com-janela          abre o Chromium visível
`.trim();

function argumentos(argv: readonly string[]): JornadaOptions {
  const valores = new Map<string, string>();
  const marcas = new Set<string>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) throw new Error(`argumento solto: ${arg}\n\n${USO}`);
    const nome = arg.slice(2);
    if (nome === 'com-janela' || nome === 'ajuda' || nome === 'help') {
      marcas.add(nome);
      continue;
    }
    const valor = argv[++i];
    if (valor === undefined) throw new Error(`--${nome} veio sem valor\n\n${USO}`);
    valores.set(nome, valor);
  }

  if (marcas.has('ajuda') || marcas.has('help')) {
    process.stdout.write(`${USO}\n`);
    process.exit(0);
  }

  const inteiro = (nome: string): number | undefined => {
    const bruto = valores.get(nome);
    if (bruto === undefined) return undefined;
    const valor = Number(bruto);
    if (!Number.isInteger(valor) || valor <= 0) {
      throw new Error(`--${nome} precisa ser inteiro positivo, veio ${JSON.stringify(bruto)}`);
    }
    return valor;
  };

  const dist = valores.get('dist');
  const torneiraXtz = inteiro('torneira-xtz');

  return {
    dist: resolve(dist ?? fileURLToPath(new URL('../../../apps/tezzet/dist', import.meta.url))),
    ...(valores.has('rede') ? { networkId: valores.get('rede')! } : {}),
    ...(valores.has('destino') ? { destino: valores.get('destino')! } : {}),
    ...(valores.has('xtz') ? { xtz: valores.get('xtz')! } : {}),
    ...(valores.has('torneira') ? { faucetUrl: valores.get('torneira')! } : {}),
    ...(torneiraXtz !== undefined ? { torneiraXtz } : {}),
    headless: !marcas.has('com-janela'),
    log: (linha) => process.stdout.write(`${linha}\n`),
  };
}

const resultado = await correrJornada(argumentos(process.argv.slice(2)));

process.stdout.write(
  [
    '',
    `rede        ${resultado.network.label} (${resultado.network.id})`,
    `de          ${resultado.endereco}`,
    `para        ${resultado.destino}`,
    `valor       ${formatMutezAsTez(resultado.amountMutez)} XTZ`,
    `operação    ${resultado.hash}`,
    `explorador  ${resultado.explorador}`,
    `confirmada  nível ${resultado.outcome.level}, bloco ${resultado.outcome.block}`,
    `na tela     ${resultado.statusNaTela}`,
    '',
  ].join('\n'),
);
