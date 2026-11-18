/* SToolkit: «Forzar fecha» también quita min/max del campo y del datepicker. */
import { readFileSync } from 'node:fs';
import { test, expect } from 'bun:test';
import { JSDOM } from 'jsdom';

const CORE = readFileSync(new URL('../src/01-core.js', import.meta.url), 'utf8');
const FECHA = readFileSync(new URL('../src/50-fecha.js', import.meta.url), 'utf8');

function boot(iniciado) {
  const dom = new JSDOM(
    '<!doctype html><html><body><form id="f">' +
      '<input id="idFechaCompra" value="09/11/2026" min="2026-11-01" max="2026-11-30">' +
      '<input id="hdMsgErrorFecha">' +
      '</form></body></html>',
    { url: 'https://siretrac.cne.gob.mx/GasLP/Compras/RegistrarCompra', runScripts: 'outside-only', pretendToBeVisual: true }
  );
  const win = dom.window;
  win.eval(CORE);
  win.EasyTrac.ui = {
    tab: () => {
      const d = win.document.createElement('div');
      win.document.body.appendChild(d);
      return d;
    },
  };

  const campo = win.document.getElementById('idFechaCompra');
  const dp = { iniciado, minDate: new win.Date(2026, 10, 1), maxDate: new win.Date(2026, 10, 30) };

  function nodo(el) {
    return {
      length: 1,
      0: el,
      val(v) { if (v === undefined) return el.value; el.value = v; return this; },
      closest() { return nodo(win.document.getElementById('f')); },
      on(ev, fn) {
        String(ev).split(/\s+/).forEach((e) => el.addEventListener(e, fn));
        return this;
      },
      rules() { return { required: true }; },
      hasClass() { return dp.iniciado; },
      data() { return dp.iniciado ? { datepicker: true } : null; },
      datepicker(a, b) {
        if (a === 'option' && b === 'minDate') return dp.minDate;
        if (a === 'option' && b === 'maxDate') return dp.maxDate;
        if (a === 'option' && b && typeof b === 'object') {
          if ('minDate' in b) dp.minDate = b.minDate;
          if ('maxDate' in b) dp.maxDate = b.maxDate;
        }
        return this;
      },
    };
  }

  win.$ = win.jQuery = function (sel) {
    const el = typeof sel === 'string' ? win.document.querySelector(sel) : sel;
    if (!el) return { length: 0, val() { return ''; } };
    return nodo(el);
  };
  win.$.data = () => null;
  win.jQuery.validator = { methods: { ValidaFechaIngreso: () => false } };
  win.localStorage.setItem('stoolkit_activo', '0');
  win.eval(FECHA);
  return { win, campo, dp, sw: win.document.getElementById('stoolkit-sw') };
}

test('al activar quita min/max y los restaura al apagar', () => {
  const { win, campo, dp, sw } = boot(true);
  expect(campo.getAttribute('min')).toBe('2026-11-01');

  sw.checked = true;
  sw.dispatchEvent(new win.Event('change'));
  expect(campo.hasAttribute('min')).toBe(false);
  expect(campo.hasAttribute('max')).toBe(false);
  expect(dp.minDate).toBe(null);
  expect(dp.maxDate).toBe(null);
  expect(win.jQuery.validator.methods.ValidaFechaIngreso()).toBe(true);

  sw.checked = false;
  sw.dispatchEvent(new win.Event('change'));
  expect(campo.getAttribute('min')).toBe('2026-11-01');
  expect(campo.getAttribute('max')).toBe('2026-11-30');
  expect(dp.minDate instanceof win.Date).toBe(true);
  expect(dp.maxDate instanceof win.Date).toBe(true);
});

test('si el datepicker se inicializa después, el foco vuelve a soltar los límites', () => {
  const { win, campo, dp, sw } = boot(false);
  sw.checked = true;
  sw.dispatchEvent(new win.Event('change'));
  expect(dp.minDate instanceof win.Date).toBe(true); // aún no existía: no se tocó

  dp.iniciado = true;
  campo.dispatchEvent(new win.Event('focus'));
  expect(dp.minDate).toBe(null);
  expect(dp.maxDate).toBe(null);
});
