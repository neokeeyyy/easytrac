/* EasyTrac Ajustes: one panel for every persistent option.
   Each field reads and writes the store that already owned it (acs_cfg, traspasos CONFIG),
   so this module never keeps a parallel copy of the configuration. */
(function () {
  'use strict';
  var ET = globalThis.EasyTrac;
  var VISTO = 'cfg_visto';

  var campos = [];
  var porClave = {};
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
    return String(guardado || '') !== String(version || '');
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

  function vehiculos() {
    return parseVehiculos(valor('acs.vehiculos', ''));
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
    var secciones = [], porSeccion = {};
    campos.forEach(function (c) {
      if (!porSeccion[c.seccion]) { porSeccion[c.seccion] = []; secciones.push(c.seccion); }
      porSeccion[c.seccion].push(c);
    });
    var html = '<p class="etcfg-hint">Se guarda al cambiar cada campo. Revísalos antes de procesar.</p>';
    secciones.forEach(function (s) {
      html += '<section class="etcfg-sec"><h3>' + esc(s) + '</h3>' +
        porSeccion[s].map(campoHtml).join('') + '</section>';
    });
    if (!secciones.length) html += '<p class="etcfg-hint">No hay opciones configurables.</p>';
    pane.innerHTML = html;
  }

  function crearPane() {
    var p = ET.ui.tab('ajustes', 'Ajustes', 90, 420);
    p.id = 'etcfg-pane';
    p.addEventListener('change', function (ev) {
      var el = ev.target;
      var clave = el && el.getAttribute && el.getAttribute('data-clave');
      if (!clave) return;
      set(clave, el.type === 'checkbox' ? el.checked : el.value);
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

  function abrir() {
    pintar();
    if (ET.ui.activar) ET.ui.activar('ajustes', true);
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
    '#etcfg-pane textarea{resize:vertical;min-height:72px;}' +
    '#etcfg-pane input[type=checkbox]{width:16px;height:16px;flex:0 0 auto;margin:0;accent-color:var(--ui-primary);}' +
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
      revisar();
    });
  }
})();
