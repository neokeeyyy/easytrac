/* Update notice: reads the published header, compares versions and offers the install page.
   @grant none means no GM_* here: the check is a plain fetch of the same raw file Tampermonkey
   already uses for @updateURL, so the CDN cache never hides a release. */
(function () {
  'use strict';
  var root = typeof globalThis !== 'undefined' ? globalThis : window;
  var ET = root.EasyTrac = root.EasyTrac || {};

  var FUENTE = 'https://raw.githubusercontent.com/neokeeyyy/easytrac/main/EasyTrac.user.js';
  var CLAVE = 'update'; /* ET.store añade el prefijo easytrac: */
  var SILENCIO = 3 * 24 * 60 * 60 * 1000; // «Ahora no» calla 3 días
  var REVISION = 12 * 60 * 60 * 1000;     // y como mucho se mira dos veces al día
  var ESPERA = 30 * 60 * 1000;            // tras un fallo de red, medio hora

  /* true si remota es más nueva que actual, comparando segmento a segmento. */
  function hayNueva(actual, remota) {
    var a = String(actual || '').split('.');
    var b = String(remota || '').split('.');
    for (var i = 0; i < 3; i++) {
      var x = parseInt(a[i], 10) || 0;
      var y = parseInt(b[i], 10) || 0;
      if (y !== x) return y > x;
    }
    return false;
  }

  function versionDe(texto) {
    var m = /@version\s+([0-9][0-9.]*)/.exec(texto || '');
    return m ? m[1] : '';
  }

  /* La copia de la rama en GitHub raw tarda unos minutos en refrescarse y entonces
     Violentmonkey ofrece «Reinstalar» la versión vieja. El archivo de un tag es
     inmutable, así que la instalación apunta al tag de la versión detectada. */
  function instalarUrl(v) {
    return 'https://raw.githubusercontent.com/neokeeyyy/easytrac/v' +
      encodeURIComponent(v) + '/EasyTrac.user.js';
  }

  var CSS = [
    '#et-upd{position:fixed;left:16px;bottom:16px;z-index:2147482100;width:320px;box-sizing:border-box;',
    'padding:12px;background:var(--ui-bg);border:1px solid var(--ui-border-strong);border-radius:0;',
    'font:400 13px/1.45 var(--ui-font);color:var(--ui-fg);animation:et-upd-in 340ms cubic-bezier(.34,1.56,.64,1) both}',
    '#et-upd.et-upd-out{animation:et-upd-out 140ms ease-in both}',
    '#et-upd .et-upd-t{font-size:14px;margin:0 0 2px}',
    '#et-upd .et-upd-s{color:var(--ui-muted);margin:0 0 10px}',
    '#et-upd .et-upd-a{display:flex;gap:8px}',
    '#et-upd button{font:400 12px/1 var(--ui-font);padding:7px 10px;border:1px solid var(--ui-border-strong);',
    'background:var(--ui-bg);color:var(--ui-fg);border-radius:0;cursor:pointer;transition:background 120ms,transform 140ms}',
    '#et-upd button[data-x="go"]{background:var(--ui-primary);border-color:var(--ui-primary);color:#fff}',
    '#et-upd button[data-x="go"]:hover{background:var(--ui-primary-hover);border-color:var(--ui-primary-hover)}',
    '#et-upd button[data-x="no"]:hover{background:#f5f5f5}',
    '#et-upd button:active{transform:scale(.97)}',
    '@keyframes et-upd-in{0%{opacity:0;transform:translateY(28px) scale(.96)}',
    '60%{opacity:1;transform:translateY(-4px) scale(1.012)}100%{opacity:1;transform:none}}',
    '@keyframes et-upd-out{to{opacity:0;transform:translateY(16px)}}',
    '@media (prefers-reduced-motion:reduce){#et-upd,#et-upd.et-upd-out{animation:none}}',
    '#et-upd-aviso{position:fixed;left:16px;bottom:16px;z-index:2147482100;padding:9px 12px;background:var(--ui-bg);',
    'border:1px solid var(--ui-border-strong);border-radius:0;font:400 13px/1.4 var(--ui-font);color:var(--ui-fg)}',
  ].join('');

  function cerrar(caja, luego) {
    caja.className = 'et-upd-out';
    setTimeout(function () { if (caja.parentNode) caja.parentNode.removeChild(caja); if (luego) luego(); }, 140);
  }

  function mostrar(v) {
    if (document.getElementById('et-upd')) return;
    (ET.ui && ET.ui.style ? ET.ui.style : function () {})(CSS);
    var caja = document.createElement('div');
    caja.id = 'et-upd';
    caja.setAttribute('role', 'alertdialog');
    caja.setAttribute('aria-live', 'polite');
    caja.innerHTML =
      '<p class="et-upd-t"><strong>EasyTRAC ' + v + '</strong> ya está disponible</p>' +
      '<p class="et-upd-s">Tienes la ' + (ET.version || 'anterior') + '. Se instala en un clic.</p>' +
      '<div class="et-upd-a">' +
      '<button type="button" data-x="go">Actualizar ahora</button>' +
      '<button type="button" data-x="no">Ahora no</button>' +
      '</div>';
    caja.addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (!b) return;
      if (b.getAttribute('data-x') === 'go') {
        cerrar(caja);
        window.open(instalarUrl(v), '_blank');
        return;
      }
      var st = ET.store.get(CLAVE, {}) || {};
      st.hasta = Date.now() + SILENCIO;
      ET.store.set(CLAVE, st);
      cerrar(caja);
    });
    document.body.appendChild(caja);
  }

  /* La marca de revisión solo se guarda cuando la consulta responde bien: si la red
     falla, se reintenta a los 30 minutos en la visita siguiente en vez de callar 12 h. */
  function revisar(forzar) {
    var st = ET.store.get(CLAVE, {}) || {};
    var ahora = Date.now();
    if (!forzar) {
      if (st.hasta && ahora < st.hasta) return;
      if (st.visto && ahora - st.visto < REVISION) return;
      if (st.fallo && ahora - st.fallo < ESPERA) return;
    }
    fetch(FUENTE, { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (t) {
        var v = versionDe(t);
        st = ET.store.get(CLAVE, {}) || {};
        st.visto = Date.now();
        delete st.fallo;
        ET.store.set(CLAVE, st);
        if (v && hayNueva(ET.version, v)) mostrar(v);
        else if (forzar) avisar('Ya tienes la última versión (' + ET.version + ').');
      })
      .catch(function () {
        st = ET.store.get(CLAVE, {}) || {};
        st.fallo = Date.now();
        ET.store.set(CLAVE, st);
        if (forzar) avisar('No se pudo consultar GitHub. Revisa tu red y vuelve a intentar.');
      });
  }

  /* Respuesta breve en la esquina, para el botón manual de Ajustes. */
  function avisar(texto) {
    var caja = document.getElementById('et-upd-aviso');
    if (caja) caja.parentNode.removeChild(caja);
    caja = document.createElement('div');
    caja.id = 'et-upd-aviso';
    caja.textContent = texto;
    (ET.ui.style || function () {})(CSS);
    document.body.appendChild(caja);
    setTimeout(function () { if (caja.parentNode) caja.parentNode.removeChild(caja); }, 5000);
  }

  ET.update = { revisar: revisar, hayNueva: hayNueva, versionDe: versionDe, instalarUrl: instalarUrl, fuente: FUENTE };
  if (typeof module !== 'undefined' && module.exports) module.exports = ET.update;

  if (typeof document !== 'undefined' && typeof fetch === 'function') {
    ET.ready(function () {
      setTimeout(revisar, 4000);
      if (ET.config && ET.config.accion) {
        ET.config.accion({
          seccion: 'Aplicación',
          etiqueta: 'Buscar actualizaciones',
          alPulsar: function () { revisar(true); },
        });
      }
    });
  }
})();
