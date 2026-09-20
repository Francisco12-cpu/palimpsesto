// Títulos de fim de partida. Função pura sobre `state.history` (um resultado por rodada,
// ver computeRoundResult). Só aparecem quando a condição é cumprida.
//
// Os textos (emoji, nome, descrição, destaque) vêm de data/titulos.json, que chega aqui
// dentro de `state.content.titles`; se faltar, usa a reserva abaixo. Assim dá para editar
// nome e explicação de uma conquista sem tocar em código.
//
// Interpretações adotadas:
//  Fã do X          — chutou a MESMA vanguarda >= config.fanThreshold vezes (o nome leva a vanguarda)
//  Fora da Realidade — autor(es) do texto com MAIS denúncias na partida (mín. 1)
//  Sniper           — no máximo 1 erro na partida, com pelo menos 1 acerto
//  Mestre do Blefe  — num texto, todos os outros (mín. 2) palpitaram e NINGUÉM acertou
//  Zero Chute       — passou uma rodada inteira sem usar nenhum palpite
//  Denunciado e Sobreviveu — teve denúncia válida e mesmo assim ninguém acertou a vanguarda
//  Último Romântico — 3 vezes o Romantismo apareceu no lugar errado (chutou e errou, ou escreveu e confundiram)
//  Inimigo da Sogra — acertou um texto escrito em Poesia Marginal

const FALLBACK = {
  blefe: { emoji: '🃏', name: 'Mestre do Blefe', description: 'Ninguém acertou a vanguarda dele.', highlight: 90 },
  sniper: { emoji: '🎯', name: 'Sniper', description: 'Errou no máximo um palpite na partida.', highlight: 85 },
  sobreviveu: { emoji: '🔥', name: 'Denunciado e Sobreviveu', description: 'Foi denunciado e ainda assim ninguém o descobriu.', highlight: 80 },
  sogra: { emoji: '🚬', name: 'Inimigo da Sogra', description: 'Reconheceu um texto em Poesia Marginal.', highlight: 65 },
  romantico: { emoji: '🥀', name: 'Último Romântico', description: 'O Romantismo apareceu no lugar errado três vezes.', highlight: 55 },
  fa: { emoji: '🎭', name: 'Fã do {vanguarda}', description: 'Chutou {vanguarda} {vezes} vezes.', highlight: 50 },
  fora: { emoji: '🌀', name: 'Fora da Realidade', description: 'Escreveu o texto mais denunciado da partida.', highlight: 40 },
  zero: { emoji: '🐌', name: 'Zero Chute', description: 'Passou uma rodada sem usar nenhum palpite.', highlight: 20 },
};

const ROMANTISMO = 'Romantismo';
const MARGINAL = 'Poesia Marginal';
const fill = (txt, vars) => String(txt).replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));

export function computeTitles(state) {
  const { players, history, config } = state;
  const meta = Object.fromEntries((state.content?.titles ?? []).map((t) => [t.id, t]));
  const info = (id) => meta[id] ?? FALLBACK[id] ?? { emoji: '🏅', name: id, description: '', highlight: 0 };
  const out = [];
  const add = (id, playerIds, detail, vars = {}) => {
    const ids = [...new Set(playerIds)];
    if (!ids.length) return;
    const m = info(id);
    out.push({
      id: vars.vanguarda ? `${id}:${vars.vanguarda}` : id,
      emoji: m.emoji,
      label: fill(m.name, vars),
      description: fill(m.description, vars),
      highlight: m.highlight ?? 0,
      playerIds: ids,
      detail,
    });
  };

  // estatísticas por jogador
  const stats = Object.fromEntries(players.map((p) => [p.id, { hits: 0, misses: 0, byVanguard: {}, romantic: 0 }]));
  for (const round of history) {
    for (const t of round.texts) {
      for (const [gid, list] of Object.entries(t.guesses)) {
        const st = stats[gid];
        if (!st) continue;
        for (const g of list) {
          st.byVanguard[g] = (st.byVanguard[g] ?? 0) + 1;
          const right = g === t.vanguard;
          if (right) st.hits += 1;
          else {
            st.misses += 1;
            if (g === ROMANTISMO) st.romantic += 1; // chutou Romantismo e errou
          }
        }
        // escreveu em Romantismo e confundiram o leitor
        if (t.vanguard === ROMANTISMO && stats[t.authorId] && !list.includes(ROMANTISMO)) stats[t.authorId].romantic += list.length;
      }
    }
  }

  // 🎭 Fã do X (um título por vanguarda; pode haver vários fãs)
  const fans = {};
  for (const p of players) {
    const top = Object.entries(stats[p.id].byVanguard).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= config.fanThreshold) (fans[top[0]] ??= []).push(p.id);
  }
  for (const [v, ids] of Object.entries(fans)) {
    add('fa', ids, `chutou ${v} ${config.fanThreshold}+ vezes`, { vanguarda: v, vezes: config.fanThreshold });
  }

  // 🌀 Fora da Realidade
  let maxReports = 0;
  for (const r of history) for (const t of r.texts) maxReports = Math.max(maxReports, t.reporters.length);
  if (maxReports > 0) {
    const ids = history.flatMap((r) => r.texts.filter((t) => t.reporters.length === maxReports).map((t) => t.authorId));
    add('fora', ids, `texto mais denunciado (${maxReports})`);
  }

  // 🎯 Sniper
  add('sniper', players.filter((p) => stats[p.id].hits >= 1 && stats[p.id].misses <= 1).map((p) => p.id), 'errou 1 palpite ou menos');

  // 🃏 Mestre do Blefe
  const bluffers = [];
  for (const r of history) {
    for (const t of r.texts) {
      const others = players.filter((p) => p.id !== t.authorId);
      const allGuessed = others.every((p) => (t.guesses[p.id] ?? []).length > 0);
      if (others.length >= 2 && allGuessed && t.hits.length === 0) bluffers.push(t.authorId);
    }
  }
  add('blefe', bluffers, 'ninguém acertou a vanguarda dele');

  // 🐌 Zero Chute
  add('zero', players.filter((p) => history.some((r) => r.texts.every((t) => !(t.guesses[p.id] ?? []).length))).map((p) => p.id), 'passou uma rodada sem chutar');

  // 🔥 Denunciado e Sobreviveu
  const survivors = [];
  for (const r of history) for (const t of r.texts) if (t.denounced && t.hits.length === 0) survivors.push(t.authorId);
  add('sobreviveu', survivors, 'denunciado, mas ninguém acertou');

  // 🥀 Último Romântico
  const times = info('romantico').times ?? 3;
  add('romantico', players.filter((p) => stats[p.id].romantic >= times).map((p) => p.id), `o Romantismo deu errado ${times}+ vezes`);

  // 🚬 Inimigo da Sogra
  const marginal = [];
  for (const r of history) for (const t of r.texts) if (t.vanguard === MARGINAL) marginal.push(...t.hits);
  add('sogra', marginal, `acertou um texto em ${MARGINAL}`);

  return out;
}

/**
 * Os `max` títulos mais notáveis de um jogador (nunca inventa: só os que ele realmente ganhou).
 * `highlight` maior aparece primeiro.
 */
export function topTitlesFor(titles, playerId, max = 3) {
  return (titles ?? [])
    .filter((t) => t.playerIds.includes(playerId))
    .sort((a, b) => (b.highlight ?? 0) - (a.highlight ?? 0))
    .slice(0, max);
}
