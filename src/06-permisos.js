/* EasyTrac permisos
   Permission discovery shared by the features. */
(function () {
  'use strict';
  var ET = globalThis.EasyTrac;
  var matchInput = ET.core.text.matchInput, matchText = ET.core.text.matchText;

  function escanearPermisos(html) {
    var lista = [];
    var vistos = {};
    var re = /href\s*=\s*["']([^"']*SeleccionarPermiso[^"']*)["']/gi;
    var m;
    while ((m = re.exec(html))) {
      var href = m[1].replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/g, "'");
      if (href.indexOf('idPermiso') === -1) continue;
      var idm = href.match(/idPermiso=(\d+)/);
      if (!idm || vistos[idm[1]]) continue;
      vistos[idm[1]] = true;
      var url = href.indexOf('http') === 0 ? href : href.indexOf('/') === 0 ? href : '/' + href;
      lista.push({ id: idm[1], url: url });
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
    permisoUrlPorId: permisoUrlPorId,
    permisoDeUrl: permisoDeUrl
  };
})();
