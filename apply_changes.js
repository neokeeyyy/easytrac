const fs = require('fs');
const path = 'C:/Users/manuniz/satps/src/20-acs.js';
let content = fs.readFileSync(path, 'utf8');
let changed = 0;

function replace(old, neo) {
  if (!content.includes(old)) {
    console.error('NO MATCH for:', old.substring(0, 80));
    return false;
  }
  content = content.replace(old, neo);
  changed++;
  console.log('OK:', old.substring(0, 60));
  return true;
}

// 6A: Change BOTONES.inicio
replace(
  "      inicio: ['<i class=\"fa-solid fa-play\"></i> Procesar todo el rango', 'principal', 1, 1, 1, 0, 1],",
  "      inicio: [null, null, 0, 1, 1, 0, 1],"
);

// 6B: Replace div de tabla única por múltiples tablas
replace(
  `      '  <div id="acs-tabla-wrap"><table id="acs-tabla"><thead id="acs-thead"></thead><tbody></tbody></table></div>' +`,
  `      '  <div id="acs-tabla-wrap">' +
      '    <table id="acs-tabla-inicio" class="acs-tabla-sec"><thead id="acs-thead-inicio"></thead><tbody></tbody></table>' +
      '    <table id="acs-tabla-aceptar" class="acs-tabla-sec" style="display:none"><thead id="acs-thead-aceptar"></thead><tbody></tbody></table>' +
      '    <table id="acs-tabla-cerrar" class="acs-tabla-sec" style="display:none"><thead id="acs-thead-cerrar"></thead><tbody></tbody></table>' +
      '    <table id="acs-tabla-facturas" class="acs-tabla-sec" style="display:none"><thead id="acs-thead-facturas"></thead><tbody></tbody></table>' +
      '  </div>' +`
);

// 6C: Update actualizarBotones
replace(
  `    function actualizarBotones(tab) {
      // Hide the "Procesar todo el rango" button for the 'inicio' tab as it is no longer needed.
      if (tab === 'inicio') {
        const btn = panel.querySelector('#acs-ejecutar');
        if (btn) btn.style.display = 'none';
      }
      var cfg = BOTONES[tab] || BOTONES.inicio;
      for (var i = 0; i < IDS_BOTON.length; i++) {
        panel.querySelector('#acs-' + IDS_BOTON[i]).style.display = cfg[i + 2] ? 'inline-block' : 'none';
      }
      if (cfg[0]) {
        var ejecutar = panel.querySelector('#acs-ejecutar');
        ejecutar.innerHTML = cfg[0];
        ejecutar.className = cfg[1] ? 'acs-btn acs-btn-principal' : 'acs-btn';
      }
      var extra = tab === 'facturas' ? '<th>Factura</th>' : tab === 'cerrar' ? '<th>Motivo de cierre</th>' : '';
      panel.querySelector('#acs-thead').innerHTML = (tab === 'inicio' || tab === 'cerrar' || tab === 'facturas')
        ? '<tr><th></th><th>Registro</th><th>Estatus</th><th>Volumen</th><th>Fecha</th><th>Permiso</th>' + extra + '</tr>'
        : '<tr><th>Módulo</th><th>Permiso</th><th>Registro</th><th>Estado</th><th>Detalle</th></tr>';
      panel.querySelector('#acs-acciones').style.display = tab === 'facturas' ? 'none' : 'grid';
      panel.querySelector('#acs-facturas-acciones').style.display = tab === 'facturas' ? 'flex' : 'none';
    }`,
  `    function actualizarBotones(tab) {
      var cfg = BOTONES[tab] || BOTONES.inicio;
      for (var i = 0; i < IDS_BOTON.length; i++) {
        var el = panel.querySelector('#acs-' + IDS_BOTON[i]);
        if (el) el.style.display = cfg[i + 2] ? 'inline-block' : 'none';
      }
      if (cfg[0]) {
        var ejecutar = panel.querySelector('#acs-ejecutar');
        if (ejecutar) {
          ejecutar.innerHTML = cfg[0];
          ejecutar.className = cfg[1] ? 'acs-btn acs-btn-principal' : 'acs-btn';
        }
      }
      /* Cabeceras: cada tabla tiene su propio thead. */
      var tablaId = TABLA_POR_TAB[tab] || 'inicio';
      var extra = tab === 'facturas' ? '<th>Factura</th>' : tab === 'cerrar' ? '<th>Motivo de cierre</th>' : '';
      var theadCompras = '<tr><th></th><th>Registro</th><th>Estatus</th><th>Volumen</th><th>Fecha</th><th>Permiso</th>' + extra + '</tr>';
      var theadAcciones = '<tr><th>Módulo</th><th>Permiso</th><th>Registro</th><th>Estado</th><th>Detalle</th></tr>';
      var thead = panel.querySelector('#acs-thead-' + tablaId);
      if (thead) thead.innerHTML = (tab === 'inicio' || tab === 'cerrar' || tab === 'facturas') ? theadCompras : theadAcciones;
      /* Mostrar solo la tabla del tab activo. */
      var tablas = panel.querySelectorAll('.acs-tabla-sec');
      for (var t = 0; t < tablas.length; t++) {
        tablas[t].style.display = tablas[t].id === 'acs-tabla-' + tablaId ? 'table' : 'none';
      }
      panel.querySelector('#acs-acciones').style.display = tab === 'facturas' ? 'none' : 'grid';
      panel.querySelector('#acs-facturas-acciones').style.display = tab === 'facturas' ? 'flex' : 'none';
    }`
);

// 6D: Update event listener from tbody to tablaWrap
replace(
  `    panel.querySelector('#acs-detener-facturas').addEventListener('click', detener);
    var tbody = panel.querySelector('#acs-tabla tbody');
    function filasConCheckbox() {
      return Array.prototype.slice.call(tbody.querySelectorAll('tr')).filter(function (tr) {
        return tr.querySelector('input[type="checkbox"]');
      });
    }
    tbody.addEventListener('change', function (ev) {
      var tr = ev.target.closest('tr');
      if (tr && ev.target.type === 'checkbox') tr.setAttribute('aria-selected', ev.target.checked ? 'true' : 'false');
      actualizarResumen();
    });
    tbody.addEventListener('keydown', function (ev) {`,
  `    panel.querySelector('#acs-detener-facturas').addEventListener('click', detener);
    var tablaWrap = panel.querySelector('#acs-tabla-wrap');
    function filasConCheckbox() {
      var tb = tbodyActivo();
      return tb ? Array.prototype.slice.call(tb.querySelectorAll('tr')).filter(function (tr) {
        return tr.querySelector('input[type="checkbox"]');
      }) : [];
    }
    tablaWrap.addEventListener('change', function (ev) {
      var tr = ev.target.closest('tr');
      if (tr && ev.target.type === 'checkbox') tr.setAttribute('aria-selected', ev.target.checked ? 'true' : 'false');
      actualizarResumen();
    });
    tablaWrap.addEventListener('keydown', function (ev) {`
);

// 6E: Update marcarFilaFactura
replace(
  `  function marcarFilaFactura(idx, ok) {
    var ch = document.querySelector('.acs-factura-check[data-idx="' + idx + '"]');`,
  `  function marcarFilaFactura(idx, ok) {
    var ch = document.querySelector('#acs-tabla-facturas .acs-factura-check[data-idx="' + idx + '"]');`
);

// 6F: Update CSS - table selectors
replace(
  `    '#acs-tabla-wrap{max-height:clamp(200px,40vh,480px);overflow:auto;background:var(--ui-bg);border-top:1px solid var(--ui-border);}' +
    '#acs-tabla{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums;}' +
    '#acs-tabla th{background:var(--ui-bg);color:var(--ui-fg);border-bottom:1px solid var(--ui-border-strong);padding:6px;text-align:left;font-weight: 400;position:sticky;top:0;z-index:1;}' +
    '#acs-tabla td{border-bottom:1px solid var(--ui-border);padding:6px;color:var(--ui-fg);overflow-wrap:anywhere;}' +
    '#acs-tabla tbody tr:nth-child(even){background:#f5f5f5;}' +
    '#acs-tabla tbody tr:focus-visible{outline:2px solid var(--ui-focus);outline-offset:-2px;}' +`,
  `    '#acs-tabla-wrap{max-height:clamp(200px,40vh,480px);overflow:auto;background:var(--ui-bg);border-top:1px solid var(--ui-border);}' +
    '.acs-tabla-sec{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums;}' +
    '.acs-tabla-sec th{background:var(--ui-bg);color:var(--ui-fg);border-bottom:1px solid var(--ui-border-strong);padding:6px;text-align:left;font-weight: 400;position:sticky;top:0;z-index:1;}' +
    '.acs-tabla-sec td{border-bottom:1px solid var(--ui-border);padding:6px;color:var(--ui-fg);overflow-wrap:anywhere;}' +
    '.acs-tabla-sec tbody tr:nth-child(even){background:#f5f5f5;}' +
    '.acs-tabla-sec tbody tr:focus-visible{outline:2px solid var(--ui-focus);outline-offset:-2px;}' +`
);

// 6G: Update CSS - problem row selectors
replace(
  `    '#acs-tabla tbody tr.acs-factura-ok{background:var(--ui-ok-bg);}' +
    '.acs-est.ok{color:var(--ui-ok-fg);}' +
    '.acs-est.fail,.acs-fail{color:var(--ui-err-fg);}' +
    '#acs-tabla tbody tr.acs-problema,#acs-tabla tbody tr.acs-problema td{color:var(--ui-err-fg);font-weight:bold;}'`,
  `    '.acs-tabla-sec tbody tr.acs-factura-ok{background:var(--ui-ok-bg);}' +
    '.acs-est.ok{color:var(--ui-ok-fg);}' +
    '.acs-est.fail,.acs-fail{color:var(--ui-err-fg);}' +
    '.acs-tabla-sec tbody tr.acs-problema,.acs-tabla-sec tbody tr.acs-problema td{color:var(--ui-err-fg);font-weight:bold;}'`
);

// 6H: Update runModulo limpiarTabla call
replace(
  `      // Despachar y Recepcionar no deben borrar la lista ni sus selecciones al iniciar.
      if (nombre !== 'Despachar' && nombre !== 'Recepcionar') limpiarTabla();`,
  `      // Despachar y Recepcionar no deben borrar la lista ni sus selecciones al iniciar.
      if (nombre !== 'Despachar' && nombre !== 'Recepcionar') limpiarTabla(tabActiva);`
);

// 6J: Update aceptarUna .then - detect volumen 0
replace(
  `      .then(function (res) {
        if (res.json && res.json.result === true) return { ok: true, msg: '' };
        return { ok: false, msg: (res.json && (res.json.mensaje || res.json.message)) || res.text.slice(0, 200) };
      });
  }`,
  `      .then(function (res) {
        if (res.json && res.json.result === true) {
          /* Detectar si la aceptación resultó con volumen 0 (fallo silencioso del servidor). */
          var vol = res.json && (res.json.volumen_Aceptado || res.json.volumen || res.json.cantidad || 0);
          if (vol !== undefined && Number(vol) === 0) {
            return { ok: true, msg: 'AVISO: aceptada con volumen 0', aceptadaEnCero: true };
          }
          return { ok: true, msg: '' };
        }
        return { ok: false, msg: (res.json && (res.json.mensaje || res.json.message)) || res.text.slice(0, 200) };
      });
  }`
);

// 6J part 2: Update procesarLote to handle aceptadaEnCero
replace(
  `  function procesarLote(items, accion, verbo, modulo, permiso) {
    return secuencia(items, function (x) {
      var fila = modulo ? nuevaFila(modulo, permiso, x.codigoRegistro) : null;
      return accion(x).then(function (r) {
        if (fila) fila.set(r.ok ? 'OK' : 'FALLO', r.msg);
        progStep(verbo + ' ' + x.codigoRegistro + ' → ' + (r.ok ? 'OK' : 'FALLO') + (r.msg ? ' · ' + r.msg : ''));
      }).catch(function (e) {
        if (fila) fila.set('FALLO', e.message);
        progStep(verbo + ' ' + x.codigoRegistro + ' → ERROR');
      });
    });
  }`,
  `  function procesarLote(items, accion, verbo, modulo, permiso) {
    return secuencia(items, function (x) {
      var fila = modulo ? nuevaFila(modulo, permiso, x.codigoRegistro) : null;
      return accion(x).then(function (r) {
        if (fila) {
          fila.set(r.ok ? 'OK' : 'FALLO', r.msg);
          if (r.aceptadaEnCero && fila.tr) fila.tr.classList.add('acs-problema');
        }
        progStep(verbo + ' ' + x.codigoRegistro + ' → ' + (r.ok ? 'OK' : 'FALLO') + (r.msg ? ' · ' + r.msg : ''));
      }).catch(function (e) {
        if (fila) fila.set('FALLO', e.message);
        progStep(verbo + ' ' + x.codigoRegistro + ' → ERROR');
      });
    });
  }`
);

console.log(`\nTotal replacements made: ${changed}`);
fs.writeFileSync(path, content, 'utf8');
console.log('File written.');
