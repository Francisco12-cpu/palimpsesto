// Telas de jogo (escrever, revelar, palpitar, denunciar, pontuar, fim) compartilhadas pelo
// modo solo e pelo modo rede. Recebem uma "visão" do estado (s) e um ctx:
//   ctx.me        id do jogador local
//   ctx.now()     relógio (no modo rede é o tempo do relay → timer sincronizado)
//   ctx.actions   { draft(text), guess(v), done(), report(authorId) }
//   ctx.onAgain   () => void | null   (botão "jogar de novo"; null = "aguardando o host")
//   ctx.onExit    () => void
// Devolve { render(state), tick(), destroy() }.
import * as E from '../engine/engine.js';
import { BRAND } from '../brand.js';
import { VANGUARD_INFO } from '../data/vanguards.js';
import { icon, seal } from './icons.js';
import { avatar, confetti, countUp, splash, bigCount, urgency, shake, announce, keepAwake } from './fx.js';
import { sfx, haptic } from './sound.js';

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fold = (x) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const PHASES = {
  writing: ['Escrevendo', 'pen'],
  revealing: ['Revelação', 'eye'],
  guessing: ['Palpite', 'target'],
  reporting: ['Denúncias', 'flag'],
  scoring: ['Pontuação', 'star'],
  finished: ['Fim de jogo', 'trophy'],
};
const CIRC = 2 * Math.PI * 19;
const READY_PHASES = ['writing', 'revealing', 'guessing', 'reporting'];
const ABOUT = Object.fromEntries(VANGUARD_INFO.map((v) => [v.name, v.about]));

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
      <div class="phase-title"><div class="k">Rodada ${s.round} de ${s.totalRounds}</div>
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
          <span class="tag">${esc(a.textType)}</span>
          <div class="lbl">Tema</div><div class="val">${esc(a.theme)}</div>
          ${a.modifier ? `<div class="lbl">Modificador</div><div class="val">${esc(a.modifier)}</div>` : ''}
          ${a.keywords.length ? `<div class="lbl">Palavras-chave${s.config.keywordPenalty ? ` (faltar alguma custa ${s.config.keywordPenalty} pt)` : ''}</div><div id="kws">${a.keywords.map((k) => `<span class="tag kw" data-k="${esc(k)}">${esc(k)}</span>`).join('')}</div>` : ''}
        </div>
      </div>
      <details class="tip"><summary>Lembrete do estilo</summary><p>${esc(ABOUT[a.vanguard] ?? '')}</p></details>
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

  function viewRevealing() {
    const a = s.assignments[E.currentAuthorId(s)];
    app.innerHTML = `<div class="screen">${header()}${textPaper()}
      <p class="dim">Tema: ${esc(a.theme)} · ${esc(a.textType)}. Leia com atenção — a vanguarda continua secreta.</p>
      ${readyBtn('Já li — Pronto')}</div>`;
    document.getElementById('done').onclick = () => { ctx.actions.done(); haptic(20); };
  }

  function viewGuessing() {
    const authorId = E.currentAuthorId(s);
    const mine = s.guesses[authorId]?.[me] ?? [];
    const left = s.config.guessesPerPlayer - mine.length;
    const h = s.config.helper;
    const isMe = authorId === me;
    const canGuess = !isMe && left > 0 && !s.done.includes(me);
    app.innerHTML = `<div class="screen">${header()}${textPaper()}
      ${isMe ? `<p class="dim">É o seu texto — aguarde os palpites dos outros.</p>${readyBtn()}` : `
      <div class="panel">
        <h3>Qual é a vanguarda?</h3>
        <p>Palpites restantes: <b class="hit">${left}</b>
          ${mine.map((m) => `<span class="tag">${esc(m)}</span>`).join('')}</p>
        ${canGuess ? `<form id="g" class="guess-box" autocomplete="off">
          <div class="row"><input name="v" id="gin" placeholder="Digite o nome da vanguarda…" style="flex:1;min-width:0" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="send">
            <button class="primary">${icon('send', 16)} Palpitar</button></div>
          ${h.autocomplete ? '<ul class="suggest" id="sug"></ul>' : ''}
          <p id="gerr" class="err"></p></form>` : ''}
        ${h.showAllNames ? `<div class="chips">${s.config.vanguards.map((v) => `<button type="button" data-fill="${esc(v)}">${esc(v)}</button>`).join('')}</div>` : ''}
        <p class="dim" style="margin-top:10px">O resultado (acerto ou erro) só aparece no fim da rodada.</p>
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
    app.innerHTML = `<div class="screen">${header()}
      <p class="dim">Denuncie textos que não têm nada a ver com o tema. Com ${q} denúncia(s) o autor perde ${s.config.reportPenalty} ponto(s).</p>
      ${s.order.map((id) => {
        const rep = s.reports[id] ?? [];
        const a = s.assignments[id];
        const mine = rep.includes(me);
        return `<div class="panel">
          ${paperHtml(s.texts[id] ?? '', `${av(id, 26)} ${nameOf(id)}`, true)}
          <div class="dim">Tema: ${esc(a.theme)}</div>
          <div class="row" style="margin-top:8px"><span>${icon('flag', 16)} ${rep.length}/${q} — ${namesOf(rep)}</span>
          ${id === me ? '' : `<button data-rep="${id}" class="${mine ? 'on' : ''}" style="margin-left:auto">${mine ? 'Retirar denúncia' : 'Denunciar'}</button>`}</div></div>`;
      }).join('')}
      ${readyBtn('Terminei — Pronto')}</div>`;
    app.querySelectorAll('[data-rep]').forEach((b) => { b.onclick = () => { ctx.actions.report(b.dataset.rep); haptic(15); }; });
    document.getElementById('done').onclick = () => { ctx.actions.done(); haptic(20); };
  }

  function viewScoring() {
    const r = s.lastResult;
    const ranked = E.ranking(s);
    app.innerHTML = `<div class="screen">${header()}
      ${r.texts.map((t, i) => `<div class="panel result" style="--i:${i}">
        <div class="head">${seal(t.vanguard, 46)}
          <div><div class="dim">${nameOf(t.authorId)} escreveu em</div>
          <b style="font:700 1.05rem var(--f-title);color:var(--gold);letter-spacing:1px;text-transform:uppercase">${esc(t.vanguard)}</b></div>
          ${t.denounced ? `<span class="flagged" style="margin-left:auto">${icon('flag', 14)} denúncia válida</span>` : ''}</div>
        <div class="verdict">
          <div class="hit">${icon('check', 15)} Acertaram: ${namesOf(t.hits)}</div>
          <div class="miss">${icon('x', 15)} Erraram: ${namesOf(t.misses)}</div>
          <div class="dim">${icon('flag', 14)} Denunciaram: ${namesOf(t.reporters)}</div>
          ${t.keywords?.total ? `<div class="${t.keywords.missing.length ? 'miss' : 'hit'}">Palavras-chave: ${t.keywords.used}/${t.keywords.total}${t.keywords.missing.length ? ` — faltou: ${t.keywords.missing.map(esc).join(', ')}` : ''}</div>` : ''}
          <div class="dim">Palpites: ${Object.entries(t.guesses).map(([id, l]) => `${nameOf(id)}: ${l.map(esc).join(' / ')}`).join(' · ') || '—'}</div>
        </div></div>`).join('')}
      <div class="divisor">✦</div><h3>Placar</h3>
      ${ranked.map((p, i) => {
        const d = r.deltas[p.id];
        return `<div class="score-row ${i === 0 ? 'first' : ''}" style="--i:${i}">
          <span class="pos">${i + 1}</span>${av(p.id, 36)}<span class="name">${esc(p.name)}</span>
          <span class="pts" data-score="${p.score}" data-from="${scoreMemo[p.id] ?? 0}">${scoreMemo[p.id] ?? 0}</span>
          <span class="delta ${d.net > 0 ? 'up' : d.net < 0 ? 'down' : ''}">${d.net > 0 ? '+' : ''}${d.net || '·'}${d.lost ? ` <small>(−${d.lost} ${icon('flag', 12)})</small>` : ''}</span></div>`;
      }).join('')}</div>`;
    app.querySelectorAll('[data-score]').forEach((el) => countUp(el, Number(el.dataset.from), Number(el.dataset.score)));

    const mineHit = r.texts.some((t) => t.hits.includes(me));
    const gained = r.deltas[me]?.net ?? 0;
    if (mineHit || gained > 0) { sfx.success(); haptic([30, 40, 60]); if (gained >= 2) confetti(28); }
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
      <div class="divisor">✦</div><h2 style="text-align:center;margin-top:0">Títulos</h2>
      ${s.titles.length ? s.titles.map((t, i) => `<div class="panel title-card" style="--i:${i}"><span class="em">${BRAND.emoji ? t.emoji : icon('trophy', 30)}</span>
        <div><b>${esc(t.label)}</b><div>${namesOf(t.playerIds)}</div><div class="dim">${esc(t.detail)}</div></div></div>`).join('')
        : '<p class="dim" style="text-align:center">Nenhum título desta vez.</p>'}
      <p class="row" style="justify-content:center;margin-top:20px">
        ${ctx.onAgain ? `<button id="again" class="primary">${icon('play', 16)} Jogar de novo</button>` : '<span class="dim">Aguardando o host reiniciar…</span>'}
        <button id="exit" class="ghost">Sair</button></p>
      ${anthologyHtml()}</div>`;
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
    const showText = s.phase === 'revealing' || s.phase === 'guessing';
    const what = { writing: 'Os jogadores estão escrevendo…', reporting: 'Os jogadores estão denunciando textos…', revealing: '', guessing: '' }[s.phase] ?? '';
    app.innerHTML = `<div class="screen">${header()}
      <div class="callout"><b>Você está assistindo.</b> Você entra na próxima partida.</div>
      ${showText ? textPaper() : `<p class="dim">${what}</p>`}
      <h3>Placar</h3>${scoreTable()}</div>`;
  }

  const VIEWS = {
    writing: viewWriting, revealing: viewRevealing, guessing: viewGuessing,
    reporting: viewReporting, scoring: viewScoring, finished: viewFinished,
  };

  /** Só remonta o DOM quando algo visível mudou (não perde foco/texto no textarea). */
  function keyOf() {
    const base = `${s.round}:${s.phase}:${s.cursor}:${s.done.includes(me)}`;
    if (s.phase === 'guessing') return `${base}:${(s.guesses[s.order[s.cursor]]?.[me] ?? []).join('|')}`;
    if (s.phase === 'reporting') return `${base}:${JSON.stringify(s.reports)}`;
    return base;
  }

  const PHASE_SFX = { writing: sfx.start, revealing: sfx.page, guessing: sfx.chime, reporting: sfx.gong };
  const SPLASH = {
    writing: () => splash('Escrevam', `Rodada ${s.round} de ${s.totalRounds}`),
    reporting: () => splash('Denúncias', 'Algo fora do tema?'),
    scoring: () => splash('Pontuação', 'A vanguarda revelada'),
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
      const timed = s.phase !== 'scoring' && s.phase !== 'revealing'; // leitura de texto não tem contagem dramática
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
