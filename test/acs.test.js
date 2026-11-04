'use strict';
/* Pruebas de la lógica pura de ACS (src/20-acs.js): filtros, cuerpos de petición y nombre del PDF. */
const { test } = require('bun:test');
const assert = require('node:assert/strict');

require('../src/01-core.js');
require('../src/02-store.js');
require('../src/03-http.js');
require('../src/04-dates.js');
require('../src/05-text.js');
require('../src/06-permisos.js');
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

test('enRango acepta los bordes del rango (mismo día) y rechaza los días vecinos', function () {
  assert.equal(acs.enRango('10/08/2026', RANGO), true);
  assert.equal(acs.enRango('16/08/2026', RANGO), true);
  assert.equal(acs.enRango('12/08/2026', RANGO), true);
  assert.equal(acs.enRango('09/08/2026', RANGO), false);
  assert.equal(acs.enRango('17/08/2026', RANGO), false);
});

test('enRango rechaza fechas vacías o ilegibles sin lanzar', function () {
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

test('filtro en tránsito: estatus 4 y fechaDespacho en rango', function () {
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

test('filtro del listado: excluye en tránsito (4) y rechazadas, conserva 0 y 2', function () {
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

test('los filtros por permiso vendedor comparan sin espacios y respetan el vacío', function () {
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

test('cuerpoAceptar codifica el código y conserva los campos', function () {
  const body = acs.cuerpoAceptar({ idCompra: 42, codigoRegistro: 'LP/1295/7/4334' });
  assert.deepEqual(campos(body), { idCompra: '42', CodigoRegistro: 'LP/1295/7/4334' });
});

test('cuerpoGuardarAceptar incluye comprador, vendedor y cadena vacía', function () {
  const body = acs.cuerpoGuardarAceptar({ idCompra: 42, codigoRegistro: 'LP/1295/7/4334' }, '11', '22');
  assert.deepEqual(campos(body), {
    idCompra: '42',
    CodigoRegistro: 'LP/1295/7/4334',
    idComprador: '11',
    idVendedor: '22',
    cadenaAcuse: ''
  });
});

test('cuerpoVerificaCompra codifica el código y fija proceso=2', function () {
  assert.deepEqual(campos(acs.cuerpoVerificaCompra('LP/1295/7/4334')), {
    prefixCodigoRegistro: 'LP/1295/7/4334',
    proceso: '2'
  });
});

test('cuerpoCerrarCompra soporta acentos y comillas en motivo y acuse', function () {
  const o = {
    contenidoAcuse: 'Estado=Cerrada|Razón Social Comprador=GAS "OJUELOS" & Cía.|Observaciones=añadido',
    idCompra: '123',
    motivo: 'Cierre "urgente" por ñandú & 100%',
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

test('cuerpoCerrarCompra omite volumenCierre cuando viene vacío', function () {
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
    acuse: '|Razón Social Comprador=GAS "OJUELOS, S.A." & Cía|Dirección=Km. 6+500'
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
    acuse: '|Permiso Comprador=LP/1295|Razón Social="GAS DE OJUELOS"|Placas=JU47194'
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

test('nombreArchivoTraspaso arma LP-permiso-número.pdf', function () {
  assert.equal(acs.nombreArchivoTraspaso('LP/1295/DIST/ES/2026'), 'LP-1295-DIST-ES-2026.pdf');
  assert.equal(acs.nombreArchivoTraspaso('LP/5621/EXP/PLA/2025'), 'LP-5621-EXP-PLA-2025.pdf');
  assert.equal(acs.nombreArchivoTraspaso('LP/1295/7/4334'), 'LP-1295-7-4334.pdf');
});

test('nombreArchivoTraspaso cae al nombre genérico con códigos raros y nunca deja caracteres inválidos', function () {
  const raros = ['', undefined, null, 'código raro "x"/y\n.pdf', 'sin formato', '<>|?*'];
  raros.forEach(function (codigo) {
    const nombre = acs.nombreArchivoTraspaso(codigo);
    assert.equal(nombre, 'formato_traspaso.pdf');
    assert.equal(/[\\/:*?"<>|\r\n]/.test(nombre), false);
  });
  const conSufijo = acs.nombreArchivoTraspaso('LP/1295/DIST/ES/2026?foo="bar"&x=1');
  assert.equal(conSufijo, 'LP-1295-DIST-ES-2026.pdf');
  assert.equal(/[\\/:*?"<>|\r\n]/.test(conSufijo), false);
});
