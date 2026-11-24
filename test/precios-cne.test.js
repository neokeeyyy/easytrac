const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const api = require('../src/60-precios-cne.js');
const { norm, estadoKey, muniKey, clave, num, parseCneItems, mapaCne, precioDe, fechaPdf, llenarTabla, planPermiso } = api;

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

test('fechaPdf lee la fecha del nombre del archivo', () => {
  const f = fechaPdf(
    'https://www.gob.mx/cms/uploads/attachment/file/1117388/PRECIOS_MAXIMOS_VIGENTES_DEL_22_al_28_de_noviembre_DE_2026.pdf',
    'Descargar documento'
  );
  assert.equal(f.getFullYear(), 2026);
  assert.equal(f.getMonth(), 10);
  assert.equal(f.getDate(), 22);
});

test('llenarTabla llena las filas visibles y respeta capturados', () => {
  const dom = new JSDOM(`<table>
    <thead><tr><th>Estado</th><th>Municipio</th><th>Localidad</th><th>Precio</th><th>Fecha</th><th>Hora</th></tr></thead>
    <tbody>
      <tr><td>Jalisco</td><td>Ojuelos de Jalisco</td><td>Centro</td><td><input id="PrecioNuevo-1"></td><td><input id="FechaNueva-1"></td><td><input id="HoraNueva-1"></td></tr>
      <tr><td>Jalisco</td><td>Ojuelos de Jalisco</td><td>La Paz</td><td><input id="PrecioNuevo-2"></td><td><input id="FechaNueva-2"></td><td><input id="HoraNueva-2"></td></tr>
      <tr><td>Jalisco</td><td>Ojuelos de Jalisco</td><td>Otro</td><td><input id="PrecioNuevo-3" value="12.00"></td><td><input id="FechaNueva-3"></td><td><input id="HoraNueva-3"></td></tr>
      <tr><td>Jalisco</td><td>Desconocido</td><td>X</td><td><input id="PrecioNuevo-4"></td></tr>
      <tr><td>Jalisco</td><td>Ojuelos de Jalisco</td><td>Sin campo</td><td>n/a</td></tr>
    </tbody>
  </table>`);
  const win = dom.window;
  const Evento = global.Event;
  global.Event = win.Event;
  try {
    const tabla = win.document.querySelector('table');
    const mapa = new Map([[clave('Jalisco', 'Ojuelos de Jalisco'), { kg: 21.84, litro: 11.79 }]]);
    const cuenta = llenarTabla(tabla, { estado: 0, muni: 1, loc: 2 }, mapa, 'litro', '23/11/2026', '14:10', true);

    assert.equal(cuenta.ok, 2);
    assert.equal(cuenta.sin, 1);
    assert.equal(cuenta.sinCampo, 1);
    assert.deepEqual([...cuenta.faltan], ['Jalisco / Desconocido']);
    assert.equal(win.document.querySelector('#PrecioNuevo-1').value, '11.79');
    assert.equal(win.document.querySelector('#PrecioNuevo-2').value, '11.79');
    assert.equal(win.document.querySelector('#PrecioNuevo-3').value, '12.00');
    assert.equal(win.document.querySelector('#FechaNueva-1').value, '23/11/2026');
    assert.equal(win.document.querySelector('#HoraNueva-2').value, '14:10');
    assert.equal(win.document.querySelector('#PrecioNuevo-4').value, '');
  } finally {
    global.Event = Evento;
  }
});

test('llenarTabla sobrescribe el vigente prefijado y respeta el capturado a mano', () => {
  const dom = new JSDOM(`<table><tbody>
    <tr><td class="id-bodega">Jalisco</td><td class="capacidad-recipiente">Ojuelos de Jalisco</td><td class="cantidad-recipiente">Centro</td><td class="cantidad-vendida">11.79</td>
      <td><input type="hidden" id="hdPrecioNuevo-1" value=""><input id="PrecioNuevo-1" name="PrecioNuevo-1" value="11.79"></td><td><input id="FechaNueva-1" value="09/11/2026"></td><td><input id="HoraNueva-1" value="15:20"></td></tr>
    <tr><td class="id-bodega">Jalisco</td><td class="capacidad-recipiente">Ojuelos de Jalisco</td><td class="cantidad-recipiente">La Paz</td><td class="cantidad-vendida">11.79</td>
      <td><input type="hidden" id="hdPrecioNuevo-2" value=""><input id="PrecioNuevo-2" name="PrecioNuevo-2" value="11.50"></td><td><input id="FechaNueva-2" value="09/11/2026"></td><td><input id="HoraNueva-2" value="15:20"></td></tr>
  </tbody></table>`);
  const win = dom.window;
  const Evento = global.Event;
  global.Event = win.Event;
  try {
    const tabla = win.document.querySelector('table');
    const mapa = new Map([[clave('Jalisco', 'Ojuelos de Jalisco'), { kg: 21.84, litro: 12.34 }]]);
    const cuenta = llenarTabla(tabla, { estado: -1, muni: -1, loc: -1 }, mapa, 'litro', '23/11/2026', '14:10', true);

    assert.equal(cuenta.ok, 1);
    assert.equal(win.document.querySelector('#PrecioNuevo-1').value, '12.34');
    assert.equal(win.document.querySelector('#hdPrecioNuevo-1').value, '');
    assert.equal(win.document.querySelector('#FechaNueva-1').value, '23/11/2026');
    assert.equal(win.document.querySelector('#HoraNueva-1').value, '14:10');
    assert.equal(win.document.querySelector('#PrecioNuevo-2').value, '11.50');
    assert.equal(win.document.querySelector('#FechaNueva-2').value, '09/11/2026');
  } finally {
    global.Event = Evento;
  }
});

test('planPermiso arma items de auto-tanque y recipiente con precio CNE', () => {
  const mapa = new Map([[clave('Jalisco', 'Ojuelos de Jalisco'), { kg: 21.84, litro: 11.79 }]]);
  const fmt = { aplicaTxt: '09/11/2026', aplicaUS: '2026-11-09', hora: '14:10', registro: '2026-11-09 13:00:00' };
  const permiso = { id: 10, nombre: 'LP/1/DIST/PLA/2016' };
  const j = {
    listaPreciosVigentesAutoTanque: [{
      idPrecio: 100, idPermiso: 0, estado: 'Jalisco', municipio: 'Ojuelos de Jalisco',
      localidad: 'Ojuelos de Jalisco', idEstado: 14, idMunicipio: 62, idLocalidad: 1,
      precio: '11.09', precioNuevo: ''
    }],
    listaPreciosVigentesRecipiente: [{
      idPrecio: 101, idPermiso: 10, estado: 'Jalisco', municipio: 'Ojuelos de Jalisco',
      localidad: 'Ojuelos de Jalisco', idEstado: 14, idMunicipio: 62, idLocalidad: 1,
      capacidadKg: 45, precio: '20.00', precioNuevo: ''
    }]
  };

  const plan = planPermiso(j, permiso, fmt, mapa);

  assert.equal(plan.items.length, 2);
  assert.deepEqual(plan.items[0], {
    idPrecio: 100, idPermiso: 10, idEstatus: 2, idEstado: 14, idMunicipio: 62, idLocalidad: 1,
    fechaRegistro: '2026-11-09 13:00:00', autotanque: true, recipiente: false,
    fechaNuevoPrecio: '2026-11-09', horaNuevoPrecio: '14:10', precioNuevo: '11.79'
  });
  assert.equal(plan.items[1].precioNuevo, '21.84');
  assert.equal(plan.items[1].autotanque, false);
  assert.equal(plan.items[1].recipiente, true);
  assert.equal(plan.items[1].capacidadKg, 45);
  assert.match(plan.cadena, /Precio vigente por litro=11\.09/);
  assert.match(plan.cadena, /Precio vigente por Kg=20\.00\|Capacidad Kg=45/);
  assert.equal(plan.cuenta.sinPrecio, 0);
});

test('planPermiso omite filas sin ubicación, sin precio, ya pendientes o iguales', () => {
  const mapa = new Map([[clave('Jalisco', 'Ojuelos de Jalisco'), { kg: 21.84, litro: 11.79 }]]);
  const fmt = { aplicaTxt: '09/11/2026', aplicaUS: '2026-11-09', hora: '14:10', registro: '2026-11-09 13:00:00' };
  const permiso = { id: 10, nombre: 'LP/1/DIST/PLA/2016' };
  const j = {
    listaPreciosVigentesAutoTanque: [
      { idPrecio: 1, estado: '', municipio: 'X', precio: '1.00' },
      { idPrecio: 2, estado: 'Jalisco', municipio: 'Desconocido', precio: '1.00' },
      { idPrecio: 3, estado: 'Jalisco', municipio: 'Ojuelos de Jalisco', precio: '11.00', precioNuevo: '12.00' },
      { idPrecio: 4, estado: 'Jalisco', municipio: 'Ojuelos de Jalisco', precio: '11.79', precioNuevo: '' }
    ]
  };

  const plan = planPermiso(j, permiso, fmt, mapa);

  assert.equal(plan.items.length, 0);
  assert.deepEqual(plan.cuenta, { sinPrecio: 1, sinUbicacion: 1, yaPendiente: 1, igual: 1 });
  assert.deepEqual(plan.faltan, ['Jalisco / Desconocido']);
});
