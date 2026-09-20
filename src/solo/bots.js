// Bots simples do modo solo: texto pré-pronto aleatório (não precisa escrever bem —
// serve só pra exercitar timer, revelação, palpite, denúncia, pontuação e títulos).

export const BOT_NAMES = ['Ana Bot', 'Beto Bot', 'Cida Bot', 'Duda Bot', 'Edu Bot', 'Fabi Bot', 'Gui Bot'];

const LINES = [
  'O relógio conta o que a boca não disse.',
  'Há uma janela aberta dentro do meu peito.',
  'A tarde escorre devagar pelas paredes.',
  'Ninguém percebeu o barulho da chuva começando.',
  'Guardei o seu nome numa caixa sem tampa.',
  'A cidade respira, e eu respiro fora do compasso.',
  'Cada passo pergunta pelo anterior.',
  'Se eu esperar mais um pouco, talvez o dia mude de ideia.',
  'As mãos lembram o que a memória esqueceu.',
  'Entre a palavra e o gesto, um corredor comprido.',
  'O vento leva o assunto e deixa o cheiro.',
  'Trago no bolso um resto de verão.',
  'A rua inteira parece ensaiar uma despedida.',
  'Tudo o que eu disse voltou pra casa sozinho.',
];

export function botText(assignment, rng) {
  // Junta linhas prontas (repetindo o banco se preciso) até passar do mínimo de caracteres.
  const target = assignment.minChars + rng.int(60);
  const out = [];
  let len = 0;
  while (out.length < 3 || len < target) {
    for (const l of rng.shuffle(LINES)) {
      out.push(l);
      len += l.length + 1;
      if (out.length >= 3 && len >= target) break;
    }
  }
  return out.join('\n');
}

/** Bot "chuta": acerta com probabilidade `accuracy` (espia a resposta, ok em modo de teste). */
export function botGuess({ vanguards, answer, already, rng, accuracy = 0.3 }) {
  const options = vanguards.filter((v) => !already.includes(v));
  if (options.includes(answer) && rng.next() < accuracy) return answer;
  return rng.pick(options);
}
