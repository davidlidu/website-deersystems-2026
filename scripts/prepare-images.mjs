// Genera los recursos optimizados de /public/img a partir de /brand-src.
import sharp from 'sharp';

const SRC = 'brand-src';
const OUT = 'public/img';

// Convierte un recorte sobre fondo blanco en PNG/WebP con alfa real
// ("un-matting": invierte la composición sobre blanco).
async function unmatteWhite(input, region, out, width) {
  const { data, info } = await sharp(input).extract(region).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const px = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    let a = Math.max(255 - r, 255 - g, 255 - b) / 255;
    a = Math.min(1, Math.max(0, (a - 0.03) / 0.97));
    const un = (c) => (a < 0.004 ? 0 : Math.round(Math.min(255, Math.max(0, 255 - (255 - c) / a))));
    px[j] = un(r); px[j + 1] = un(g); px[j + 2] = un(b); px[j + 3] = Math.round(a * 255);
  }
  await sharp(px, { raw: { width: info.width, height: info.height, channels: 4 } })
    .resize({ width }).webp({ quality: 88, alphaQuality: 90 }).toFile(out);
}

await unmatteWhite(`${SRC}/nexo-sheet.webp`, { left: 10, top: 93, width: 360, height: 872 }, `${OUT}/nexo-front.webp`, 520);
await sharp(`${SRC}/nexo-icon.webp`).resize(640).webp({ quality: 88 }).toFile(`${OUT}/nexo-icon.webp`);
await sharp(`${SRC}/david.jpg`).resize({ width: 900 }).webp({ quality: 82 }).toFile(`${OUT}/david-liduenas.webp`);
await sharp(`${SRC}/logo-square.png`).resize(512).png().toFile(`${OUT}/deersystems-logo.png`);
await sharp(`${SRC}/logo-square.png`).extract({ left: 230, top: 140, width: 564, height: 564 })
  .resize(180).png().toFile('public/apple-touch-icon.png');
// Imagen Open Graph 1200x630 sobre Azul Profundo.
const logo = await sharp(`${SRC}/logo-square.png`).extract({ left: 230, top: 140, width: 564, height: 564 }).resize(300).png().toBuffer();
await sharp({ create: { width: 1200, height: 630, channels: 4, background: '#051923' } })
  .composite([{ input: logo, left: 450, top: 110 }]).png().toFile(`${OUT}/og-image.png`);
console.log('ok');
