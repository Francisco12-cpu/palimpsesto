// Áudio com um AudioContext falso: garante que todos os efeitos rodam sem erro, que mudo/volume/música
// e vibração respeitam as configurações — sem precisar de placa de som.
import test from 'node:test';
import assert from 'node:assert/strict';

const made = { osc: 0, buf: 0, ctx: 0 };
class Param { constructor() { this.value = 0; } setValueAtTime() {} exponentialRampToValueAtTime() {} }
class Node {
  constructor() { this.gain = new Param(); this.frequency = new Param(); this.detune = new Param(); this.delayTime = new Param(); this.Q = new Param(); }
  connect(n) { return n; } start() {} stop() {}
}
class Ctx {
  constructor() { made.ctx++; this.currentTime = 0; this.sampleRate = 8000; this.state = 'suspended'; this.destination = new Node(); }
  resume() { this.state = 'running'; }
  createGain() { return new Node(); }
  createOscillator() { made.osc++; return new Node(); }
  createBuffer(_c, len) { made.buf++; return { getChannelData: () => new Float32Array(len) }; }
  createBufferSource() { return new Node(); }
  createBiquadFilter() { return new Node(); }
  createDynamicsCompressor() { return new Node(); }
  createDelay() { return new Node(); }
}
globalThis.AudioContext = Ctx;
const vibrations = [];
Object.defineProperty(globalThis, 'navigator', { value: { vibrate: (p) => vibrations.push(p) }, configurable: true });

const { sfx, music, setAudio, setMuted, audioSettings, haptic } = await import('../src/ui/sound.js');

test('todos os efeitos tocam sem erro e geram som', () => {
  setAudio({ muted: false, volume: 0.5, music: false, haptics: true });
  const before = made.osc + made.buf;
  for (const [name, fn] of Object.entries(sfx)) {
    assert.doesNotThrow(() => fn(), `sfx.${name}`);
  }
  assert.doesNotThrow(() => sfx.countdown(true));
  assert.ok(made.osc + made.buf > before + 20, 'criou osciladores/ruído');
});

test('mudo não cria som novo; ligar de novo volta a tocar', () => {
  setMuted(true);
  assert.equal(audioSettings().muted, true);
  const n = made.osc;
  sfx.success(); sfx.click();
  assert.equal(made.osc, n, 'mudo = silêncio');
  setMuted(false);
  sfx.click();
  assert.ok(made.osc > n);
});

test('volume é limitado ao configurado e guardado', () => {
  setAudio({ volume: 0.25 });
  assert.equal(audioSettings().volume, 0.25);
});

test('música ambiente: liga/desliga pelas configurações e o intervalo é limpo', () => {
  setAudio({ music: true, muted: false }); // já inicia sozinha
  music.stop();
  const n = made.osc;
  music.start();
  assert.ok(made.osc > n, 'tocou o primeiro compasso');
  music.start(); // idempotente
  setAudio({ music: false });
  const m = made.osc;
  music.start();
  assert.equal(made.osc, m, 'desligada não toca');
  music.stop();
});

test('vibração só quando ligada e com som ativo', () => {
  vibrations.length = 0;
  setAudio({ haptics: true, muted: false });
  haptic([30, 40]);
  assert.deepEqual(vibrations, [[30, 40]]);
  setAudio({ haptics: false });
  haptic(20);
  assert.equal(vibrations.length, 1);
  setAudio({ haptics: true, muted: true });
  haptic(20);
  assert.equal(vibrations.length, 1);
  setAudio({ muted: false });
  setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref();
});
