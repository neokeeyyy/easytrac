/* EasyTrac PRECIOS CNE
   Llena los precios nuevos de Agregar Precios con la tabla máxima vigente de la CNE. */
(function () {
  'use strict';
  var ET = globalThis.EasyTrac;

  var ART = 'https://www.gob.mx/cne/articulos/precios-maximos-de-gas-lp-399035';
  var WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  var MES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
  var LISTAS = [
    { lista: 'listaPreciosVigentesAutoTanque', tabla: 'idtblPreciosNuevosAutotanque', modo: 'litro', fecha: 'idFechaPrecioNuevoAll', hora: 'idHorasMinutosNuevoAll' },
    { lista: 'listaPreciosXaplicarAutoTanque', tabla: 'idtblPreciosXaplicarAutoTanque', modo: 'litro', fecha: 'idFechaPrecioNuevoAll', hora: 'idHorasMinutosNuevoAll' },
    { lista: 'listaPreciosVigentesRecipiente', tabla: 'idtblPreciosNuevosRecipiente', modo: 'kg', fecha: 'idFechaPrecioNuevoAllRecipiente', hora: 'idHorasMinutosNuevoAllRecipiente' },
    { lista: 'listaPreciosXaplicarRecipiente', tabla: 'idtblPreciosXaplicarRecipiente', modo: 'kg', fecha: 'idFechaPrecioNuevoAllRecipiente', hora: 'idHorasMinutosNuevoAllRecipiente' }
  ];

  // ---------- funciones puras (probadas en test/precios-cne.test.js) ----------

  function norm(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase().replace(/\s+/g, ' ').trim();
  }

  function estadoKey(s) {
    var x = norm(s).replace(/^ESTADO DE /, '');
    x = x.replace(/ DE ZARAGOZA$/, '').replace(/ DE OCAMPO$/, '')
      .replace(/ DE IGNACIO DE LA LLAVE$/, '').replace(/ DE LA LLAVE$/, '');
    if (x === 'DISTRITO FEDERAL') x = 'CIUDAD DE MEXICO';
    return x;
  }

  function muniKey(s) {
    return norm(s).replace(/\s*\([^)]*\)\s*$/, '');
  }

  function clave(estado, muni) {
    return estadoKey(estado) + '|' + muniKey(muni);
  }

  function num(s) {
    var n = parseFloat(String(s).replace(/[^0-9.,-]/g, '').replace(/,/g, ''));
    return isNaN(n) ? null : n;
  }

  var COLS = [
    { k: 'region', min: -1e9, max: 100 },
    { k: 'estado', min: 100, max: 250 },
    { k: 'municipio', min: 250, max: 400 },
    { k: 'kg', min: 400, max: 490 },
    { k: 'litro', min: 490, max: 1e9 }
  ];

  // Las filas del PDF están separadas ~15 pt y el precio está 0.4 pt arriba:
  // agrupar por banda de 3 pt y luego repartir cada texto por su columna x.
  function parseCneItems(items) {
    var bandas = new Map();
    for (var i = 0; i < (items || []).length; i++) {
      var it = items[i];
      var s = String(it.str || '').replace(/\s+/g, ' ').trim();
      var tr = it.transform;
      if (!s || !tr) continue;
      var band = Math.round(tr[5] / 3);
      if (!bandas.has(band)) bandas.set(band, []);
      bandas.get(band).push({ s: s, x: tr[4] });
    }
    var filas = [];
    bandas.forEach(function (arr) {
      var c = { region: '', estado: '', municipio: '', kg: '', litro: '' };
      arr.sort(function (a, b) { return a.x - b.x; });
      for (var j = 0; j < arr.length; j++) {
        var col = null;
        for (var k = 0; k < COLS.length; k++) {
          if (arr[j].x >= COLS[k].min && arr[j].x < COLS[k].max) { col = COLS[k]; break; }
        }
        if (col) c[col.k] += (c[col.k] ? ' ' : '') + arr[j].s;
      }
      var region = parseInt(c.region, 10);
      var kg = num(c.kg), litro = num(c.litro);
      if (!region || !c.estado || !c.municipio || kg == null || litro == null) return;
      filas.push({ region: region, estado: c.estado.trim(), municipio: c.municipio.trim(), kg: kg, litro: litro });
    });
    return filas;
  }

  function mapaCne(filas) {
    var m = new Map();
    for (var i = 0; i < (filas || []).length; i++) {
      var f = filas[i];
      m.set(clave(f.estado, f.municipio), f);
    }
    return m;
  }

  function precioDe(m, estado, muni) {
    return m.get(clave(estado, muni))
      || m.get(clave(estado, String(muni).replace(/\s*\([^)]*\).*$/, '')))
      || null;
  }

  function fechaPdf(href, texto) {
    // Los archivos de la CNE traen la fecha con guiones bajos: DEL_22_AL_28...
    var s = norm(href + ' ' + (texto || '')).replace(/_/g, ' ');
    var m = /DEL (\d{1,2}) AL (\d{1,2}) DE ([A-Z]+) DE (\d{4})/.exec(s)
      || /(\d{1,2}) AL (\d{1,2}) DE ([A-Z]+) DE (\d{4})/.exec(s);
    if (!m) return null;
    var mes = MES[m[3].toLowerCase()];
    if (!mes) return null;
    return new Date(+m[4], mes - 1, +m[1]);
  }

  // ---------- fechas ----------

  function dos(n) { return String(n).padStart(2, '0'); }
  function fechaLocal(d) { return d.getFullYear() + '-' + dos(d.getMonth() + 1) + '-' + dos(d.getDate()); }
  function horaLocal(d) { return dos(d.getHours()) + ':' + dos(d.getMinutes()); }
  function fechaTxt(d) { return dos(d.getDate()) + '/' + dos(d.getMonth() + 1) + '/' + d.getFullYear(); }
  var MINUTO_MINIMO = 60; // la pantalla exige al menos 60 min de diferencia
var MARGEN_MIN = 10;    // margen de seguridad: 1 h 10 min en total
function porDefecto() { var d = new Date(Date.now() + (MINUTO_MINIMO + MARGEN_MIN) * 60e3); d.setSeconds(0, 0); return d; }

  // ---------- red ----------

  function pedir(url, tipo) {
    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise(function (res, rej) {
        GM_xmlhttpRequest({
          method: 'GET', url: url, timeout: 90000, responseType: tipo,
          onload: function (r) {
            if (r.status < 200 || r.status >= 300) return rej(new Error('HTTP ' + r.status));
            res(typeof r.response === 'string' || tipo === 'arraybuffer' ? r.response : r.responseText);
          },
          onerror: function (r) { rej(new Error((r && r.error) || 'Error de red')); },
          ontimeout: function () { rej(new Error('Tiempo agotado')); }
        });
      });
    }
    if (typeof GM !== 'undefined' && GM && GM.xmlHttpRequest) {
      return GM.xmlHttpRequest({ method: 'GET', url: url, timeout: 90000, responseType: tipo }).then(function (r) {
        if (r.status < 200 || r.status >= 300) throw new Error('HTTP ' + r.status);
        return r.response != null ? r.response : r.responseText;
      });
    }
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return tipo === 'arraybuffer' ? r.arrayBuffer() : r.text();
    });
  }

  function csrf() {
    var i = document.querySelector('input[name="__RequestVerificationToken"]');
    return i && i.value ? i.value : '';
  }

  async function listasPrecios(fecha) {
    var headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    var t = csrf();
    if (t) headers.RequestVerificationToken = t;
    var r = await fetch('/GasLP/Precios/GetListaPreciosXpermiso', {
      method: 'POST',
      headers: headers,
      body: 'fecha=' + encodeURIComponent(fecha),
      credentials: 'include'
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var j = await r.json();
    if (!j || !j.success) throw new Error((j && j.message) || 'La respuesta no trae success');
    return j;
  }

  async function urlPdf() {
    var html = await pedir(ART, 'text');
    var doc = new DOMParser().parseFromString(String(html), 'text/html');
    var vistos = new Set();
    var links = [];
    var as = doc.querySelectorAll('a[href*="/cms/uploads/attachment/file/"]');
    for (var i = 0; i < as.length; i++) {
      var href = new URL(as[i].getAttribute('href'), 'https://www.gob.mx').href;
      if (vistos.has(href)) continue;
      vistos.add(href);
      if (!/\.pdf($|\?)/i.test(href) || !/precios.*maximos.*vigentes/i.test(norm(href))) continue;
      links.push({ href: href, fecha: fechaPdf(href, as[i].textContent) });
    }
    if (!links.length) throw new Error('No encontré el PDF de precios vigentes en la CNE');
    links.sort(function (a, b) { return (b.fecha ? b.fecha.getTime() : 0) - (a.fecha ? a.fecha.getTime() : 0); });
    return links[0];
  }

  async function filasPdf(url) {
    var pdfjs = window.pdfjsLib || (typeof pdfjsLib !== 'undefined' ? pdfjsLib : null);
    if (!pdfjs) throw new Error('pdf.js no cargó; revisa el @require');
    if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = WORKER;
    /* pdf.js no puede leer la URL directa (CORS): bajamos los bytes con GM_xmlhttpRequest. */
    var data = await pedir(url, 'arraybuffer');
    var pdf = await pdfjs.getDocument({ data: data }).promise;
    var filas = [];
    for (var p = 1; p <= pdf.numPages; p++) {
      var page = await pdf.getPage(p);
      var tc = await page.getTextContent();
      filas.push.apply(filas, parseCneItems(tc.items));
    }
    return filas;
  }

  // ---------- tabla de SIRETRAC ----------

  function indices(tabla) {
    var trs = tabla.querySelectorAll('thead tr');
    var ths = Array.prototype.map.call((trs.length ? trs[trs.length - 1].children : []), function (x) { return norm(x.textContent); });
    function buscar(re) {
      for (var i = 0; i < ths.length; i++) if (re.test(ths[i])) return i;
      return -1;
    }
    return { estado: buscar(/^(ESTADO|ENTIDAD)/), muni: buscar(/MUNICIPIO/), loc: buscar(/LOCALIDAD/) };
  }

  function textoDe(td) {
    if (!td) return '';
    var inp = td.querySelector('input, select');
    return (inp ? inp.value : td.textContent).replace(/\s+/g, ' ').trim();
  }

  function texto(tr, i) { return textoDe(tr.children[i]); }

  function setVal(inp, v) {
    // Vacía primero: algunos campos con máscara conservan el texto anterior.
    inp.value = '';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.value = v;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    inp.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  // Llena las filas visibles de una tabla. No depende del listado del permiso:
  // si la tabla está en pantalla, sus datos ya vienen del servidor.
  function llenarTabla(tabla, idx, mapa, modo, fTxt, hTxt, respetar) {
    var cuenta = { ok: 0, sin: 0, sinCampo: 0, faltan: new Set() };
    var trs = tabla.querySelectorAll('tbody tr');
    for (var i = 0; i < trs.length; i++) {
      var tr = trs[i];
      // Clases fijas de SIRETRAC; los índices del thead quedan como respaldo.
      var estado = textoDe(tr.querySelector('td.id-bodega')) || texto(tr, idx.estado);
      var muni = textoDe(tr.querySelector('td.capacidad-recipiente')) || texto(tr, idx.muni);
      if (!estado || !muni) continue;
      var p = precioDe(mapa, estado, muni);
      if (!p) { cuenta.sin++; cuenta.faltan.add(estado + ' / ' + muni); continue; }
      var inp = tr.querySelector('input[id^="PrecioNuevo-"], input[name^="PrecioNuevo"], input[id*="PrecioNuevo"]');
      if (!inp) { cuenta.sinCampo++; continue; }
      // El servidor prefija el precio vigente: eso no es un capturado manual.
      var vigente = num(textoDe(tr.querySelector('td.cantidad-vendida')));
      if (respetar && num(inp.value) > 0 && num(inp.value) !== vigente) continue;
      setVal(inp, (modo === 'kg' ? p.kg : p.litro).toFixed(2));
      var f = tr.querySelector('input[id^="FechaNueva-"], input[name^="FechaNueva"]');
      var h = tr.querySelector('input[id^="HoraNueva-"], input[name^="HoraNueva"]');
      if (f) setVal(f, fTxt);
      if (h) setVal(h, hTxt);
      cuenta.ok++;
    }
    return cuenta;
  }

  function fechaUS(txt) {
    var w = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : (typeof window !== 'undefined' ? window : null);
    if (w && typeof w.GetFechaFormatUS === 'function') { try { return w.GetFechaFormatUS(txt); } catch (e) {} }
    var p = String(txt).split('/');
    return p.length === 3 ? p[2] + '-' + p[1] + '-' + p[0] : txt;
  }

  function fechaHoraServidor(d) {
    var w = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : (typeof window !== 'undefined' ? window : null);
    if (w && typeof w.GetFechaHoraBrowser === 'function') { try { return w.GetFechaHoraBrowser(1); } catch (e) {} }
    return fechaLocal(d) + ' ' + horaLocal(d) + ':' + dos(d.getSeconds());
  }

  function formatoFecha(d) {
    return {
      aplicaTxt: fechaTxt(d),
      aplicaUS: fechaUS(fechaTxt(d)),
      hora: horaLocal(d),
      registro: fechaHoraServidor(d)
    };
  }

  // Arma los items de guardado de un permiso a partir de las listas vigentes.
  function planPermiso(j, permiso, fmt, mapa) {
    var items = [], filas = [], faltan = [], cadena = '';
    var cuenta = { sinPrecio: 0, sinUbicacion: 0, yaPendiente: 0, igual: 0 };
    var listas = [
      { nombre: 'listaPreciosVigentesAutoTanque', modo: 'litro' },
      { nombre: 'listaPreciosVigentesRecipiente', modo: 'kg' }
    ];
    for (var li = 0; li < listas.length; li++) {
      var L = listas[li];
      var lista = Array.isArray(j[L.nombre]) ? j[L.nombre] : [];
      for (var ri = 0; ri < lista.length; ri++) {
        var row = lista[ri];
        if (!row.estado || !row.municipio) { cuenta.sinUbicacion++; continue; }
        var p = precioDe(mapa, row.estado, row.municipio);
        var nuevo = p ? (L.modo === 'kg' ? p.kg : p.litro) : null;
        if (nuevo == null || isNaN(nuevo)) { cuenta.sinPrecio++; faltan.push(row.estado + ' / ' + row.municipio); continue; }
        var txtNuevo = Number(nuevo).toFixed(2);
        if (num(row.precioNuevo) > 0) { cuenta.yaPendiente++; continue; }
        var actual = num(row.precio);
        if (actual != null && Math.abs(actual - nuevo) < 0.005) { cuenta.igual++; continue; }
        var item = {
          idPrecio: row.idPrecio,
          idPermiso: row.idPermiso ? row.idPermiso : permiso.id,
          idEstatus: 2,
          idEstado: row.idEstado,
          idMunicipio: row.idMunicipio,
          idLocalidad: row.idLocalidad,
          fechaRegistro: fmt.registro,
          autotanque: L.modo === 'litro',
          recipiente: L.modo === 'kg',
          fechaNuevoPrecio: fmt.aplicaUS,
          horaNuevoPrecio: fmt.hora,
          precioNuevo: txtNuevo
        };
        if (L.modo === 'kg') item.capacidadKg = row.capacidadKg;
        items.push(item);
        filas.push({ estado: row.estado, municipio: row.municipio, localidad: row.localidad, actual: row.precio, nuevo: txtNuevo, modo: L.modo });
        if (L.modo === 'kg') {
          cadena += '|Entidad Federativa=' + row.estado + '|Municipio=' + row.municipio + '|Localidad=' + row.localidad +
            '|Precio vigente por Kg=' + row.precio + '|Capacidad Kg=' + row.capacidadKg +
            '|Precio Nuevo=' + txtNuevo + '|Fecha nuevo precio=' + fmt.aplicaTxt + ' ' + fmt.hora;
        } else {
          cadena += '|Entidad Federativa=' + row.estado + '|Municipio=' + row.municipio + '|Localidad=' + row.localidad +
            '|Precio vigente por litro=' + row.precio +
            '|Precio Nuevo=' + txtNuevo + '|Fecha nuevo precio=' + fmt.aplicaTxt + ' ' + fmt.hora;
        }
      }
    }
    return { items: items, filas: filas, cadena: cadena, faltan: faltan, cuenta: cuenta };
  }

  // ---------- interfaz ----------

  var cargando = false;

  function decir(t, err) {
    var msg = document.getElementById('cne-msg');
    if (!msg) return;
    msg.textContent = t;
    msg.style.color = err ? '#C60C0E' : '#706F6F';
  }

  async function llenar() {
    if (cargando) return;
    var btn = document.getElementById('cne-run');
    cargando = true;
    if (btn) btn.disabled = true;
    try {
      decir('Leyendo el artículo de la CNE…');
      var r = await urlPdf();
      decir('Leyendo el PDF de la CNE…');
      var filas = await filasPdf(r.href);
      if (!filas.length) throw new Error('El PDF no devolvió filas con precio');
      var mapa = mapaCne(filas);
      var fInp = document.getElementById('cne-fecha');
      var hInp = document.getElementById('cne-hora');
      var d = new Date(fInp.value + 'T' + hInp.value + ':00');
      if (isNaN(d)) throw new Error('Fecha u hora inválida');
      var fTxt = fechaTxt(d), hTxt = horaLocal(d);
      decir('Llenando precios…');
      var respetar = document.getElementById('cne-skip').checked;
      var ok = 0, sin = 0, sinCampo = 0, tablas = 0;
      var faltan = new Set();
      var puestos = new Set();
      for (var li = 0; li < LISTAS.length; li++) {
        var L = LISTAS[li];
        var tabla = document.getElementById(L.tabla);
        if (!tabla) continue;
        tablas++;
        var idx = indices(tabla);
        if (idx.estado < 0 || idx.muni < 0) { sinCampo++; continue; }
        if (!puestos.has(L.modo)) {
          puestos.add(L.modo);
          var fAll = document.getElementById(L.fecha), hAll = document.getElementById(L.hora);
          if (fAll) setVal(fAll, fTxt);
          if (hAll) setVal(hAll, hTxt);
        }
        var cuenta = llenarTabla(tabla, idx, mapa, L.modo, fTxt, hTxt, respetar);
        ok += cuenta.ok; sin += cuenta.sin; sinCampo += cuenta.sinCampo;
        cuenta.faltan.forEach(function (x) { faltan.add(x); });
      }
      if (!tablas) throw new Error('No encontré las tablas de precios; la página cambió');
      if (sin) console.warn('CNE sin coincidencia:', Array.from(faltan));
      var muestra = Array.from(faltan).slice(0, 3).join('; ');
      decir('Listo: ' + ok + ' filas · ' + sin + ' sin coincidencia · ' + sinCampo + ' sin campo' + (sin ? ' (' + muestra + '…)' : ''));
      if (r.fecha && fechaTxt(r.fecha) !== fTxt) console.info('Semana CNE:', fechaTxt(r.fecha), 'elegida:', fTxt);
    } catch (e) {
      decir('Error: ' + e.message, true);
      console.error(e);
    } finally {
      cargando = false;
      if (btn) btn.disabled = false;
    }
  }

  function iniciar() {
    if (typeof document === 'undefined' || !/\/GasLP\/Precios/i.test(location.href)) return;
    if (document.getElementById('cne-run')) return;
    var d = porDefecto();
    var panel = ET.ui.tab('precios-cne', 'Precios CNE', 60, 300);
    panel.innerHTML =
      '<label style="display:flex;align-items:center;gap:8px;padding:2px 0">' +
        '<span style="width:46px;font-weight:400">Fecha</span>' +
        '<input id="cne-fecha" type="date" value="' + fechaLocal(d) + '" style="flex:1;min-width:0;padding:4px 6px;border:1px solid #ccc;font:inherit">' +
      '</label>' +
      '<label style="display:flex;align-items:center;gap:8px;padding:2px 0">' +
        '<span style="width:46px;font-weight:400">Hora</span>' +
        '<input id="cne-hora" type="time" value="' + horaLocal(d) + '" style="flex:1;min-width:0;padding:4px 6px;border:1px solid #ccc;font:inherit">' +
      '</label>' +
      '<label style="display:flex;align-items:center;gap:8px;padding:2px 0;cursor:pointer;user-select:none">' +
        '<input id="cne-skip" type="checkbox" checked style="width:16px;height:16px;margin:0;accent-color:#2EA836">' +
        '<span style="font-weight:400">Respetar capturados</span>' +
      '</label>' +
      '<button id="cne-run" type="button" style="width:100%;border:0;background:#2EA836;color:#fff;padding:6px 14px;font:inherit;cursor:pointer;margin:4px 0">Llenar con CNE</button>' +
      '<div id="cne-msg" style="color:#706F6F;font-size:12px">Listo para leer la CNE.</div>';
    document.getElementById('cne-run').addEventListener('click', llenar);
  }

  // ---------- bulk desde el selector de permisos ----------

  var bulkCargando = false;
  var bulkPlanes = [];
  var bulkMapa = null;
  var bulkVisto = 0;

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function esPlanta(p) {
    var act = norm(p.actividad || '');
    var mat = norm(p.materia || '');
    var cod = norm(p.nombre || '');
    if (/ESTACION|EXPENDIO/.test(act) || /ESTACION|EXPENDIO/.test(cod)) return false;
    var gas = mat.indexOf('GAS') >= 0 || /(^|\/)LP(\/|$)/.test(cod);
    var planta = (act.indexOf('DISTRIBUCION') >= 0 && act.indexOf('PLANTA') >= 0) || (cod.indexOf('DIST') >= 0 && cod.indexOf('PLA') >= 0);
    return gas && planta;
  }

  function permisoActivo() {
    var el = document.getElementById('codigoregistro');
    if (el && el.value) return el.value.trim();
    var n = document.querySelector('.navbar-custom-menu .hidden-xss');
    return n ? n.textContent.trim() : '';
  }

  async function activaPermiso(p) {
    var qs = new URLSearchParams({
      idPermiso: p.id,
      permiso: p.nombre || '',
      idPermisionario: '0',
      idPermisoMateria: '0',
      idPermisoActividad: '0',
      razonSocial: p.razon || '',
      estatus: 'False',
      capacidadOperativa: '0'
    });
    var r = await fetch('/OrdenDePedido/SeleccionarPermiso?' + qs, { credentials: 'include' });
    if (!r.ok) throw new Error('No se pudo activar ' + (p.nombre || p.id) + ' (HTTP ' + r.status + ')');
  }

  async function listaPermisos() {
    var lista = ET.core.permisos.permisosDeDocumento(document);
    if (!lista.length) {
      var html = await (await fetch('/OrdenDePedido/Permisos', { credentials: 'include' })).text();
      lista = ET.core.permisos.permisosDeDocumento(new DOMParser().parseFromString(html, 'text/html'));
    }
    return lista;
  }

  function decirBulk(t, err) {
    var m = document.getElementById('cne-bulk-msg');
    if (!m) return;
    m.textContent = t;
    m.style.color = err ? '#C60C0E' : '#706F6F';
  }

  function renderBulk(fmt) {
    var box = document.getElementById('cne-bulk-list');
    if (!box) return;
    var total = bulkPlanes.reduce(function (n, x) { return n + x.plan.items.length; }, 0);
    var html = '<table style="width:100%;border-collapse:collapse;font-size:11px">' +
      '<thead><tr><th style="text-align:left;border-bottom:1px solid #ccc">Permiso</th>' +
      '<th style="text-align:right;border-bottom:1px solid #ccc">Filas</th>' +
      '<th style="text-align:left;border-bottom:1px solid #ccc">Detalle</th></tr></thead><tbody>';
    bulkPlanes.forEach(function (x) {
      var p = x.permiso, plan = x.plan;
      var det = plan.filas.slice(0, 4).map(function (f) {
        return esc(f.municipio) + ' ' + esc(f.nuevo) + (f.modo === 'kg' ? ' kg' : ' L');
      }).join('<br>');
      if (plan.filas.length > 4) det += '<br>… +' + (plan.filas.length - 4);
      if (!plan.items.length) {
        var motivos = [];
        if (plan.cuenta.sinPrecio) motivos.push(plan.cuenta.sinPrecio + ' sin precio');
        if (plan.cuenta.sinUbicacion) motivos.push(plan.cuenta.sinUbicacion + ' sin ubicación');
        det = 'Sin cambios' + (motivos.length ? ' · ' + motivos.join(' · ') : '');
      } else {
        var extra = [];
        if (plan.cuenta.yaPendiente) extra.push(plan.cuenta.yaPendiente + ' ya por aplicar');
        if (plan.cuenta.igual) extra.push(plan.cuenta.igual + ' igual');
        if (plan.cuenta.sinUbicacion) extra.push(plan.cuenta.sinUbicacion + ' sin ubicación');
        if (extra.length) det += '<br><span style="color:#706F6F">' + extra.join(' · ') + '</span>';
      }
      html += '<tr><td style="padding:2px 0;border-bottom:1px solid #eee">' + esc(p.nombre) + '</td>' +
        '<td style="text-align:right;border-bottom:1px solid #eee">' + plan.items.length + '</td>' +
        '<td style="border-bottom:1px solid #eee">' + det + '</td></tr>';
    });
    html += '</tbody></table>';
    if (!bulkPlanes.length) html = '<div style="font-size:12px">No hay permisos de Distribución/Planta.</div>';
    box.innerHTML = html;
    var btn = document.getElementById('cne-bulk-send');
    if (btn) btn.style.display = total ? 'block' : 'none';
    decirBulk('Revisados ' + bulkPlanes.length + ' permisos · ' + total + ' precios · ' + fmt.aplicaTxt + ' ' + fmt.hora);
  }

  async function revisarBulk() {
    if (bulkCargando) return;
    var btn = document.getElementById('cne-bulk-run');
    bulkCargando = true;
    if (btn) btn.disabled = true;
    bulkPlanes = [];
    try {
      decirBulk('Leyendo el PDF de la CNE…');
      var r = await urlPdf();
      var filas = await filasPdf(r.href);
      if (!filas.length) throw new Error('El PDF no devolvió filas con precio');
      bulkMapa = mapaCne(filas);
      var todos = await listaPermisos();
      var permisos = todos.filter(esPlanta);
      if (!permisos.length) throw new Error('No hay permisos de Distribución/Planta en la tabla');
      var origen = permisoActivo();
      var fmt = formatoFecha(porDefecto());
      var ahora = new Date();
      var consulta = fechaTxt(ahora) + ' ' + horaLocal(ahora) + ':' + dos(ahora.getSeconds());
      try {
        for (var i = 0; i < permisos.length; i++) {
          var p = permisos[i];
          decirBulk('Revisando ' + (p.nombre || p.id) + ' (' + (i + 1) + '/' + permisos.length + ')…');
          await activaPermiso(p);
          var j = await listasPrecios(consulta);
          bulkPlanes.push({ permiso: p, plan: planPermiso(j, p, fmt, bulkMapa) });
        }
      } finally {
        var back = todos.find(function (x) { return x.nombre === origen; });
        if (back) { try { await activaPermiso(back); } catch (e) { console.error(e); } }
      }
      renderBulk(fmt);
      bulkVisto = Date.now();
    } catch (e) {
      decirBulk('Error: ' + e.message, true);
      console.error(e);
    } finally {
      bulkCargando = false;
      if (btn) btn.disabled = false;
    }
  }

  async function enviarBulk() {
    if (bulkCargando) return;
    var total = bulkPlanes.reduce(function (n, x) { return n + x.plan.items.length; }, 0);
    if (!total) return;
    if (Date.now() - bulkVisto > 30 * 60e3) { decirBulk('La revisión tiene más de 30 min; vuelve a revisar.', true); return; }
    var fmt = formatoFecha(porDefecto());
    if (!confirm('¿Enviar ' + total + ' precios a ' + bulkPlanes.length + ' permisos a las ' + fmt.aplicaTxt + ' ' + fmt.hora + '? No se pueden modificar después.')) return;
    var btn = document.getElementById('cne-bulk-send');
    bulkCargando = true;
    if (btn) btn.disabled = true;
    var ahora = new Date();
    var consulta = fechaTxt(ahora) + ' ' + horaLocal(ahora) + ':' + dos(ahora.getSeconds());
    var todos = [], origen = '';
    var okPerm = 0, okFilas = 0, fallos = [];
    try {
      todos = await listaPermisos();
      origen = permisoActivo();
      for (var i = 0; i < bulkPlanes.length; i++) {
        var p = bulkPlanes[i].permiso;
        decirBulk('Enviando ' + (p.nombre || p.id) + ' (' + (i + 1) + '/' + bulkPlanes.length + ')…');
        try {
          await activaPermiso(p);
          var j = await listasPrecios(consulta);
          var plan = planPermiso(j, p, fmt, bulkMapa);
          if (!plan.items.length) { fallos.push((p.nombre || p.id) + ': sin cambios'); continue; }
          var headers = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' };
          var t = csrf();
          if (t) headers.RequestVerificationToken = t;
          var res = await fetch('/GasLP/Precios/InsertaPreciosNuevos2', {
            method: 'POST',
            headers: headers,
            body: 'datos=' + encodeURIComponent(JSON.stringify(plan.items)) + '&cadenaAcuse=' + encodeURIComponent(plan.cadena),
            credentials: 'include'
          });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          var out = await res.json();
          if (!out || !out.success) throw new Error((out && out.mensaje) || 'sin success');
          okPerm++;
          okFilas += plan.items.length;
        } catch (e) {
          fallos.push((p.nombre || p.id) + ': ' + e.message);
        }
      }
    } catch (e) {
      decirBulk('Error: ' + e.message, true);
      console.error(e);
    } finally {
      var back = todos.find(function (x) { return x.nombre === origen; });
      if (back) { try { await activaPermiso(back); } catch (e) { console.error(e); } }
      bulkCargando = false;
      if (btn) btn.disabled = false;
    }
    decirBulk('Enviado: ' + okPerm + ' permisos · ' + okFilas + ' precios' + (fallos.length ? ' · fallos: ' + fallos.join('; ') : ''), fallos.length > 0);
    console.log('CNE bulk', { okPerm: okPerm, okFilas: okFilas, fallos: fallos });
  }

  function iniciarBulk() {
    if (typeof document === 'undefined' || !/\/OrdenDePedido\/Permisos/i.test(location.href)) return;
    if (document.getElementById('cne-bulk-run')) return;
    var panel = ET.ui.tab('precios-cne-bulk', 'Precios CNE', 61, 340);
    panel.innerHTML =
      '<div style="font-size:12px;color:#706F6F;padding:2px 0">Actualiza todos los permisos de Distribución/Planta con la CNE.</div>' +
      '<button id="cne-bulk-run" type="button" style="width:100%;border:0;background:#2EA836;color:#fff;padding:6px 14px;font:inherit;cursor:pointer;margin:4px 0">Revisar plantas</button>' +
      '<div id="cne-bulk-msg" style="color:#706F6F;font-size:12px">Listo para revisar.</div>' +
      '<div id="cne-bulk-list" style="margin-top:6px"></div>' +
      '<button id="cne-bulk-send" type="button" style="display:none;width:100%;border:0;background:#C60C0E;color:#fff;padding:6px 14px;font:inherit;cursor:pointer;margin:6px 0">Confirmar y enviar</button>';
    document.getElementById('cne-bulk-run').addEventListener('click', revisarBulk);
    document.getElementById('cne-bulk-send').addEventListener('click', enviarBulk);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { norm: norm, estadoKey: estadoKey, muniKey: muniKey, clave: clave, num: num, parseCneItems: parseCneItems, mapaCne: mapaCne, precioDe: precioDe, fechaPdf: fechaPdf, llenarTabla: llenarTabla, planPermiso: planPermiso };
  }

  if (typeof document !== 'undefined') {
    var arranque = function () { iniciar(); iniciarBulk(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arranque);
    else arranque();
  }
})();
