import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * O critério que define esta onda: **nenhuma chave privada, semente ou frase
 * de recuperação em lugar nenhum do código.** Este teste é o portão. Se
 * alguém trouxer material de chave para o app antes da onda de custódia, ele
 * reprova aqui, e não numa revisão que talvez aconteça.
 *
 * O teste roda sobre o código com os comentários removidos: explicar por que
 * a semente não está aqui é justamente o que se quer que esteja escrito.
 */
const PROIBIDOS: readonly RegExp[] = [
  /\bmnemonic\b/i,
  /\bseedPhrase\b/i,
  /\bprivateKey\b/,
  /\bsecretKey\b/,
  /\bsemente\b/i,
  /InMemorySigner/,
  /@taquito\/signer/,
  /\bderivePath\b/i,
];

const raiz = resolve('src');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.(ts|tsx|css)$/.test(entry) ? [full] : [];
  });
}

/** Remove comentários de bloco e de linha, preservando o número das linhas. */
function stripComments(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, (_, prefix: string) => prefix);
}

describe('a onda sem custódia', () => {
  it.each(sources(raiz).map((file) => [relative(raiz, file), file]))(
    'src/%s não usa material de chave',
    (_name, file) => {
      const linhas = stripComments(readFileSync(file, 'utf8')).split('\n');

      for (const padrao of PROIBIDOS) {
        const achou = linhas.findIndex((linha) => padrao.test(linha));
        expect(
          achou === -1 ? null : `${file}:${achou + 1} — ${linhas[achou]?.trim()}`,
          `o padrão ${padrao} não pode aparecer nesta onda`,
        ).toBeNull();
      }
    },
  );

  it('não depende de nenhum pacote de assinatura local', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const todas = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });

    expect(todas).not.toContain('@taquito/signer');
    expect(todas.filter((name) => /stronghold|keychain|keyring/i.test(name))).toEqual([]);
  });

  it('o núcleo Rust não declara nenhuma dependência de criptografia', () => {
    // Sem os comentários: o Cargo.toml explica por que essas crates não estão
    // aqui, e explicar é justamente o que se quer que esteja escrito.
    const cargo = readFileSync('src-tauri/Cargo.toml', 'utf8')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');

    for (const crate of ['ed25519-dalek', 'bip39', 'blake2', 'argon2', 'chacha20poly1305', 'stronghold']) {
      expect(cargo).not.toContain(crate);
    }
  });
});
