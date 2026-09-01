import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

/**
 * Servidor estático do `dist/` do Tezzet.
 *
 * O app é uma SPA lida de `file://` no Tauri, mas o Beacon precisa de uma
 * origem HTTP para a criptografia da Web Crypto e para o `localStorage`. Este
 * servidor existe só para dar essa origem — não é infraestrutura, é o
 * mínimo para o Chromium abrir o mesmo `dist/` que vai para o pacote.
 */
const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export class ServidorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServidorError';
  }
}

export interface DistServido {
  readonly url: string;
  fechar(): Promise<void>;
}

export async function servirDist(dist: string): Promise<DistServido> {
  const raiz = resolve(dist);
  if (!existsSync(join(raiz, 'index.html'))) {
    throw new ServidorError(
      `${raiz}/index.html não existe — rode "npm run build" em apps/tezzet antes`,
    );
  }

  const server: Server = createServer((req, res) => {
    const caminho = new URL(req.url ?? '/', 'http://localhost').pathname;
    const pedido = caminho === '/' ? 'index.html' : decodeURIComponent(caminho).replace(/^\/+/, '');

    // Um `..` no caminho serviria arquivo de fora do `dist/`. O servidor é de
    // teste, mas ele abre uma porta, e uma porta aberta é uma porta aberta.
    const alvo = join(raiz, normalize(pedido));
    const dentro = alvo === raiz || alvo.startsWith(raiz + sep);
    const arquivo = dentro && existsSync(alvo) && statSync(alvo).isFile() ? alvo : join(raiz, 'index.html');

    res.writeHead(200, {
      'content-type': TIPOS[extname(arquivo)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(arquivo).pipe(res);
  });

  await new Promise<void>((ok, falha) => {
    server.once('error', falha);
    server.listen(0, '127.0.0.1', ok);
  });

  const endereco = server.address();
  if (endereco === null || typeof endereco === 'string') {
    throw new ServidorError('o servidor subiu sem porta TCP');
  }

  return {
    url: `http://127.0.0.1:${endereco.port}/`,
    fechar: () =>
      new Promise<void>((ok, falha) => server.close((cause) => (cause ? falha(cause) : ok()))),
  };
}
