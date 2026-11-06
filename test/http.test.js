/* Cortacircuitos: varios 500 seguidos cortan la API y avisan en pantalla. */
import { readFileSync } from 'node:fs';
import { test, expect } from 'bun:test';
import { JSDOM } from 'jsdom';

const CODE = ['01-core.js', '02-store.js', '03-http.js']
  .map((m) => readFileSync(new URL('../src/' + m, import.meta.url), 'utf8'))
  .join('\n;\n');

function boot(respuestas) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://siretrac.cne.gob.mx/GasLP/Compras/ListaRegistros',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const cola = respuestas.slice();
  let llamadas = 0;
  dom.window.fetch = async function () {
    llamadas += 1;
    const r = cola.length ? cola.shift() : { status: 200, body: '{"data":[]}' };
    return { status: r.status, text: async () => r.body };
  };
  dom.window.eval(CODE);
  const http = dom.window.EasyTrac.core.http;
  http.config = { DATA_RETRIES: 1, DATA_RETRY_BASE_MS: 1 };
  return { win: dom.window, http, llamadas: () => llamadas };
}

test('tres 500 seguidos cortan la API, rechazan y pintan el aviso', async () => {
  const { win, http, llamadas } = boot([
    { status: 500, body: '{"data":[]}' },
    { status: 500, body: '{"data":[]}' },
    { status: 500, body: '{"data":[]}' },
  ]);
  for (let i = 0; i < 3; i += 1) await http.apiPostDatos('/x', '');

  expect(http.caida()).toBe(true);
  expect(win.document.getElementById('easytrac-caida')).toBeTruthy();
  expect(win.document.querySelector('[role="alertdialog"]')).toBeTruthy();

  const antes = llamadas();
  await expect(http.apiPostDatos('/x', '')).rejects.toThrow(/no responde/);
  expect(llamadas()).toBe(antes); // ya no sale ninguna petición
});

test('un 200 en medio reinicia la cuenta de 500', async () => {
  const { http } = boot([
    { status: 500, body: '{}' },
    { status: 500, body: '{}' },
    { status: 200, body: '{"data":[]}' },
    { status: 500, body: '{}' },
    { status: 500, body: '{}' },
  ]);
  await http.apiPostDatos('/x', '');
  await http.apiPostDatos('/x', '');
  await http.apiPostDatos('/x', '');
  await http.apiPostDatos('/x', '');
  await http.apiPostDatos('/x', '');
  expect(http.caida()).toBe(false);
});

test('datosDe rechaza un 500 en vez de devolver una lista vacía', async () => {
  const { http } = boot([{ status: 500, body: '{"data":[]}' }]);
  await expect(http.datosDe('/x')).rejects.toThrow(/HTTP 500|no responde/);
});
