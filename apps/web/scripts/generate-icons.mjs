// Renders the brand SVGs in design/brand/ to the PNG and icon files the product
// needs. Run it when a logo SVG changes: `pnpm --filter web icons`.
//
// The SVGs are rendered exactly as they are (Chromium draws them; nothing is
// redrawn, recoloured or cropped) on a transparent page, so the rounded
// corners stay transparent. Outputs:
//   design/brand/leadpilot-240.png   product logo, 240x240
//   design/brand/neronmen.png        personal brand (never shown in the product), 512x512
//   apps/web/public/email/logo.png   what the invite email loads (copy of the 240 render)
//   apps/web/public/brand/leadpilot.svg   the app logo (sidebar, auth pages)
//   apps/web/app/icon.svg            favicon for modern browsers (Next.js file convention)
//   apps/web/app/apple-icon.png      180x180 home-screen icon
//   apps/web/app/favicon.ico         16, 32 and 48 px for old browsers
import { chromium } from '@playwright/test';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const brand = join(root, 'design', 'brand');
const web = join(root, 'apps', 'web');

const browser = await chromium.launch();

/** The SVG at `size` x `size` px, with a transparent background, as PNG bytes. */
async function render(svgPath, size) {
  const svg = readFileSync(svgPath);
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<!doctype html><body style="margin:0;background:transparent">` +
      `<img src="data:image/svg+xml;base64,${svg.toString('base64')}" ` +
      `width="${size}" height="${size}" style="display:block"></body>`,
  );
  await page.waitForFunction(() => document.images[0].complete);
  const png = await page.screenshot({ omitBackground: true });
  await page.close();
  return png;
}

/** An .ico file holding PNG images (supported by every browser since IE 9). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0);
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map(({ png }) => png)]);
}

const leadpilot = join(brand, 'leadpilot.svg');
const write = (path, data) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  console.log('wrote', path.replace(root, '').replaceAll('\\', '/'));
};

const logo240 = await render(leadpilot, 240);
write(join(brand, 'leadpilot-240.png'), logo240);
write(join(web, 'public', 'email', 'logo.png'), logo240);
write(join(brand, 'neronmen.png'), await render(join(brand, 'neronmen.svg'), 512));
write(join(web, 'app', 'apple-icon.png'), await render(leadpilot, 180));
write(
  join(web, 'app', 'favicon.ico'),
  ico(
    await Promise.all(
      [16, 32, 48].map(async (size) => ({ size, png: await render(leadpilot, size) })),
    ),
  ),
);
copyFileSync(leadpilot, join(web, 'app', 'icon.svg'));
copyFileSync(leadpilot, join(web, 'public', 'brand', 'leadpilot.svg'));

await browser.close();
