'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/01-core.js');
require('../src/05-text.js');
require('../src/06-permisos.js');
const api = require('../src/30-acuses.js');

const iso = d => d ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') : null;

test('semanaDe lee la semana ISO: 2026-W45 va del lunes 2026-11-02 al domingo 2026-11-08', function () {
  const s = api.semanaDe('2026-W45');
  assert.ok(s);
  assert.equal(iso(s.lunes), '2026-11-02');
  assert.equal(iso(s.domingo), '2026-11-08');
});

test('semanaDe acepta la semana 53 cuando el año la tiene y rechaza la que no existe', function () {
  const s53 = api.semanaDe('2026-W53');
  assert.ok(s53);
  assert.equal(iso(s53.lunes), '2026-12-28');
  assert.equal(iso(s53.domingo), '2027-01-03');
  assert.equal(api.semanaDe('2027-W53'), null);   // 2027 solo tiene 52 semanas ISO
  assert.equal(api.semanaDe('2026-W54'), null);
  assert.equal(api.semanaDe('2026-W00'), null);
});

test('dmy parsea dd/mm/aaaa', function () {
  assert.equal(iso(api.dmy('01/11/2026')), '2026-11-01');
  assert.equal(iso(api.dmy('2026-11-04T09:30:00')), '2026-11-04');
  assert.equal(api.dmy('32/13/2026'), null);
});

test('fechaOpDe usa la fecha de operación de la cadena, no la de registro', function () {
  const it = { fechaAcuse: '2026-11-04T09:00:00', tipoAcuse: 'Aceptar Registro de Venta' };
  const c = { o: { 'Fecha de la venta': '01/11/2026', 'Fecha de registro': '04/11/2026' } };
  const r = api.fechaOpDe(c, it);
  assert.equal(iso(r.d), '2026-11-01');
  assert.equal(r.fuente, 'Fecha de la venta');
  assert.equal(r.aprox, false);
});

test('fechaOpDe sin fecha de registro usa la fecha de operación de la cadena', function () {
  const it = { fechaAcuse: '2026-11-04', tipoAcuse: 'Aceptar Registro de Venta' };
  const r = api.fechaOpDe({ o: { 'Fecha de la venta': '30/10/2026' } }, it);
  assert.equal(iso(r.d), '2026-10-30');
  assert.equal(r.aprox, false);
});

test('fechaOpDe con tres fechas descarta la de registro y prefiere la del tipo de operación', function () {
  const it = { fechaAcuse: '2026-11-04', tipoAcuse: 'Aceptar Registro de Venta' };
  const c = { o: { 'Fecha de registro': '04/11/2026', 'Fecha de la compra': '02/11/2026', 'Fecha de la venta': '01/11/2026' } };
  const r = api.fechaOpDe(c, it);
  assert.equal(iso(r.d), '2026-11-01');
  assert.equal(r.fuente, 'Fecha de la venta');
  assert.equal(r.aprox, false);
});

test('fechaOpDe con solo la fecha de registro cae en la Fecha Acuse y la marca aproximada', function () {
  const it = { fechaAcuse: '2026-11-04', tipoAcuse: 'Aceptar Registro de Compra' };
  const r = api.fechaOpDe({ o: { 'Fecha de registro': '04/11/2026' } }, it);
  assert.equal(iso(r.d), '2026-11-04');
  assert.equal(r.fuente, 'Fecha Acuse');
  assert.equal(r.aprox, true);
});

test('labelDe muestra VTA-permiso-DDMMAAAA en una venta sin NOR', function () {
  const r = { nor: '', op: 'VENTA', perm: 'LP/20517/EXP/ES/2017', fOp: new Date(2026, 10, 1) };
  assert.equal(api.labelDe(r), 'VTA-LP/20517/EXP/ES/2017-01112026');
});

test('labelDe muestra el NOR en una compra y VTA cuando es venta aunque tenga NOR', function () {
  const compra = { nor: 'LP/20517/2026/00040', op: 'COMPRA', perm: 'LP/20517/EXP/ES/2017', fOp: new Date(2026, 10, 1) };
  const venta = { nor: 'LP/20517/2026/00041', op: 'VENTA', perm: 'LP/20517/EXP/ES/2017', fOp: new Date(2026, 10, 2) };
  assert.equal(api.labelDe(compra), 'LP/20517/2026/00040');
  assert.equal(api.labelDe(venta), 'VTA-LP/20517/EXP/ES/2017-02112026');
});

test('fechaOpDe en un tipo sin operación (precios) usa la Fecha Acuse, no una fecha de vigencia', function () {
  const it = { fechaAcuse: '2026-11-04', tipoAcuse: 'Precios' };
  const r = api.fechaOpDe({ o: { 'Fecha de publicación': '20/10/2026', 'Fecha de registro': '04/11/2026' } }, it);
  assert.equal(iso(r.d), '2026-11-04');
  assert.equal(r.aprox, false);
  assert.match(r.fuente, /sin operación/);
});

test('tipoOp distingue recepción, aceptación, despacho y traspaso', function () {
  assert.equal(api.tipoOp({ tipoAcuse: 'Recepción de compra' }), 'RECEPCION');
  assert.equal(api.tipoOp({ tipoAcuse: 'Aceptación de compra' }), 'ACEPTACION');
  assert.equal(api.tipoOp({ tipoAcuse: 'Despacho' }), 'DESPACHO');
  assert.equal(api.tipoOp({ tipoAcuse: 'Traspaso' }), 'TRASPASO');
});

test('fechaOpDe en recepción prefiere la fecha de recepción sobre la de compra', function () {
  const it = { fechaAcuse: '2026-11-06', tipoAcuse: 'Recepción de compra' };
  const r = api.fechaOpDe({ o: { 'Fecha de la compra': '01/11/2026', 'Fecha de recepción': '05/11/2026', 'Fecha de registro': '06/11/2026' } }, it);
  assert.equal(iso(r.d), '2026-11-05');
  assert.equal(r.fuente, 'Fecha de recepción');
});

test('labelDe de un tipo sin NOR usa su tipo, no VTA', function () {
  const r = { nor: '', op: 'PRECIO', perm: 'LP/14432/DIST/PLA/2016', fOp: new Date(2026, 10, 4) };
  assert.equal(api.labelDe(r), 'PRECIO-LP/14432/DIST/PLA/2016-04112026');
});

test('parseCadenaTexto lee una cadena de despacho aunque no traiga Folio ni Codigo', function () {
  const txt = 'Cadena Original |Permiso Comprador=LP/14432/DIST/PLA/2016|Permiso Suministrador=LP/16140/PLA/2019|Fecha Registro=2026-10-28 10:00:00|Fecha de Despacho=28/10/2026| Hash único para el acuse abc';
  const c = api.parseCadenaTexto(txt);
  assert.ok(c);
  assert.equal(c.o['Permiso Comprador'], 'LP/14432/DIST/PLA/2016');
  const r = api.fechaOpDe(c, { fechaAcuse: '2026-11-03', tipoAcuse: 'Generar registro de despacho' });
  assert.equal(iso(r.d), '2026-10-28');
  assert.equal(r.aprox, false);
});

test('parseCadenaTexto acepta Código acentuado y fechaOpDe usa la fecha de recepción', function () {
  const txt = 'Cadena Original |Código de Registro=LP/14432/2026/00123|Fecha Registro=2026-10-27 17:00:00|Fecha de Recepción=19/10/2026| Hash único para el acuse def';
  const c = api.parseCadenaTexto(txt);
  assert.ok(c);
  assert.equal(c.o['Fecha de Recepción'], '19/10/2026');
  const r = api.fechaOpDe(c, { fechaAcuse: '2026-10-27', tipoAcuse: 'Recepción de compra' });
  assert.equal(iso(r.d), '2026-10-19');
});

test('parseCadenaTexto lee la venta con Folio y fechaOpDe descarta la fecha de registro', function () {
  const txt = 'Cadena Original |Folio Acuse=4d46ddda-1111-2222-3333-444444444444|Fecha de la venta=27/10/2026|Fecha de registro=04/11/2026| Hash único para el acuse ghi';
  const c = api.parseCadenaTexto(txt);
  assert.ok(c);
  const r = api.fechaOpDe(c, { fechaAcuse: '2026-11-04', tipoAcuse: 'Agregar venta' });
  assert.equal(iso(r.d), '2026-10-27');
  assert.equal(r.aprox, false);
});

test('permisosDeTabla lee la tabla #example igual que el escáner de traspasos', function () {
  const th = t => ({ textContent: t });
  const td = t => ({ textContent: t });
  const row = (cells, href) => ({
    cells: cells.map(td),
    querySelector: sel => (href && sel.includes('idPermiso=')) ? { getAttribute: () => href } : null
  });
  const tabla = {
    querySelectorAll: sel => sel === 'thead th'
      ? ['', 'Permiso', 'Razón Social', 'Materia', 'Actividad'].map(th)
      : [row(['0', 'LP/14432/DIST/PLA/2016', 'GAS DE OJUELOS SA DE CV', 'LP', 'Distribución'], '?idPermiso=111'),
         row(['0', 'LP/16140/EXP/ES/2016', 'OTRA SA DE CV', 'LP', 'Expendio'], '?idPermiso=222')]
  };
  const doc = { querySelector: sel => sel === '#example' ? tabla : null };
  const ps = api.permisosDeTabla(doc);
  assert.equal(ps.length, 2);
  assert.deepEqual(ps[0], { id: '111', codigo: 'LP/14432/DIST/PLA/2016', razon: 'GAS DE OJUELOS SA DE CV', actividad: 'Distribución' });
  assert.equal(ps[1].id, '222');
});

test('cuentaDeTipos agrupa por tipo con los cinco rotulos de la portada', function () {
  const filas = [
    { sub: { texto: 'Venta' } },
    { sub: { texto: 'VENTA' } },
    { sub: { texto: 'Aceptar registro de recepción' } },
    { sub: { texto: 'Nuevo Registro de Compra' } },
    { sub: { texto: 'Otro tipo raro' } },
    { sub: null }
  ];
  const c = api.cuentaDeTipos(filas);
  assert.deepEqual(Object.keys(c), api.LISTA_PORTADA);
  assert.equal(c.VENTA, 2);
  assert.equal(c['NUEVO REGISTRO DE COMPRA'], 1);
  assert.equal(c['ACEPTAR REGISTRO DE COMPRA'], 0);
  assert.equal(c['ACEPTAR REGISTRO DE RECEPCION'], 1);
  assert.equal(c['CERRAR REGISTRO DE COMPRA'], 0);
});

test('cuentaDeTipos clasifica la forma real del listado (venta sin subtipo y siglas)', function () {
  const filas = [
    { it: { tipoAcuse: 'VENTA' }, sub: { texto: '', sigla: 'SIN_TIPO', clave: 'SIN_TIPO' } },
    { it: { tipoAcuse: 'VENTA' }, sub: { texto: '', sigla: 'SIN_TIPO', clave: 'SIN_TIPO' } },
    { it: { tipoAcuse: 'NUEVO REGISTRO DE COMPRA' }, sub: { texto: 'Nuevo registro de compra', sigla: 'NRC', clave: 'nuevo-compra' } },
    { it: { tipoAcuse: 'ACEPTAR REGISTRO DE COMPRA' }, sub: { texto: '', sigla: 'ARC', clave: 'aceptar-compra' } },
    { it: { tipoAcuse: 'ACEPTAR REGISTRO DE RECEPCION' }, sub: { texto: '', sigla: 'ARR', clave: 'aceptar-recepcion' } },
    { it: { tipoAcuse: 'CERRAR REGISTRO DE COMPRA' }, sub: { texto: '', sigla: 'CRC', clave: 'cerrar-compra' } }
  ];
  const c = api.cuentaDeTipos(filas);
  assert.equal(c.VENTA, 2);
  assert.equal(c['NUEVO REGISTRO DE COMPRA'], 1);
  assert.equal(c['ACEPTAR REGISTRO DE COMPRA'], 1);
  assert.equal(c['ACEPTAR REGISTRO DE RECEPCION'], 1);
  assert.equal(c['CERRAR REGISTRO DE COMPRA'], 1);
  assert.equal(Object.values(c).reduce((a, b) => a + b, 0), filas.length);
});

test('partesFecha acepta el Date del periodo y el texto DD/MM/AAAA', function () {
  assert.deepEqual(api.partesFecha(new Date(2026, 9, 12)), { d: 12, m: 10, a: 2026 });
  assert.deepEqual(api.partesFecha(new Date(2026, 9, 18)), { d: 18, m: 10, a: 2026 });
  assert.deepEqual(api.partesFecha('18/10/2026'), { d: 18, m: 10, a: 2026 });
  assert.deepEqual(api.partesFecha(null), { d: 0, m: 0, a: 0 });
});

test('nombreDeEstacion sale del mapeo LP y no de la razon social', function () {
  const ET = globalThis.EasyTrac;
  const antesStore = ET.store, antesTr = ET.traspasos;
  const LP = s => String(s == null ? '' : s).replace(/\s+/g, '').toUpperCase();
  ET.store = { get: (k, d) => (k === 'traspasos.plantillas'
    ? [{ nombre: 'OJUELOS-LAGOS', permiso: 'LP/17718/EXP/ES/2016' },
       { nombre: 'EL GALLO', permiso: 'LP/16385/EXP/ES/2016' }]
    : d) };
  ET.traspasos = { canonicalPermit: LP };
  try {
    assert.equal(api.nombreDeEstacion('LP/17718/EXP/ES/2016'), 'OJUELOS-LAGOS');
    assert.equal(api.nombreDeEstacion(' lp / 16385 / exp / es / 2016 '), 'EL GALLO');
    assert.equal(api.nombreDeEstacion('LP/14432/DIST/PLA/2016'), '');
    assert.equal(api.nombreDeEstacion(''), '');
  } finally {
    ET.store = antesStore;
    ET.traspasos = antesTr;
  }
});
