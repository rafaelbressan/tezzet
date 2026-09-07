import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';

/**
 * O Tezzet dirigido pelo Chromium, pela interface de verdade.
 *
 * Nada aqui é injetado no app: o `dist/` servido é o mesmo que vai para o
 * pacote, e cada passo é o passo que uma pessoa daria. O código de pareamento
 * sai de onde uma pessoa o tiraria — o botão "Copy to clipboard" do modal do
 * Beacon, que é a alternativa em texto do QR.
 */

export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppError';
  }
}

export interface TezzetNoChromiumOptions {
  readonly url: string;
  readonly headless?: boolean;
  /** Sobe para ver a jornada acontecer quando algo quebra e o log não explica. */
  readonly slowMoMs?: number;
}

export class TezzetNoChromium {
  private constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    readonly page: Page,
  ) {}

  static async abrir(options: TezzetNoChromiumOptions): Promise<TezzetNoChromium> {
    const browser = await chromium.launch({
      headless: options.headless ?? true,
      ...(options.slowMoMs !== undefined ? { slowMo: options.slowMoMs } : {}),
    });
    // A leitura da área de transferência é o que substitui a câmera lendo o
    // QR. Sem esta permissão o `readText` rejeita e o pareamento não sai.
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    await page.goto(options.url, { waitUntil: 'load' });
    return new TezzetNoChromium(browser, context, page);
  }

  private get modalBeacon(): Locator {
    return this.page.locator('beacon-alert');
  }

  /**
   * Clica em "Conectar carteira" e devolve o código de pareamento.
   *
   * O modal do Beacon lista carteiras; a que mostra QR é uma de celular. A
   * escolha é feita pelo subtítulo, não pelo nome: a lista é do SDK e muda.
   */
  async conectarECopiarPareamento(timeoutMs = 60_000): Promise<string> {
    await this.page.getByRole('button', { name: 'Conectar carteira' }).click();
    await this.modalBeacon.waitFor({ state: 'attached', timeout: timeoutMs });

    const soCelular = this.modalBeacon.locator('.wallet-main', {
      has: this.page.locator('p', { hasText: /^Mobile App$/ }),
    });
    await soCelular.first().waitFor({ state: 'visible', timeout: timeoutMs });
    const quantas = await soCelular.count();
    if (quantas === 0) {
      const oQueTem = await this.modalBeacon.locator('.wallet-main').allInnerTexts();
      throw new AppError(
        `nenhuma carteira de celular no modal do Beacon, e é a única que mostra QR — ` +
          `apareceram: ${JSON.stringify(oQueTem)}`,
      );
    }
    await soCelular.first().click();

    const copiar = this.modalBeacon.locator('.qr-copy-wrapper');
    await copiar.waitFor({ state: 'visible', timeout: timeoutMs });
    await copiar.click();

    const pareamento = await this.page.evaluate(() => navigator.clipboard.readText());
    if (typeof pareamento !== 'string' || pareamento.trim() === '') {
      throw new AppError('o botão de copiar do Beacon não deixou nada na área de transferência');
    }
    return pareamento.trim();
  }

  /**
   * Espera `alvo` aparecer, mas desiste na hora se a tela mostrar um erro.
   *
   * Sem isto, todo defeito do app vira "timeout esperando um botão" e o
   * motivo — que está escrito na tela, em português — se perde.
   */
  private async esperar(alvo: Locator, oQue: string, timeoutMs: number): Promise<void> {
    const alerta = this.page.locator('.t-fault');
    const quem = await Promise.race([
      alvo.first().waitFor({ state: 'visible', timeout: timeoutMs }).then(
        () => 'alvo' as const,
        () => 'nada' as const,
      ),
      alerta.first().waitFor({ state: 'visible', timeout: timeoutMs }).then(
        () => 'alerta' as const,
        () => 'nada' as const,
      ),
    ]);
    if (quem === 'alvo') return;

    const texto = (await alerta.first().isVisible())
      ? (await alerta.first().innerText()).replace(/\s+/g, ' ').trim()
      : '';
    throw new AppError(
      texto === ''
        ? `${oQue} não apareceu em ${timeoutMs} ms`
        : `${oQue} não apareceu — a tela diz: ${texto}`,
    );
  }

  /** Espera o app assumir a conta que a carteira autorizou e devolve o endereço na tela. */
  async esperarConectado(timeoutMs = 90_000): Promise<string> {
    const endereco = this.page.locator('.app__header .t-address');
    await this.esperar(endereco, 'o endereço conectado no cabeçalho', timeoutMs);
    return (await endereco.getAttribute('title')) ?? (await endereco.innerText());
  }

  /** Preenche o formulário de envio e para na revisão, sem assinar. */
  async revisarEnvio(destino: string, xtz: string, timeoutMs = 90_000): Promise<void> {
    await this.page.getByRole('tab', { name: 'Enviar' }).click();
    await this.page.getByLabel('Endereço de destino').fill(destino);
    await this.page.getByLabel('Valor em XTZ').fill(xtz);
    await this.page.getByRole('button', { name: 'Revisar' }).click();
    await this.esperar(
      this.page.getByRole('button', { name: 'Assinar na carteira' }),
      'a revisão do envio',
      timeoutMs,
    );
  }

  /** Aperta "Assinar na carteira". Quem assina é a carteira de teste, do outro lado. */
  async assinar(): Promise<void> {
    await this.page.getByRole('button', { name: 'Assinar na carteira' }).click();
  }

  /** O hash que o app mostrou depois de injetar. */
  async hashNaTela(timeoutMs = 180_000): Promise<string> {
    const hash = this.page.locator('.t-ophash');
    await this.esperar(hash, 'o hash da operação', timeoutMs);
    return (await hash.innerText()).trim();
  }

  /** O texto do estado da operação que o app publica em `role="status"`. */
  async esperarTextoDeStatus(padrao: RegExp, timeoutMs: number): Promise<string> {
    const status = this.page.getByRole('status');
    await status.filter({ hasText: padrao }).first().waitFor({ state: 'visible', timeout: timeoutMs });
    return (await status.first().innerText()).trim();
  }

  async fechar(): Promise<void> {
    await this.context.close();
    await this.browser.close();
  }
}
