// Tela de configuração de sala (spec seção 7). Reutilizada pelo solo agora e pela
// criação de sala em rede na Fase 3. Produz um objeto `config` que o motor normaliza.
import { VANGUARD_INFO, VANGUARD_PRESETS } from '../data/content.js';
import { DEFAULT_CONFIG, TEXT_TYPES } from '../engine/config.js';

const STORAGE_KEY = 'vanguardas.config.v1';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const GROUPS = ['Pré-modernos', 'Vanguardas europeias', 'Brasileiras'];

export function loadSavedConfig() {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(cfg) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch { /* sem storage: tudo bem */ }
}

/**
 * Monta o formulário dentro de `container` (que deve estar dentro de um <form> ou ser o próprio).
 * Devolve { read(), validate() }.
 */
export function mountRoomConfig(container, initial = loadSavedConfig()) {
  const chosenVanguards = initial.vanguards ?? VANGUARD_INFO.map((v) => v.name);
  const timers = { ...DEFAULT_CONFIG.timers, ...(initial.timers || {}) };
  const num = (name, label, value, min, max, hint = '') =>
    `<label>${label} <input name="${name}" type="number" min="${min}" max="${max}" value="${value}">${hint ? `<small class="dim"> ${hint}</small>` : ''}</label>`;
  const chk = (name, label, on) => `<label class="inline"><input type="checkbox" name="${name}" ${on ? 'checked' : ''}> ${label}</label>`;

  container.innerHTML = `
    <fieldset>
      <legend>Vanguardas em jogo <span id="vcount" class="dim"></span></legend>
      <div class="row" id="presets">
        ${Object.entries(VANGUARD_PRESETS).map(([k, p]) => `<button type="button" data-preset="${k}">${esc(p.label)}</button>`).join('')}
      </div>
      ${GROUPS.map((g) => `<p class="dim grp">${g}</p><div class="grid">
        ${VANGUARD_INFO.filter((v) => v.group === g).map((v) =>
          `<label class="inline"><input type="checkbox" name="van" value="${esc(v.name)}" ${chosenVanguards.includes(v.name) ? 'checked' : ''}> ${esc(v.name)}</label>`).join('')}
      </div>`).join('')}
    </fieldset>

    <fieldset>
      <legend>Texto</legend>
      <div class="grid">
        ${num('minChars', 'Mínimo de caracteres', initial.minChars, 0, 3000)}
        ${num('keywords', 'Palavras-chave por tema', initial.keywordsPerTheme, 0, 5, '(0 = nenhuma)')}
        <label>Tipo de texto
          <select name="fixedType"><option value="">sorteado entre os permitidos</option>
          ${TEXT_TYPES.map((t) => `<option ${initial.fixedTextType === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
        </label>
      </div>
      <p class="dim grp">Tipos permitidos no sorteio</p>
      <div class="grid">${TEXT_TYPES.map((t) => `<label class="inline"><input type="checkbox" name="ttype" value="${t}" ${initial.textTypes.includes(t) ? 'checked' : ''}> ${t}</label>`).join('')}</div>
      ${chk('mods', 'Modificadores (a intenção que o texto precisa carregar)', initial.modifiersEnabled)}
      ${chk('filter', 'Filtro de palavrões (troca por asteriscos)', initial.filterProfanity)}
    </fieldset>

    <fieldset>
      <legend>Regras</legend>
      <div class="grid">
        ${num('rounds', 'Rodadas (cada um escreve 1× por rodada)', initial.roundsPerPlayer, 1, 20)}
        ${num('guesses', 'Palpites por jogador em cada texto', initial.guessesPerPlayer, 1, 5)}
        ${num('quorum', 'Denúncias para punir o autor (quórum)', initial.reportQuorum, 1, 20)}
        ${num('penalty', 'Pontos perdidos na denúncia', initial.reportPenalty, 0, 20)}
        ${num('kwpen', 'Pontos perdidos se faltar palavra-chave', initial.keywordPenalty, 0, 10, '(0 = só informativo)')}
      </div>
    </fieldset>

    <fieldset>
      <legend>Facilitador</legend>
      ${chk('auto', 'Autocomplete de vanguardas ao palpitar (só nomes, sem explicação)', initial.helper.autocomplete)}
      ${chk('all', 'Lista completa de nomes sempre visível na tela', initial.helper.showAllNames)}
    </fieldset>

    <details>
      <summary>Tempos (segundos)</summary>
      <div class="grid">
        ${num('t_writing', 'Escrita', timers.writing, 5, 3600)}
        ${num('t_revealing', 'Revelação de cada texto', timers.revealing, 1, 300)}
        ${num('t_guessing', 'Palpite de cada texto', timers.guessing, 3, 300)}
        ${num('t_reporting', 'Denúncia', timers.reporting, 3, 300)}
        ${num('t_scoring', 'Pontuação da rodada', timers.scoring, 3, 300)}
      </div>
      <button type="button" id="fast">Modo rápido (para testes)</button>
    </details>`;

  const $all = (sel) => [...container.querySelectorAll(sel)];
  const field = (name) => container.querySelector(`[name="${name}"]`);
  const updateCount = () => {
    const n = $all('[name="van"]:checked').length;
    container.querySelector('#vcount').textContent = `— ${n} selecionada(s)`;
  };

  container.querySelectorAll('[data-preset]').forEach((b) => {
    b.onclick = () => {
      const names = VANGUARD_PRESETS[b.dataset.preset].names;
      $all('[name="van"]').forEach((c) => { c.checked = names.includes(c.value); });
      updateCount();
    };
  });
  container.addEventListener('change', (e) => { if (e.target.name === 'van') updateCount(); });
  container.querySelector('#fast').onclick = () => {
    for (const [k, v] of Object.entries({ writing: 15, revealing: 4, guessing: 8, reporting: 10, scoring: 5 })) field(`t_${k}`).value = v;
  };
  updateCount();

  const n = (name) => Number(field(name).value);
  function read() {
    return {
      vanguards: $all('[name="van"]:checked').map((c) => c.value),
      minChars: n('minChars'),
      keywordsPerTheme: n('keywords'),
      fixedTextType: field('fixedType').value || null,
      textTypes: $all('[name="ttype"]:checked').map((c) => c.value),
      modifiersEnabled: field('mods').checked,
      roundsPerPlayer: n('rounds'),
      guessesPerPlayer: n('guesses'),
      reportQuorum: n('quorum'),
      reportPenalty: n('penalty'),
      keywordPenalty: n('kwpen'),
      filterProfanity: field('filter').checked,
      helper: { autocomplete: field('auto').checked, showAllNames: field('all').checked },
      timers: {
        writing: n('t_writing'), revealing: n('t_revealing'), guessing: n('t_guessing'),
        reporting: n('t_reporting'), scoring: n('t_scoring'),
      },
    };
  }

  /** Mensagem de erro (string) ou null se a config está boa. */
  function validate(players = 2) {
    const c = read();
    if (c.vanguards.length < 2) return 'Selecione pelo menos 2 vanguardas.';
    if (c.vanguards.length < players) return `Selecione pelo menos ${players} vanguardas (uma por jogador).`;
    if (!c.textTypes.length && !c.fixedTextType) return 'Permita pelo menos 1 tipo de texto.';
    return null;
  }

  return { read, validate, save: () => saveConfig(read()) };
}
