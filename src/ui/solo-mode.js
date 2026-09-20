// Modo solo: você + bots, mesmo motor da partida real (spec seção 9).
import { createSolo, HUMAN_ID } from '../solo/solo.js';
import { CONTENT } from '../data/content.js';
import { mountRoomConfig } from './room-config.js';
import { createGameView } from './game-views.js';
import { icon } from './icons.js';
import { sfx } from './sound.js';

export function startSolo(app, { playerName, color, onExit }) {
  let solo = null;
  let view = null;
  let ticker = null;

  function stop() {
    view?.destroy();
    view = null;
    solo?.stop();
    solo = null;
    clearInterval(ticker);
  }

  function lobby() {
    stop();
    app.innerHTML = `<div class="screen">
      <p><button id="back" class="ghost">${icon('back', 16)} Menu</button></p>
      <h1>Modo solo</h1>
      <p class="dim">Você contra bots (texto pré-pronto). Serve para testar o jogo sem rede.</p>
      <form id="cfg" class="panel">
        <label>Bots (1 a 7) <input name="bots" type="number" min="1" max="7" value="3"></label>
        <div id="room"></div>
        <p style="margin-top:14px"><button class="primary big" style="width:auto">${icon('play', 18)} Começar</button></p>
        <p id="err" class="err"></p>
      </form></div>`;
    document.getElementById('back').onclick = () => { stop(); onExit(); };
    const room = mountRoomConfig(document.getElementById('room'));
    document.getElementById('cfg').onsubmit = (ev) => {
      ev.preventDefault();
      const err = document.getElementById('err');
      const invalid = room.validate(Number(new FormData(ev.target).get('bots')) + 1);
      if (invalid) { err.textContent = invalid; sfx.error(); return; }
      try {
        solo = createSolo({
          humanName: playerName || 'Você',
          humanColor: color,
          botCount: Number(new FormData(ev.target).get('bots')),
          content: CONTENT,
          config: room.read(),
          onChange: (s) => view?.render(s),
        });
      } catch (e) {
        err.textContent = e.message;
        sfx.error();
        return;
      }
      room.save();
      play();
    };
  }

  function play() {
    view = createGameView(app, {
      me: HUMAN_ID,
      now: () => Date.now(),
      actions: {
        draft: (t) => solo.updateDraft(t),
        guess: (v) => solo.guess(v),
        done: () => solo.done(),
        report: (id) => solo.report(id),
      },
      onAgain: lobby,
      onExit: () => { stop(); onExit(); },
    });
    solo.start();
    solo.run(200);
    view.render(solo.state);
    ticker = setInterval(() => view.tick(), 200);
  }

  lobby();
}
