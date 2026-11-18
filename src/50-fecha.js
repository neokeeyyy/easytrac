/* EasyTrac FECHA
   SToolkit: unlock the date fields. */
(function () {
  'use strict';
  var ET = globalThis.EasyTrac;
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
  var limites = null;   /* min/max del campo y del datepicker, para devolverlos al apagar */

  var panel = ET.ui.tab('stoolkit', 'Fecha', 50, 300);
  panel.innerHTML =
    '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;padding:2px 0">' +
      '<input id="stoolkit-sw" type="checkbox" style="width:16px;height:16px;margin:0;cursor:pointer;accent-color:#2EA836">' +
      '<span style="font-weight: 400">Forzar fecha</span>' +
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
    if (on) soltarLimites();
    else restaurarLimites();
  }

  /* Quita el mínimo/máximo del campo y del calendario para poder elegir cualquier fecha pasada. */
  function opcionesDatepicker() {
    try {
      var $c = $(campoFecha);
      if (!$c.hasClass('hasDatepicker') && !$c.data('datepicker')) return null;
      return {
        minDate: $c.datepicker('option', 'minDate'),
        maxDate: $c.datepicker('option', 'maxDate')
      };
    } catch (e) { return null; }
  }

  function soltarLimites() {
    var campo = document.querySelector(campoFecha);
    if (!campo) return;
    if (!limites) {
      limites = {
        min: campo.getAttribute('min'),
        max: campo.getAttribute('max'),
        dp: null
      };
    }
    campo.removeAttribute('min');
    campo.removeAttribute('max');
    if (!limites.dp) limites.dp = opcionesDatepicker();
    if (limites.dp) {
      try { $(campoFecha).datepicker('option', { minDate: null, maxDate: null }); } catch (e) {}
    }
  }

  function restaurarLimites() {
    if (!limites) return;
    var campo = document.querySelector(campoFecha);
    if (campo) {
      if (limites.min === null) campo.removeAttribute('min');
      else campo.setAttribute('min', limites.min);
      if (limites.max === null) campo.removeAttribute('max');
      else campo.setAttribute('max', limites.max);
    }
    if (limites.dp) {
      try { $(campoFecha).datepicker('option', limites.dp); } catch (e) {}
    }
    limites = null;
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

  $(campoFecha).on('focus input change blur', function () { if (activo) { aplicar(true); sincronizar(); } });
  if (formEl) formEl.addEventListener('submit', sincronizar, true);
  sw.addEventListener('change', function () {
    activo = sw.checked;
    try { localStorage.setItem('stoolkit_activo', activo ? '1' : '0'); } catch (e) {}
    aplicar(activo);
    sincronizar();
  });

  if (activo) { aplicar(true); sincronizar(); }

  ET.fecha = ET.fecha || {};
})();
