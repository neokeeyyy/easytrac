/* EasyTrac Ajustes: one panel for every persistent option.
   Each field reads and writes the store that already owned it (acs_cfg, traspasos CONFIG),
   so this module never keeps a parallel copy of the configuration. */
(function () {
  'use strict';
  var ET = globalThis.EasyTrac;

  var campos = [];
  var acciones = [];
  var porClave = {};
  var listas = {};
  var pane = null;

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

  function accionesFilaHtml(c, i, st, simple) {
    var clave = esc(c.clave);
    var fila = i + 1;
    if (st.confirmar === i) {
      return '<span class="etcfg-confirmar" role="group" aria-label="Confirmar borrado de la fila ' + fila + '">' +
        '<button type="button" class="etcfg-boton etcfg-peligro" data-lista-si="' + clave + '" data-fila="' + i +
        '" aria-label="Sí, eliminar la fila ' + fila + '">Sí</button>' +
        '<button type="button" class="etcfg-boton" data-lista-no="' + clave + '" data-fila="' + i +
        '" aria-label="No eliminar la fila ' + fila + '">No</button></span>';
    }
    return (simple ? '' : '<button type="button" class="etcfg-boton" data-lista-editar="' + clave + '" data-fila="' + i +
      '" aria-label="Editar la fila ' + fila + '">Editar</button>') +
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

  /* Tarjetas: cada fila es un box con sus campos siempre editables. */
  function tarjetasListaHtml(c) {
    var cols = columnasLista(c);
    var st = estadoLista(c);
    var id = 'cfg-' + c.clave.replace(/[^a-z0-9]+/gi, '-');
    var html = '<div class="etcfg-cards" role="group" aria-labelledby="' + id + '-lbl">';
    if (!st.datos.length) {
      html += '<p class="etcfg-vacio">Sin filas. Usa «Añadir».</p>';
    }
    st.datos.forEach(function (fila, i) {
      html += '<div class="etcfg-card" data-fila="' + i + '"><div class="etcfg-card-campos">';
      cols.forEach(function (col, j) {
        var val = fila[col.clave] == null ? '' : String(fila[col.clave]);
        html += '<label class="etcfg-card-campo"><span>' + esc(col.etiqueta || col.clave) + '</span>' +
          '<input type="text" class="etcfg-celda-input" data-lista-campo="' + esc(c.clave) +
          '" data-fila="' + i + '" data-col="' + j + '" aria-label="' +
          esc((col.etiqueta || col.clave) + ', fila ' + (i + 1)) + '" value="' + esc(val) + '"></label>';
      });
      html += '</div><div class="etcfg-card-pie">' + accionesFilaHtml(c, i, st, true) + '</div></div>';
    });
    return html + '</div>';
  }

  function cuerpoLista(c) {
    return c.modo === 'tarjetas' ? tarjetasListaHtml(c) : tablaListaHtml(c);
  }

  function listaHtml(c) {
    var id = 'cfg-' + c.clave.replace(/[^a-z0-9]+/gi, '-');
    return '<span class="etcfg-lista-titulo" id="' + id + '-lbl">' + esc(c.etiqueta) + '</span>' +
      '<div class="etcfg-lista-caja" data-lista="' + esc(c.clave) + '">' +
      cuerpoLista(c) +
      '<div class="etcfg-lista-pie"><button type="button" class="etcfg-boton" data-lista-add="' + esc(c.clave) +
      '" aria-label="Añadir fila a ' + esc(c.etiqueta) + '">Añadir</button></div></div>';
  }

  /* Rehace la tabla de una lista y lleva el foco al control que toca. */
  function refrescarLista(c, foco) {
    if (!pane) return;
    var caja = pane.querySelector('[data-lista="' + c.clave + '"]');
    if (!caja) return;
    caja.innerHTML = cuerpoLista(c) +
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

  function focoLista(c, f, j) {
    return c.modo === 'tarjetas'
      ? 'input[data-lista-campo][data-fila="' + f + '"][data-col="' + j + '"]'
      : focoCelda(f, j);
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
      st.confirmar = -1;
      if (c.modo === 'tarjetas') {
        refrescarLista(c, focoLista(c, st.datos.length - 1, 0));
      } else {
        st.editando = { f: st.datos.length - 1, c: 0 };
        refrescarLista(c, '[data-lista-input]');
      }
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
      refrescarLista(c, st.datos.length ? focoLista(c, Math.min(f, st.datos.length - 1), 0) : null);
    } else {
      st.confirmar = -1;
      refrescarLista(c, '[data-lista-borrar][data-fila="' + f + '"]');
    }
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
      var opciones = typeof c.opciones === 'function' ? c.opciones() : (c.opciones || []);
      opciones.forEach(function (o) {
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
      var listaCampo = el && el.getAttribute && el.getAttribute('data-lista-campo');
      if (listaCampo) {
        var c = porClave[listaCampo];
        var st = c && estadoLista(c);
        var f = +el.getAttribute('data-fila'), j = +el.getAttribute('data-col');
        if (c && st) {
          if (!st.datos[f]) st.datos[f] = {};
          st.datos[f][columnasLista(c)[j].clave] = el.value;
          guardarLista(c, st.datos);
        }
        return;
      }
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
      var campo = t.closest ? t.closest('[data-lista-campo]') : null;
      if (campo) {
        if (ev.key === 'Enter') { ev.preventDefault(); campo.blur(); }
        return;
      }
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
    '#etcfg-pane .etcfg-cards{display:grid;gap:8px;}' +
    '#etcfg-pane .etcfg-card{border:1px solid var(--ui-border);padding:9px 10px;background:var(--ui-bg);}' +
    '#etcfg-pane .etcfg-card-campos{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) 64px;gap:8px;align-items:end;}' +
    '#etcfg-pane .etcfg-card-campo{display:grid;gap:3px;font-size:12px;color:var(--ui-muted);}' +
    '#etcfg-pane .etcfg-card-campo input{font-size:13px;}' +
    '#etcfg-pane .etcfg-card-pie{display:flex;justify-content:flex-end;margin-top:7px;}' +
    '#etcfg-pane .etcfg-card-pie .etcfg-boton{padding:4px 8px;font-size:12px;margin:0;}' +
    '#etcfg-pane .etcfg-celda-input{width:100%;min-width:0;padding:4px 5px;border:1px solid var(--ui-focus);' +
    'background:var(--ui-bg);color:var(--ui-fg);font:inherit;font-size:13px;}' +
    '#etcfg-pane input[type=checkbox]{width:16px;height:16px;flex:0 0 auto;margin:0;accent-color:var(--ui-primary);}' +
    '#etcfg-pane .etcfg-boton{font:400 13px/1 var(--ui-font);padding:8px 11px;border:1px solid var(--ui-border-input);' +
    'background:var(--ui-bg);color:var(--ui-fg);border-radius:0;cursor:pointer;transition:background 120ms linear,transform 140ms var(--shub-spring);}' +
    '#etcfg-pane .etcfg-boton:hover{background:#f5f5f5;}' +
    '#etcfg-pane .etcfg-boton:active{transform:scale(.97);}' +
    '#etcfg-pane input:focus,#etcfg-pane select:focus{border-color:var(--ui-focus);box-shadow:0 0 8px rgba(102,175,233,.6);outline:0;}';

  ET.config = {
    add: add,
    accion: accion,
    valor: valor,
    set: set,
    abrir: abrir,
    parseVehiculos: parseVehiculos,
    vehiculos: vehiculos,
    campos: function () { return campos.slice(); },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = ET.config;

  if (typeof document !== 'undefined' && ET.ready) {
    ET.ready(function () {
      pintar();
      if (ET.ui.engrane) ET.ui.engrane('Ajustes', abrir, 'ajustes');
    });
  }
})();
