#!/usr/bin/env node
/**
 * Busca `@tezos-suite/chain` (SPEC-0002) por commit fixo.
 *
 * A camada de cadeia é uma só para o Tezzet e o TAPS — é onde mora a
 * aritmética de dinheiro, a leitura da TzKT e a confirmação Tenderbake. Ela
 * está em `packages/tezos-chain` no repositório do TAPS, e o npm não instala
 * subdiretório de repositório git. Copiar o código para cá criaria uma segunda
 * cópia da aritmética de dinheiro, que é exatamente o que a SPEC proíbe.
 *
 * Então: clone raso do commit fixado em `chain.pin.json`, com sparse-checkout
 * do subdiretório, montado em `vendor/tezos-chain` — que não entra no git.
 * O commit é conferido depois do clone: um `git tag -f` no remoto não muda o
 * que este script aceita.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pin = JSON.parse(readFileSync(join(appRoot, 'chain.pin.json'), 'utf8'));
const target = join(appRoot, 'vendor', 'tezos-chain');
const stamp = join(target, '.pinned-commit');

if (!/^[0-9a-f]{40}$/.test(pin.commit)) {
  throw new Error(
    `chain.pin.json: "commit" precisa ser um SHA de 40 dígitos, veio ${JSON.stringify(pin.commit)} — ` +
      'um branch move e deixa de ser um pino',
  );
}

if (existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === pin.commit) {
  process.stdout.write(`${pin.package} já em ${pin.commit.slice(0, 12)}\n`);
  process.exit(0);
}

const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();

const work = mkdtempSync(join(tmpdir(), 'tezos-chain-'));
try {
  git(['init', '--quiet', work]);
  git(['remote', 'add', 'origin', pin.repository], work);
  git(['config', 'core.sparseCheckout', 'true'], work);
  mkdirSync(join(work, '.git', 'info'), { recursive: true });
  writeFileSync(join(work, '.git', 'info', 'sparse-checkout'), `${pin.subdirectory}/\n`);
  git(['fetch', '--quiet', '--depth', '1', 'origin', pin.commit], work);
  git(['checkout', '--quiet', 'FETCH_HEAD'], work);

  const fetched = git(['rev-parse', 'HEAD'], work);
  if (fetched !== pin.commit) {
    throw new Error(`commit conferido ${fetched} não é o fixado ${pin.commit}`);
  }

  const source = join(work, pin.subdirectory);
  if (!existsSync(join(source, 'package.json'))) {
    throw new Error(`${pin.subdirectory}/package.json não existe em ${pin.commit}`);
  }
  const name = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).name;
  if (name !== pin.package) {
    throw new Error(`o pacote em ${pin.subdirectory} chama-se ${name}, não ${pin.package}`);
  }

  rmSync(target, { recursive: true, force: true });
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
  writeFileSync(stamp, `${pin.commit}\n`);
  process.stdout.write(`${pin.package} @ ${pin.commit.slice(0, 12)} → vendor/tezos-chain\n`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
