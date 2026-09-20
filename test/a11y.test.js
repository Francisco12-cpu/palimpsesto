// Acessibilidade automática: contraste das cores do tema (WCAG AA = 4,5:1 para texto normal).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/ui/theme.css', import.meta.url), 'utf8');
const v = (name) => {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(m, `variável --${name} não encontrada`);
  return m[1];
};

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

const BG = v('bg');
const PANEL = '#281e12'; // o painel mais claro em uso (pior caso: --panel-2 sobre o fundo)

test('contraste: texto do tema sobre fundo e painéis passa em 4,5:1', () => {
  for (const name of ['text', 'ink', 'gold', 'dim', 'red', 'green', 'gold-text']) {
    for (const [onName, on] of [['fundo', BG], ['painel', PANEL]]) {
      const r = ratio(v(name), on);
      assert.ok(r >= 4.5, `--${name} sobre ${onName}: ${r.toFixed(2)}:1 (mínimo 4,5)`);
    }
  }
});

test('contraste: botão primário (texto escuro sobre ouro) e folha de pergaminho', () => {
  assert.ok(ratio('#1b1206', v('gold')) >= 7, 'botão primário');
  assert.ok(ratio('#2a1d0c', '#e2cd9b') >= 7, 'texto sobre o pergaminho');
});
