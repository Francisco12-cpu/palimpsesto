// Testa se os brokers MQTT públicos respondem daqui (conecta, assina, publica com retain e recebe de volta).
//   node tools/broker-check.mjs
import { MqttClient } from '../src/net/mqtt.js';

const BROKERS = [
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://broker.emqx.io:8084/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
  'wss://mqtt.eclipseprojects.io:443/mqtt',
];

for (const url of BROKERS) {
  const t0 = Date.now();
  const topic = `palimpsesto/check/${Math.random().toString(36).slice(2)}`;
  const c = new MqttClient({ url, clientId: `chk${Math.random().toString(36).slice(2, 10)}` });
  try {
    await c.connect(7000);
    const got = new Promise((res, rej) => { c.onMessage = (t, p) => res(new TextDecoder().decode(p)); setTimeout(() => rej(new Error('sem eco')), 5000); });
    c.subscribe(topic);
    await new Promise((r) => setTimeout(r, 400));
    c.publish(topic, 'olá');
    const msg = await got;
    console.log(`OK   ${url}  (${Date.now() - t0} ms, eco: ${msg})`);
  } catch (e) {
    console.log(`FALHA ${url}  → ${e.message}`);
  }
  c.close();
}
process.exit(0);
