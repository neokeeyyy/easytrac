/* EasyTrac Ajustes: one panel for every persistent option.
   Each field reads and writes the store that already owned it (acs_cfg, traspasos CONFIG),
   so this module never keeps a parallel copy of the configuration. */
(function () {
  'use strict';
  var ET = globalThis.EasyTrac;
  var VISTO = 'cfg_visto';

  var campos = [];
  var acciones = [];
  var porClave = {};
  var listas = {};
  var pane = null;
  var modal = null, btnGuardar = null, abierto = false, atajo = null;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function add(c) {
    if (!c || !c.clave || porClave[c.clave]) return;
    c.seccion = c.seccion || 'General';
    c.tipo = c.tipo || 'text';
    porClave[c.clave] = c;
    campos.push(c);
    if (pane) pintarCampos();
  }

  /* Botón suelto dentro de una sección (no guarda nada): lo usa el aviso de versión. */
  function accion(a) {
    if (!a || !a.etiqueta) return;
    a.seccion = a.seccion || 'General';
    acciones.push(a);
    if (pane) pintarCampos();
  }

  function leer(c) {
    try { return c.leer ? c.leer() : ET.store.get(c.clave, c.defecto); }
    catch (e) { return c.defecto; }
  }

  function valor(clave, defecto) {
    var c = porClave[clave];
    if (!c) return defecto;
    var v = leer(c);
    return v == null ? (defecto === undefined ? c.defecto : defecto) : v;
  }

  function set(clave, v) {
    var c = porClave[clave];
    if (!c) return;
    if (c.tipo === 'number') v = Math.max(0, +v || 0);
    if (c.tipo === 'check') v = !!v;
    try { if (c.guardar) c.guardar(v); else ET.store.set(clave, v); } catch (e) {}
  }

  function necesitaRevision(guardado, version) {
    /* Los @require se ejecutan antes de que el loader escriba ET.version: con el marcador
       no se pregunta nada, o el aviso saldría en cada carga. */
    if (!version || version === '0.0.0-dev') return false;
    return String(guardado || '') !== String(version);
  }

  /* Lista de vehículos: una línea por vehículo, `nombre|placas` o solo `placas`.
     El tercer campo opcional es el id de SIRETRAC, si ya se conoce. */
  function parseVehiculos(texto) {
    var vistos = {};
    var lista = [];
    String(texto == null ? '' : texto).split(/\r?\n/).forEach(function (linea) {
      var partes = String(linea).split('|');
      var nombre = partes.length > 1 ? String(partes[0]).trim() : '';
      var placas = String(partes.length > 1 ? partes[1] : partes[0]).trim();
      var id = partes.length > 2 ? String(partes[2]).trim() : '';
      if (!placas) return;
      var clave = placas.toUpperCase().replace(/\s+/g, '');
      if (vistos[clave]) return;
      vistos[clave] = true;
      lista.push({ nombre: nombre, placas: placas, id: id });
    });
    return lista;
  }

  /* Acepta el array nuevo y el texto legado: nada se rompe antes de migrar. */
  function listaVehiculos(v) {
    if (typeof v === 'string') return parseVehiculos(v);
    if (!Array.isArray(v)) return [];
    var vistos = {};
    var lista = [];
    v.forEach(function (it) {
      if (!it || typeof it !== 'object') return;
      var nombre = String(it.nombre == null ? '' : it.nombre).trim();
      var placas = String(it.placas == null ? '' : it.placas).trim();
      var id = String(it.id == null ? '' : it.id).trim();
      if (!placas) return;
      var clave = placas.toUpperCase().replace(/\s+/g, '');
      if (vistos[clave]) return;
      vistos[clave] = true;
      lista.push({ nombre: nombre, placas: placas, id: id });
    });
    return lista;
  }

  function vehiculos() {
    return listaVehiculos(valor('acs.vehiculos', ''));
  }

  /* ---------- listas (tipo 'lista': tabla con alta, edición y borrado) ---------- */

  function columnasLista(c) {
    if (c.columnas && c.columnas.length) return c.columnas;
    return [
      { clave: 'nombre', etiqueta: 'Nombre', ancho: '28%' },
      { clave: 'placas', etiqueta: 'Placas', ancho: '26%' },
      { clave: 'id', etiqueta: 'ID', ancho: '10%' }
    ];
  }

  /* El valor guardado es un array; un string es texto legado (migrar lo decide el campo). */
  function listaActual(c) {
    var v = leer(c);
    if (Array.isArray(v)) return v.map(function (it) { return it && typeof it === 'object' ? Object.assign({}, it) : {}; });
    if (typeof v === 'string') return (c.migrar || parseVehiculos)(v);
    return [];
  }

  function guardarLista(c, datos) {
    set(c.clave, datos);
  }

  function estadoLista(c) {
    if (!listas[c.clave]) listas[c.clave] = { datos: listaActual(c), editando: null, confirmar: -1 };
    return listas[c.clave];
  }

  function accionesFilaHtml(c, i, st) {
    var clave = esc(c.clave);
    var fila = i + 1;
    if (st.confirmar === i) {
      return '<span class="etcfg-confirmar" role="group" aria-label="Confirmar borrado de la fila ' + fila + '">' +
        '<button type="button" class="etcfg-boton etcfg-peligro" data-lista-si="' + clave + '" data-fila="' + i +
        '" aria-label="Sí, eliminar la fila ' + fila + '">Sí</button>' +
        '<button type="button" class="etcfg-boton" data-lista-no="' + clave + '" data-fila="' + i +
        '" aria-label="No eliminar la fila ' + fila + '">No</button></span>';
    }
    return '<button type="button" class="etcfg-boton" data-lista-editar="' + clave + '" data-fila="' + i +
      '" aria-label="Editar la fila ' + fila + '">Editar</button>' +
      '<button type="button" class="etcfg-boton etcfg-peligro" data-lista-borrar="' + clave + '" data-fila="' + i +
      '" aria-label="Eliminar la fila ' + fila + '">Eliminar</button>';
  }

  function tablaListaHtml(c) {
    var cols = columnasLista(c);
    var st = estadoLista(c);
    var id = 'cfg-' + c.clave.replace(/[^a-z0-9]+/gi, '-');
    var html = '<table class="etcfg-tabla" aria-labelledby="' + id + '-lbl"><thead><tr>';
    cols.forEach(function (col) {
      html += '<th scope="col"' + (col.ancho ? ' style="width:' + esc(col.ancho) + '"' : '') + '>' +
        esc(col.etiqueta || col.clave) + '</th>';
    });
    html += '<th scope="col" class="etcfg-col-acc">Acciones</th></tr></thead><tbody>';
    if (!st.datos.length) {
      html += '<tr><td class="etcfg-vacio" colspan="' + (cols.length + 1) + '">Sin filas. Usa «Añadir».</td></tr>';
    }
    st.datos.forEach(function (fila, i) {
      html += '<tr data-fila="' + i + '">';
      cols.forEach(function (col, j) {
        var val = fila[col.clave] == null ? '' : String(fila[col.clave]);
        var etiqueta = (col.etiqueta || col.clave) + ', fila ' + (i + 1);
        if (st.editando && st.editando.f === i && st.editando.c === j) {
          html += '<td><input type="text" class="etcfg-celda-input" data-lista-input="' + esc(c.clave) +
            '" data-fila="' + i + '" data-col="' + j + '" aria-label="' + esc(etiqueta) +
            '" value="' + esc(val) + '"></td>';
        } else {
          html += '<td tabindex="0" data-celda="' + esc(c.clave) + '" data-fila="' + i + '" data-col="' + j +
            '" aria-label="' + esc(etiqueta + ': ' + (val || 'vacío')) + '">' +
            (val ? esc(val) : '<span class="etcfg-mudo">—</span>') + '</td>';
        }
      });
      html += '<td class="etcfg-col-acc">' + accionesFilaHtml(c, i, st) + '</td></tr>';
    });
    return html + '</tbody></table>';
  }

  function listaHtml(c) {
    var id = 'cfg-' + c.clave.replace(/[^a-z0-9]+/gi, '-');
    return '<span class="etcfg-lista-titulo" id="' + id + '-lbl">' + esc(c.etiqueta) + '</span>' +
      '<div class="etcfg-lista-caja" data-lista="' + esc(c.clave) + '">' +
      tablaListaHtml(c) +
      '<div class="etcfg-lista-pie"><button type="button" class="etcfg-boton" data-lista-add="' + esc(c.clave) +
      '" aria-label="Añadir fila a ' + esc(c.etiqueta) + '">Añadir</button></div></div>';
  }

  /* Rehace la tabla de una lista y lleva el foco al control que toca. */
  function refrescarLista(c, foco) {
    if (!pane) return;
    var caja = pane.querySelector('[data-lista="' + c.clave + '"]');
    if (!caja) return;
    caja.innerHTML = tablaListaHtml(c) +
      '<div class="etcfg-lista-pie"><button type="button" class="etcfg-boton" data-lista-add="' + esc(c.clave) +
      '" aria-label="Añadir fila a ' + esc(c.etiqueta) + '">Añadir</button></div>';
    var el = caja.querySelector(foco || '[data-lista-add]');
    if (el) el.focus();
  }

  function enfocarCelda(c, f, j) {
    if (!pane) return;
    var caja = pane.querySelector('[data-lista="' + c.clave + '"]');
    if (!caja) return;
    var el = caja.querySelector('td[data-celda][data-fila="' + f + '"][data-col="' + j + '"]');
    if (el) el.focus();
  }

  /* Confirmar o cancelar una celda en edición; el borrado nunca ocurre aquí. */
  function terminarCelda(inp, guardar) {
    if (!inp || inp.getAttribute('data-hecho')) return;
    inp.setAttribute('data-hecho', '1');
    var c = porClave[inp.getAttribute('data-lista-input')];
    var st = c && listas[c.clave];
    if (!c || !st || !st.editando) return;
    var cols = columnasLista(c);
    var f = st.editando.f, j = st.editando.c;
    if (guardar) {
      if (!st.datos[f]) st.datos[f] = {};
      st.datos[f][cols[j].clave] = inp.value;
    }
    st.editando = null;
    /* Una fila que se queda entera en blanco no se guarda. */
    var vacia = !st.datos[f] || cols.every(function (col) {
      var v = st.datos[f][col.clave];
      return !String(v == null ? '' : v).trim();
    });
    if (vacia) {
      st.datos.splice(f, 1);
      guardarLista(c, st.datos);
      refrescarLista(c, st.datos.length ? focoCelda(Math.min(f, st.datos.length - 1), j) : null);
      return;
    }
    if (guardar) guardarLista(c, st.datos);
    refrescarLista(c, focoCelda(f, j));
  }

  function focoCelda(f, j) {
    return 'td[data-celda][data-fila="' + f + '"][data-col="' + j + '"]';
  }

  function editarCelda(celda) {
    var c = porClave[celda.getAttribute('data-celda')];
    var st = c && estadoLista(c);
    if (!c || !st) return;
    st.editando = { f: +celda.getAttribute('data-fila'), c: +celda.getAttribute('data-col') };
    st.confirmar = -1;
    refrescarLista(c, '[data-lista-input]');
  }

  function manejarLista(el) {
    var clave = el.getAttribute('data-lista-add') || el.getAttribute('data-lista-editar') ||
      el.getAttribute('data-lista-borrar') || el.getAttribute('data-lista-si') || el.getAttribute('data-lista-no');
    var c = porClave[clave];
    if (!c) return;
    var st = estadoLista(c);
    var f = +el.getAttribute('data-fila');
    if (el.hasAttribute('data-lista-add')) {
      st.datos.push({});
      st.editando = { f: st.datos.length - 1, c: 0 };
      st.confirmar = -1;
      refrescarLista(c, '[data-lista-input]');
    } else if (el.hasAttribute('data-lista-editar')) {
      st.editando = { f: f, c: 0 };
      st.confirmar = -1;
      refrescarLista(c, '[data-lista-input]');
    } else if (el.hasAttribute('data-lista-borrar')) {
      st.editando = null;
      st.confirmar = f;
      refrescarLista(c, '[data-lista-no][data-fila="' + f + '"]');
    } else if (el.hasAttribute('data-lista-si')) {
      st.datos.splice(f, 1);
      st.confirmar = -1;
      guardarLista(c, st.datos);
      refrescarLista(c, st.datos.length ? focoCelda(Math.min(f, st.datos.length - 1), 0) : null);
    } else {
      st.confirmar = -1;
      refrescarLista(c, '[data-lista-borrar][data-fila="' + f + '"]');
    }
  }

  function marcarVisto(version) {
    var v = version === undefined ? ET.version : version;
    ET.store.set(VISTO, v);
    return v;
  }

  /* ---------- pane ---------- */

  function campoHtml(c) {
    var id = 'cfg-' + c.clave.replace(/[^a-z0-9]+/gi, '-');
    var v = leer(c);
    if (v == null) v = c.defecto;
    var attrs = ' id="' + id + '" data-clave="' + esc(c.clave) + '"';
    var html = '<div class="etcfg-campo etcfg-' + esc(c.tipo) + '">';
    if (c.tipo === 'check') {
      html += '<label for="' + id + '"><input type="checkbox"' + attrs + (v ? ' checked' : '') + '> ' + esc(c.etiqueta) + '</label>';
    } else if (c.tipo === 'select') {
      html += '<label for="' + id + '">' + esc(c.etiqueta) + '</label><select' + attrs + '>';
      (c.opciones || []).forEach(function (o) {
        var ov = typeof o === 'object' ? o.valor : o;
        var ot = typeof o === 'object' ? o.texto : o;
        html += '<option value="' + esc(ov) + '"' + (String(ov) === String(v) ? ' selected' : '') + '>' + esc(ot) + '</option>';
      });
      html += '</select>';
    } else if (c.tipo === 'textarea') {
      html += '<label for="' + id + '">' + esc(c.etiqueta) + '</label>' +
        '<textarea' + attrs + ' rows="4">' + esc(v) + '</textarea>';
    } else if (c.tipo === 'lista') {
      html += listaHtml(c);
    } else {
      var tipo = c.tipo === 'number' ? 'number' : 'text';
      html += '<label for="' + id + '">' + esc(c.etiqueta) + '</label>' +
        '<input type="' + tipo + '"' + attrs + ' value="' + esc(v) + '"' +
        (tipo === 'number' ? ' min="0" step="100"' : '') + '>';
    }
    return html + '</div>';
  }

  function pintarCampos() {
    if (!pane) return;
    listas = {};
    var secciones = [], porSeccion = {};
    function grupo(nombre) {
      if (!porSeccion[nombre]) { porSeccion[nombre] = { campos: [], acciones: [] }; secciones.push(nombre); }
      return porSeccion[nombre];
    }
    campos.forEach(function (c) { grupo(c.seccion).campos.push(c); });
    acciones.forEach(function (a, i) { grupo(a.seccion).acciones.push({ a: a, i: i }); });
    var html = '<p class="etcfg-hint">Se guarda al cambiar cada campo. Revísalos antes de procesar.</p>';
    secciones.forEach(function (s) {
      var g = porSeccion[s];
      html += '<section class="etcfg-sec"><h3>' + esc(s) + '</h3>' +
        g.campos.map(campoHtml).join('') +
        g.acciones.map(function (it) {
          return '<div class="etcfg-campo"><button type="button" class="etcfg-boton" data-accion="' + it.i + '">' +
            esc(it.a.etiqueta) + '</button></div>';
        }).join('') +
        '</section>';
    });
    if (!secciones.length) html += '<p class="etcfg-hint">No hay opciones configurables.</p>';
    pane.innerHTML = html;
  }

  function crearPane() {
    var p = ET.ui.pane('ajustes', 420);
    p.id = 'etcfg-pane';
    p.addEventListener('change', function (ev) {
      var el = ev.target;
      var clave = el && el.getAttribute && el.getAttribute('data-clave');
      if (!clave) return;
      set(clave, el.type === 'checkbox' ? el.checked : el.value);
    });
    p.addEventListener('click', function (ev) {
      var t = ev.target && ev.target.closest ? ev.target : null;
      var lista = t ? t.closest('[data-lista-add],[data-lista-editar],[data-lista-borrar],[data-lista-si],[data-lista-no]') : null;
      if (lista) { manejarLista(lista); return; }
      var celda = t ? t.closest('td[data-celda]') : null;
      if (celda) { editarCelda(celda); return; }
      var b = t ? t.closest('[data-accion]') : null;
      if (!b) return;
      var a = acciones[+b.getAttribute('data-accion')];
      if (a && a.alPulsar) a.alPulsar();
    });
    p.addEventListener('keydown', function (ev) {
      var t = ev.target;
      if (!t || !t.getAttribute) return;
      var inp = t.closest ? t.closest('[data-lista-input]') : null;
      if (inp) {
        if (ev.key === 'Enter') { ev.preventDefault(); terminarCelda(inp, true); }
        else if (ev.key === 'Escape') { ev.preventDefault(); terminarCelda(inp, false); }
        return;
      }
      var celda = t.closest ? t.closest('td[data-celda]') : null;
      if (!celda) return;
      var c = porClave[celda.getAttribute('data-celda')];
      if (!c) return;
      var st = estadoLista(c);
      var f = +celda.getAttribute('data-fila'), j = +celda.getAttribute('data-col');
      var nf = f, nj = j;
      if (ev.key === 'ArrowDown') nf = f + 1;
      else if (ev.key === 'ArrowUp') nf = f - 1;
      else if (ev.key === 'ArrowRight') nj = j + 1;
      else if (ev.key === 'ArrowLeft') nj = j - 1;
      else if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); editarCelda(celda); return; }
      else if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); return; }
      else return;
      ev.preventDefault();
      var cols = columnasLista(c).length;
      if (nj >= cols) { nj = 0; nf = f + 1; }
      if (nj < 0) { nj = cols - 1; nf = f - 1; }
      if (nf >= 0 && nf < st.datos.length) enfocarCelda(c, nf, nj);
    });
    return p;
  }

  function pintar() {
    if (!pane) {
      pane = crearPane();
      (ET.ui.style || function () {})(CSS);
    }
    pintarCampos();
    return pane;
  }

  var volverA = '';

  function abrir(alternar) {
    pintar();
    /* Second click on the gear returns where you were. */
    if (alternar && pane && pane.classList.contains('on') && volverA) {
      if (ET.ui.activar) ET.ui.activar(volverA, false);
      return;
    }
    var on = document.querySelector('#shub-panes .shub-pane.on');
    if (on && on !== pane) volverA = on.getAttribute('data-id');
    if (ET.ui.activar) ET.ui.activar('ajustes', false);
    abierto = true;
    if (btnGuardar) btnGuardar.disabled = false;
  }

  /* ---------- revisión obligatoria ---------- */

  function guardarVisto() {
    if (!abierto) return;
    marcarVisto(ET.version);
    if (atajo) document.removeEventListener('keydown', atajo, true);
    atajo = null;
    if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
    modal = null;
    btnGuardar = null;
  }

  function mostrarModal() {
    (ET.ui.style || function () {})(CSS);
    modal = document.createElement('div');
    modal.id = 'etcfg-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'etcfg-modal-t');
    modal.innerHTML =
      '<div id="etcfg-caja">' +
      '  <h2 id="etcfg-modal-t">Revisa la configuración</h2>' +
      '  <p class="etcfg-modal-txt">Antes de usar el toolkit revisa los ajustes de esta versión. ' +
      'Puedes cambiar el vehículo, las placas, las esperas y el resto de opciones desde la pestaña Ajustes.</p>' +
      '  <p class="etcfg-modal-ver">Versión instalada: <strong>' + esc(ET.version) + '</strong></p>' +
      '  <div class="etcfg-modal-acc">' +
      '    <button type="button" id="etcfg-ir">Abrir Ajustes</button>' +
      '    <button type="button" id="etcfg-ok" disabled>Guardar y continuar</button>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(modal);
    btnGuardar = modal.querySelector('#etcfg-ok');

    modal.querySelector('#etcfg-ir').addEventListener('click', function () {
      abrir();
      modal.classList.add('etcfg-min');
      var txt = modal.querySelector('.etcfg-modal-txt');
      if (txt) txt.textContent = 'Ajustes abiertos. Cuando termines de revisarlos, guarda y continúa.';
    });
    btnGuardar.addEventListener('click', guardarVisto);
    /* Esc y el clic fuera no cierran: solo «Guardar y continuar». */
    atajo = function (ev) { if (modal && ev.key === 'Escape') ev.preventDefault(); };
    document.addEventListener('keydown', atajo, true);
    modal.addEventListener('click', function (ev) { if (ev.target === modal) ev.stopPropagation(); });
    modal.querySelector('#etcfg-ir').focus();
  }

  function revisar() {
    if (!necesitaRevision(ET.store.get(VISTO, ''), ET.version)) return;
    if (!modal) mostrarModal();
  }

  /* ---------- CSS (house-ui: Geist Pixel 400, plano, esquinas rectas, paleta --ui-*) ---------- */

  var CSS =
    '#etcfg-pane{font-family:var(--ui-font);font-size:14px;line-height:1.43;color:var(--ui-fg);}' +
    '#etcfg-pane *{box-sizing:border-box;}' +
    '#etcfg-pane .etcfg-hint{margin:0 0 12px;color:var(--ui-muted);font-size:13px;}' +
    '#etcfg-pane .etcfg-sec{margin:0 0 14px;padding:0 0 12px;border-bottom:1px solid var(--ui-border);}' +
    '#etcfg-pane .etcfg-sec:last-child{border-bottom:0;}' +
    '#etcfg-pane h3{margin:0 0 8px;font-size:12px;font-weight:400;text-transform:uppercase;letter-spacing:.04em;color:var(--ui-muted);}' +
    '#etcfg-pane .etcfg-campo{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:6px 10px;align-items:center;margin:0 0 8px;}' +
    '#etcfg-pane .etcfg-check{grid-template-columns:minmax(0,1fr);}' +
    '#etcfg-pane .etcfg-check label{display:flex;align-items:center;gap:7px;}' +
    '#etcfg-pane label{font-size:13px;font-weight:400;color:var(--ui-fg);margin:0;}' +
    '#etcfg-pane input[type=text],#etcfg-pane input[type=number],#etcfg-pane select,#etcfg-pane textarea{width:100%;min-width:0;max-width:100%;padding:6px 7px;' +
    'border:1px solid var(--ui-border-input);background:var(--ui-bg);color:var(--ui-fg);font:inherit;font-size:13px;}' +
    '#etcfg-pane textarea{resize:vertical;min-height:72px;grid-column:1 / -1;}' +
    '#etcfg-pane .etcfg-lista{grid-template-columns:minmax(0,1fr);}' +
    '#etcfg-pane .etcfg-lista-titulo{font-size:13px;}' +
    '#etcfg-pane .etcfg-lista-caja{min-width:0;max-width:100%;overflow-x:auto;}' +
    '#etcfg-pane .etcfg-tabla{width:100%;border-collapse:collapse;table-layout:fixed;font-size:13px;}' +
    '#etcfg-pane .etcfg-tabla th,#etcfg-pane .etcfg-tabla td{padding:5px 6px;border:1px solid var(--ui-border);' +
    'text-align:left;vertical-align:middle;overflow-wrap:anywhere;}' +
    '#etcfg-pane .etcfg-tabla th{font-weight:400;color:var(--ui-muted);background:var(--ui-border);}' +
    '#etcfg-pane .etcfg-tabla td[data-celda]{cursor:text;}' +
    '#etcfg-pane .etcfg-tabla td[data-celda]:focus{outline:2px solid var(--ui-focus);outline-offset:-2px;}' +
    '#etcfg-pane .etcfg-tabla .etcfg-col-acc{width:150px;}' +
    '#etcfg-pane .etcfg-tabla .etcfg-boton{padding:4px 6px;margin:0 3px 3px 0;font-size:12px;}' +
    '#etcfg-pane .etcfg-peligro{color:var(--ui-danger);border-color:var(--ui-danger);}' +
    '#etcfg-pane .etcfg-peligro:hover{background:var(--ui-err-bg);}' +
    '#etcfg-pane .etcfg-confirmar{display:inline-flex;flex-wrap:wrap;gap:3px;}' +
    '#etcfg-pane .etcfg-mudo{color:var(--ui-muted);}' +
    '#etcfg-pane .etcfg-vacio{text-align:center;color:var(--ui-muted);}' +
    '#etcfg-pane .etcfg-lista-pie{margin-top:6px;}' +
    '#etcfg-pane .etcfg-celda-input{width:100%;min-width:0;padding:4px 5px;border:1px solid var(--ui-focus);' +
    'background:var(--ui-bg);color:var(--ui-fg);font:inherit;font-size:13px;}' +
    '#etcfg-pane input[type=checkbox]{width:16px;height:16px;flex:0 0 auto;margin:0;accent-color:var(--ui-primary);}' +
    '#etcfg-pane .etcfg-boton{font:400 13px/1 var(--ui-font);padding:8px 11px;border:1px solid var(--ui-border-input);' +
    'background:var(--ui-bg);color:var(--ui-fg);border-radius:0;cursor:pointer;transition:background 120ms linear,transform 140ms var(--shub-spring);}' +
    '#etcfg-pane .etcfg-boton:hover{background:#f5f5f5;}' +
    '#etcfg-pane .etcfg-boton:active{transform:scale(.97);}' +
    '#etcfg-pane input:focus,#etcfg-pane select:focus{border-color:var(--ui-focus);box-shadow:0 0 8px rgba(102,175,233,.6);outline:0;}' +
    '#etcfg-modal{position:fixed;inset:0;z-index:2147483100;display:flex;align-items:center;justify-content:center;padding:16px;' +
    'background:rgba(51,51,51,.55);font:400 14px/1.43 var(--ui-font);color:var(--ui-fg);box-sizing:border-box;}' +
    '#etcfg-modal *{box-sizing:border-box;}' +
    '#etcfg-modal #etcfg-caja{width:min(420px,100%);background:var(--ui-bg);border:1px solid var(--ui-border-strong);padding:16px;' +
    'animation:etcfg-in 320ms cubic-bezier(.34,1.56,.64,1) both;}' +
    '#etcfg-caja h2{margin:0 0 8px;font-size:16px;font-weight:400;}' +
    '#etcfg-caja .etcfg-modal-txt{margin:0 0 8px;}' +
    '#etcfg-caja .etcfg-modal-ver{margin:0 0 14px;color:var(--ui-muted);font-size:13px;}' +
    '#etcfg-caja .etcfg-modal-acc{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;}' +
    '#etcfg-caja button{font:400 13px/1 var(--ui-font);padding:8px 11px;border:1px solid var(--ui-border-input);' +
    'background:var(--ui-bg);color:var(--ui-fg);border-radius:0;cursor:pointer;transition:background 120ms linear,transform 140ms var(--shub-spring);}' +
    '#etcfg-caja button:hover:enabled{background:#f5f5f5;}' +
    '#etcfg-caja button:active:enabled{transform:scale(.97);}' +
    '#etcfg-caja button:focus-visible{outline:2px solid var(--ui-focus);outline-offset:1px;}' +
    '#etcfg-caja #etcfg-ok{background:var(--ui-primary);border-color:var(--ui-primary);color:#fff;}' +
    '#etcfg-caja #etcfg-ok:hover:enabled{background:var(--ui-primary-hover);border-color:var(--ui-primary-hover);}' +
    '#etcfg-caja #etcfg-ok:disabled{background:var(--ui-bg);border-color:var(--ui-border);color:var(--ui-muted);cursor:not-allowed;}' +
    /* Revisión abierta: el cuadro se aparta a la esquina y la página queda usable. */
    '#etcfg-modal.etcfg-min{background:transparent;pointer-events:none;align-items:flex-end;justify-content:flex-start;}' +
    '#etcfg-modal.etcfg-min #etcfg-caja{pointer-events:auto;width:min(320px,100%);}' +
    '#etcfg-modal.etcfg-min #etcfg-ir{display:none;}' +
    '@keyframes etcfg-in{0%{opacity:0;transform:translateY(14px) scale(.97)}100%{opacity:1;transform:none}}' +
    '@media (prefers-reduced-motion:reduce){#etcfg-caja{animation:none}}';

  ET.config = {
    add: add,
    accion: accion,
    valor: valor,
    set: set,
    abrir: abrir,
    revisar: revisar,
    necesitaRevision: necesitaRevision,
    marcarVisto: marcarVisto,
    parseVehiculos: parseVehiculos,
    vehiculos: vehiculos,
    campos: function () { return campos.slice(); },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = ET.config;

  if (typeof document !== 'undefined' && ET.ready) {
    ET.ready(function () {
      pintar();
      if (ET.ui.engrane) ET.ui.engrane('Ajustes', abrir, 'ajustes');
      /* Un tick después: los @require corren antes del cuerpo del loader, que es quien
         escribe la versión instalada. Sin esto el modal compara contra 0.0.0-dev y vuelve. */
      setTimeout(revisar, 0);
    });
  }
})();
