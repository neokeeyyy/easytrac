/* EasyTrac Repetir compra
   Guarda el permiso que recibe y la comercializadora al registrar una compra,
   y vuelve a abrir el formulario con esos mismos datos. */
(function () {
  'use strict';
  var ET = globalThis.EasyTrac;
  var W = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : (typeof window !== 'undefined' ? window : globalThis);

  var URL_TIPO = '/GasLP/Compras/NuevoRegistro_SeleccionaTipoSuministrador';
  var URL_GUARDA = 'GuardaCompraGasLP';
  var MAX = 50;
  var BANDERA = 'et_compra_repetir';
  var CLAVES = {
    receptor: 'compra_receptor',
    comercializadora: 'compra_comercializadora',
    tipo: 'compra_tipo',
    registros: 'compra_registros'
  };

  function get(clave, defecto) {
    try { return ET.store ? ET.store.get(clave, defecto) : defecto; } catch (e) { return defecto; }
  }

  function set(clave, valor) {
    try { if (ET.store) ET.store.set(clave, valor); } catch (e) {}
  }

  function dos(n) { return String(n).padStart(2, '0'); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Variables que la página de datos escribe inline.
  function parseDatos(html) {
    var txt = String(html || '');
    function leer(nombre) {
      var re = new RegExp('(?:^|[^\\w$])' + nombre + '\\s*=\\s*([\'"])([\\s\\S]*?)\\1');
      var m = re.exec(txt);
      if (m) return m[2].trim();
      re = new RegExp('(?:^|[^\\w$])' + nombre + '\\s*=\\s*(-?\\d+)');
      m = re.exec(txt);
      return m ? m[1] : '';
    }
    return {
      idVendedor: leer('idVendedor'),
      idComprador: leer('idComprador'),
      nombreComprador: leer('NombreComprador')
    };
  }

  function numeroDe(texto, href) {
    var m = /N[uú]mero de registro de compra\s*:?\s*(LP\/\d+\/\d+\/\d+)/i.exec(String(texto || ''));
    if (m) return m[1];
    var h = /[?&]codigo=((?:LP|CNE%2FLP)(?:%2F|\/)\d+(?:%2F|\/)\d+(?:%2F|\/)\d+)/i.exec(String(href || ''));
    if (h) {
      try { return decodeURIComponent(h[1]); } catch (e) { return h[1]; }
    }
    return '';
  }

  function agregarRegistro(lista, entrada) {
    var arr = Array.isArray(lista) ? lista.slice() : [];
    if (!entrada || !entrada.n) return arr;
    arr = arr.filter(function (x) { return !x || x.n !== entrada.n; });
    arr.unshift(entrada);
    return arr.slice(0, MAX);
  }

  function pasoDe(href) {
    var p = String(href || '').toLowerCase();
    if (p.indexOf('seleccionatiposuministrador') !== -1) return 'tipo';
    if (p.indexOf('seleccionasuministrador') !== -1) return 'suministrador';
    if (p.indexOf('ingresadatos') !== -1) return 'datos';
    if (p.indexOf('paginaconfirmacion') !== -1) return 'confirmacion';
    return '';
  }

  function receptorActual() {
    var el = document.getElementById('codigoregistro');
    if (el && el.value) return el.value.trim();
    var n = document.querySelector('.navbar-custom-menu .hidden-xss');
    if (n && n.textContent.trim()) return n.textContent.trim();
    var d = parseDatos(document.documentElement ? document.documentElement.innerHTML : '');
    return d.nombreComprador || '';
  }

  function leerTipo() {
    var sel = document.getElementById('idRC_cmbTipoSuministrador');
    if (!sel || sel.selectedIndex < 0) return null;
    var opt = sel.options[sel.selectedIndex];
    if (!sel.value) return null;
    return { id: String(sel.value), nombre: String(opt.textContent || '').trim() };
  }

  function guardarTipo() {
    var tipo = leerTipo();
    if (!tipo) return;
    set(CLAVES.tipo, tipo);
    pintarEstado();
  }

  function guardarComercializadora(el) {
    var m = /ShowIngresaDatosCompra\(\s*(\d+)\s*\)/.exec(el.getAttribute('onclick') || '');
    var nombre = String(el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!m && !nombre) return;
    set(CLAVES.comercializadora, { id: m ? m[1] : '', nombre: nombre });
    var receptor = receptorActual();
    if (receptor) set(CLAVES.receptor, receptor);
    pintarEstado();
  }

  function guardarDatos() {
    var d = parseDatos(document.documentElement ? document.documentElement.innerHTML : '');
    var com = get(CLAVES.comercializadora, null);
    if (d.idVendedor && (!com || !com.id)) {
      set(CLAVES.comercializadora, { id: d.idVendedor, nombre: com ? com.nombre : '' });
    }
    var receptor = receptorActual();
    if (receptor) set(CLAVES.receptor, receptor);
    pintarEstado();
  }

  function decir(t, err) {
    var m = document.getElementById('rc-msg');
    if (!m) return;
    m.textContent = t;
    m.style.color = err ? '#C60C0E' : '#706F6F';
  }

  function pintarEstado() {
    var r = document.getElementById('rc-recibe');
    var c = document.getElementById('rc-com');
    var b = document.getElementById('rc-repetir');
    if (!r || !c || !b) return;
    var receptor = get(CLAVES.receptor, '');
    var com = get(CLAVES.comercializadora, null);
    var tipo = get(CLAVES.tipo, null);
    r.textContent = 'Recibe: ' + (receptor || 'sin capturar');
    c.textContent = 'Comercializadora: ' + (com && com.nombre ? com.nombre : 'sin capturar');
    var listo = !!(com && com.id && tipo && tipo.id);
    b.disabled = !listo;
    b.style.opacity = listo ? '1' : '.55';
    b.style.cursor = listo ? 'pointer' : 'not-allowed';
    if (!listo) decir('Elige tipo y comercializadora una vez al registrar una compra.', false);
  }

  function pintarLog() {
    var box = document.getElementById('rc-log');
    if (!box) return;
    var lista = get(CLAVES.registros, []);
    if (!Array.isArray(lista) || !lista.length) {
      box.innerHTML = '<div style="font-size:11px;color:#706F6F">Sin registros todavía.</div>';
      return;
    }
    var html = '<table style="width:100%;border-collapse:collapse;font-size:10px;line-height:1.3">' +
      '<thead><tr><th style="text-align:left;border-bottom:1px solid #ccc">Registro</th>' +
      '<th style="text-align:left;border-bottom:1px solid #ccc">Fecha</th>' +
      '<th style="text-align:left;border-bottom:1px solid #ccc">Comercializadora</th></tr></thead><tbody>';
    lista.forEach(function (r) {
      html += '<tr><td style="padding:2px 0;border-bottom:1px solid #eee">' + esc(r.n) + '</td>' +
        '<td style="border-bottom:1px solid #eee;white-space:nowrap">' + esc(r.f) + ' ' + esc(r.h) + '</td>' +
        '<td style="border-bottom:1px solid #eee;max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' +
        esc(r.comercializadora) + '">' + esc(r.comercializadora) + '</td></tr>';
    });
    box.innerHTML = html + '</tbody></table>';
  }

  function registrar(num) {
    if (!num) return;
    var d = new Date();
    var com = get(CLAVES.comercializadora, null);
    var entrada = {
      n: num,
      f: d.getFullYear() + '-' + dos(d.getMonth() + 1) + '-' + dos(d.getDate()),
      h: dos(d.getHours()) + ':' + dos(d.getMinutes()),
      receptor: get(CLAVES.receptor, ''),
      comercializadora: com ? (com.nombre || '') : ''
    };
    set(CLAVES.registros, agregarRegistro(get(CLAVES.registros, []), entrada));
    pintarLog();
  }

  function escanearConfirmacion() {
    var num = numeroDe(document.body ? document.body.innerText : '', location.href);
    if (num) registrar(num);
  }

  function limpiarBandera() {
    try { sessionStorage.removeItem(BANDERA); } catch (e) {}
  }

  function leerGuardado(txt) {
    try {
      var j = typeof txt === 'string' ? JSON.parse(txt) : txt;
      if (!j) return '';
      if (j.result !== true && j.success !== true && j.result !== 'true' && j.success !== 'true') return '';
      var m = /LP\/\d+\/\d+\/\d+/.exec(String(j.mensaje || ''));
      return m ? m[0] : '';
    } catch (e) { return ''; }
  }

  function esGuarda(url) {
    return String(url || '').indexOf(URL_GUARDA) !== -1;
  }

  // La página no siempre muestra la confirmación: también se lee la respuesta del guardado.
  function parchearRed() {
    if (W.__etCompraRed) return;
    W.__etCompraRed = true;
    if (typeof W.fetch === 'function') {
      var f = W.fetch;
      W.fetch = function () {
        var p = f.apply(this, arguments);
        try {
          var u = arguments[0];
          var url = typeof u === 'string' ? u : (u && u.url) || '';
          if (esGuarda(url)) {
            p.then(function (r) {
              r.clone().text().then(function (t) {
                var n = leerGuardado(t);
                if (n) registrar(n);
              }).catch(function () {});
            }).catch(function () {});
          }
        } catch (e) {}
        return p;
      };
    }
    var X = W.XMLHttpRequest;
    if (X && X.prototype) {
      var open = X.prototype.open, send = X.prototype.send;
      X.prototype.open = function (m, u) {
        this.__etUrl = u;
        return open.apply(this, arguments);
      };
      X.prototype.send = function () {
        var xhr = this;
        if (esGuarda(xhr.__etUrl)) {
          xhr.addEventListener('load', function () {
            var n = leerGuardado(xhr.responseText);
            if (n) registrar(n);
          });
        }
        return send.apply(this, arguments);
      };
    }
  }

  function avanzar() {
    var activa = false;
    try { activa = sessionStorage.getItem(BANDERA) === '1'; } catch (e) {}
    if (!activa) return;
    var paso = pasoDe(location.href);
    if (paso === 'tipo') {
      var tipo = get(CLAVES.tipo, null);
      var sel = document.getElementById('idRC_cmbTipoSuministrador');
      if (!tipo || !tipo.id || !sel) {
        decir('No pude elegir el tipo guardado.', true);
        limpiarBandera();
        return;
      }
      sel.value = String(tipo.id);
      if (String(sel.value) !== String(tipo.id)) {
        decir('El tipo guardado ya no está disponible.', true);
        limpiarBandera();
        return;
      }
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      var btn = document.getElementById('idbtonAceptar');
      if (btn) btn.click();
      else {
        decir('No encontré el botón Aceptar.', true);
        limpiarBandera();
      }
    } else if (paso === 'suministrador') {
      var com = get(CLAVES.comercializadora, null);
      var link = null;
      var links = document.querySelectorAll('[onclick*="ShowIngresaDatosCompra"]');
      for (var i = 0; i < links.length; i++) {
        var m = /ShowIngresaDatosCompra\(\s*(\d+)\s*\)/.exec(links[i].getAttribute('onclick') || '');
        if (m && com && String(m[1]) === String(com.id)) { link = links[i]; break; }
      }
      if (link) link.click();
      else if (com && com.id && typeof W.ShowIngresaDatosCompra === 'function') W.ShowIngresaDatosCompra(com.id);
      else {
        decir('No encontré la comercializadora guardada.', true);
        limpiarBandera();
      }
    } else if (paso === 'datos') {
      limpiarBandera();
      decir('Formulario abierto: captura volumen, precio y fecha; no se envía solo.', false);
    }
  }

  function repetir() {
    var com = get(CLAVES.comercializadora, null);
    var tipo = get(CLAVES.tipo, null);
    if (!com || !com.id || !tipo || !tipo.id) {
      decir('Falta el tipo o la comercializadora; regístralos una vez.', true);
      return;
    }
    var receptor = receptorActual();
    if (receptor) set(CLAVES.receptor, receptor);
    try { sessionStorage.setItem(BANDERA, '1'); } catch (e) {}
    location.href = URL_TIPO;
  }

  function capturar() {
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('#idbtonAceptar')) guardarTipo();
      var link = t.closest('[onclick*="ShowIngresaDatosCompra"]');
      if (link) guardarComercializadora(link);
    }, true);
    var paso = pasoDe(location.href);
    if (paso === 'datos') guardarDatos();
    if (paso === 'confirmacion') escanearConfirmacion();
  }

  function iniciar() {
    if (typeof document === 'undefined' || !/\/GasLP\/Compras\//i.test(location.href)) return;
    if (document.getElementById('rc-repetir')) return;
    parchearRed();
    var panel = ET.ui.tab('repetir', 'Repetir compra', 62, 340);
    panel.innerHTML =
      '<div style="font-size:12px;color:#706F6F;padding:2px 0">Guarda el permiso que recibe y la comercializadora al registrar una compra, y repite el formulario con esos datos.</div>' +
      '<div id="rc-recibe" style="font-size:12px;padding:3px 0"></div>' +
      '<div id="rc-com" style="font-size:12px;padding:0 0 3px"></div>' +
      '<button id="rc-repetir" type="button" style="width:100%;border:0;background:#2EA836;color:#fff;padding:6px 14px;font:inherit;cursor:pointer;margin:4px 0">Repetir compra</button>' +
      '<div id="rc-msg" style="color:#706F6F;font-size:12px"></div>' +
      '<div id="rc-log" style="margin-top:8px"></div>';
    document.getElementById('rc-repetir').addEventListener('click', repetir);
    pintarEstado();
    pintarLog();
    capturar();
    setTimeout(avanzar, 80);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseDatos: parseDatos, numeroDe: numeroDe, agregarRegistro: agregarRegistro, pasoDe: pasoDe };
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
    else iniciar();
  }
})();
