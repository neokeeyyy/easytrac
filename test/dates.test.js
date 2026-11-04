/* Semanas lunes-domingo: el rango por defecto de toda la app. */
const { test } = require('node:test');
const assert = require('node:assert');
require('../src/01-core.js');
const d = require('../src/04-dates.js');

test('lunesDe devuelve el lunes de la semana que contiene la fecha', () => {
  assert.equal(d.toISO(d.lunesDe('2026-11-04')), '2026-11-02'); // miércoles
  assert.equal(d.toISO(d.lunesDe('2026-11-02')), '2026-11-02'); // ya es lunes
  assert.equal(d.toISO(d.lunesDe('2026-11-08')), '2026-11-02'); // domingo
});

test('domingoDe cierra la semana el domingo', () => {
  assert.equal(d.toISO(d.domingoDe('2026-11-04')), '2026-11-08');
  assert.equal(d.toISO(d.domingoDe('2026-11-02')), '2026-11-08');
});

test('semanaDe devuelve el par lunes-domingo en ISO', () => {
  assert.deepEqual(d.semanaDe('2026-11-04'), { lunes: '2026-11-02', domingo: '2026-11-08' });
});

test('semanaAnterior es la semana completa anterior a hoy', () => {
  const { lunes, domingo } = d.semanaAnterior();
  const l = d.parseISO(lunes);
  const s = d.parseISO(domingo);
  assert.equal(l.getDay(), 1, 'empieza en lunes');
  assert.equal(s.getDay(), 0, 'acaba en domingo');
  assert.equal(Math.round((s - l) / 86400000), 6);
  const hoy = d.parseISO(d.toISO(new Date()));
  assert.ok(l < hoy && s < hoy, 'la semana ya cerró');
  assert.equal(d.toISO(l), lunes, 'ida y vuelta');
});
