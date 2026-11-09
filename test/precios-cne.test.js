const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../src/60-precios-cne.js');
const { norm, estadoKey, muniKey, clave, num, parseCneItems, mapaCne, precioDe, fechaPdf } = api;

const item = (str, x, y) => ({ str, transform: [1, 0, 0, 1, x, y] });

// Fila real del PDF: Región | Entidad | Municipio | $kg | $litro
const FILA = (y, region, estado, muni, kg, litro) => [
  item(region, 65.8, y),
  item(estado, 142.3, y),
  item(muni, 304.0, y),
  item(kg, 449.4, y),
  item(litro, 522.8, y)
];

test('parseCneItems agrupa por fila y reparte por columnas', () => {
  const f = parseCneItems(FILA(636.6, '1', 'AGUASCALIENTES', 'AGUASCALIENTES', '$21.54', '$11.63'));
  assert.equal(f.length, 1);
  assert.deepEqual(f[0], { region: 1, estado: 'AGUASCALIENTES', municipio: 'AGUASCALIENTES', kg: 21.54, litro: 11.63 });
});

test('parseCneItems separa filas por banda y descarta encabezados', () => {
  const items = [
    ...FILA(636.6, '1', 'AGUASCALIENTES', 'AGUASCALIENTES', '$21.54', '$11.63'),
    ...FILA(621.6, '1', 'AGUASCALIENTES', 'EL LLANO', '$21.54', '$11.63'),
    item('Región', 65.8, 651.0),
    item('Entidad Federativa', 142.3, 651.0),
    item('Municipio', 304.0, 651.0),
    item('Precio por kilogramo con IVA', 449.4, 651.0),
    item('Precio por litro con IVA', 522.8, 651.0)
  ];
  const f = parseCneItems(items);
  assert.equal(f.length, 2);
  assert.deepEqual(f.map(x => x.municipio), ['AGUASCALIENTES', 'EL LLANO']);
});

test('parseCneItems descarta filas sin precios completos', () => {
  const items = [
    item('2', 65.8, 636.6),
    item('ZACATECAS', 142.3, 636.6),
    item('APOZOL', 304.0, 636.6),
    item('$21.93', 449.4, 636.6)
  ];
  assert.equal(parseCneItems(items).length, 0);
});

test('estadoKey normaliza alias del PDF', () => {
  assert.equal(estadoKey('ESTADO DE MÉXICO'), 'MEXICO');
  assert.equal(estadoKey('DISTRITO FEDERAL'), 'CIUDAD DE MEXICO');
  assert.equal(estadoKey('COAHUILA DE ZARAGOZA'), 'COAHUILA');
  assert.equal(estadoKey('VERACRUZ DE IGNACIO DE LA LLAVE'), 'VERACRUZ');
  assert.equal(estadoKey('SAN LUIS POTOSÍ'), 'SAN LUIS POTOSI');
});

test('muniKey quita el paréntesis final', () => {
  assert.equal(muniKey('OJUÉLOS DE JALISCO (ALGUNA)'), 'OJUELOS DE JALISCO');
  assert.equal(muniKey('MEXICALI'), 'MEXICALI');
});

test('num limpia moneda y miles', () => {
  assert.equal(num('$21.54'), 21.54);
  assert.equal(num('1,234.5'), 1234.5);
  assert.equal(num('abc'), null);
});

test('precioDe busca exacto y con paréntesis', () => {
  const m = mapaCne([{ region: 1, estado: 'AGUASCALIENTES', municipio: 'AGUASCALIENTES', kg: 21.54, litro: 11.63 }]);
  assert.equal(precioDe(m, 'Estado de Aguascalientes', 'Aguascalientes').kg, 21.54);
  assert.equal(precioDe(m, 'AGUASCALIENTES', 'Aguascalientes (Centro)').litro, 11.63);
  assert.equal(precioDe(m, 'JALISCO', 'OJUELOS'), null);
});

test('clave une estado y municipio normalizados', () => {
  assert.equal(clave('Estado de México', 'Toluca de Lerdo (Centro)'), 'MEXICO|TOLUCA DE LERDO');
});

test('fechaPdf lee el rango del PDF', () => {
  const f = fechaPdf(
    'PRECIOS_MAXIMOS_VIGENTES_DEL_8_AL_14_DE_NOVIEMBRE_DE_2026.PDF',
    'Precios Máximos Vigentes del 08 al 14 de noviembre de 2026'
  );
  assert.equal(f.getFullYear(), 2026);
  assert.equal(f.getMonth(), 10);
  assert.equal(f.getDate(), 8);
  assert.equal(fechaPdf('', ''), null);
});
