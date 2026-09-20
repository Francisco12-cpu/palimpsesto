// Telas de jogo (escrever, revelar, palpitar, denunciar, pontuar, fim) compartilhadas pelo
// modo solo e pelo modo rede. Recebem uma "visão" do estado (s) e um ctx:
//   ctx.me        id do jogador local
//   ctx.now()     relógio (no modo rede é o tempo do relay → timer sincronizado)
//   ctx.actions   { draft(text), guess(v), done(), report(authorId) }
//   ctx.onAgain   () => void | null   (botão "jogar de novo"; null = "aguardando o host")
//   ctx.onExit    () => void
// Devolve { render(state), tick(), destroy() }.
import * as E from '../engine/engine.js';
import { topTitlesFor } from '../engine/titles.js';
import { BRAND } from '../brand.js';
import { VANGUARD_INFO } from '../data/content.js';
import { icon, seal } from './icons.js';
import { avatar, confetti, countUp, splash, bigCount, urgency, shake, announce, keepAwake } from './fx.js';
import { sfx, haptic } from './sound.js';

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fold = (x) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const PHASES = {
  writing: ['Escrevendo', 'pen'],
  preview: ['Leia o texto', 'eye'],
  guessing: ['Palpite', 'target'],
  reveal: ['Resposta', 'scroll'],
  reporting: ['Denúncia', 'flag'],
  scoring: ['Placar da rodada', 'star'],
  finished: ['Fim de jogo', 'trophy'],
};
const CIRC = 2 * Math.PI * 19;
const TEXT_PHASES = ['preview', 'guessing', 'reveal', 'reporting'];
const READY_PHASES = ['writing', 'preview', 'guessing', 'reveal', 'reporting'];
const ABOUT = Object.fromEntries(VANGUARD_INFO.map((v) => [v.name, v.about]));
const SHORT = Object.fromEntries(VANGUARD_INFO.map((v) => [v.name, v.short]));

/** Copia texto (com alternativa para navegadores sem a API de área de transferência). */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* sem suporte */ }
    ta.remove();
    return ok;
  }
}

export function createGameView(app, ctx) {
  const me = ctx.me;
  let viewKey = '';
  let phaseId = '';
  let s = null;
  let baseline = 1; // duração da fase (p/ o anel do timer)
  let lastSecond = -1;
  let timerEl = null;
  let scoreMemo = {};
  let prevOthersDone = 0;
  const local = { round: -1, text: '' }; // texto digitado aqui (a visão do host pode estar defasada)

  document.body.classList.add('playing');
  keepAwake(true);

  const player = (id) => s.players.find((p) => p.id === id);
  const rawName = (id) => player(id)?.name ?? id;
  const nameOf = (id) => esc(rawName(id));
  const namesOf = (ids) => (ids.length ? ids.map(nameOf).join(', ') : '—');
  const av = (id, size) => avatar(rawName(id), size, player(id)?.color);

  const readyCount = () => {
    const on = s.players.filter((p) => p.connected);
    return `${on.filter((p) => s.done.includes(p.id)).length}/${on.length} prontos`;
  };

  function header() {
    const [label, ico] = PHASES[s.phase];
    return `<div class="phase-head">
      <div class="phase-ico">${icon(ico, 24)}</div>
      <div class="phase-title"><div class="k">Rodada ${s.round}/${s.totalRounds}${TEXT_PHASES.includes(s.phase) ? ` · texto ${s.cursor + 1}/${s.order.length}` : ''}</div>
        <div class="v">${label}</div>
        ${READY_PHASES.includes(s.phase) ? `<span class="pill" id="pill">${icon('check', 12)}<span id="ready">${readyCount()}</span></span>` : ''}</div>
      ${s.phaseEndsAt != null ? `<div class="timer" id="timer" role="timer" aria-label="Tempo restante"><svg viewBox="0 0 44 44" aria-hidden="true"><circle class="track" cx="22" cy="22" r="19"/><circle class="prog" id="ring" cx="22" cy="22" r="19" stroke-dasharray="${CIRC}" stroke-dashoffset="0"/></svg><div class="num" id="tnum" aria-hidden="true"></div></div>` : ''}
    </div>`;
  }

  const readyBtn = (label = 'Pronto') => {
    const mine = s.done.includes(me);
    return `<div class="actionbar"><button id="done" class="${mine ? '' : 'primary'}" ${mine ? 'disabled' : ''}>${icon('check', 16)} ${mine ? 'Pronto — aguardando os outros' : label}</button></div>`;
  };

  const paperHtml = (text, by, small = false) => {
    const lines = text.trim() ? text.split('\n').filter((l) => l.trim()) : [];
    return `<div class="paper ${small ? 'small' : ''}">
      ${by ? `<div class="by">${by}</div>` : ''}
      ${lines.length ? lines.map((l, i) => `<span class="ln" style="--i:${Math.min(i, 22)}">${esc(l)}</span>`).join('') : '<span class="empty">(texto vazio)</span>'}
    </div>`;
  };

  // ---------------------------------------------------------------- fases

  function viewWriting() {
    const a = s.assignments[me];
    const locked = s.done.includes(me);
    app.innerHTML = `<div class="screen">${header()}
      <div class="panel gold mission">
        ${seal(a.vanguard, 78)}
        <div class="info">
          <div class="lbl">Sua vanguarda (segredo)</div>
          <div class="van">${esc(a.vanguard)}</div>
          <p class="van-short">${esc(SHORT[a.vanguard] ?? '')}</p>
        </div>
      </div>
      <div class="panel rules">
        <div class="rule"><span class="lbl">Tema</span><span class="val">${esc(a.theme)}</span></div>
        ${a.modifier ? `<div class="rule"><span class="lbl">Modificador</span><span class="val">${esc(a.modifier)}</span></div>` : ''}
        <div class="rule"><span class="lbl">Tipo de texto</span><span class="val">${esc(a.textType)}</span></div>
        ${a.keywords.length ? `<div class="rule"><span class="lbl">Palavras-chave${s.config.keywordPenalty ? ` (−${s.config.keywordPenalty} pt se faltar)` : ''}</span>
          <span class="val" id="kws">${a.keywords.map((k) => `<span class="tag kw" data-k="${esc(k)}">${esc(k)}</span>`).join('')}</span></div>` : ''}
      </div>
      <details class="tip"><summary>Como escrever neste estilo</summary><p>${esc(ABOUT[a.vanguard] ?? '')}</p></details>
      <textarea id="draft" placeholder="Escreva no estilo do ${esc(a.vanguard)}… sem revelar o nome!" ${locked ? 'readonly' : ''} spellcheck="true" autocapitalize="sentences" enterkeyhint="enter"></textarea>
      <div class="counter"><span id="lines"></span><div class="bar"><i id="cbar"></i></div></div>
      ${readyBtn('Já terminei — Pronto')}
      <p class="dim" style="margin-top:8px"><small>Quando todos marcarem Pronto o jogo segue na hora. Depois de Pronto o texto trava.</small></p>
    </div>`;
    const ta = document.getElementById('draft');
    ta.value = local.round === s.round ? local.text : (s.drafts[me] ?? '');
    if (!locked && matchMedia('(pointer: fine)').matches) ta.focus(); // no celular não abre o teclado sozinho
    const count = () => {
      const n = E.countChars(ta.value);
      const ok = n >= a.minChars;
      document.getElementById('lines').innerHTML =
        `${n} caractere(s) — ${ok ? '<span class="hit">mínimo atingido ✓</span>' : `faltam ${a.minChars - n} para o mínimo`}`;
      document.getElementById('cbar').style.width = `${a.minChars ? Math.min(100, (n / a.minChars) * 100) : 100}%`;
      app.querySelectorAll('#kws [data-k]').forEach((el) => el.classList.toggle('ok', E.keywordUsed(ta.value, el.dataset.k))); // marca as já usadas
    };
    ta.oninput = () => {
      local.round = s.round; local.text = ta.value;
      ctx.actions.draft(ta.value);
      sfx.key();
      count();
    };
    count();
    document.getElementById('done').onclick = () => {
      ctx.actions.draft(ta.value); // garante que o último texto chegou antes do Pronto
      ctx.actions.done();
      haptic(20);
    };
  }

  function textPaper() {
    const t = E.currentText(s);
    const by = `${av(t.authorId, 26)} ${nameOf(t.authorId)} <span style="margin-left:auto">${t.index + 1} / ${t.total}</span>`;
    return paperHtml(t.text, by);
  }

  /** Fila de avatares: acende em dourado quem já acertou este texto. */
  function guessBoard() {
    const authorId = E.currentAuthorId(s);
    const hits = s.hits?.[authorId] ?? [];
    const others = s.players.filter((p) => p.id !== authorId);
    return `<div class="board" id="board">${others.map((p) => {
      const rank = hits.indexOf(p.id);
      const done = s.done.includes(p.id);
      return `<div class="bplayer ${rank >= 0 ? 'got' : done ? 'spent' : ''}" title="${esc(p.name)}${rank >= 0 ? ' — acertou!' : ''}">
        ${av(p.id, 40)}<span class="nm">${esc(p.name)}</span>
        ${rank >= 0 ? `<span class="got-tag">conseguiu! +${E.pointsForRank(s.config, rank)}</span>` : done ? '<span class="dim">—</span>' : ''}</div>`;
    }).join('')}</div>`;
  }

  function viewPreview() {
    const a = s.assignments[E.currentAuthorId(s)];
    app.innerHTML = `<div class="screen">${header()}
      <p class="dim">Leia com atenção: em seguida você tenta adivinhar a vanguarda.</p>
      ${textPaper()}
      <div class="rule"><span class="lbl">Tema</span><span class="val">${esc(a.theme)}</span></div>
      <div class="rule"><span class="lbl">Tipo</span><span class="val">${esc(a.textType)}</span></div>
      ${readyBtn('Já li — Pronto')}</div>`;
    document.getElementById('done').onclick = () => { ctx.actions.done(); haptic(20); };
  }

  /** Resposta deste texto: vanguarda real, tema, tipo e quem acertou. */
  function viewReveal() {
    const authorId = E.currentAuthorId(s);
    const a = s.assignments[authorId];
    const hits = s.hits?.[authorId] ?? [];
    const guessed = Object.keys(s.guesses[authorId] ?? {});
    const missed = guessed.filter((id) => !hits.includes(id));
    const iHit = hits.includes(me);
    app.innerHTML = `<div class="screen">${header()}
      <div class="panel gold reveal-card">
        ${seal(a.vanguard, 72)}
        <div><div class="lbl">${nameOf(authorId)} escreveu em</div>
          <div class="van">${esc(a.vanguard)}</div>
          <p class="van-short">${esc(SHORT[a.vanguard] ?? '')}</p></div>
      </div>
      <div class="rule"><span class="lbl">Tema</span><span class="val">${esc(a.theme)}</span></div>
      <div class="rule"><span class="lbl">Tipo de texto</span><span class="val">${esc(a.textType)}</span></div>
      ${a.modifier ? `<div class="rule"><span class="lbl">Modificador</span><span class="val">${esc(a.modifier)}</span></div>` : ''}
      ${authorId === me ? '' : `<p class="${iHit ? 'hit' : 'miss'}" style="font-weight:700">${iHit ? `${icon('check', 16)} Você acertou!` : `${icon('x', 16)} Você não acertou este.`}</p>`}
      <div class="panel">
        <div class="hit">${icon('check', 15)} Acertaram: ${hits.length ? hits.map((id, i) => `${nameOf(id)} <small>(+${E.pointsForRank(s.config, i)})</small>`).join(', ') : '—'}</div>
        <div class="miss">${icon('x', 15)} Erraram: ${namesOf(missed)}</div>
      </div>
      ${textPaper()}
      ${readyBtn('Pronto')}</div>`;
    document.getElementById('done').onclick = () => { ctx.actions.done(); haptic(20); };
  }

  function viewGuessing() {
    const authorId = E.currentAuthorId(s);
    const mine = s.guesses[authorId]?.[me] ?? [];
    const iHit = E.hasHit(s, me, authorId);
    const left = E.guessesLeft(s, me, authorId);
    const h = s.config.helper;
    const isMe = authorId === me;
    const canGuess = !isMe && left > 0 && !s.done.includes(me);
    app.innerHTML = `<div class="screen">${header()}${textPaper()}
      ${guessBoard()}
      ${isMe ? `<p class="dim">É o seu texto — veja quem consegue descobrir.</p>${readyBtn()}` : `
      <div class="panel">
        ${iHit ? `<h3 class="hit">${icon('check', 18)} Você acertou!</h3><p class="dim">Aguarde os outros — a resposta aparece em seguida.</p>`
          : `<h3>Qual é a vanguarda?</h3>
        <p>Palpites restantes: <b class="${left ? 'hit' : 'miss'}">${left}</b>
          ${mine.map((m) => `<span class="tag wrong">${esc(m)}</span>`).join('')}</p>
        ${mine.length && !iHit ? `<p class="miss" id="wrongmsg">${icon('x', 15)} Não é ${esc(mine[mine.length - 1])}. ${left ? 'Tente de novo!' : 'Seus palpites acabaram.'}</p>` : ''}`}
        ${canGuess ? `<form id="g" class="guess-box" autocomplete="off">
          <div class="row"><input name="v" id="gin" placeholder="Digite o nome da vanguarda…" style="flex:1;min-width:0" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="send">
            <button class="primary">${icon('send', 16)} Palpitar</button></div>
          ${h.autocomplete ? '<ul class="suggest" id="sug"></ul>' : ''}
          <p id="gerr" class="err"></p></form>` : ''}
        ${h.showAllNames && !iHit ? `<div class="chips">${s.config.vanguards.filter((v) => !mine.includes(v)).map((v) => `<button type="button" data-fill="${esc(v)}">${esc(v)}</button>`).join('')}</div>` : ''}
      </div>${readyBtn(left > 0 ? 'Pronto (abrir mão dos palpites)' : 'Pronto')}`}</div>`;
    document.getElementById('done').onclick = () => { ctx.actions.done(); haptic(20); };
    if (!canGuess) return;

    const form = document.getElementById('g');
    const input = document.getElementById('gin');
    const sug = document.getElementById('sug');
    const names = s.config.vanguards;
    let sel = -1;
    if (matchMedia('(pointer: fine)').matches) input.focus();
    const matches = () => {
      const q = fold(input.value.trim());
      if (!q) return [];
      return names.filter((n) => fold(n).includes(q)).sort((a, b) => fold(a).startsWith(q) === fold(b).startsWith(q) ? 0 : fold(a).startsWith(q) ? -1 : 1).slice(0, 6);
    };
    const paint = () => {
      if (!sug) return;
      const m = matches();
      sel = Math.min(sel, m.length - 1);
      sug.innerHTML = m.map((n, i) => `<li data-n="${esc(n)}" class="${i === sel ? 'sel' : ''}">${esc(n)}</li>`).join('');
    };
    input.oninput = () => { sel = -1; paint(); };
    input.onfocus = () => setTimeout(() => input.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250);
    input.onkeydown = (e) => {
      const m = matches();
      if (e.key === 'ArrowDown' && m.length) { e.preventDefault(); sel = (sel + 1) % m.length; paint(); }
      else if (e.key === 'ArrowUp' && m.length) { e.preventDefault(); sel = (sel - 1 + m.length) % m.length; paint(); }
      else if (e.key === 'Tab' && m.length) { e.preventDefault(); input.value = m[Math.max(sel, 0)]; sel = -1; paint(); }
    };
    sug?.addEventListener('click', (e) => {
      const li = e.target.closest('li');
      if (li) { input.value = li.dataset.n; sel = -1; paint(); input.focus(); }
    });
    app.querySelectorAll('[data-fill]').forEach((b) => { b.onclick = () => { input.value = b.dataset.fill; input.focus(); paint(); }; });
    form.onsubmit = (ev) => {
      ev.preventDefault();
      const m = matches();
      const typed = fold(input.value.trim());
      // aceita nome exato, a sugestão destacada ou a única sugestão (evita erro de digitação)
      const v = names.find((n) => fold(n) === typed) ?? (sel >= 0 ? m[sel] : m.length === 1 ? m[0] : null);
      if (!v) {
        document.getElementById('gerr').textContent = 'Escolha um nome da lista de sugestões.';
        sfx.error(); haptic([40, 40, 40]); shake(form);
        return;
      }
      ctx.actions.guess(v);
      sfx.pop(); haptic(25);
    };
  }

  function viewReporting() {
    const q = E.effectiveQuorum(s);
    const id = E.currentAuthorId(s);
    const a = s.assignments[id];
    const rep = s.reports[id] ?? [];
    const mine = rep.includes(me);
    app.innerHTML = `<div class="screen">${header()}
      <p class="dim">Este texto tinha a ver com o tema? Com ${q} denúncia(s), ${nameOf(id)} perde ${s.config.reportPenalty} ponto(s).</p>
      <div class="rule"><span class="lbl">Tema</span><span class="val">${esc(a.theme)}</span></div>
      ${paperHtml(s.texts[id] ?? '', `${av(id, 26)} ${nameOf(id)} — ${esc(a.vanguard ?? '')}`, true)}
      <div class="panel">
        <div class="row"><span>${icon('flag', 16)} ${rep.length}/${q} ${rep.length ? `— ${namesOf(rep)}` : ''}</span>
        ${id === me ? '<span class="dim">É o seu texto.</span>' : `<button data-rep="${esc(id)}" class="${mine ? 'on' : ''}" style="margin-left:auto">${mine ? 'Retirar denúncia' : 'Fugiu do tema'}</button>`}</div>
      </div>
      ${readyBtn('Pronto')}</div>`;
    app.querySelectorAll('[data-rep]').forEach((b) => { b.onclick = () => { ctx.actions.report(b.dataset.rep); haptic(15); }; });
    document.getElementById('done').onclick = () => { ctx.actions.done(); haptic(20); };
  }

  function viewScoring() {
    const r = s.lastResult;
    const ranked = E.ranking(s);
    const top = Math.max(1, ranked[0]?.score ?? 1);
    app.innerHTML = `<div class="screen">${header()}
      <h2 style="text-align:center;margin-top:0">Placar</h2>
      <div class="kahoot">${ranked.map((p, i) => {
        const d = r.deltas[p.id] ?? { net: 0, lost: 0 };
        const before = scoreMemo[p.id] ?? 0;
        return `<div class="krow ${i === 0 ? 'first' : ''}" style="--i:${i}">
          <span class="pos">${i + 1}</span>${av(p.id, 40)}
          <div class="kbar-wrap"><div class="kname">${esc(p.name)}</div>
            <div class="kbar"><i style="width:${Math.round((before / top) * 100)}%" data-w="${Math.round((p.score / top) * 100)}"></i></div></div>
          <span class="pts" data-score="${p.score}" data-from="${before}">${before}</span>
          <span class="delta ${d.net > 0 ? 'up' : d.net < 0 ? 'down' : ''}">${d.net > 0 ? '+' : ''}${d.net || '·'}${d.lost ? ` <small>(−${d.lost})</small>` : ''}</span>
        </div>`;
      }).join('')}</div>
      <details class="tip"><summary>Como foi cada texto</summary>${r.texts.map((x) => `<div class="panel result">
        <div class="head">${seal(x.vanguard, 40)}<div><div class="dim">${nameOf(x.authorId)} escreveu em</div>
          <b style="font:700 1rem var(--f-title);color:var(--gold);letter-spacing:1px;text-transform:uppercase">${esc(x.vanguard)}</b></div>
          ${x.denounced ? `<span class="flagged" style="margin-left:auto">${icon('flag', 14)} denunciado</span>` : ''}</div>
        <div class="verdict">
          <div class="hit">${icon('check', 15)} ${x.hits.length ? x.hits.map((id, i) => `${nameOf(id)} <small>(+${E.pointsForRank(s.config, i)})</small>`).join(', ') : 'ninguém acertou'}</div>
          <div class="miss">${icon('x', 15)} ${namesOf(x.misses)}</div>
          ${x.keywords?.total ? `<div class="${x.keywords.missing.length ? 'miss' : 'hit'}">Palavras-chave: ${x.keywords.used}/${x.keywords.total}${x.keywords.missing.length ? ` — faltou: ${x.keywords.missing.map(esc).join(', ')}` : ''}</div>` : ''}
        </div></div>`).join('')}</details></div>`;

    requestAnimationFrame(() => app.querySelectorAll('.kbar i').forEach((el) => { el.style.width = `${el.dataset.w}%`; }));
    app.querySelectorAll('[data-score]').forEach((el) => countUp(el, Number(el.dataset.from), Number(el.dataset.score)));

    const gained = r.deltas[me]?.net ?? 0;
    if (gained > 0) { sfx.success(); haptic([30, 40, 60]); if (gained >= 3) confetti(28); }
    else if (r.deltas[me]?.lost) { sfx.fail(); haptic([80, 50, 80]); }
    else sfx.gong();
  }

  // ---- antologia (fim de jogo)
  function anthologyText() {
    const head = `${BRAND.name} — antologia da partida\n`;
    return head + (s.history ?? []).map((r) => `\n=== Rodada ${r.round} ===\n` + r.texts.map((t) =>
      `\n[${rawName(t.authorId)}] ${t.vanguard} — ${t.assignment.theme} (${t.assignment.textType})\n${t.text.trim() || '(texto vazio)'}\n`).join('')).join('');
  }

  function anthologyHtml() {
    if (!s.history?.length) return '';
    return `<div class="divisor">✦</div><h2 style="text-align:center;margin-top:0">Antologia</h2>
      <p class="dim" style="text-align:center">Todos os textos da partida, com a vanguarda revelada.</p>
      <div class="toolbar" style="justify-content:center">
        <button id="acopy">${icon('scroll', 16)} Copiar tudo</button>
        <button id="adl">${icon('send', 16)} Baixar .txt</button></div>
      <div class="anthology">${s.history.map((r) => `<h3 style="margin-top:18px">Rodada ${r.round}</h3>${r.texts.map((t) => `
        <div class="panel item">
          <div class="meta">${av(t.authorId, 28)} <b style="color:var(--ink)">${nameOf(t.authorId)}</b>
            <span class="tag">${esc(t.vanguard)}</span><span class="tag">${esc(t.assignment.textType)}</span></div>
          <div class="dim" style="font-size:.9rem">${esc(t.assignment.theme)}${t.assignment.modifier ? ' · ' + esc(t.assignment.modifier) : ''}</div>
          ${paperHtml(t.text, '', true)}
          <div class="dim" style="font-size:.85rem">${t.hits.length ? `Acertaram: ${namesOf(t.hits)}` : 'Ninguém acertou'}</div>
        </div>`).join('')}`).join('')}</div>`;
  }

  function viewFinished() {
    const ranked = E.ranking(s);
    const top = ranked.slice(0, 3);
    const order = [top[1], top[0], top[2]].filter(Boolean); // 2º, 1º, 3º
    const medal = { [top[0]?.id]: '1º', [top[1]?.id]: '2º', [top[2]?.id]: '3º' };
    app.innerHTML = `<div class="screen">
      <div class="hero"><h1>Fim de jogo</h1><p class="slogan">${nameOf(top[0].id)} escreveu a última palavra.</p></div>
      <div class="podium">${order.map((p, i) => `<div class="col" style="--i:${i === 1 ? 2 : i === 0 ? 1 : 0}">
        <div>${av(p.id, 48)}</div><div class="nm">${medal[p.id]} ${esc(p.name)}</div>
        <div class="step">${p.score}</div></div>`).join('')}</div>
      ${ranked.slice(3).map((p, i) => `<div class="score-row" style="--i:${i}"><span class="pos">${i + 4}</span>${av(p.id, 36)}<span class="name">${esc(p.name)}</span><span class="pts">${p.score}</span><span></span></div>`).join('')}
      <div class="divisor">✦</div><h2 style="text-align:center;margin-top:0">Destaques</h2>
      ${(() => {
        const rows = ranked.map((p) => ({ p, badges: topTitlesFor(s.titles, p.id, 3) })).filter((x) => x.badges.length);
        if (!rows.length) return '<p class="dim" style="text-align:center">Ninguém se destacou em nada desta vez.</p>';
        return rows.map(({ p, badges }, i) => `<div class="panel badge-row" style="--i:${i}">
          <div class="who">${av(p.id, 34)} <b>${esc(p.name)}</b></div>
          <div class="badges">${badges.map((b) => `<button type="button" class="badge" data-desc="${esc(b.description || b.detail)}" aria-label="${esc(b.label)}: ${esc(b.description || b.detail)}">
            <span class="em">${BRAND.emoji ? b.emoji : icon('trophy', 20)}</span><span class="bl">${esc(b.label)}</span></button>`).join('')}</div>
        </div>`).join('');
      })()}
      <p class="dim" id="badgetip" style="text-align:center;min-height:1.4em"></p>
      <p class="row" style="justify-content:center;margin-top:20px">
        ${ctx.onAgain ? `<button id="again" class="primary">${icon('play', 16)} Jogar de novo</button>` : '<span class="dim">Aguardando o host reiniciar…</span>'}
        <button id="exit" class="ghost">Sair</button></p>
      ${anthologyHtml()}</div>`;
    const tip = document.getElementById('badgetip');
    app.querySelectorAll('.badge').forEach((b) => {
      const show = () => { tip.textContent = b.dataset.desc; app.querySelectorAll('.badge').forEach((x) => x.classList.toggle('on', x === b)); };
      b.onclick = show;
      b.onmouseenter = show;
    });
    document.getElementById('again')?.addEventListener('click', ctx.onAgain);
    document.getElementById('exit').onclick = ctx.onExit;
    const flash = (btn, msg) => { const old = btn.innerHTML; btn.textContent = msg; setTimeout(() => { btn.innerHTML = old; }, 1600); };
    const copyBtn = document.getElementById('acopy');
    if (copyBtn) copyBtn.onclick = async () => flash(copyBtn, (await copyText(anthologyText())) ? 'Copiado!' : 'Não foi possível copiar');
    const dlBtn = document.getElementById('adl');
    if (dlBtn) {
      dlBtn.onclick = () => {
        const url = URL.createObjectURL(new Blob([anthologyText()], { type: 'text/plain;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url; a.download = 'palimpsesto-antologia.txt';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      };
    }
    confetti(70);
    sfx.fanfare();
    haptic([60, 40, 60, 40, 120]);
  }

  /** Quem chegou com a partida em andamento: assiste (sem vanguardas nem ações) e joga na próxima. */
  function viewSpectator() {
    const showText = TEXT_PHASES.includes(s.phase);
    const what = s.phase === 'writing' ? 'Os jogadores estão escrevendo…' : '';
    app.innerHTML = `<div class="screen">${header()}
      <div class="callout"><b>Você está assistindo.</b> Você entra na próxima partida.</div>
      ${showText ? textPaper() : `<p class="dim">${what}</p>`}
      <h3>Placar</h3>${scoreTable()}</div>`;
  }

  const VIEWS = {
    writing: viewWriting, preview: viewPreview, guessing: viewGuessing, reveal: viewReveal,
    reporting: viewReporting, scoring: viewScoring, finished: viewFinished,
  };

  /** Só remonta o DOM quando algo visível mudou (não perde foco/texto no textarea). */
  function keyOf() {
    const base = `${s.round}:${s.phase}:${s.cursor}:${s.done.includes(me)}`;
    const author = s.order[s.cursor];
    if (s.phase === 'guessing') return `${base}:${(s.guesses[author]?.[me] ?? []).join('|')}:${(s.hits?.[author] ?? []).join('|')}:${s.done.join('|')}`;
    if (s.phase === 'reporting') return `${base}:${(s.reports[author] ?? []).join('|')}`;
    return base;
  }

  const PHASE_SFX = { writing: sfx.start, preview: sfx.page, guessing: sfx.chime, reveal: sfx.whoosh, reporting: sfx.gong };
  const SPLASH = {
    writing: () => splash('Escrevam', `Rodada ${s.round} de ${s.totalRounds}`),
    guessing: () => splash('Palpite!', `Texto ${s.cursor + 1} de ${s.order.length}`),
    scoring: () => splash('Placar', `Fim da rodada ${s.round}`),
  };

  return {
    render(state) {
      s = state;
      const pid = `${s.round}:${s.phase}:${s.cursor}`;
      if (pid !== phaseId) { // fase nova (não só um clique meu)
        phaseId = pid;
        baseline = Math.max(1, (s.phaseEndsAt ?? 0) - ctx.now());
        lastSecond = -1;
        prevOthersDone = 0;
        urgency(false);
        if (s.phase !== 'scoring' && s.phase !== 'finished') PHASE_SFX[s.phase]?.();
        else if (s.phase === 'scoring') sfx.whoosh();
        SPLASH[s.phase]?.();
        announce(`Rodada ${s.round}: ${PHASES[s.phase][0]}`);
      }
      const k = keyOf();
      if (k !== viewKey) {
        viewKey = k;
        if (s.spectator && s.phase !== 'scoring' && s.phase !== 'finished') viewSpectator();
        else VIEWS[s.phase]?.();
        timerEl = document.getElementById('timer');
      }
      if (s.phase !== 'scoring') scoreMemo = { ...s.scores };
      const r = document.getElementById('ready');
      if (r) {
        r.textContent = readyCount(); // contador ao vivo, sem remontar a tela
        const others = s.done.filter((id) => id !== me).length;
        if (others > prevOthersDone) { sfx.ready(); const pill = document.getElementById('pill'); pill?.classList.remove('bump'); void pill?.offsetWidth; pill?.classList.add('bump'); }
        prevOthersDone = others;
      }
    },
    /** Chamar ~5×/s. */
    tick() {
      if (!timerEl || s?.phaseEndsAt == null) return;
      const rem = Math.max(0, s.phaseEndsAt - ctx.now());
      const secs = Math.ceil(rem / 1000);
      const tnum = document.getElementById('tnum');
      const ring = document.getElementById('ring');
      if (!tnum || !ring) return;
      tnum.textContent = secs;
      ring.style.strokeDashoffset = CIRC * (1 - Math.min(1, rem / baseline));
      const timed = s.phase === 'writing' || s.phase === 'guessing'; // só escrita e palpite têm contagem dramática
      const urgent = timed && (secs <= 5 || (s.phase === 'writing' && secs <= 10));
      timerEl.classList.toggle('urgent', urgent);
      urgency(timed && secs <= 5);
      if (secs !== lastSecond) {
        lastSecond = secs;
        if (timed) {
          if (secs > 0 && secs <= 3) { bigCount(secs); sfx.countdown(secs === 1); haptic(30); }
          else if (secs === 5 || secs === 10) announce(`Faltam ${secs} segundos`);
          else if (secs > 3 && secs <= 5) sfx.urgent();
          else if (secs > 5 && secs <= 10 && s.phase === 'writing') sfx.tick();
        }
      }
    },
    destroy() {
      urgency(false);
      keepAwake(false);
      document.body.classList.remove('playing');
      document.querySelector('.splash')?.remove();
      document.querySelector('.bigcount')?.remove();
    },
  };
}
