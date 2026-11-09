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
    var s = norm(href + ' ' + (texto || ''));
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
          onload: function (r) { (r.status >= 200 && r.status < 300) ? res(r.response) : rej(new Error('HTTP ' + r.status)); },
          onerror: function () { rej(new Error('Error de red')); },
          ontimeout: function () { rej(new Error('Tiempo agotado')); }
        });
      });
    }
    if (typeof GM !== 'undefined' && GM && GM.xmlHttpRequest) {
      return GM.xmlHttpRequest({ method: 'GET', url: url, timeout: 90000, responseType: tipo }).then(function (r) {
        if (r.status < 200 || r.status >= 300) throw new Error('HTTP ' + r.status);
        return r.response;
      });
    }
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return tipo === 'arraybuffer' ? r.arrayBuffer() : r.text();
    });
  }

  async function listasPrecios(fecha) {
    var r = await fetch('/GasLP/Precios/GetListaPreciosXpermiso', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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

  function texto(tr, i) {
    var td = tr.children[i];
    if (!td) return '';
    var inp = td.querySelector('input, select');
    return (inp ? inp.value : td.textContent).replace(/\s+/g, ' ').trim();
  }

  function filasDom(tabla, idx) {
    var trs = tabla.querySelectorAll('tbody tr');
    var m = new Map();
    for (var i = 0; i < trs.length; i++) {
      var tr = trs[i];
      var e = texto(tr, idx.estado), mu = texto(tr, idx.muni), lo = idx.loc >= 0 ? texto(tr, idx.loc) : '';
      if (!e || !mu) continue;
      var par = clave(e, mu);
      if (!m.has(par)) m.set(par, tr);
      if (lo) m.set(par + '|' + norm(lo), tr);
    }
    return m;
  }

  function buscarFila(m, estado, muni, loc) {
    var par = clave(estado, muni);
    if (loc) {
      var tr = m.get(par + '|' + norm(loc));
      if (tr) return tr;
    }
    return m.get(par) || null;
  }

  function setVal(inp, v) {
    inp.value = v;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    inp.dispatchEvent(new Event('blur', { bubbles: true }));
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
      decir('Consultando los precios del permiso…');
      var fRegistro = document.getElementById('idFechaRegistro');
       var fechaConsulta = fRegistro && fRegistro.value ? fRegistro.value : (fechaLocal(new Date()) + ' ' + horaLocal(new Date()) + ':00');
       var j = await listasPrecios(fechaConsulta);
      var respetar = document.getElementById('cne-skip').checked;
      var ok = 0, sin = 0, sinCampo = 0;
      var faltan = new Set();
      var puestos = new Set();
      for (var li = 0; li < LISTAS.length; li++) {
        var L = LISTAS[li];
        var lista = j[L.lista];
        if (!Array.isArray(lista)) continue;
        var tabla = document.getElementById(L.tabla);
        if (!tabla) continue;
        var idx = indices(tabla);
        if (idx.estado < 0 || idx.muni < 0) { sinCampo++; continue; }
        if (!puestos.has(L.modo)) {
          puestos.add(L.modo);
          var fAll = document.getElementById(L.fecha), hAll = document.getElementById(L.hora);
          if (fAll) setVal(fAll, fTxt);
          if (hAll) setVal(hAll, hTxt);
        }
        var dom = filasDom(tabla, idx);
        for (var ri = 0; ri < lista.length; ri++) {
          var row = lista[ri];
          var estado = row.estado, muni = row.municipio;
          if (!estado || !muni) { sinCampo++; continue; }
          var p = precioDe(mapa, estado, muni);
          if (!p) { sin++; faltan.add(estado + ' / ' + muni); continue; }
          var tr = buscarFila(dom, estado, muni, idx.loc >= 0 ? row.localidad : '');
          if (!tr) { sinCampo++; continue; }
          var inp = row.idPrecio != null ? document.getElementById('PrecioNuevo-' + row.idPrecio) : null;
          if (!inp) inp = tr.querySelector('input[id^="PrecioNuevo-"]');
          if (!inp) { sinCampo++; continue; }
          if (respetar && inp.value && num(inp.value) > 0) continue;
          setVal(inp, (L.modo === 'kg' ? p.kg : p.litro).toFixed(2));
          var f = (row.idPrecio != null ? document.getElementById('FechaNueva-' + row.idPrecio) : null)
            || tr.querySelector('input[id^="FechaNueva-"]');
          var h = (row.idPrecio != null ? document.getElementById('HoraNueva-' + row.idPrecio) : null)
            || tr.querySelector('input[id^="HoraNueva-"]');
          if (f) setVal(f, fTxt);
          if (h) setVal(h, hTxt);
          ok++;
        }
      }
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

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { norm: norm, estadoKey: estadoKey, muniKey: muniKey, clave: clave, num: num, parseCneItems: parseCneItems, mapaCne: mapaCne, precioDe: precioDe, fechaPdf: fechaPdf };
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
    else iniciar();
  }
})();
