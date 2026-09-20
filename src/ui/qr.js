// QR code da sala (biblioteca qrcode-generator, MIT, embutida em ../vendor — funciona offline).
import qrcode from '../vendor/qrcode.mjs';

/** SVG do QR (escalável, com margem clara em volta para leitura fácil). */
export function qrSvg(text) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
}
