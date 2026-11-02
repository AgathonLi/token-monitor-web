const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const VERSION = 'bplus-20261102';

const logo = read('assets/logo.svg');
const favicon = read('favicon.svg');
const html = read('index.html');
const manifestText = read('site.webmanifest');
const manifest = JSON.parse(manifestText);
const readmes = ['README.md', 'README.zh-CN.md'];
const readmeText = Object.fromEntries(readmes.map((name) => [name, read(name)]));

// Ordered B+ geometry: one full-width bar, two middle segments, then two
// bottom segments; only the bottom-right segment uses the accent blue.
const APPROVED = [
  { x: 8, y: 10, width: 48, height: 10, rx: 3, fill: '#1c1f24' },
  { x: 8, y: 27, width: 20, height: 10, rx: 3, fill: '#1c1f24' },
  { x: 32, y: 27, width: 16, height: 10, rx: 3, fill: '#1c1f24' },
  { x: 8, y: 44, width: 28, height: 10, rx: 3, fill: '#1c1f24' },
  { x: 40, y: 44, width: 16, height: 10, rx: 3, fill: '#4d8ee6' },
];

function rectsOf(svg) {
  return [...svg.matchAll(/<rect\b([^>]*)\/?>/g)].map((match) => {
    const attrs = {};
    for (const [, key, value] of match[1].matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) attrs[key] = value;
    return attrs;
  });
}

function assertGeometry(svg, label) {
  const rects = rectsOf(svg);
  assert.equal(rects.length, APPROVED.length, `${label}: expected exactly five mark rects`);
  rects.forEach((rect, index) => {
    const expected = APPROVED[index];
    for (const key of ['x', 'y', 'width', 'height', 'rx', 'fill']) {
      assert.equal(rect[key], String(expected[key]), `${label}: rect ${index} ${key}`);
    }
    // The B+ mark must keep its approved size; guard against accidental scaling.
    assert.equal(rect.transform, undefined, `${label}: rect ${index} must not be transformed`);
  });
}

test('logo.svg carries the approved B+ mark inside a 64x64 viewBox', () => {
  assert.match(logo, /viewBox="0 0 64 64"/);
  assert.match(logo, /<title>[^<]*Token Monitor Web[^<]*<\/title>/);
  assertGeometry(logo, 'logo.svg');
  // Transparent background: the mark rects are the only rect elements.
  assert.equal((logo.match(/<rect\b/g) || []).length, APPROVED.length);
  assert.doesNotMatch(logo, /<image\b/);
});

test('logo.svg inverts ink in dark mode via .ink while keeping the accent blue', () => {
  const dark = logo.match(/@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)\s*\{([\s\S]*?)\}\s*(?:<\/style>|$)/);
  assert.ok(dark, 'logo.svg needs a prefers-color-scheme: dark block');
  assert.match(dark[1], /\.ink\s*\{[^}]*fill\s*:\s*#eef0f3/i, 'dark block must whiten .ink');
  assert.doesNotMatch(dark[1], /#4d8ee6|\.accent/i, 'accent blue must not invert in dark mode');
  // The four dark bars opt into .ink, the final bar stays accent.
  const rects = rectsOf(logo);
  rects.slice(0, 4).forEach((rect, index) => {
    assert.match(rect.class || '', /\bink\b/, `logo.svg: rect ${index} must use .ink`);
  });
  assert.match(rects[4].class || '', /\baccent\b/, 'logo.svg: last rect must use .accent');
  assert.match(logo, /\.ink\s*\{[^}]*fill\s*:\s*#1c1f24/i, 'light .ink fill stays #1c1f24');
  assert.match(logo, /\.accent\s*\{[^}]*fill\s*:\s*#4d8ee6/i, '.accent stays #4d8ee6');
});

test('favicon.svg keeps a neutral rounded background with the same mark and never auto-inverts', () => {
  const rects = rectsOf(favicon);
  assert.equal(rects.length, APPROVED.length + 1, 'favicon.svg: background plus five mark rects');
  const [background, ...mark] = rects;
  assert.equal(background.width, '64');
  assert.equal(background.height, '64');
  assert.equal(background.rx, '12');
  assert.equal(background.fill, '#eef0f3');
  assert.equal(background.x, undefined);
  assert.equal(background.y, undefined);
  assert.equal(mark.length, APPROVED.length);
  mark.forEach((rect, index) => {
    const expected = APPROVED[index];
    for (const key of ['x', 'y', 'width', 'height', 'rx', 'fill']) {
      assert.equal(rect[key], String(expected[key]), `favicon.svg: rect ${index} ${key}`);
    }
  });
  assert.match(favicon, /viewBox="0 0 64 64"/);
  assert.doesNotMatch(favicon, /prefers-color-scheme/i, 'favicon must not invert in dark mode');
});

test('index.html references every branding asset with one shared cache token', () => {
  const refs = [
    /<link rel="icon" href="\.\/favicon\.ico\?v=bplus-20261102" sizes="any">/,
    /<link rel="icon" href="\.\/favicon\.svg\?v=bplus-20261102" type="image\/svg\+xml">/,
    /<link rel="apple-touch-icon" href="\.\/apple-touch-icon\.png\?v=bplus-20261102">/,
    /<link rel="manifest" href="\.\/site\.webmanifest\?v=bplus-20261102">/,
    /<img class="brand-logo" src="\.\/assets\/logo\.svg\?v=bplus-20261102" alt="">/,
  ];
  refs.forEach((pattern) => assert.match(html, pattern));
  const versions = new Set([...html.matchAll(/\?v=([\w.-]+)/g)].map((match) => match[1]));
  assert.deepEqual([...versions], [VERSION]);
  // Preserve the rest of the document byte-for-byte in shape: still CRLF everywhere.
  assert.equal((html.match(/\r\n/g) || []).length, (html.match(/\n/g) || []).length, 'index.html must stay CRLF-only');
});

test('page header pins the embedded logo to the light palette', () => {
  const rule = html.match(/\.brand-logo\s*\{([^}]*)\}/);
  assert.ok(rule, 'index.html needs its .brand-logo rule');
  assert.match(rule[1], /color-scheme\s*:\s*light/, '.brand-logo must force the light palette');
  // The page itself is light-only; the asset keeps its own dark inversion for dark READMEs.
  assert.doesNotMatch(html, /@media[^{]*prefers-color-scheme/i, 'index.html must not switch palettes');
  assert.match(logo, /@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)/);
});

test('site.webmanifest keeps its fields and versions all three PNG icons', () => {
  assert.deepEqual(Object.keys(manifest), [
    'name', 'short_name', 'description', 'start_url', 'scope', 'display',
    'background_color', 'theme_color', 'icons',
  ]);
  assert.equal(manifest.name, 'Token Monitor Web');
  assert.equal(manifest.short_name, 'Token Web');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.background_color, '#eef0f3');
  assert.equal(manifest.theme_color, '#eef0f3');
  const expected = [
    ['./icon-192.png', '192x192', 'any'],
    ['./icon-512.png', '512x512', 'any'],
    ['./icon-maskable-512.png', '512x512', 'maskable'],
  ];
  assert.equal(manifest.icons.length, expected.length);
  manifest.icons.forEach((icon, index) => {
    const [src, sizes, purpose] = expected[index];
    assert.equal(icon.src, `${src}?v=${VERSION}`);
    assert.equal(icon.sizes, sizes);
    assert.equal(icon.type, 'image/png');
    assert.equal(icon.purpose, purpose);
  });
  const versions = new Set([...manifestText.matchAll(/\?v=([\w.-]+)/g)].map((match) => match[1]));
  assert.deepEqual([...versions], [VERSION]);
});

test('both READMEs point their logo at the versioned asset and keep CRLF', () => {
  for (const name of readmes) {
    const text = readmeText[name];
    assert.match(text, /<img src="\.\/assets\/logo\.svg\?v=bplus-20261102" width="96" height="96"/, name);
    const versions = new Set([...text.matchAll(/\?v=([\w.-]+)/g)].map((match) => match[1]));
    assert.deepEqual([...versions], [VERSION], `${name}: single cache token`);
    assert.equal((text.match(/\r\n/g) || []).length, (text.match(/\n/g) || []).length, `${name} must stay CRLF-only`);
  }
});

test('every versioned reference resolves to a real file with matching icon dimensions', () => {
  const refs = [
    ...html.matchAll(/(?:href|src)="\.\/([^"?]+)\?v=bplus-20261102"/g),
    ...manifestText.matchAll(/"src":\s*"\.\/([^"?]+)\?v=bplus-20261102"/g),
    ...readmes.flatMap((name) => [...readmeText[name].matchAll(/src="\.\/([^"?]+)\?v=bplus-20261102"/g)]),
  ].map((match) => match[1]);
  assert.ok(refs.length >= 9, 'expected all branding refs to be versioned');
  refs.forEach((file) => assert.ok(existsSync(path.join(root, file)), `missing ${file}`));

  const pngSize = (file) => {
    const buffer = readFileSync(path.join(root, file));
    assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${file} must be a PNG`);
    return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
  };
  assert.deepEqual(pngSize('icon-192.png'), [192, 192]);
  assert.deepEqual(pngSize('icon-512.png'), [512, 512]);
  assert.deepEqual(pngSize('icon-maskable-512.png'), [512, 512]);
  assert.deepEqual(pngSize('apple-touch-icon.png'), [180, 180]);

  const ico = readFileSync(path.join(root, 'favicon.ico'));
  assert.equal(ico.readUInt16LE(0), 0, 'favicon.ico reserved field');
  assert.equal(ico.readUInt16LE(2), 1, 'favicon.ico type');
  const count = ico.readUInt16LE(4);
  const sizes = Array.from({ length: count }, (_, index) => ico[6 + index * 16]);
  for (const size of [16, 24, 32, 48]) assert.ok(sizes.includes(size), `favicon.ico missing ${size}px entry`);
});
