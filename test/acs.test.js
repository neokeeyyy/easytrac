'use strict';
/* Pruebas de la lÃ³gica pura de ACS (src/20-acs.js): filtros, cuerpos de peticiÃ³n y nombre del PDF. */
const { test } = require('bun:test');
const assert = require('node:assert/strict');

require('../src/01-core.js');
require('../src/02-store.js');
require('../src/03-http.js');
require('../src/04-dates.js');
require('../src/05-text.js');
require('../src/06-permisos.js');
/* Registro de ajustes de mentira: evita cargar el panel (DOM) y sus campos reales. */
const camposConfig = [];
globalThis.EasyTrac.config = { add: (c) => camposConfig.push(c), vehiculos: () => [] };
const acs = require('../src/20-acs.js');

const RANGO = {
  DESDE: '2026-08-10',
  HASTA: '2026-08-16',
  PERMISO_FILTRO: '',
  INCLUIR_NO_CERRADAS_FACT: false
};

function compra(extra) {
  return Object.assign({
    idEstatus: 0,
    fechaCompra: '12/08/2026',
    fechaDespacho: '12/08/2026',
    permiso_Vendedor: 'LP/1295/SAGARPA/2026'
  }, extra || {});
}

const campos = (body) => Object.fromEntries(new URLSearchParams(body));

test('enRango acepta los bordes del rango (mismo dÃ­a) y rechaza los dÃ­as vecinos', function () {
  assert.equal(acs.enRango('10/08/2026', RANGO), true);
  assert.equal(acs.enRango('16/08/2026', RANGO), true);
  assert.equal(acs.enRango('12/08/2026', RANGO), true);
  assert.equal(acs.enRango('09/08/2026', RANGO), false);
  assert.equal(acs.enRango('17/08/2026', RANGO), false);
});

test('enRango rechaza fechas vacÃ­as o ilegibles sin lanzar', function () {
  assert.equal(acs.enRango('', RANGO), false);
  assert.equal(acs.enRango(undefined, RANGO), false);
  assert.equal(acs.enRango('32/13/2026', RANGO), false);
});

test('filtro de solicitadas: estatus 0 dentro del rango', function () {
  assert.equal(acs.esCompraVisible(compra({ idEstatus: 0 }), 'solicitadas', RANGO), true);
  assert.equal(acs.esCompraVisible(compra({ idEstatus: 1 }), 'solicitadas', RANGO), false);
  assert.equal(acs.esCompraVisible(compra({ idEstatus: 0, fechaCompra: '17/08/2026' }), 'solicitadas', RANGO), false);
  assert.equal(acs.esCompraVisible(compra({ idEstatus: 0, fechaCompra: '09/08/2026' }), 'solicitadas', RANGO), false);
});

test('filtro de aceptadas: solo estatus 1 dentro del rango', function () {
  assert.equal(acs.esCompraVisible(compra({ idEstatus: 1 }), 'aceptadas', RANGO), true);
  assert.equal(acs.esCompraVisible(compra({ idEstatus: 0 }), 'aceptadas', RANGO), false);
  assert.equal(acs.esCompraVisible(compra({ idEstatus: 4 }), 'aceptadas', RANGO), false);
  assert.equal(acs.esCompraVisible(compra({ idEstatus: 1, fechaCompra: '' }), 'aceptadas', RANGO), false);
});

test('filtro en trÃ¡nsito: estatus 4 y fechaDespacho en rango', function () {
  assert.equal(acs.esCompraVisible(compra({ idEstatus: 4, fechaDespacho: '16/08/2026' }), 'enTransito', RANGO), true);
  assert.equal(acs.esCompraVisible(compra({ idEstatus: 4, fechaDespacho: '17/08/2026' }), 'enTransito', RANGO), false);
  assert.equal(acs.esCompraVisible(compra({ idEstatus: 4, fechaDespacho: '09/08/2026' }), 'enTransito', RANGO), false);
  assert.equal(acs.esCompraVisible(compra({ idEstatus: 1, fechaDespacho: '12/08/2026' }), 'enTransito', RANGO), false);
});

test('filtro de cerrables: aceptada sin fechaCierre y dentro del rango', function () {
  assert.equal(acs.esCompraVisible(compra({ idEstatus: 1 }), 'cerrables', RANGO), true);
  assert.equal(acs.esCompraVisible(compra({ idEstatus: 1, fechaCierre: '13/08/2026' }), 'cerrables', RANGO), false);
  assert.equal(acs.esCompraVisible(compra({ idEstatus: 0, estatus: 'Aceptada' }), 'cerrables', RANGO), true);
  assert.equal(acs.esCompraVisible(compra({ idEstatus: 0, estatus: 'Rechazada' }), 'cerrables', RANGO), false);
  assert.equal(acs.esCompraVisible(compra({ idEstatus: 1, fechaCompra: '17/08/2026' }), 'cerrables', RANGO), false);
});

test('filtro del listado: excluye en trÃ¡nsito (4) y rechazadas, conserva 0 y 2', function () {
  assert.equal(acs.esCompraVisible(compra({ idEstatus: 0 }), 'listado', RANGO), true);
  assert.equal(acs.esCompraVisible(compra({ idEstatus: 2 }), 'listado', RANGO), true);
  assert.equal(acs.esCompraVisible(compra({ idEstatus: 4 }), 'listado', RANGO), false);
  assert.equal(acs.esCompraVisible(compra({ idEstatus: 0, estatus: 'Rechazada' }), 'listado', RANGO), false);
  assert.equal(acs.esCompraVisible(compra({ idEstatus: 2, fechaCompra: '18/08/2026' }), 'listado', RANGO), false);
});

test('filtro de facturas: cerradas (2), con fechaCierre o incluyendo no cerradas', function () {
  assert.equal(acs.esCompraVisible(compra({ idEstatus: 2 }), 'facturas', RANGO), true);
  assert.equal(acs.esCompraVisible(compra({ idEstatus: 0, fechaCierre: '15/08/2026' }), 'facturas', RANGO), true);
  assert.equal(acs.esCompraVisible(compra({ idEstatus: 0, fechaCierre: '' }), 'facturas', RANGO), false);
  assert.equal(acs.esCompraVisible(compra({ idEstatus: 0 }), 'facturas', Object.assign({}, RANGO, { INCLUIR_NO_CERRADAS_FACT: true })), true);
  assert.equal(acs.esCompraVisible(compra({ idEstatus: 2, estatus: 'Rechazada' }), 'facturas', RANGO), false);
  assert.equal(acs.esCompraVisible(compra({ idEstatus: 2, fechaCompra: '01/08/2026' }), 'facturas', RANGO), false);
});

test('los filtros por permiso vendedor comparan sin espacios y respetan el vacÃ­o', function () {
  const cfg = Object.assign({}, RANGO, { PERMISO_FILTRO: 'LP/1295' });
  assert.equal(acs.pasaFiltroPermiso({ permiso_Vendedor: ' LP/1295 ' }, cfg), true);
  assert.equal(acs.pasaFiltroPermiso({ permiso_Vendedor: 'LP/5621' }, cfg), false);
  assert.equal(acs.pasaFiltroPermiso({}, cfg), false);
  assert.equal(acs.pasaFiltroPermiso({ permiso_Vendedor: 'LP/5621' }, RANGO), true);
  assert.equal(acs.esCompraVisible(compra({ idEstatus: 0, permiso_Vendedor: ' LP/1295 ' }), 'solicitadas', cfg), true);
  assert.equal(acs.esCompraVisible(compra({ idEstatus: 0, permiso_Vendedor: 'LP/5621' }), 'solicitadas', cfg), false);
});

test('un tipo de filtro desconocido o una compra nula no son visibles', function () {
  assert.equal(acs.esCompraVisible(compra(), 'otro', RANGO), false);
  assert.equal(acs.esCompraVisible(null, 'solicitadas', RANGO), false);
});

test('cuerpoAceptar codifica el cÃ³digo y conserva los campos', function () {
  const body = acs.cuerpoAceptar({ idCompra: 42, codigoRegistro: 'LP/1295/7/4334' });
  assert.deepEqual(campos(body), { idCompra: '42', CodigoRegistro: 'LP/1295/7/4334' });
});

test('cuerpoGuardarAceptar incluye comprador, vendedor y cadena vacÃ­a', function () {
  const body = acs.cuerpoGuardarAceptar({ idCompra: 42, codigoRegistro: 'LP/1295/7/4334' }, '11', '22');
  assert.deepEqual(campos(body), {
    idCompra: '42',
    CodigoRegistro: 'LP/1295/7/4334',
    idComprador: '11',
    idVendedor: '22',
    cadenaAcuse: ''
  });
});

test('cuerpoVerificaCompra codifica el cÃ³digo y fija proceso=2', function () {
  assert.deepEqual(campos(acs.cuerpoVerificaCompra('LP/1295/7/4334')), {
    prefixCodigoRegistro: 'LP/1295/7/4334',
    proceso: '2'
  });
});

test('cuerpoCerrarCompra soporta acentos y comillas en motivo y acuse', function () {
  const o = {
    contenidoAcuse: 'Estado=Cerrada|RazÃ³n Social Comprador=GAS "OJUELOS" & CÃ­a.|Observaciones=aÃ±adido',
    idCompra: '123',
    motivo: 'Cierre "urgente" por Ã±andÃº & 100%',
    codigo: 'LP/1295/7/4334',
    idComprador: '11',
    idVendedor: '22',
    volumenCierre: '350.5'
  };
  const body = acs.cuerpoCerrarCompra(o);
  assert.deepEqual(campos(body), {
    contenidoAcuse: o.contenidoAcuse,
    idCompra: '123',
    strMotivoCierre: o.motivo,
    CodigoRegistro: o.codigo,
    idComprador: '11',
    idVendedor: '22',
    volumenCierre: '350.5'
  });
  assert.equal(body.includes('"'), false);
  assert.equal(body.includes('\n'), false);
});

test('cuerpoCerrarCompra omite volumenCierre cuando viene vacÃ­o', function () {
  const body = acs.cuerpoCerrarCompra({
    contenidoAcuse: 'Estado=Cerrada|', idCompra: '1', motivo: 'motivo', codigo: 'LP/1/2/3',
    idComprador: '4', idVendedor: '5', volumenCierre: ''
  });
  assert.equal(Object.hasOwn(campos(body), 'volumenCierre'), false);
  assert.equal(campos(body).strMotivoCierre, 'motivo');
});

test('cuerpoDespacho conserva acuse con acentos, comillas y pipes', function () {
  const o = {
    fechaRegistro: '2026-08-12 09:30:00',
    idCompra: '77',
    cantidadDespachada: '350.5',
    idVehiculo: '9',
    placas: 'JU47194',
    codigoRegistro: 'LP/1295/7/4334',
    idComprador: '11',
    idVendedor: '22',
    acuse: '|RazÃ³n Social Comprador=GAS "OJUELOS, S.A." & CÃ­a|DirecciÃ³n=Km. 6+500'
  };
  const body = acs.cuerpoDespacho(o);
  assert.deepEqual(campos(body), {
    'de[fechaRegistro]': o.fechaRegistro,
    'de[FechaDespacho]': o.fechaRegistro,
    'de[idCompra]': '77',
    'de[CantidadDespachada]': '350.5',
    'de[IdVehiculo]': '9',
    'de[TransportePlaca]': 'JU47194',
    CodigoRegistro: o.codigoRegistro,
    idComprador: '11',
    idVendedor: '22',
    complementoAcuse: o.acuse,
    regCompraFlete: 'false'
  });
  assert.equal(body.includes('"'), false);
});

test('cuerpoRecepcion conserva acuse con acentos y comillas', function () {
  const o = {
    idEntrega: '55',
    fechaRegistro: '2026-08-12 10:00:00',
    volumen: '350.5',
    codigoRegistro: 'LP/1295/7/4334',
    idComprador: '11',
    idVendedor: '22',
    acuse: '|Permiso Comprador=LP/1295|RazÃ³n Social="GAS DE OJUELOS"|Placas=JU47194'
  };
  const body = acs.cuerpoRecepcion(o);
  assert.deepEqual(campos(body), {
    idBodega: '-1',
    idEntrega: '55',
    FechaRegistro: o.fechaRegistro,
    CostoFlete: '*',
    CantidadRecibida: '350.5',
    CodigoRegistro: o.codigoRegistro,
    idComprador: '11',
    idVendedor: '22',
    dataAcuse: o.acuse
  });
  assert.equal(body.includes('"'), false);
});

test('nombreArchivoTraspaso arma LP-permiso-nÃºmero.pdf', function () {
  assert.equal(acs.nombreArchivoTraspaso('LP/1295/DIST/ES/2026'), 'LP-1295-DIST-ES-2026.pdf');
  assert.equal(acs.nombreArchivoTraspaso('LP/5621/EXP/PLA/2025'), 'LP-5621-EXP-PLA-2025.pdf');
  assert.equal(acs.nombreArchivoTraspaso('LP/1295/7/4334'), 'LP-1295-7-4334.pdf');
});

test('nombreArchivoTraspaso cae al nombre genÃ©rico con cÃ³digos raros y nunca deja caracteres invÃ¡lidos', function () {
  const raros = ['', undefined, null, 'cÃ³digo raro "x"/y\n.pdf', 'sin formato', '<>|?*'];
  raros.forEach(function (codigo) {
    const nombre = acs.nombreArchivoTraspaso(codigo);
    assert.equal(nombre, 'formato_traspaso.pdf');
    assert.equal(/[\\/:*?"<>|\r\n]/.test(nombre), false);
  });
  const conSufijo = acs.nombreArchivoTraspaso('LP/1295/DIST/ES/2026?foo="bar"&x=1');
  assert.equal(conSufijo, 'LP-1295-DIST-ES-2026.pdf');
  assert.equal(/[\\/:*?"<>|\r\n]/.test(conSufijo), false);
});

test('elegirVehiculo usa el de la barra y cae al primero por defecto', () => {
  const lista = [
    { nombre: 'A002252', placas: 'JU47194', id: '' },
    { nombre: '', placas: 'MX12345', id: '77' },
  ];
  assert.deepEqual(acs.elegirVehiculo(lista, 'MX12345'), lista[1]);
  assert.deepEqual(acs.elegirVehiculo(lista, 'NO-EXISTE'), lista[0]);
  assert.deepEqual(acs.elegirVehiculo(lista, ''), lista[0]);
  assert.equal(acs.elegirVehiculo([], 'JU47194'), null);
});

test('clasificarFactura distingue pendiente, sin nodo y abierta', () => {
  const nodo = { idCompra: '1' };
  assert.equal(acs.clasificarFactura(compra({ idEstatus: 2 }), nodo), 'pendiente');
  assert.equal(acs.clasificarFactura(compra({ idEstatus: 2 }), null), 'sin-nodo');
  assert.equal(acs.clasificarFactura(compra({ idEstatus: 0, fechaCierre: '15/08/2026' }), null), 'sin-nodo');
  assert.equal(acs.clasificarFactura(compra({ idEstatus: 0, fechaCierre: '' }), nodo), 'abierta');
  assert.equal(acs.clasificarFactura(compra({ idEstatus: 1 }), null), 'abierta');
});

test('filaDestino mueve con flechas, Home y End sin salirse de la tabla', () => {
  assert.equal(acs.filaDestino(1, 4, 'ArrowDown'), 2);
  assert.equal(acs.filaDestino(3, 4, 'ArrowDown'), 3);
  assert.equal(acs.filaDestino(1, 4, 'ArrowUp'), 0);
  assert.equal(acs.filaDestino(0, 4, 'ArrowUp'), 0);
  assert.equal(acs.filaDestino(2, 4, 'Home'), 0);
  assert.equal(acs.filaDestino(0, 4, 'End'), 3);
  assert.equal(acs.filaDestino(-1, 4, 'ArrowDown'), -1);
  assert.equal(acs.filaDestino(0, 0, 'ArrowDown'), -1);
  assert.equal(acs.filaDestino(1, 4, 'Enter'), -1);
});

test('el formato de traspaso no imprime datos de otra empresa', function () {
  let textos = [];
  const doc = new Proxy({}, {
    get: function (_, k) {
      if (k === 'text') return function (t) { textos.push(Array.isArray(t) ? t.join('|') : String(t)); };
      return function () {};
    }
  });
  globalThis.jspdf = { jsPDF: function () { return doc; } };
  const compra = { volumen_Entregado: '1000', fechaCompra: '26/10/2026', permiso_Vendedor: 'LP/14432/DIST/PLA/2016' };

  acs.generarFormatoTraspaso(compra);
  assert.equal(textos.some(function (t) { return /OJUELOS|JALISCO/i.test(t); }), false, 'sin emisor configurado no se imprime una empresa fija');

  camposConfig.find((c) => c.clave === 'acs.emisor').guardar('EMPRESA DE PRUEBA');
  camposConfig.find((c) => c.clave === 'acs.emisor_dir').guardar('CALLE 1\nCOLONIA 2');
  textos = [];
  acs.generarFormatoTraspaso(compra);
  assert.ok(textos.some(function (t) { return t.indexOf('EMPRESA DE PRUEBA') >= 0; }), 'se imprime el emisor configurado');

  camposConfig.find((c) => c.clave === 'acs.emisor').guardar('');
  camposConfig.find((c) => c.clave === 'acs.emisor_dir').guardar('');
});

test('cerrarEntrega: un JSON con result=false deja ok=false y el HTML sigue siendo OK', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ status: 200, text: async () => '{"result":false}' });
    const fallido = await acs.cerrarEntrega({ idEntrega: 1, codigo: 'LP/1/2/3', idCompra: 9, base: '/GasLP/Recepcion/PaginaConfirmacion' });
    assert.equal(fallido.ok, false);

    globalThis.fetch = async () => ({ status: 200, text: async () => '<html>cierre correcto</html>' });
    const html = await acs.cerrarEntrega({ idEntrega: 1, codigo: 'LP/1/2/3', idCompra: 9, base: '/GasLP/Recepcion/PaginaConfirmacion' });
    assert.equal(html.ok, true);
  } finally {
    globalThis.fetch = original;
  }
});

test('subir omite una compra no cerrada', async () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><html><body><table id="acs-tabla"><tbody></tbody></table><p id="acs-status"></p></body></html>');
  const previo = globalThis.document;
  globalThis.document = dom.window.document;
  globalThis.EasyTrac.core.http.config.DELAY_MS = 1;
  const idx = acs.agregarFacturaCandidata(
    { idCompra: '9', idEstatus: 1, fechaCierre: '', codigoRegistro: 'LP/1/2/9' }, null, { idCompra: '9' });
  const chk = dom.window.document.querySelector('.acs-factura-check[data-idx="' + idx + '"]');
  chk.checked = true;

  await acs.subirFacturasSeleccionadas();
  assert.match(dom.window.document.getElementById('acs-status').textContent, /compra no cerrada/);

  globalThis.document = previo;
});

test('una fila con HTML de la API lo deja como texto', () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><html><body><table id="acs-tabla"><tbody></tbody></table></body></html>');
  const previo = globalThis.document;
  globalThis.document = dom.window.document;
  const malicioso = '<img src=x onerror=alert(1)>';
  const tr = acs.filaCompra({
    idEstatus: 0,
    codigoRegistro: malicioso,
    volumen_Solicitado: malicioso,
    volumen_Entregado: '1',
    fechaCompra: malicioso,
    permiso_Vendedor: malicioso
  }, 0, 'acs-cand-check', { motivo: true });

  assert.equal(tr.children[1].textContent, malicioso);
  assert.equal(dom.window.document.querySelectorAll('#acs-tabla tbody img').length, 0);
  assert.ok(tr.querySelector('.acs-motivo[data-idx="0"]'));
  assert.ok(tr.querySelector('.acs-motivo-msg'));

  globalThis.document = previo;
});

test('el PDF normaliza el volumen con comas y rechaza el vacio', function () {
  let textos = [];
  const doc = new Proxy({}, {
    get: function (_, k) {
      if (k === 'text') return function (t) { textos.push(Array.isArray(t) ? t.join('|') : String(t)); };
      return function () {};
    }
  });
  globalThis.jspdf = { jsPDF: function () { return doc; } };

  acs.generarFormatoTraspaso({ volumen_Entregado: '1,234.5', fechaCompra: '26/10/2026' });
  assert.ok(textos.some(function (t) { return t.indexOf('2,397') >= 0; }), '1234.5 kg son 2397 litros');

  textos = [];
  acs.generarFormatoTraspaso({ volumen_Entregado: ' 1,000 ', fechaCompra: '26/10/2026' });
  assert.ok(textos.some(function (t) { return t.indexOf('1,942') >= 0; }), '1000 kg son 1942 litros');

  assert.throws(function () { acs.generarFormatoTraspaso({ volumen_Entregado: '' }); }, /volumen de entrega vacío/);
});



