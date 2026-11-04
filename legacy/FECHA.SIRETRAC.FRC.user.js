// ==UserScript==
// @name         SToolkit
// @namespace    siretrac.stoolkit
// @version      1.6.0
// @match        https://siretrac.cne.gob.mx/GasLP/Ventas/RegistroVentaDisPla
// @match        https://siretrac.cne.gob.mx/GasLP/Ventas/RegistroVentaES
// @match        https://siretrac.cne.gob.mx/GasLP/Compras/NuevoRegistro_IngresaDatos
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /* ===== SHub: menú unificado (copia IDÉNTICA en cada script; el primero en cargar crea el menú) ===== */
  function shubTab(id, titulo, orden, ancho) {
    var D = document;
    if (!D.getElementById('shub-style')) {
      var st = D.createElement('style');
      st.id = 'shub-style';
      st.textContent =
        '#shub-root{position:fixed;top:0;right:0;bottom:0;width:var(--shub-w,320px);z-index:2147483000;display:flex;flex-direction:column;background:#f1f1f1;border-left:1px solid #6f6f6f;box-shadow:-4px 0 18px rgba(0,0,0,.28);font:13px "roboto Neue",roboto,Arial,sans-serif;color:#000;}' +
        '#shub-root *{box-sizing:border-box;}' +
        '#shub-head{background:#6f6f6f;color:#fff;padding:9px 12px;font-weight:bold;font-size:15px;display:flex;justify-content:space-between;align-items:center;user-select:none;}' +
        '#shub-head button{background:#555;border:1px solid #444;border-bottom-width:3px;color:#fff;width:28px;height:24px;cursor:pointer;font-weight:bold;border-radius:3px;line-height:1;}' +
        '#shub-tabs{display:flex;flex-wrap:wrap;background:#fff;border-bottom:1px solid #6f6f6f;}' +
        '.shub-tab{background:none;border:1px solid transparent;border-bottom:none;margin-bottom:-1px;padding:9px 14px;cursor:pointer;color:#333;font:bold 13px "roboto Neue",roboto,Arial,sans-serif;}' +
        '.shub-tab:hover{background:#f1f1f1;color:#000;}' +
        '.shub-tab.on{background:#6f6f6f;color:#fff;border-color:#6f6f6f;}' +
        '#shub-panes{flex:1;min-height:0;overflow:auto;}' +
        '.shub-pane{display:none;padding:10px;}' +
        '.shub-pane.on{display:block;}' +
        '#shub-root.shub-min #shub-tabs,#shub-root.shub-min #shub-panes,#shub-root.shub-min #shub-head span{display:none;}' +
        '#shub-root.shub-min #shub-head{justify-content:center;padding:9px 0;}' +
        'body.shub-shift .content-wrapper,body.shub-shift .right-side,body.shub-shift .main-footer{margin-right:calc(var(--shub-w,320px) + 10px);}' +
        'body.shub-shift .main-header .navbar{margin-right:calc(var(--shub-w,320px) + 10px);display:flex;flex-wrap:nowrap;align-items:center;}' +
        'body.shub-shift .main-header .navbar-header,body.shub-shift .main-header .siretrac_header{float:none;flex:1 1 auto;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}' +
        'body.shub-shift .main-header .navbar-custom-menu,body.shub-shift .main-header .navbar-right{float:none;flex:0 0 auto;}' +
        '#ui-datepicker-div{z-index:2147483647 !important;}';
      (D.head || D.documentElement).appendChild(st);
    }
    var root = D.getElementById('shub-root');
    function layout() {
      var min = root.classList.contains('shub-min'), on = root.querySelector('.shub-pane.on');
      D.documentElement.style.setProperty('--shub-w', (min ? 44 : (on ? +on.getAttribute('data-w') : 320)) + 'px');
      root.querySelector('#shub-min').textContent = min ? '\u00AB' : '\u00BB';
    }
    function activar(tid, guardar) {
      var els = root.querySelectorAll('.shub-tab,.shub-pane');
      for (var i = 0; i < els.length; i++) els[i].classList[els[i].getAttribute('data-id') === tid ? 'add' : 'remove']('on');
      if (guardar) { try { localStorage.setItem('shub_tab', tid); } catch (e) {} }
      layout();
    }
    if (!root) {
      root = D.createElement('div');
      root.id = 'shub-root';
      root.innerHTML = '<div id="shub-head"><span>Toolkit</span><button id="shub-min" type="button" title="Colapsar / expandir">\u00BB</button></div><div id="shub-tabs"></div><div id="shub-panes"></div>';
      D.body.appendChild(root);
      D.body.classList.add('shub-shift');
      try { if (localStorage.getItem('shub_min') === '1') root.classList.add('shub-min'); } catch (e) {}
      root.querySelector('#shub-min').addEventListener('click', function () {
        var m = root.classList.toggle('shub-min');
        try { localStorage.setItem('shub_min', m ? '1' : '0'); } catch (e) {}
        layout();
      });
    }
    var tabs = root.querySelector('#shub-tabs'), panes = root.querySelector('#shub-panes');
    var existente = panes.querySelector('[data-id="' + id + '"]');
    if (existente) return existente;
    var o = String(orden || 99);
    var pane = D.createElement('div');
    pane.className = 'shub-pane';
    pane.setAttribute('data-id', id); pane.setAttribute('data-o', o); pane.setAttribute('data-w', String(ancho || 320));
    var btn = D.createElement('button');
    btn.type = 'button'; btn.className = 'shub-tab'; btn.textContent = titulo;
    btn.setAttribute('data-id', id); btn.setAttribute('data-o', o);
    btn.addEventListener('click', function () { activar(id, true); });
    function insertar(cont, el) {
      var hijos = cont.children, ref = null;
      for (var i = 0; i < hijos.length; i++) { if (+hijos[i].getAttribute('data-o') > +o) { ref = hijos[i]; break; } }
      cont.insertBefore(el, ref);
    }
    insertar(tabs, btn); insertar(panes, pane);
    var guardada = ''; try { guardada = localStorage.getItem('shub_tab') || ''; } catch (e) {}
    if (!root.querySelector('.shub-pane.on') || guardada === id) activar(id, false); else layout();
    return pane;
  }
  /* ===== fin SHub ===== */

  if (typeof jQuery === 'undefined' || typeof $ === 'undefined') return;
  if (!$('#idFechaVenta').length && !$('#idFechaCompra').length) return;

  var esDisPla = $('#idtblVentasEntidad').length > 0;
  var esCompra = $('#idFechaCompra').length > 0;
  var campoFecha = esCompra ? '#idFechaCompra' : '#idFechaVenta';
  var formEl = $(campoFecha).closest('form')[0] || null;

  var activo = false;
  try { activo = localStorage.getItem('stoolkit_activo') === '1'; } catch (e) {}

  var agregadas = [];   /* fechas que metimos en HdFechasActivas, para quitarlas al apagar */
  var reglaVenta = null;    /* {r: regla original} ; r===undefined => no había regla propia */
  var reglaCompra = null;

  var panel = shubTab('stoolkit', 'Fecha', 50, 300);
  panel.innerHTML =
    '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;padding:2px 0">' +
      '<input id="stoolkit-sw" type="checkbox" style="width:16px;height:16px;margin:0;cursor:pointer;accent-color:#2EA836">' +
      '<span style="font-weight:bold">Forzar fecha</span>' +
    '</label>' +
    '<div style="color:#666;font-size:12px;margin-top:6px">Activo: acepta cualquier fecha que escribas en el formulario.</div>';

  var sw = document.getElementById('stoolkit-sw');
  sw.checked = activo;

  function aplicar(on) {
    if (esCompra) {
      try {
        var $c = $('#idFechaCompra');
        if (on) {
          if (!reglaCompra) reglaCompra = $c.rules();
          $c.rules('remove', 'remote');
        } else if (reglaCompra) {
          $c.rules('add', reglaCompra);
          reglaCompra = null;
        }
      } catch (e) {}
    } else {
      try {
        var v = $.data(formEl, 'validator');
        if (v && v.settings && v.settings.rules) {
          if (on) {
            if (!reglaVenta) reglaVenta = { r: v.settings.rules.idFechaVenta };
            v.settings.rules.idFechaVenta = { required: true };
          } else if (reglaVenta) {
            if (reglaVenta.r === undefined) delete v.settings.rules.idFechaVenta;
            else v.settings.rules.idFechaVenta = reglaVenta.r;
            reglaVenta = null;
          }
        }
      } catch (e) {}
    }
    if (!on) {
      var hd = $('#HdFechasActivas');
      if (hd.length) {
        var lista = hd.val() ? String(hd.val()).split(',') : [];
        for (var i = 0; i < agregadas.length; i++) {
          var j = lista.indexOf(agregadas[i]);
          if (j > -1) lista.splice(j, 1);
        }
        hd.val(lista.join(','));
      }
      agregadas = [];
    }
  }

  /* Toma la fecha escrita y la hace pasar por los campos ocultos que revisa el sitio */
  function sincronizar() {
    if (!activo) return;
    var fecha = String($(campoFecha).val() || '').trim();
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(fecha)) return;
    if (esCompra) { $('#hdMsgErrorFecha').val(''); return; }
    $('#HdMensajeFechaVenta').val('');
    if (!esDisPla) return;
    var hd = $('#HdFechasActivas');
    if (!hd.length) return;
    var actuales = hd.val() ? String(hd.val()) : '';
    var lista = actuales ? actuales.split(',') : [];
    if (lista.indexOf(fecha) === -1) {
      lista.push(fecha);
      hd.val(lista.join(','));
      agregadas.push(fecha);
    }
  }

  try {
    var validaOrig = jQuery.validator.methods.ValidaFechaIngreso;
    if (validaOrig) {
      jQuery.validator.methods.ValidaFechaIngreso = function () {
        if (activo) { $('#hdMsgErrorFecha').val(''); return true; }
        return validaOrig.apply(this, arguments);
      };
    }
  } catch (e) {}

  $(campoFecha).on('input change blur', function () { if (activo) { aplicar(true); sincronizar(); } });
  if (formEl) formEl.addEventListener('submit', sincronizar, true);
  sw.addEventListener('change', function () {
    activo = sw.checked;
    try { localStorage.setItem('stoolkit_activo', activo ? '1' : '0'); } catch (e) {}
    aplicar(activo);
    sincronizar();
  });

  if (activo) { aplicar(true); sincronizar(); }
})();