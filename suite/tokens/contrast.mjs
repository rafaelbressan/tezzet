#!/usr/bin/env node
// Confere o bloco "contrast" de tokens.json contra o cálculo da WCAG 2.1.
// Roda sem dependência nenhuma:  node suite/tokens/contrast.mjs
// Sai com código 1 se algum valor declarado divergir do calculado.
//
// Existe porque a v1.0.0 declarava razões subestimadas — e uma delas
// ("steel sobre paper falha AA") era falsa. Número de contraste escrito à
// mão envelhece errado; este arquivo é o que impede isso de acontecer de novo.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const tokens = JSON.parse(readFileSync(join(here, "tokens.json"), "utf8"));

const channel = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luminance = (hex) => {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(h.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

const hex = (name) => {
  const c = tokens.color[name];
  if (!c) throw new Error(`cor inexistente em tokens.json: ${name}`);
  return c.value;
};

// "gold-on-ink" → ["gold", "ink"]. O sufixo é sempre a última cor conhecida.
const split = (key) => {
  const parts = key.split("-on-");
  if (parts.length !== 2) throw new Error(`chave fora do formato <cor>-on-<fundo>: ${key}`);
  return parts;
};

let failed = 0;
const rows = [];

for (const [key, entry] of Object.entries(tokens.contrast)) {
  if (key.startsWith("$")) continue;
  const [fg, bg] = split(key);
  const got = ratio(hex(fg), hex(bg));
  const declared = parseFloat(entry.value);
  const ok = Math.abs(got - declared) < 0.005;
  if (!ok) failed++;
  rows.push([key, `${got.toFixed(2)}:1`, entry.value, ok ? "confere" : "DIVERGE"]);
}

const w = (i) => Math.max(...rows.map((r) => r[i].length));
const [w0, w1, w2] = [w(0), w(1), w(2)];
console.log(`Suíte Tezos — contraste WCAG 2.1 · tokens v${tokens.$version}\n`);
for (const [k, got, dec, verdict] of rows) {
  console.log(`${k.padEnd(w0)}  calculado ${got.padStart(w1)}  declarado ${dec.padStart(w2)}  ${verdict}`);
}

if (failed) {
  console.error(`\n${failed} valor(es) divergem de tokens.json. Corrija o JSON — o cálculo é a fonte.`);
  process.exit(1);
}
console.log(`\n${rows.length} pares conferidos, nenhum divergente.`);
