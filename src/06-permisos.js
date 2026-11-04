/* EasyTrac permisos
   Permission discovery shared by the features. */
(function () {
  'use strict';
  var ET = globalThis.EasyTrac;
  var matchInput = ET.core.text.matchInput, matchText = ET.core.text.matchText;

  /* Devuelve { id, codigo, url }: `id` es el idPermiso interno y `codigo` el LP/… que ve el usuario. */
  function escanearPermisos(html) {
    html = String(html || '');
    var lista = [];
    var vistos = {};
    function add(id, codigo, href) {
      if (!id || vistos[id] || !href) return;
      vistos[id] = true;
      var url = href.indexOf('http') === 0 ? href : href.indexOf('/') === 0 ? href : '/' + href;
      lista.push({ id: id, codigo: codigo || '', url: url });
    }
    // La tabla #example trae el código visible; el regex de hrefs es el respaldo.
    if (typeof DOMParser === 'function') {
      permisosDeDocumento(new DOMParser().parseFromString(html, 'text/html')).forEach(function (p) {
        add(p.id, p.nombre, p.href);
      });
    }
    var re = /href\s*=\s*["']([^"']*SeleccionarPermiso[^"']*)["']/gi;
    var m;
    while ((m = re.exec(html))) {
      var href = m[1].replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/g, "'");
      if (href.indexOf('idPermiso') === -1) continue;
      var idm = href.match(/idPermiso=(\d+)/);
      if (idm) add(idm[1], '', href);
    }
    return lista;
  }

  // Forma canónica: { id, nombre, href, razon, materia, actividad }; nombre = texto del permiso, href = enlace SeleccionarPermiso.
  function permisosDeDocumento(doc) {
    var tabla = doc.querySelector('#example');
    if (!tabla) return [];
    var norm = function (t) {
      return String(t == null ? '' : t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    };
    var cab = [].map.call(tabla.querySelectorAll('thead th'), function (x) { return norm(x.textContent || ''); });
    if (cab.length && (!cab.some(function (h) { return h.indexOf('permiso') !== -1; }) ||
      !cab.some(function (h) { return h.indexOf('razon social') !== -1; }))) return [];
    var lista = [], vistos = Object.create(null);
    var filas = tabla.querySelectorAll('tbody tr');
    for (var i = 0; i < filas.length; i++) {
      var tr = filas[i], tds = tr.cells || [];
      if (tds.length < 2) continue;
      var nombre = String(tds[1].textContent || '').trim();
      if (!nombre) continue;
      var a = tr.querySelector('a[href*="idPermiso="]');
      var href = a ? (a.getAttribute('href') || '') : '';
      var id = '';
      if (href) {
        try { id = new URL(href, 'https://siretrac.cne.gob.mx/').searchParams.get('idPermiso') || ''; }
        catch (e) { id = ''; }
      }
      if (!id) {
        var raw = String(tds[0] ? tds[0].textContent : '').trim();
        if (/^\d+$/.test(raw) && raw !== '0') id = raw;
      }
      if (!id || vistos[id]) continue;
      vistos[id] = true;
      lista.push({
        id: id,
        nombre: nombre,
        href: href,
        razon: String(tds[2] ? tds[2].textContent : '').trim(),
        materia: String(tds[3] ? tds[3].textContent : '').trim(),
        actividad: String(tds[4] ? tds[4].textContent : '').trim()
      });
    }
    return lista;
  }

  function permisoUrlPorId(id) {
    return '/OrdenDePedido/SeleccionarPermiso?idPermiso=' + encodeURIComponent(id) +
      '&permiso=&idPermisionario=0&idPermisoMateria=0&idPermisoActividad=0&razonSocial=&estatus=False&capacidadOperativa=0';
  }

  function permisoDeUrl(url) {
    try {
      var idx = String(url).indexOf('?');
      var params = new URLSearchParams(idx === -1 ? '' : url.substring(idx + 1));
      return params.get('permiso') || '';
    } catch (e) {
      return '';
    }
  }

  ET.core = ET.core || {};
  ET.core.permisos = {
    escanearPermisos: escanearPermisos,
    permisosDeDocumento: permisosDeDocumento,
    permisoUrlPorId: permisoUrlPorId,
    permisoDeUrl: permisoDeUrl
  };
})();
