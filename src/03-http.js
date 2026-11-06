/* EasyTrac http
   fetch helpers: retries, JSON in datos, multipart. */
(function () {
  'use strict';
  var ET = globalThis.EasyTrac;

  var HDRS = { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' };
  var HDRS_PLAIN = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' };

  /* Wired by the feature that owns the configuration and the logger. */
  function cfg() { return ET.core.http.config || {}; }
  function log() { if (ET.core.log) ET.core.log.apply(null, arguments); }

  /* Cortacircuitos: varios 500 seguidos en poco tiempo = SIRETRAC caído o saturado. */
  var CAIDA = { activa: false, fallos: 0, desde: 0, oyentes: [] };
  var VENTANA_MS = 60000;
  var MAX_FALLOS = 3;
  var MSG_CAIDA = 'SIRETRAC no responde (posible saturación o mantenimiento). Operación cancelada.';

  function caida() { return CAIDA.activa; }

  function alCaer(fn) {
    if (typeof fn !== 'function') return;
    if (CAIDA.activa) { try { fn(MSG_CAIDA); } catch (e) {} return; }
    CAIDA.oyentes.push(fn);
  }

  function avisarCaida() {
    if (CAIDA.activa) return;
    CAIDA.activa = true;
    log('CAIDA', { fallos: CAIDA.fallos });
    for (var i = 0; i < CAIDA.oyentes.length; i++) {
      try { CAIDA.oyentes[i](MSG_CAIDA); } catch (e) {}
    }
  }

  function anotar(status) {
    if (status >= 500) {
      var ahora = Date.now();
      if (!CAIDA.fallos || ahora - CAIDA.desde > VENTANA_MS) { CAIDA.fallos = 0; CAIDA.desde = ahora; }
      CAIDA.fallos += 1;
      if (CAIDA.fallos >= MAX_FALLOS) avisarCaida();
    } else if (status > 0) {
      CAIDA.fallos = 0;
      CAIDA.desde = 0;
    }
  }

  function rechazarCaida() {
    var e = new Error(MSG_CAIDA);
    e.caida = true;
    return Promise.reject(e);
  }

  function pantallaCaida(mensaje) {
    if (typeof document === 'undefined') return;
    function pintar() {
      if (!document.body || document.getElementById('easytrac-caida')) return;
      var caja = document.createElement('div');
      caja.id = 'easytrac-caida';
      caja.setAttribute('role', 'alertdialog');
      caja.setAttribute('aria-modal', 'true');
      caja.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.86);display:flex;align-items:center;justify-content:center;padding:24px;font:400 16px/1.6 var(--ui-font,system-ui),sans-serif;';
      var carta = document.createElement('div');
      carta.style.cssText = 'max-width:560px;width:100%;background:var(--ui-bg,#fff);color:var(--ui-fg,#333);border:2px solid var(--ui-danger,#C60C0E);padding:28px;';
      var titulo = document.createElement('h2');
      titulo.textContent = 'SIRETRAC no responde';
      titulo.style.cssText = 'margin:0 0 12px;font-size:20px;color:var(--ui-danger,#C60C0E);';
      var texto = document.createElement('p');
      texto.textContent = mensaje;
      texto.style.margin = '0 0 12px';
      var ayuda = document.createElement('p');
      ayuda.textContent = 'Se detuvieron las operaciones en curso. Espera unos minutos y recarga la página. Si sigue igual, avisa a sistemas.';
      ayuda.style.margin = '0 0 20px';
      var boton = document.createElement('button');
      boton.type = 'button';
      boton.textContent = 'Recargar página';
      boton.style.cssText = 'background:var(--ui-danger,#C60C0E);color:#fff;border:0;padding:10px 18px;font:inherit;cursor:pointer;';
      boton.onclick = function () { location.reload(); };
      carta.appendChild(titulo);
      carta.appendChild(texto);
      carta.appendChild(ayuda);
      carta.appendChild(boton);
      caja.appendChild(carta);
      document.body.appendChild(caja);
      boton.focus();
    }
    if (document.body) pintar();
    else document.addEventListener('DOMContentLoaded', pintar);
  }

  function esperarMs(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function textoRespuesta(res) {
    return String(res && res.text || '').replace(/\s+/g, ' ').slice(0, 1200);
  }

  function apiPost(url, body, plain) {
    if (CAIDA.activa) return rechazarCaida();
    log(plain ? 'POST PLAIN' : 'POST', { url: url, body: body });
    return fetch(url, { method: 'POST', headers: plain ? HDRS_PLAIN : HDRS, body: body, credentials: 'same-origin' })
      .then(function (r) {
        return r.text().then(function (txt) {
          var j = null; try { j = JSON.parse(txt); } catch (e) {}
          var res = { status: r.status, text: txt, json: j };
          anotar(r.status);
          log('RESPUESTA', { url: url, status: r.status, json: j, text: textoRespuesta(res) });
          return res;
        });
      }).catch(function (e) {
        log('ERROR', { url: url, error: e.message });
        throw e;
      });
  }

  function respuestaReintentable(res) {
    return !res || !res.json || res.status === 408 || res.status === 429 || res.status >= 500;
  }

  function conReintentos(peticion, reintentar) {
    var intento = 0;
    var max = Math.max(1, Number(cfg().DATA_RETRIES) || 3);
    function ejecutar() {
      if (CAIDA.activa) return rechazarCaida();
      intento++;
      return peticion().then(function (res) {
        if (intento < max && reintentar(res)) {
          return esperarMs((Number(cfg().DATA_RETRY_BASE_MS) || 100) * Math.pow(2, intento - 1)).then(ejecutar);
        }
        return res;
      }).catch(function (e) {
        if (CAIDA.activa || e.caida) throw e;
        if (intento < max) {
          return esperarMs((Number(cfg().DATA_RETRY_BASE_MS) || 100) * Math.pow(2, intento - 1)).then(ejecutar);
        }
        throw e;
      });
    }
    return ejecutar();
  }

  function apiPostDatos(url, body) {
    return conReintentos(function () { return apiPost(url, body); }, respuestaReintentable);
  }

  function getJsonDatos(url) {
    return conReintentos(function () {
      return fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
        .then(function (r) {
          return r.text().then(function (txt) {
            var json = null;
            try { json = JSON.parse(txt); } catch (e) {}
            var res = { status: r.status, text: txt, json: json };
            anotar(r.status);
            log('RESPUESTA GET', { url: url, status: r.status, json: json, text: textoRespuesta(res) });
            return res;
          });
        });
    }, function (res) { return respuestaReintentable(res) || !res.json; })
      .then(function (res) {
        if (res.status >= 400) throw new Error('HTTP ' + res.status + ' en ' + url);
        if (!res.json) throw new Error('respuesta no JSON en ' + url);
        return res.json;
      });
  }

  function datosDe(url) {
    return apiPostDatos(url, 'idEstatus=-2').then(function (res) {
      if (!res || res.status >= 400 || !res.json) {
        throw new Error('SIRETRAC devolvió HTTP ' + (res && res.status) + ' en ' + url);
      }
      return res.json.data || [];
    });
  }

  function postMultipart(url, formData) {
    if (CAIDA.activa) return rechazarCaida();
    return fetch(url, {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      body: formData,
      credentials: 'same-origin'
    }).then(function (r) {
      return r.text().then(function (txt) {
        var json = null;
        try { json = JSON.parse(txt); } catch (e) {}
        anotar(r.status);
        return { status: r.status, text: txt, json: json };
      });
    });
  }

  ET.core = ET.core || {};
  ET.core.http = {
    esperarMs: esperarMs,
    textoRespuesta: textoRespuesta,
    apiPost: apiPost,
    respuestaReintentable: respuestaReintentable,
    conReintentos: conReintentos,
    apiPostDatos: apiPostDatos,
    getJsonDatos: getJsonDatos,
    datosDe: datosDe,
    postMultipart: postMultipart,
    caida: caida,
    alCaer: alCaer,
    mensajeCaida: MSG_CAIDA
  };

  if (typeof document !== 'undefined') alCaer(pantallaCaida);
})();
