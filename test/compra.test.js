const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDatos, numeroDe, agregarRegistro, pasoDe } = require('../src/65-compra.js');

test('parseDatos lee las variables inline del formulario', () => {
  const html = '<script>var idVendedor = 123; var idComprador = "456"; let NombreComprador = \'GAS DE OJUELOS SA DE CV\';</script>';
  assert.deepEqual(parseDatos(html), {
    idVendedor: '123',
    idComprador: '456',
    nombreComprador: 'GAS DE OJUELOS SA DE CV'
  });
  assert.deepEqual(parseDatos('<p>hola</p>'), { idVendedor: '', idComprador: '', nombreComprador: '' });
});

test('numeroDe lee la confirmación y el respaldo de la URL', () => {
  assert.equal(numeroDe('Número de registro de compra: LP/14432/2026/1', ''), 'LP/14432/2026/1');
  assert.equal(numeroDe('Numero de registro de compra LP/14432/2026/2', ''), 'LP/14432/2026/2');
  assert.equal(numeroDe('', '/GasLP/Compras/PaginaConfirmacion?codigo=LP%2F14432%2F2026%2F3'), 'LP/14432/2026/3');
  assert.equal(numeroDe('nada', '/GasLP/Compras/Index'), '');
});

test('agregarRegistro deduplica por número y deja al frente el más reciente', () => {
  const a = { n: 'LP/1/2026/1', f: '2026-11-08', h: '10:00' };
  const b = { n: 'LP/1/2026/2', f: '2026-11-09', h: '11:00' };
  assert.deepEqual(agregarRegistro([], a), [a]);
  assert.deepEqual(agregarRegistro([a, b], a), [a, b]);
  assert.deepEqual(agregarRegistro([b, a], a), [a, b]);
  assert.deepEqual(agregarRegistro([a], { n: '', f: 'x' }), [a]);
});

test('agregarRegistro recorta a 50 registros', () => {
  let lista = [];
  for (let i = 0; i < 55; i++) lista = agregarRegistro(lista, { n: 'LP/1/2026/' + i });
  assert.equal(lista.length, 50);
  assert.equal(lista[0].n, 'LP/1/2026/54');
});

test('pasoDe reconoce cada pantalla del flujo', () => {
  assert.equal(pasoDe('https://siretrac.cne.gob.mx/GasLP/Compras/NuevoRegistro_SeleccionaTipoSuministrador'), 'tipo');
  assert.equal(pasoDe('/GasLP/Compras/NuevoRegistro_SeleccionaSuministrador'), 'suministrador');
  assert.equal(pasoDe('/GasLP/Compras/NuevoRegistro_IngresaDatos'), 'datos');
  assert.equal(pasoDe('/GasLP/Compras/PaginaConfirmacion?x=1'), 'confirmacion');
  assert.equal(pasoDe('/GasLP/Compras/Index'), '');
});
