// Criptografia das mensagens do modo online (broker MQTT público = ponte que NÃO deve ler o jogo).
// AES-GCM 256 com chave derivada do código da sala (PBKDF2). Quem não tem o código só vê bytes
// aleatórios; o tópico usa um hash do código, então o código também não aparece no broker.
// Usa WebCrypto (disponível no navegador em HTTPS/localhost e no Node 20+).

const te = new TextEncoder();
const td = new TextDecoder();
const SALT = te.encode('palimpsesto-v1');
const ITERATIONS = 100_000;

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export class Cipher {
  constructor(key, roomId) {
    this.key = key;
    this.roomId = roomId;
  }

  static async fromCode(code) {
    const c = String(code).toUpperCase();
    const subtle = globalThis.crypto.subtle;
    const material = await subtle.importKey('raw', te.encode(c), 'PBKDF2', false, ['deriveKey']);
    const key = await subtle.deriveKey(
      { name: 'PBKDF2', salt: SALT, iterations: ITERATIONS, hash: 'SHA-256' },
      material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
    );
    const roomId = hex(await subtle.digest('SHA-256', te.encode(`id:${c}`))).slice(0, 20);
    return new Cipher(key, roomId);
  }

  /** objeto → bytes (iv de 12 bytes + texto cifrado). */
  async encrypt(obj) {
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.key, te.encode(JSON.stringify(obj))));
    const out = new Uint8Array(12 + ct.length);
    out.set(iv);
    out.set(ct, 12);
    return out;
  }

  /** bytes → objeto, ou null se não for da nossa sala / foi adulterado. */
  async decrypt(bytes) {
    try {
      const b = new Uint8Array(bytes);
      if (b.length < 29) return null;
      const pt = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.subarray(0, 12) }, this.key, b.subarray(12));
      return JSON.parse(td.decode(pt));
    } catch {
      return null;
    }
  }
}
