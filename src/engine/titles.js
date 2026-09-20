// Títulos de fim de partida (spec seção 8). Só aparecem se a condição for cumprida.
// Função pura sobre `state.history` (um resultado por rodada, ver computeRoundResult).
//
// Interpretações adotadas onde a spec era aberta:
//  🎭 Fã do X       — chutou a MESMA vanguarda >= config.fanThreshold vezes (o título leva o nome dela)
//  🌀 Fora da Realidade — autor(es) do texto com MAIS denúncias (mín. 1). Sem voto "mais estranho".
//  🎯 Sniper        — 1 erro ou menos na partida, com pelo menos 1 acerto (quem nunca chutou não ganha)
//  🃏 Mestre do Blefe — em algum texto, todos os outros (mín. 2) chutaram e NENHUM acertou
//  🐌 Zero Chute    — em alguma rodada não usou nenhum palpite (em nenhum texto dela)
//  🔥 Denunciado e Sobreviveu — teve denúncia com quórum e mesmo assim ninguém acertou a vanguarda

export function computeTitles(state) {
  const { players, history, config } = state;
  const out = [];
  const add = (id, emoji, label, playerIds, detail) => {
    if (playerIds.length) out.push({ id, emoji, label, playerIds: [...new Set(playerIds)], detail });
  };

  // estatísticas por jogador
  const stats = Object.fromEntries(
    players.map((p) => [p.id, { hits: 0, misses: 0, byVanguard: {} }]),
  );
  for (const round of history) {
    for (const t of round.texts) {
      for (const [gid, list] of Object.entries(t.guesses)) {
        for (const g of list) {
          const st = stats[gid];
          if (!st) continue;
          st.byVanguard[g] = (st.byVanguard[g] ?? 0) + 1;
          if (g === t.vanguard) st.hits += 1;
          else st.misses += 1;
        }
      }
    }
  }

  // 🎭 Fã do X (um título por vanguarda, vários fãs possíveis)
  const fans = {};
  for (const p of players) {
    const top = Object.entries(stats[p.id].byVanguard).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= config.fanThreshold) (fans[top[0]] ??= []).push(p.id);
  }
  for (const [v, ids] of Object.entries(fans)) {
    add(`fa:${v}`, '🎭', `Fã do ${v}`, ids, `chutou ${v} ${config.fanThreshold}+ vezes`);
  }

  // 🌀 Fora da Realidade
  let maxReports = 0;
  for (const r of history) for (const t of r.texts) maxReports = Math.max(maxReports, t.reporters.length);
  if (maxReports > 0) {
    const ids = history.flatMap((r) => r.texts.filter((t) => t.reporters.length === maxReports).map((t) => t.authorId));
    add('fora', '🌀', 'Fora da Realidade', ids, `texto mais denunciado (${maxReports})`);
  }

  // 🎯 Sniper
  add(
    'sniper', '🎯', 'Sniper',
    players.filter((p) => stats[p.id].hits >= 1 && stats[p.id].misses <= 1).map((p) => p.id),
    'errou 1 palpite ou menos',
  );

  // 🃏 Mestre do Blefe
  const bluffers = [];
  for (const r of history) {
    for (const t of r.texts) {
      const others = players.filter((p) => p.id !== t.authorId);
      const allGuessed = others.every((p) => (t.guesses[p.id] ?? []).length > 0);
      if (others.length >= 2 && allGuessed && t.hits.length === 0) bluffers.push(t.authorId);
    }
  }
  add('blefe', '🃏', 'Mestre do Blefe', bluffers, 'ninguém acertou a vanguarda dele');

  // 🐌 Zero Chute
  const lazy = players.filter((p) =>
    history.some((r) => r.texts.every((t) => !(t.guesses[p.id] ?? []).length)),
  );
  add('zero', '🐌', 'Zero Chute', lazy.map((p) => p.id), 'passou uma rodada sem chutar');

  // 🔥 Denunciado e Sobreviveu
  const survivors = [];
  for (const r of history) for (const t of r.texts) if (t.denounced && t.hits.length === 0) survivors.push(t.authorId);
  add('sobreviveu', '🔥', 'Denunciado e Sobreviveu', survivors, 'denunciado, mas ninguém acertou');

  return out;
}
