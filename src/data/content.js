// Agregador do conteúdo do jogo — é o `content` que o motor recebe.
// Os dados ficam em arquivos separados (vanguards.js, themes.js) pra ser fácil expandir.
import { VANGUARDS } from './vanguards.js';
import { THEMES } from './themes.js';

export { VANGUARDS, VANGUARD_INFO, VANGUARD_PRESETS, EMOJI } from './vanguards.js';
export { THEMES, TONES } from './themes.js';

// Modificadores: a intenção/mensagem que o texto precisa carregar (spec seção 5).
export const MODIFIERS = [
  'Fale sobre a dor de uma perda',
  'Fale sobre a alegria simples de estar vivo',
  'Culpe algo/alguém externo pelo ocorrido',
  'Assuma a culpa por tudo sozinho',
  'Escreva de forma irônica (o oposto do que sente)',
  'Escreva como se fosse a última coisa que vai dizer a alguém',
  'Escreva com esperança, mesmo sabendo que vai dar errado',
  'Escreva como um pedido de desculpas disfarçado',
  'Escreva como quem conta um segredo a uma criança',
  'Escreva com raiva contida, sem nunca gritar',
  'Escreva com saudade de um lugar que já não existe',
  'Escreva com humor negro, rindo do que dói',
  'Escreva como uma oração feita por quem não acredita',
  'Escreva como um pedido de socorro discreto',
  'Escreva como se estivesse vendo tudo de muito longe',
  'Escreva como quem se despede sem dizer adeus',
];

export const CONTENT = { vanguards: VANGUARDS, themes: THEMES, modifiers: MODIFIERS };
