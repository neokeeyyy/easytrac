/* Boot smoke test: loads every module in a real DOM (jsdom) and checks the shared sidebar. */
import { readFileSync } from 'node:fs';
import { test, expect } from 'bun:test';
import { JSDOM } from 'jsdom';

const MODULES = [
  '01-core.js', '02-store.js', '03-http.js', '04-dates.js', '05-text.js', '06-permisos.js',
  '10-ui-tokens.js', '11-ui-sidebar.js', '12-ui-notice.js', '13-ui-grid.js', '20-acs.js', '30-acuses.js',
  '40-venta.js', '50-fecha.js', '70-traspasos.js',
];

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const BUNDLE = MODULES.map((m) => readFileSync(new URL('../src/' + m, import.meta.url), 'utf8'))
  .join('\n;\n')
  .replace("ET.version = '0.0.0-dev';", "ET.version = '" + VERSION + "';");

async function boot(url, body, code) {
  const dom = new JSDOM('<!doctype html><html><head></head><body>' + (body || '') + '</body></html>', {
    url,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  dom.window.eval(code || BUNDLE);
  /* jsdom fires DOMContentLoaded/load asynchronously; the modules boot there. */
  if (dom.window.document.readyState !== 'complete') {
    await new Promise((res) => dom.window.addEventListener('load', res, { once: true }));
  }
  return dom.window;
}

const tabs = (win) => Array.from(win.document.querySelectorAll('.shub-tab')).map((b) => b.getAttribute('data-id'));

test('boots on a GasLP page with the shared sidebar', async () => {
  const win = await boot('https://siretrac.cne.gob.mx/GasLP/Compras/ListaRegistros');
  expect(win.EasyTrac).toBeTruthy();
  expect(win.EasyTrac.version).toBe(VERSION);
  const ids = tabs(win);
  expect(ids).toContain('acs');
  expect(ids).toContain('acuses');
  /* order follows src order, ACS first */
  expect(ids.indexOf('acs')).toBeLessThan(ids.indexOf('acuses'));
  expect(win.document.querySelectorAll('#shub-root').length).toBe(1);
});

test('ACS arranca sin vehiculo, placas ni fechas de otra empresa', async () => {
  const win = await boot('https://siretrac.cne.gob.mx/GasLP/Compras/ListaRegistros');
  const doc = win.document;
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

  expect(doc.querySelector('#acs-vehiculo').value).toBe('');
  expect(doc.querySelector('#acs-placas').value).toBe('');
  expect(doc.querySelector('#acs-hasta').value).toBe(iso(new Date()));
  expect(doc.querySelector('#acs-desde').value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test('acuses stays out of pages it cannot work on', async () => {
  const win = await boot('https://siretrac.cne.gob.mx/Cuenta/Login');
  const ids = tabs(win);
  expect(ids).toContain('acs');
  expect(ids).not.toContain('acuses');
});

test('acuses monta el panel de vista previa oculto', async () => {
  const win = await boot('https://siretrac.cne.gob.mx/GasLP/Compras/ListaRegistros');
  const prev = win.document.querySelector('#sa-prev');
  expect(prev).toBeTruthy();
  expect(prev.getAttribute('role')).toBe('dialog');
  expect(prev.className).toBe('');
  expect(prev.querySelector('#sa-prev-body')).toBeTruthy();
  const css = win.document.getElementById('sa-css').textContent;
  expect(css).toContain('sa-prev-in');
  expect(css).toContain('cubic-bezier(.34,1.56,.64,1)');
});

test('the traspasos matrix is a cell grid mounted in its tab', async () => {
  const win = await boot('https://siretrac.cne.gob.mx/GasLP/Compras/ListaRegistros');
  const host = win.document.querySelector('#siretrac-traspasos-host');
  expect(host).toBeTruthy();
  expect(host.closest('.shub-pane')).toBeTruthy();
  const matrix = host.shadowRoot.querySelector('[data-role="matrix"]');
  expect(matrix).toBeTruthy();
  expect(matrix.getAttribute('data-et-mount')).toBe('1');
  expect(matrix.tagName).toBe('DIV');
});

test('analizar matriz lee el grid y pinta el preview', async () => {
  const win = await boot('https://siretrac.cne.gob.mx/GasLP/Compras/ListaRegistros');
  const sr = win.document.querySelector('#siretrac-traspasos-host').shadowRoot;
  win.EasyTrac.grid.pegar(sr.querySelector('[data-role="matrix"]'), 'TRASPASOS (KILOS)\t26/10/2026\t27/10/2026\nOjuelos-Lagos\t3529\t1556\nMatancillas\t1652\t');
  sr.querySelector('[data-action="analyze"]').click();
  const preview = sr.querySelector('[data-role="preview"]');
  expect(preview.textContent.trim().length).toBeGreaterThan(0);
});

test('a pasted matrix becomes a grid and serializes back', async () => {
  const win = await boot('https://siretrac.cne.gob.mx/GasLP/Compras/ListaRegistros');
  const matrix = win.document.querySelector('#siretrac-traspasos-host').shadowRoot.querySelector('[data-role="matrix"]');
  win.EasyTrac.grid.pegar(matrix, 'TRASPASOS (KILOS)\t26/10/2026\nOjuelos-Lagos\t3529');
  const celdas = matrix.querySelectorAll('td');
  expect(celdas.length).toBe(2);
  expect(win.EasyTrac.grid.serializar(matrix)).toBe('TRASPASOS (KILOS)\t26/10/2026\nOjuelos-Lagos\t3529');
});

test('el standalone instalable arranca igual que los módulos', async () => {
  const raw = readFileSync(new URL('../dist/EasyTrac.standalone.user.js', import.meta.url), 'utf8');
  const code = raw.slice(raw.indexOf('// ==/UserScript==') + 18);
  const win = await boot('https://siretrac.cne.gob.mx/GasLP/Compras/ListaRegistros', '', code);
  expect(win.document.querySelectorAll('#shub-root').length).toBe(1);
  const ids = tabs(win);
  expect(ids).toContain('acs');
  expect(ids).toContain('traspasos');
});

test('el loader apunta a un módulo por archivo y no pide grants', () => {
  const head = readFileSync(new URL('../EasyTrac.user.js', import.meta.url), 'utf8');
  const requires = head.split('\n').filter((l) => l.startsWith('// @require'));
  expect(requires.length).toBe(18); /* 3 librerías + 15 módulos */
  expect(requires.filter((l) => l.includes('/src/')).length).toBe(15);
  expect(head).toContain('// @grant        none');
  expect(head).toContain('@match        https://siretrac.cne.gob.mx/*');
  /* Sin esto la copia modular reporta 0.0.0-dev y el aviso de versión miente. */
  expect(head).toContain("EasyTrac.version = '" + VERSION + "'");
});
