/* EasyTrac ACUSES
   Acuse downloader: analyse, download ZIP, print. */
(function () {
  'use strict';
  var ET = globalThis.EasyTrac;
  // ===================== Utilidades puras (sin DOM; se prueban en Node) =====================
  const MES = { ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12 };
  const pad2 = n => String(n).padStart(2, '0');

  const mk = (y, m, d) => {
    y = +y; m = +m; d = +d;
    if (y < 100) y += 2000;
    const t = new Date(y, m - 1, d);
    return (y >= 1990 && y <= 2100 && t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d) ? t : null;
  };

  // Fecha tolerante: 14-092026, 1409/2026, 20260914, 14 sep 2026, ISO, con hora...
  function dmy(s) {
    s = String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (!s) return null;
    s = s.replace(/(ene|jan|feb|mar|abr|apr|may|jun|jul|ago|aug|sep|set|oct|nov|dic|dec)[a-z]*\.?/g, (_, m) => ' ' + MES[m] + ' ')
         .replace(/\bde\b/g, ' ')
         .replace(/(\d)t(\d)/, '$1 $2')
         .replace(/\s*\d{1,2}:\d{2}.*$/, '');
    const g = s.match(/\d+/g) || [];
    if (g.length >= 3) {
      const [a, b, c] = g;
      if (a.length >= 4) return mk(a, b, c) || mk(a, c, b);
      return mk(c, b, a) || mk(c, a, b);
    }
    const D = g.join('');
    if (D.length === 8) {
      const y0 = +D.slice(0, 4);
      return (y0 >= 1990 && y0 <= 2100 && (mk(D.slice(0, 4), D.slice(4, 6), D.slice(6)) || mk(D.slice(0, 4), D.slice(6), D.slice(4, 6))))
        || mk(D.slice(4), D.slice(2, 4), D.slice(0, 2)) || mk(D.slice(4), D.slice(0, 2), D.slice(2, 4));
    }
    if (D.length === 7) {
      const y = D.slice(3), r = D.slice(0, 3), y2 = D.slice(0, 4), r2 = D.slice(4);
      return mk(y, r.slice(1), r[0]) || mk(y, r[2], r.slice(0, 2))
        || mk(y2, r2.slice(1), r2[0]) || mk(y2, r2[2], r2.slice(0, 2));
    }
    if (D.length === 6) return mk(D.slice(4), D.slice(2, 4), D.slice(0, 2));
    return null;
  }

  const ddmmaaaa = d => pad2(d.getDate()) + pad2(d.getMonth() + 1) + d.getFullYear();
  const isoFecha = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  const fTxt = d => (d instanceof Date && !isNaN(d)) ? pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear() : '';
  const mismoDia = (a, b) => !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  // Semana ISO de una fecha: '2026-W45'
  function semanaISO(d) {
    const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dia = (t.getDay() + 6) % 7;                 // lunes = 0
    t.setDate(t.getDate() - dia + 3);                 // jueves de esa semana
    const primero = new Date(t.getFullYear(), 0, 4);
    const sem = 1 + Math.round(((t - primero) / 86400000 - 3 + ((primero.getDay() + 6) % 7)) / 7);
    return t.getFullYear() + '-W' + pad2(sem);
  }

  // '2026-W45' -> { lunes: 2026-11-02, domingo: 2026-11-08 }; null si la semana no existe
  function semanaDe(iso) {
    const m = /^(\d{4})-W(\d{1,2})$/.exec(String(iso || '').trim());
    if (!m) return null;
    const anio = +m[1], sem = +m[2];
    if (sem < 1) return null;
    const ultima = +String(semanaISO(new Date(anio, 11, 28))).split('-W')[1];   // el 28-dic siempre cae en la última semana ISO
    if (sem > ultima) return null;
    const ene4 = new Date(anio, 0, 4);
    const lunes1 = new Date(anio, 0, 4 - ((ene4.getDay() + 6) % 7));
    const lunes = new Date(lunes1);
    lunes.setDate(lunes1.getDate() + (sem - 1) * 7);
    const domingo = new Date(lunes);
    domingo.setDate(lunes.getDate() + 6);
    return { lunes, domingo };
  }

  const nk = k => String(k == null ? '' : k).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const safe = x => String(x).replace(/[\\/:*?"<>|]+/g, '_').trim();
  const seg = x => safe(x).replace(/\s+/g, ' ').replace(/[. ]+$/, '').slice(0, 90) || 'SIN_DATO';
  const esc = x => String(x == null ? '' : x).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';

  // Fechas de la cadena original: solo claves que contengan "fecha".
  function fechasCadena(o) {
    return Object.keys(o || {})
      .filter(k => /fecha/i.test(k))
      .map(k => ({ clave: k, d: dmy(o[k]) }))
      .filter(x => x.d);
  }

  // Familia de la operación para elegir la fecha de la cadena que le corresponde.
  const FAMILIA = {
    VENTA: /venta/,
    COMPRA: /compra/,
    TRASPASO: /traspaso/,
    DESPACHO: /despacho/,
    RECEPCION: /recep/,
    ENTREGA: /entrega/,
    ACEPTACION: /aceptaci/
  };
  function familiaFecha(it) {
    const t = nk(String((it && it.tipoAcuse) || '') + ' ' + String((it && it.tituloAcuse) || ''));
    if (/recep/.test(t)) return 'RECEPCION';
    if (/entreg/.test(t)) return 'ENTREGA';
    if (/despacho/.test(t)) return 'DESPACHO';
    if (/traspaso/.test(t)) return 'TRASPASO';
    if (/aceptaci/.test(t)) return 'ACEPTACION';
    if (/venta/.test(t)) return 'VENTA';
    if (/compra/.test(t)) return 'COMPRA';
    return '';
  }

  // Fecha de OPERACIÓN: fechas de la cadena distintas (por día) de la Fecha Acuse; se prefiere la
  // clave del tipo de operación y, si no hay, la más temprana. Sin candidata: Fecha Acuse (aprox.).
  function fechaOpDe(c, it) {
    it = it || {};
    const o = (c && c.o) || {};
    const fa = dmy(it.fechaAcuse);
    const todas = fechasCadena(o);
    const fam = familiaFecha(it);
    // Tipos sin fecha de operación (precios, inventario, facturas...): el periodo es la Fecha Acuse.
    // Así entran todos los acuses aunque su cadena traiga fechas de vigencia o publicación.
    if (!fam) {
      const op = todas.find(x => /operaci/.test(nk(x.clave)));
      if (op) return { d: op.d, fuente: op.clave, aprox: false };
      if (fa) return { d: fa, fuente: 'Fecha Acuse (tipo sin operación)', aprox: false };
    }
    const resto = fa ? todas.filter(x => !mismoDia(x.d, fa)) : todas;
    const preferidas = fam ? resto.filter(x => FAMILIA[fam].test(nk(x.clave))) : [];
    const lista = (preferidas.length ? preferidas : resto).slice().sort((a, b) => a.d - b.d);
    if (lista.length) return { d: lista[0].d, fuente: lista[0].clave, aprox: false };
    if (fa) return { d: fa, fuente: 'Fecha Acuse', aprox: true };
    return { d: null, fuente: '', aprox: true };
  }

  // Texto de la fila: el NOR, o VTA-<permiso>-<DDMMAAAA> en ventas y acuses sin NOR.
  function labelDe(r) {
    r = r || {};
    const nor = String(r.nor || '').trim();
    const op = String(r.op || '').toUpperCase().replace(/\s+/g, '_') || 'ACU';
    const venta = op === 'VENTA';
    if (nor && nor !== 'SIN_NOR' && !venta) return nor;
    const d = r.fOp;
    return (venta ? 'VTA' : op) + '-' + String(r.perm || 'SIN_PERMISO') + '-' + (d instanceof Date && !isNaN(d) ? ddmmaaaa(d) : '');
  }

  // ---------- Campos del listado y de la cadena ----------
  const vItem = (it, ...nombres) => {
    it = it || {};
    for (const n of nombres) { const v = it[n]; if (v != null && String(v).trim()) return String(v).trim(); }
    return '';
  };
  const campoPor = (o, re) => {
    const k = Object.keys(o || {}).find(k => re.test(nk(k)));
    return k ? o[k] : '';
  };

  // Fecha Acuse del listado (siempre con dmy, nunca con new Date del texto).
  function fechaDe(it) {
    const d = dmy(it && it.fechaAcuse);
    return d ? { d, k: 'Fecha Acuse', origen: 'listado' } : null;
  }

  // Tipo de operación: SOLO desde el SUBTIPO (tipoAcuse), nunca desde "Tipo de registro".
  function tipoOp(it, sub) {
    it = it || {};
    const f = [sub && sub.clave, it.tipoAcuse].map(x => nk(String(x == null ? '' : x)));
    if (f.some(x => /recep/.test(x))) return 'RECEPCION';
    if (f.some(x => /entreg/.test(x))) return 'ENTREGA';
    if (f.some(x => /despacho/.test(x))) return 'DESPACHO';
    if (f.some(x => /traspaso|transferencia/.test(x))) return 'TRASPASO';
    if (f.some(x => /aceptaci/.test(x))) return 'ACEPTACION';
    if (f.some(x => /venta/.test(x))) return 'VENTA';
    if (f.some(x => /compra/.test(x))) return 'COMPRA';
    if (f.some(x => /precio/.test(x))) return 'PRECIO';
    if (f.some(x => /inventario/.test(x))) return 'INVENTARIO';
    if (f.some(x => /factura/.test(x))) return 'FACTURA';
    return safe(it.tipoAcuse || 'OTROS').toUpperCase() || 'OTROS';
  }

  // ---------- Sigla del subtipo = VERBO + R + TIPO (ARR, CRC, NRC, RRC, DRC...) ----------
  const PARE = new Set('de del la el los las un una unos unas y o en a al por con para sobre acuse acuses no num numero folio codigo tipo estado solicitud fecha'.split(' '));
  const TIPOS = ('compra C COMPRA|compras C COMPRA|venta V VENTA|ventas V VENTA|recepcion R RECEPCION|recepciones R RECEPCION|' +
    'entrega E ENTREGA|entregas E ENTREGA|despacho D DESPACHO|despachos D DESPACHO|aceptacion A ACEPTACION|aceptaciones A ACEPTACION|' +
    'inventario I INVENTARIO|factura F FACTURA|facturas F FACTURA|precio P PRECIO|precios P PRECIO|' +
    'traspaso T TRASLADO|transferencia T TRASLADO').split('|').map(s => s.split(' '));
  const limpia = t => nk(String(t == null ? '' : t)).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const palabras = t => limpia(t).split(' ').filter(x => x && !PARE.has(x) && !/^\d+$/.test(x));
  const esTipo = w => TIPOS.find(t => w.startsWith(t[0]));
  const esCont = w => /^(registr|acuse|solicitud|document)/.test(w);

  function siglaDe(texto) {
    const orig = String(texto == null ? '' : texto).replace(/\s+/g, ' ').trim();
    const w = palabras(orig);
    const ci = w.findIndex(esCont);
    const ni = w.findIndex(esTipo);
    if (w.length < 2) return null;
    if (ci < 0 && ni !== w.length - 1 && ni !== 0) return null;
    const tipo = w[ni < 0 ? 0 : ni], [t, L, op] = esTipo(tipo) || [tipo, tipo[0].toUpperCase(), ''];
    const v = ci > 0 ? w[ci - 1] : ci < 0 ? (ni === 0 ? w[1] : w[0]) : null;
    return v ? { texto: orig, sigla: (v[0] + 'R' + L).toUpperCase(), clave: v + '-' + t, tipo: t, op }
      : { texto: orig, sigla: 'R' + L, clave: 'registro-' + t, tipo: t, op };
  }

  function subtipo(o, it) {
    it = it || {}; o = o || {};
    const subtipoDe = obj => Object.keys(obj).filter(k => /subtipo|tipo\s*de\s*acuse/i.test(k)).flatMap(k => [obj[k], k + ' ' + obj[k]]);
    for (const v of [vItem(it, 'tipoAcuse', 'subtipo', 'subTipo', 'nombreSubtipo', 'descripcionSubtipo'),
      ...subtipoDe(o), it.tipoAcuse]) {
      const r = siglaDe(v);
      if (r) return r;
    }
    const tit = String(it.tipoAcuse || '').replace(/\s+/g, ' ').trim();
    const w = palabras(tit), ini = w.map(x => x[0]).join('').toUpperCase();
    if (w.length >= 2 && w.length <= 5) return { texto: tit, sigla: ini, clave: ini };
    const L = w.length > 1 ? (esTipo(w[0]) || [])[1] : null;
    if (L) return { texto: tit, sigla: (w[1] ? w[1][0] : 'R') + 'R' + L, clave: w[1] + '-' + w[0] };
    return { texto: '', sigla: 'SIN_TIPO', clave: 'SIN_TIPO' };
  }

  // Razón social según la operación (Comprador / Suministrador).
  function razonSocial(o, op) {
    o = o || {};
    const k = Object.keys(o).find(x => /raz[oó]n\s*social/i.test(x) && (op === 'VENTA' ? /suministr|vended/i.test(x) : /comprador/i.test(x)))
      || Object.keys(o).find(x => /raz[oó]n\s*social/i.test(x));
    return seg(k ? o[k] : '');
  }

  // Permiso del acuse (define carpeta, nombres y estación de impresión).
  function permisoDe(op, o, it) {
    o = o || {}; it = it || {};
    const ks = Object.keys(o).filter(k => /^permiso/.test(nk(k)));
    const w = x => { const k = ks.find(k => nk(k).includes(x)); return k ? o[k] : ''; };
    const cmp = vItem(it, 'comprador', 'permisoComprador'), vnd = vItem(it, 'vendedor', 'permisoVendedor'),
      per = vItem(it, 'permiso', 'permisoPropietario');
    const L = (op === 'COMPRA' || op === 'RECEPCION' || op === 'ACEPTACION') ? [w('comprador'), cmp, per]
      : (op === 'VENTA' || op === 'DESPACHO') ? [w('vendedor'), w('suministrador'), vnd, per]
      : [w('propietario'), w('vendedor'), w('comprador'), per, vnd, cmp, it.permisoPropietario];
    L.push(o[ks[0]], it.permisoPropietario);
    const v = L.find(x => x && String(x).trim());
    return v ? String(v).trim() : 'SIN_PERMISO';
  }

  // La cadena original es una secuencia plana "clave=valor|clave=valor|...".
  // No todas empiezan con Folio/Codigo (los despachos empiezan con Permiso Comprador),
  // así que se recorta el bloque y se toma el tramo con más segmentos.
  function parseCadenaTexto(texto) {
    const t = String(texto == null ? '' : texto).replace(/\s+/g, ' ').trim();
    if (!t) return null;
    const ini = t.search(/cadena\s+original/i);
    const fin = t.search(/hash\s+[uú]nico/i);
    const zona = ini >= 0 ? t.slice(ini + 15, fin > ini ? fin : t.length) : t;
    let mejor = '';
    for (const m of zona.matchAll(/\|?[^|=<>]{1,80}=[^|<>]*(?:\|[^|=<>]{1,80}=[^|<>]*)+/g)) {
      if (m[0].length > mejor.length) mejor = m[0];
    }
    if (!mejor) return null;
    const txt = mejor.replace(/^\|+|\|+$/g, '');
    const o = {};
    txt.split('|').forEach(p => {
      const i = p.indexOf('=');
      if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1).trim();
    });
    if (!Object.keys(o).length) return null;
    return { raw: txt.trim(), o };
  }

  function parseCadena(html) {
    if (typeof DOMParser === 'undefined') return parseCadenaTexto(html);
    const doc = new DOMParser().parseFromString(String(html == null ? '' : html), 'text/html');
    return parseCadenaTexto(doc.body ? doc.body.textContent : html);
  }

  const esPlantaDist = p => /distribuidor|\/dist\//i.test(String(p.actividad || '') + ' ' + String(p.codigo || ''));
  const ordenPermisos = ps => ps.slice().sort((a, b) => (esPlantaDist(a) ? 1 : 0) - (esPlantaDist(b) ? 1 : 0));

  // Escaneo de permisos: la misma tabla #example que usa siretrac-traspasos.user.js.
  // Alias del escáner único: { id, codigo, razon, actividad } para el resto de este módulo.
  function permisosDeTabla(doc) {
    return ET.core.permisos.permisosDeDocumento(doc).map(p => ({
      id: p.id, codigo: p.nombre, razon: p.razon, actividad: p.actividad
    }));
  }

  // Export para node:test. En el navegador se ignora.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { dmy, semanaDe, semanaISO, fechasCadena, fechaOpDe, labelDe, tipoOp, subtipo, parseCadenaTexto, permisosDeTabla };
  }

  // ===================== Arranque DOM =====================
  if (typeof document !== 'undefined' && /\/GasLP\/|OrdenDePedido/i.test(location.href)) iniciar();

  function iniciar() {
    if (document.getElementById('sa-panel')) return;

    const $ = s => document.querySelector(s);
    const BUSCA = '/GasLP/Administracion/BuscaAcuse';
    const WORKERS = 10;
    const AVISOS = [];
    const ESTRAT = { modo: 'global', activo: null };
    const pdfCache = new Map();     // idAcuse -> Uint8Array
    const pdfProm = new Map();      // idAcuse -> promesa en vuelo (dedupe)

    let filas = [];                 // una fila por acuse en rango
    let sel = new Set();            // n de las filas seleccionadas
    let anchor = null, foco = null;
    let cancel = false, analizando = false, descargando = false;
    let ctrl = new AbortController();

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const esperaFallo = k => sleep(400 * (k * 2 * k + 1));
    const abortado = e => !!e && (e.name === 'AbortError' || /abort/i.test(String(e.message || '')));
    const st = t => { const el = $('#sa-st'); if (el) el.textContent = t; };

    // Red con reintentos. 401 = sesión caducada: no se reintenta.
    async function post(url, data, reintentos) {
      const n = reintentos == null ? 2 : reintentos;
      for (let k = 0; ; k++) {
        try {
          const r = await fetch(url, {
            method: 'POST', credentials: 'include', signal: ctrl.signal,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
            body: new URLSearchParams(data)
          });
          if (r.status === 401) { const e = new Error('Sesión expirada'); e.fatal = true; throw e; }
          if ((r.status === 429 || r.status >= 500) && k < n) { await esperaFallo(k); continue; }
          if (!r.ok) throw new Error(url + ' -> ' + r.status);
          return r;
        } catch (e) {
          if (e.fatal || e.name === 'AbortError' || k >= n) throw e;
          await esperaFallo(k);
        }
      }
    }

    // Cola con WORKERS fijos. Las tareas capturan sus propios errores.
    async function pool(items, n, fn) {
      let i = 0;
      const W = Math.max(1, Math.min(n, items.length));
      await Promise.all(Array.from({ length: W }, async () => {
        while (i < items.length && !cancel) { const k = i++; await fn(items[k], k); }
      }));
    }

    // ---------- Permisos del permisionario ----------
    function permisosDeEnlaces(doc) {
      const out = [], vistos = new Set();
      doc.querySelectorAll('a[href*="SeleccionarPermiso"]').forEach(a => {
        const qs = new URLSearchParams((a.getAttribute('href') || '').split('?')[1] || '');
        const codigo = String(qs.get('permiso') || '').trim();
        if (!codigo || vistos.has(codigo)) return;
        vistos.add(codigo);
        const tr = a.closest('tr');
        const td = tr ? [...tr.children].map(x => (x.textContent || '').replace(/\s+/g, ' ').trim()) : [];
        const tabla0 = tr ? tr.closest('table') : null;
        const cab = tabla0 ? [...tabla0.querySelectorAll('thead th, thead td')] : [];
        const idxDe = re => cab.findIndex(x => re.test(x.textContent || ''));
        const iRazon = idxDe(/raz[oó]n\s*social/i), iAct = idxDe(/actividad/i);
        const pareceRazon = t => t && !/^LP\/\d+/i.test(t) && !/^\d+$/.test(t) &&
          /\b(SA|S\.?\s?A\.?|S\s?DE|S\.?\s?A\.?\s?DE|SAPI|SAB|SC|SRL|S\.?\s?A\.?\s?DE\s?C\.?\s?V\.?)\b/i.test(t) &&
          t.split(' ').length >= 2 && /[A-ZÁÉÍÓÚÑ]{3}/.test(t);
        const razon = String(qs.get('razonSocial') || '').trim() ||
          (iRazon >= 0 ? (td[iRazon] || '') : '') || td.find(pareceRazon) || '';
        out.push({ id: String(qs.get('idPermiso') || '').trim(), codigo, razon: String(razon).trim(),
          actividad: String((iAct >= 0 ? td[iAct] : '') || td[4] || '').trim() });
      });
      return out;
    }

    // Universal: funciona desde cualquier módulo de SIRETRAC. Primero lee la tabla ya
    // cargada; si no está, pide /OrdenDePedido/Permisos y, como último recurso, lee los
    // enlaces SeleccionarPermiso de la página actual.
    async function listaPermisos() {
      let doc0 = document;
      let out = permisosDeTabla(doc0);
      if (!out.length) {
        try {
          const html = await (await fetch('/OrdenDePedido/Permisos',
            { credentials: 'include', signal: ctrl.signal })).text();
          doc0 = new DOMParser().parseFromString(html, 'text/html');
          out = permisosDeTabla(doc0);
        } catch (e) { if (e.name === 'AbortError') throw e; }
      }
      if (!out.length) out = permisosDeEnlaces(doc0);
      return out;
    }

    async function activaPermiso(p) {
      const qs = new URLSearchParams({ idPermiso: p.id, permiso: p.codigo, idPermisionario: '0',
        idPermisoMateria: '0', idPermisoActividad: '0', razonSocial: p.razon || '', estatus: 'False', capacidadOperativa: '0' });
      await fetch('/OrdenDePedido/SeleccionarPermiso?' + qs, { credentials: 'include', signal: ctrl.signal });
    }

    const firma = r => ((r && r.item2) || []).map(i => i.idAcuse).join(',') + '|' + ((r && r.item1 && r.item1.paginaFinal) || 1);

    function permisoEnPantalla(codigos) {
      const m = String((document.body.innerText || '')).match(/LP\/\d+\/[A-Z]+\/[A-Za-z]+\/\d{4}/);
      return m && codigos.has(m[0]) ? m[0] : null;
    }

    // 3-4 peticiones. Devuelve cómo recorrer y RESTAURA SIEMPRE el permiso original.
    async function detectaEstrategia(permisos, prog) {
      const codigos = new Set(permisos.map(p => p.codigo));
      const pantalla = permisoEnPantalla(codigos);
      const lee = async extra => (await post(BUSCA, Object.assign({ filtro: '', pagina: 1 }, extra || {}))).json();
      const fBase = firma(await lee());
      const A = permisos.find(p => !pantalla || p.codigo !== pantalla) || permisos[0];
      const B = permisos.find(p => p !== A) || A;
      if (!A) return { modo: 'global', activo: null, fBase };

      prog('Comprobando si el listado depende del permiso activo…');
      await activaPermiso(A);
      const rA = await lee();
      const fA = firma(rA);
      const rB = B === A ? rA : (await activaPermiso(B), await lee());
      const fB = firma(rB);
      const paginas = {};
      paginas[A.codigo] = (rA.item1 && rA.item1.paginaFinal) || 1;
      if (B !== A) paginas[B.codigo] = (rB.item1 && rB.item1.paginaFinal) || 1;

      let activo = permisos.find(p => p.codigo === pantalla) || null;
      if (!activo) activo = (fBase === fA && fA !== fB) ? A : (fBase === fB && fA !== fB) ? B : null;
      if (!activo && permisos.length === 1) activo = permisos[0];   // un solo permiso: restaurar es seguro

      let modo;
      if (fA === fB) modo = 'global';
      else if (B !== A && firma(await lee({ idPermiso: A.id, permiso: A.codigo })) === fA) modo = 'param';
      else modo = 'sesion';

      // Restauración SIEMPRE, también en global y param (la detección movió la sesión).
      if (activo) {
        try { prog('Restaurando el permiso original…'); await activaPermiso(activo); }
        catch (e) { if (!abortado(e)) AVISOS.push('no se pudo restaurar el permiso: ' + e.message); }
      } else {
        AVISOS.push('no se pudo saber qué permiso tenías activo: puede quedar otro permiso seleccionado');
      }
      return { modo, activo, fBase, paginas };
    }

    // ---------- PDF (solo al descargar o imprimir; nunca durante el análisis) ----------
    function esPdf(b) {
      if (!b || !b.length) return false;
      const n = Math.min(1024, b.length);
      let s = '';
      for (let i = 0; i < n; i++) s += String.fromCharCode(b[i]);
      return s.indexOf('%PDF-') >= 0;
    }

    async function bajarPdf(it) {
      let ultimo = 'no se pudo obtener el PDF';
      for (let i = 0; i < 3; i++) {
        try {
          const r = await post('/GasLP/Administracion/ImprimirAcuse', { idAcuse: it.idAcuse }, 0);
          const b = new Uint8Array(await r.arrayBuffer());
          if (esPdf(b)) return b;
          ultimo = 'el servidor devolvió algo que no es un PDF';
        } catch (e) {
          if (e.name === 'AbortError' || e.fatal) throw e;
          ultimo = e.message;
        }
        if (i < 2) await sleep(500 * (i + 1) * (i + 1));
      }
      throw new Error(ultimo + ' (tras 3 intentos)');
    }

    // Dedupe por idAcuse y también por petición en vuelo.
    function pdfDe(it) {
      const id = it.idAcuse;
      if (pdfCache.has(id)) return Promise.resolve(pdfCache.get(id));
      if (pdfProm.has(id)) return pdfProm.get(id);
      const p = bajarPdf(it).then(b => { pdfCache.set(id, b); pdfProm.delete(id); return b; },
        e => { pdfProm.delete(id); throw e; });
      pdfProm.set(id, p);
      return p;
    }

    // Adelanta los PDFs en segundo plano: el hover y el ZIP ya los encuentran en pdfCache.
    // 3 a la vez con pausa, para no competir con el resto de la página; nunca bloquea la UI.
    let prefetchToken = 0;
    function prefetch(lista) {
      const token = ++prefetchToken;
      const pend = lista.filter(r => !r.error && r.it && r.it.idAcuse && !pdfCache.has(r.it.idAcuse));
      if (!pend.length) return;
      pool(pend, 3, async r => {
        if (token !== prefetchToken) return;
        try { await pdfDe(r.it); } catch (e) { /* queda el reintento al descargar */ }
        await sleep(200);
      });
    }

    async function pideCadena(it, intentos = 3) {
      for (let i = 0; i < intentos; i++) {
        try {
          const html = await (await post('/GasLP/Administracion/VerAcuse', { idAcuse: it.idAcuse }, 0)).text();
          const c = parseCadena(html);
          if (c) return c;
        } catch (e) {
          if (e.name === 'AbortError' || e.fatal) return null;
        }
        if (i < intentos - 1) await sleep(500 * (i + 1));
      }
      return null;
    }

    // ---------- Filas ----------
    function datosListado(r) {
      const it = r.it, o = {};
      [['Código de Registro', r.registro], ['Comprador', vItem(it, 'comprador', 'nombreComprador', 'permisoComprador')],
        ['Vendedor', vItem(it, 'vendedor', 'nombreVendedor', 'permisoVendedor')],
        ['Permiso', vItem(it, 'permiso', 'permisoPropietario')], ['Materia', vItem(it, 'materia', 'permisoTipo')],
        ['Subtipo', vItem(it, 'tipoAcuse')], ['Fecha Acuse', fTxt(r.f)],
        ['Usuario', vItem(it, 'usuario', 'nombreUsuario', 'userName')], ['Acuse (idAcuse)', it.idAcuse]]
        .forEach(x => { if (x[1]) o[x[0]] = x[1]; });
      return o;
    }

    const CRIT = { I: 'idAcuse', C: 'cadena', N: 'NOR+permiso+subtipo', L: 'contenido del listado' };

    function arma(r, c, d1, d2) {
      const it = r.it, o = (c && c.o) || {};
      r.c = c || null;
      r.sinCadena = !c;
      const fa = fechaDe(it);
      r.f = fa ? fa.d : null;
      const fo = fechaOpDe(c, it);
      r.fOp = fo.d || r.f;
      r.fuente = fo.fuente || 'Fecha Acuse';
      r.aprox = fo.aprox;
      r.error = '';
      if (!r.fOp) { r.error = 'sin fecha de acuse ni de operación'; r.enRango = false; return; }
      r.enRango = r.fOp >= d1 && r.fOp <= d2;
      r.sub = subtipo(o, it);
      r.op = tipoOp(it, r.sub);
      r.perm = permisoDe(r.op, o, it);
      r.nor = vItem(it, 'idCodigoRegistro', 'codigoRegistro', 'codigoDeRegistro') ||
        campoPor(o, /^(?!.*fecha).*registro/) || o['Codigo de Registro'] || 'SIN_NOR';
      r.folio = campoPor(o, /^folio\s*acuse/) || String(it.idAcuse || '');
      r.razon = (c ? razonSocial(o, r.op) : '') ||
        vItem(it, 'razonSocial', 'razonSocialComprador', 'razonSocialVendedor') || (r.p && r.p.razon) || '';
      r.estadoCadena = campoPor(o, /^estado/) || '';
      r.aviso = c ? '' : 'sin cadena original: se usa el PDF del acuse';
      r.carpeta = [seg(r.perm).replace(/\//g, '_'), seg(r.sub.texto || r.sub.sigla)].filter(x => x && x !== 'SIN_DATO').join('/');
      r.nombre = seg(r.nor) + '-' + ddmmaaaa(r.fOp) + '-' + seg(r.sub.texto || r.sub.sigla);
    }

    // Antiduplicados por idAcuse, cadena+subtipo o NOR+permiso+subtipo (y contenido si no hay cadena).
    function marcaDups() {
      const vistos = new Map();
      for (const r of filas) {
        r.dup = false; r.dupTxt = '';
        if (!r.error && r.enRango && r.sub) {
          const stKey = r.sub.clave || (r.sub.texto ? limpia(r.sub.texto) : r.sub.sigla);
          const claves = ['I:' + r.it.idAcuse, 'C:' + stKey + '|' + limpia(r.c ? r.c.raw : 'SIN_CADENA_' + r.it.idAcuse)];
          if (r.nor !== 'SIN_NOR') claves.push('N:' + stKey + '|' + limpia(r.perm) + '|' + r.nor);
          if (!r.c) {
            const L = datosListado(r);
            delete L['Acuse (idAcuse)'];
            const L2 = Object.assign({}, L);
            delete L2['Comprador']; delete L2['Vendedor']; delete L2['Permiso'];
            claves.push('L:' + stKey + '|' + limpia(Object.values(L).join('|')));
            claves.push('L:' + stKey + '|' + limpia(Object.values(L2).join('|')));
          }
          const kDup = claves.find(k => vistos.get(k));
          if (kDup) { r.dup = true; r.dupTxt = 'duplicado de ' + vistos.get(kDup) + ' (' + (CRIT[kDup[0]] || '') + ', subtipo ' + stKey + ')'; }
          else claves.forEach(k => vistos.set(k, r.it.idAcuse));
        }
      }
    }

    // ---------- Análisis ----------
    const diaDe = v => { const d = v ? new Date(v + 'T00:00:00') : null; return d && !isNaN(d) ? d : null; };

    async function analizar() {
      if (analizando || descargando) { st('Espera a que termine el trabajo en curso'); return; }
      const d1 = diaDe($('#sa-d1').value), d2 = diaDe($('#sa-d2').value);
      if (!d1 || !d2) { st('Pon la semana o el rango de fechas'); return; }
      if (d1 > d2) { st('El rango está al revés'); return; }
      analizando = true; cancel = false; ctrl = new AbortController();
      filas = []; sel = new Set(); anchor = null; foco = null; AVISOS.length = 0;
      render(); st('Analizando…');
      try { await barrido(d1, d2); }
      catch (e) { if (!abortado(e)) st('Error: ' + e.message); }
      finally { analizando = false; }
    }

    async function barrido(d1, d2) {
      st('Leyendo los permisos…');
      let permisos = [];
      try { permisos = ordenPermisos(await listaPermisos()); }
      catch (e) { if (!abortado(e)) AVISOS.push('no se pudieron leer los permisos: ' + e.message); }
      if (!permisos.length) AVISOS.push('no se pudieron leer los permisos: se barrió solo el permiso activo');

      const desde = new Date(d1); desde.setDate(desde.getDate() - 7);   // margen de 7 días
      const cand = [];
      const paginaDe = async (pag, p) => {
        const data = { filtro: '', pagina: pag };
        if (p && ESTRAT.modo === 'param') { data.idPermiso = p.id; data.permiso = p.codigo; }
        return (await post(BUSCA, data)).json();
      };

      // Sin corte por fecha superior: se sigue hasta que las páginas dejan de tener Fecha Acuse
      // dentro del margen. La inclusión final es por fecha de OPERACIÓN.
      const lista = async (p, etiqueta) => {
        let pag = 1, fin = 1, viejas = 0;
        while (pag <= fin && !cancel) {
          let r;
          try { r = await paginaDe(pag, p); }
          catch (e) {
            if (!abortado(e)) AVISOS.push(etiqueta + ' · página ' + pag + ': ' + e.message);
            return;
          }
          fin = Math.max(1, (r.item1 && r.item1.paginaFinal) || 1);
          const items = r.item2 || [];
          let maxF = null;
          for (let i = 0; i < items.length; i++) {
            const it = items[i], f = dmy(it.fechaAcuse);
            if (f && (!maxF || f > maxF)) maxF = f;
            if (!f || f < desde) continue;
            cand.push({ it, p, orden: pag * 1000 + i });
          }
          st(etiqueta + ' · pág. ' + pag + '/' + fin + ' · ' + cand.length + ' acuses');
          if (!maxF || maxF < desde) { if (++viejas >= 2) break; } else viejas = 0;
          pag++;
          await sleep(120);
        }
      };

      let det = { modo: 'global', activo: null };
      if (permisos.length) {
        try {
          det = await detectaEstrategia(permisos, st);
        } catch (e) {
          if (abortado(e)) return;
          AVISOS.push('no se pudo detectar cómo se recorre el listado: ' + e.message);
          det = { modo: 'sesion', activo: null };
        }
        if (cancel) return;
        ESTRAT.modo = det.modo; ESTRAT.activo = det.activo || null;
        st('Modo de permisos: ' + ({ global: 'el listado ya trae todos', param: 'filtro por permiso', sesion: 'cambio de permiso en sesión' }[det.modo] || det.modo));
      }

      if (!permisos.length) {
        await lista(null, 'Listando');
      } else if (det.modo === 'global') {
        await lista(null, 'Listando');
      } else if (det.modo === 'param') {
        let k = 0;
        await pool(permisos, WORKERS, async p => { k++; await lista(p, 'Permiso ' + k + '/' + permisos.length + ' · ' + p.codigo); });
      } else {
        try {
          for (let i = 0; i < permisos.length && !cancel; i++) {
            await activaPermiso(permisos[i]);
            await lista(permisos[i], 'Permiso ' + (i + 1) + '/' + permisos.length + ' · ' + permisos[i].codigo);
          }
        } finally {
          if (det.activo) { try { await activaPermiso(det.activo); } catch (e) { /* abortado o sesión caída */ } }
        }
      }
      if (cancel) return;

      // Dedupe determinista de candidatos: gana la estación sobre la planta.
      const prio = p => (p && esPlantaDist(p) ? 1 : 0);
      cand.sort((a, b) => prio(a.p) - prio(b.p) ||
        String(a.p && a.p.codigo || '').localeCompare(String(b.p && b.p.codigo || '')) || (a.orden - b.orden));
      const vistos = new Set(), finales = [];
      for (const c of cand) {
        const id = c.it.idAcuse;
        if (vistos.has(id)) continue;
        vistos.add(id);
        finales.push(c);
      }
      if (!finales.length) { st('Sin acuses en el rango'); return; }

      const total = finales.length;
      const tmp = finales.map(c => ({ it: c.it, p: c.p, n: 0, enRango: false, dup: false, aprox: false,
        registro: vItem(c.it, 'idCodigoRegistro', 'codigoRegistro', 'codigoDeRegistro') }));
      let hechas = 0;
      await pool(tmp, WORKERS, async r => {
        const c = await pideCadena(r.it);
        if (cancel) return;
        arma(r, c, d1, d2);
        hechas++;
        if (hechas % 5 === 0 || hechas === total) st('Cadenas ' + hechas + '/' + total);
      });

      // Repaso en serie: alguna cadena puede fallar de forma transitoria en el pool.
      const sinCadena = tmp.filter(r => !r.c);
      if (sinCadena.length) {
        st('Repasando ' + sinCadena.length + ' cadenas…');
        for (const r of sinCadena) {
          if (cancel) return;
          const c = await pideCadena(r.it, 1);
          if (c) arma(r, c, d1, d2);
        }
      }
      if (cancel) return;

      // Solo se listan los acuses cuya fecha de operación cae en el periodo.
      filas = tmp.filter(r => r.enRango);
      if (!filas.length) { st('Sin acuses en el periodo'); return; }
      filas.forEach((r, i) => { r.n = i; });
      marcaDups();
      sel = new Set(filas.filter(r => r.enRango && !r.dup && !r.error).map(r => r.n));
      render();
      const nAprox = filas.filter(r => r.aprox).length;
      st('Listo: ' + filas.length + ' acuses · ' + sel.size + ' seleccionados' +
        (nAprox ? ' · ' + nAprox + ' con fecha aprox.' : '') +
        (AVISOS.length ? ' · ' + AVISOS.length + ' aviso(s)' : ''));
      prefetch(filas);
    }

    // ---------- Selección y filtro ----------
    function coincide(r) {
      const bus = nk(String($('#sa-bus').value || '').trim());
      if (!bus) return true;
      return nk([labelDe(r), r.nor, r.perm, r.op, r.sub && r.sub.texto, r.sub && r.sub.sigla,
        r.razon, r.folio, r.it.idAcuse].join(' ')).includes(bus);
    }
    const visibles = () => filas.filter(coincide);

    function actualizarCuenta() {
      const n = filas.filter(coincide).length;
      $('#sa-count').textContent = n + ' acuses · ' + sel.size + ' seleccionados';
    }

    function pintarSel() {
      document.querySelectorAll('#sa-lista .sa-i').forEach(el => {
        const n = +el.dataset.n, on = sel.has(n);
        el.classList.toggle('sa-on', on);
        el.classList.toggle('sa-foc', n === foco);
        el.setAttribute('aria-selected', on ? 'true' : 'false');
      });
    }

    function aplicarFiltro() {
      document.querySelectorAll('#sa-lista .sa-i').forEach(el => {
        const r = filas[+el.dataset.n];
        el.hidden = !(r && coincide(r));
      });
      actualizarCuenta();
      ocultarTip();
    }

    function render() {
      $('#sa-lista').innerHTML = filas.map(r =>
        '<div class="sa-i' + (r.dup ? ' sa-dup' : '') + (r.error ? ' sa-err' : '') + '" role="option" tabindex="-1" data-n="' + r.n + '" aria-selected="' + sel.has(r.n) + '">' + esc(labelDe(r)) + '</div>'
      ).join('');
      pintarSel();
      aplicarFiltro();
    }

    function alternar(n) {
      if (sel.has(n)) sel.delete(n); else sel.add(n);
      pintarSel(); actualizarCuenta();
    }

    function rangoHasta(n) {
      const vis = visibles();
      const i = vis.findIndex(r => r.n === anchor), j = vis.findIndex(r => r.n === n);
      if (i < 0 || j < 0) sel.add(n);
      else for (let k = Math.min(i, j); k <= Math.max(i, j); k++) sel.add(vis[k].n);
      pintarSel(); actualizarCuenta();
    }

    function enfocar(n) {
      const row = $('#sa-lista').querySelector('.sa-i[data-n="' + n + '"]');
      if (!row) return;
      foco = n; row.focus();
      if (typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
      pintarSel();
    }

    const seleccionados = () => filas.filter(r => sel.has(r.n) && !r.error && r.fOp);

    // ---------- Vista previa (tooltip fijo) ----------
    function tipHtml(r) {
      const lin = (k, v) => v ? '<div><span class="k">' + esc(k) + '</span> ' + esc(v) + '</div>' : '';
      return lin('Operación', fTxt(r.fOp) + (r.aprox ? ' (aprox.)' : '') + (r.fuente ? ' · ' + r.fuente : '')) +
        lin('Acuse', fTxt(r.f)) +
        lin('Tipo', [r.op, r.sub && (r.sub.texto || r.sub.sigla)].filter(Boolean).join(' · ')) +
        lin('Permiso', r.perm) +
        lin('Razón social', r.razon) +
        lin('Folio', r.folio) +
        lin('Estado', r.estadoCadena || '—') +
        (r.dup ? lin('Duplicado', r.dupTxt) : '') +
        (r.aviso ? lin('Aviso', r.aviso) : '') +
        (r.pdfError ? lin('PDF', r.pdfError) : '') +
        (r.error ? lin('Error', r.error) : '');
    }

    function mostrarTip(n, x, y) {
      const r = filas[n], tip = $('#sa-tip');
      if (!r || !tip) return;
      tip.innerHTML = tipHtml(r);
      tip.style.display = 'block';
      const w = tip.offsetWidth, h = tip.offsetHeight;
      const left = Math.max(4, Math.min(x + 12, window.innerWidth - w - 6));
      const top = (y + h + 20 > window.innerHeight) ? Math.max(4, y - h - 10) : y + 16;
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    }

    function ocultarTip() {
      const tip = $('#sa-tip');
      if (tip) tip.style.display = 'none';
    }

    // ---------- ZIP ----------
    const FIJAS = ['idAcuse', 'NOR', 'Folio', 'Fecha operación', 'Fecha acuse', 'Fuente fecha operación',
      'Aproximada', 'Subtipo', 'Tipo', 'Permiso', 'Razón social', 'Estado', 'Archivo'];

    function filaCsv(r, archivo) {
      return {
        idAcuse: r.it.idAcuse,
        NOR: r.nor,
        Folio: r.folio,
        'Fecha operación': fTxt(r.fOp),
        'Fecha acuse': fTxt(r.f),
        'Fuente fecha operación': r.fuente,
        Aproximada: r.aprox ? 'SI' : 'NO',
        Subtipo: r.sub ? (r.sub.texto || r.sub.sigla) : '',
        Tipo: r.op,
        Permiso: r.perm,
        'Razón social': r.razon,
        Estado: r.estadoCadena,
        Archivo: archivo,
        extra: (r.c && r.c.o) || {}
      };
    }

    function descargar(blob, nombre) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = nombre;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    }

    const rangoTag = () => ($('#sa-d1').value || '') + '_' + ($('#sa-d2').value || '');

    async function bajarPdfs(inc) {
      inc.forEach(r => { r.pdfError = ''; });
      let hechos = 0;
      st('PDFs 0/' + inc.length + '…');
      await pool(inc, WORKERS, async r => {
        try { await pdfDe(r.it); }
        catch (e) { if (!abortado(e)) r.pdfError = e.message; }
        hechos++;
        if (hechos % 5 === 0 || hechos === inc.length) st('PDFs ' + hechos + '/' + inc.length + '…');
      });
    }

    async function descargarZip() {
      if (analizando || descargando) { st('Espera a que termine el trabajo en curso'); return; }
      const inc = seleccionados();
      if (!inc.length) { st('No hay acuses seleccionados'); return; }
      if (typeof JSZip === 'undefined') { st('JSZip no cargó'); return; }
      cancel = false; ctrl = new AbortController(); descargando = true;
      try {
      await bajarPdfs(inc);
      if (cancel) { st('Cancelado'); return; }

      const zip = new JSZip(), usados = new Set(), rows = [], extras = new Set();
      let fallos = 0;
      for (const r of inc) {
        if (r.pdfError || !pdfCache.has(r.it.idAcuse)) { fallos++; continue; }
        let base = r.carpeta + '/' + r.nombre;
        if (usados.has(base + '.pdf')) base += '_' + r.it.idAcuse;
        usados.add(base + '.pdf');
        zip.file(base + '.pdf', pdfCache.get(r.it.idAcuse));
        const row = filaCsv(r, base + '.pdf');
        Object.keys(row.extra).forEach(k => { if (FIJAS.indexOf(k) < 0) extras.add(k); });
        rows.push(row);
      }

      const head = FIJAS.concat([...extras]);
      const csv = [head.map(q).join(',')].concat(rows.map(row =>
        head.map(k => q(Object.prototype.hasOwnProperty.call(row, k) ? row[k] : (row.extra && row.extra[k]) || '')).join(','))).join('\r\n');
      zip.file('acuses.csv', '\ufeff' + csv);

      const errs = [];
      AVISOS.forEach(t => errs.push('recorrido\t' + t));
      filas.forEach(r => {
        if (r.error) errs.push(r.it.idAcuse + '\t' + r.error);
        else if (r.pdfError) errs.push(r.it.idAcuse + '\tPDF: ' + r.pdfError);
      });
      filas.forEach(r => {
        if (r.aprox && r.enRango) errs.push(r.it.idAcuse + '\tfecha de operación aproximada: ' + fTxt(r.fOp) + ' (sin fecha en la cadena distinta de la Fecha Acuse)');
      });
      if (errs.length) zip.file('errores.txt', errs.join('\r\n'));

      const dups = filas.filter(r => r.dup && !sel.has(r.n));
      if (dups.length) zip.file('duplicados_omitidos.txt', 'idAcuse\toperacion\tpermiso\tNOR\tsiglas\tmotivo\r\n' +
        dups.map(r => [r.it.idAcuse, r.op, r.perm, r.nor, r.sub ? r.sub.sigla : '', r.dupTxt].join('\t')).join('\r\n'));

      st('Empaquetando ZIP…');
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, m => { st('ZIP ' + m.percent.toFixed(0) + '%'); });
      descargar(blob, 'acuses_' + rangoTag() + '.zip');
      st('ZIP: ' + rows.length + ' PDFs' + (fallos ? ' · ' + fallos + ' sin PDF' : '') +
        (dups.length ? ' · ' + dups.length + ' duplicados omitidos' : '') + (errs.length ? ' · ' + errs.length + ' avisos' : ''));
      } finally { descargando = false; }
    }

    // ---------- Imprimir: un PDF con portada por estación ----------
    function estacionesDe(inc) {
      const por = new Map();
      for (const r of inc) {
        const k = r.perm || 'SIN_PERMISO';
        if (!por.has(k)) por.set(k, []);
        por.get(k).push(r);
      }
      const cmp = (a, b) => (a.fOp - b.fOp) || String(a.nor).localeCompare(String(b.nor)) || (a.it.idAcuse - b.it.idAcuse);
      return [...por.entries()].sort((a, b) => a[0].localeCompare(b[0]))
        .map(([perm, grupo]) => ({ perm, filas: grupo.sort(cmp) }));
    }

    async function imprimir() {
      if (analizando || descargando) { st('Espera a que termine el trabajo en curso'); return; }
      const inc = seleccionados();
      if (!inc.length) { st('No hay acuses seleccionados'); return; }
      if (typeof PDFLib === 'undefined') { st('pdf-lib no cargó'); return; }
      cancel = false; ctrl = new AbortController(); descargando = true;
      try {
      await bajarPdfs(inc);
      if (cancel) { st('Cancelado'); return; }

      const ests = estacionesDe(inc);
      const doc = await PDFLib.PDFDocument.create();
      const A4 = PDFLib.PageSizes.A4;
      const f = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
      const fb = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
      let nAcuses = 0, saltados = 0;

      for (const { perm, filas: grupo } of ests) {
        st('Uniendo ' + perm + '…');
        const p = doc.addPage(A4);
        let y = 780;
        const t = (txt, size, bold, x, dy) => { y -= (dy || 26); p.drawText(txt, { x: x == null ? 56 : x, y: y, size: size, font: bold ? fb : f }); };
        t('Acuses por estación', 11, true, 56, 36);
        t('Estación: ' + perm, 18, true, 56, 40);
        const razon = grupo.map(r => r.razon).find(Boolean);
        if (razon) t('Razón social: ' + razon, 10, false, 56, 26);
        t('Acuses: ' + grupo.length, 11, true, 56, 28);
        t('Del ' + fTxt(grupo[0].fOp) + ' al ' + fTxt(grupo[grupo.length - 1].fOp), 10, false, 56, 22);
        y -= 14;
        const porSub = new Map();
        grupo.forEach(r => { const s = r.sub.texto || r.sub.sigla; porSub.set(s, (porSub.get(s) || 0) + 1); });
        for (const [s, n] of porSub) t('· ' + s + ' (' + n + ')', 10, false, 70, 18);

        for (const r of grupo) {
          const bytes = pdfCache.get(r.it.idAcuse);
          if (!bytes) { saltados++; continue; }
          try {
            const src = await PDFLib.PDFDocument.load(bytes);
            const ps = await doc.copyPages(src, src.getPageIndices());
            ps.forEach(pg => doc.addPage(pg));
            nAcuses++;
          } catch (e) { saltados++; r.pdfError = 'PDF ilegible: ' + e.message; }
        }
      }
      if (!nAcuses) { st('Ningún PDF se pudo unir'); return; }

      const bytes = await doc.save();
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const win = window.open(url, '_blank');
      if (!win) descargar(blob, 'acuses_' + rangoTag() + '.pdf');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      st('Imprimir: ' + nAcuses + ' acuses · ' + doc.getPageCount() + ' páginas' +
        (saltados ? ' · ' + saltados + ' sin PDF' : '') + (win ? ' · abierto' : ' · descargado'));
      } finally { descargando = false; }
    }

    // ---------- Limpiar ----------
    function limpiar() {
      cancel = true;
      try { ctrl.abort(); } catch (e) { /* ya abortado */ }
      ctrl = new AbortController();
      filas = []; sel = new Set(); anchor = null; foco = null; AVISOS.length = 0;
      pdfCache.clear(); pdfProm.clear();
      prefetchToken++;
      $('#sa-lista').innerHTML = '';
      ocultarTip();
      cerrarPrev();
      actualizarCuenta();
      st('Limpiado');
    }

    // ---------- Estilo (house-ui plano) ----------
    const css = `
      #sa-panel{background:#fff;color:#333;font:12px var(--ui-font)}
      #sa-panel *{box-sizing:border-box}
      #sa-panel .sa-grilla{display:grid;grid-template-columns:48px minmax(0,1fr);gap:3px 6px;align-items:center}
      #sa-panel .sa-lb{font-size:11px;font-weight: 400;color:#706F6F;text-align:right;white-space:nowrap;line-height:24px}
      #sa-panel .sa-f{width:100%;min-width:0;height:24px;padding:0 5px;font:12px var(--ui-font);color:#333;background:#fff;border:1px solid #ccc;border-radius:0}
      #sa-panel .sa-f:focus{outline:1px solid #66afe9;border-color:#66afe9}
      #sa-panel .sa-btns{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin:6px 0}
      #sa-panel .sa-btn{height:26px;padding:0 4px;font:400 12px var(--ui-font);color:#333;background:#fff;border:1px solid #ccc;border-radius:0;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      #sa-panel .sa-btn:hover{background:#e5e5e5}
      #sa-panel .sa-btn:active{background:#ddd}
      #sa-panel .sa-btn:focus{outline:1px solid #66afe9}
      #sa-panel .sa-btn.go{background:#2EA836;border-color:#2EA836;color:#fff}
      #sa-panel .sa-btn.go:hover{border-color:#333}
      #sa-panel .sa-btn.stop{color:#C60C0E;border-color:#C60C0E}
      #sa-panel .sa-filtro{display:flex;gap:5px;align-items:center;margin-bottom:3px}
      #sa-panel .sa-bus{flex:1 1 auto;min-width:0;height:24px;padding:0 5px;font:12px var(--ui-font);color:#333;background:#fff;border:1px solid #ccc;border-radius:0}
      #sa-panel .sa-bus:focus{outline:1px solid #66afe9;border-color:#66afe9}
      #sa-panel .sa-cuenta{flex:none;font-size:11px;color:#706F6F;white-space:nowrap}
      #sa-panel .sa-lista{height:52vh;min-height:140px;overflow:auto;border-top:1px solid #ddd;border-bottom:1px solid #ddd;background:#fff;outline:none;user-select:none;-webkit-user-select:none}
      #sa-panel .sa-lista:focus{outline:1px solid #66afe9}
      #sa-panel .sa-i{height:24px;line-height:23px;padding:0 6px;font:12px/23px var(--ui-font);color:#333;border-bottom:1px solid #e5e5e5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:default;outline:none}
      #sa-panel .sa-i:hover{background:#e5e5e5}
      #sa-panel .sa-i.sa-foc{background:#e5e5e5}
      #sa-panel .sa-i.sa-on{box-shadow:inset 3px 0 0 #2EA836;font-weight: 400}
      #sa-panel .sa-i.sa-dup{color:#706F6F}
      #sa-panel .sa-i.sa-err{color:#C60C0E}
      #sa-panel .sa-i[hidden]{display:none}
      #sa-panel .sa-st{font-size:10px;line-height:1.3;color:#706F6F;min-height:13px;margin-top:3px;word-break:break-word}
      #sa-tip{position:fixed;z-index:2147483647;display:none;pointer-events:none;background:#fff;color:#333;border:1px solid #706F6F;border-radius:0;padding:4px 6px;font:10px/1.35 var(--ui-font);max-width:290px}
      #sa-tip .k{color:#706F6F}
      #sa-prev{position:fixed;left:16px;top:50%;width:50vw;max-width:900px;height:78vh;z-index:2147482000;display:none;flex-direction:column;background:var(--ui-bg);color:var(--ui-fg);border:1px solid var(--ui-border-strong);font:400 12px/1.4 var(--ui-font);transform:translateY(-50%)}
      #sa-prev.on{display:flex;animation:sa-prev-in 320ms cubic-bezier(.34,1.56,.64,1) both}
      #sa-prev.sa-out{animation:sa-prev-out 130ms ease-in both}
      @keyframes sa-prev-in{0%{opacity:0;transform:translateY(-46%) scale(.92)}60%{opacity:1;transform:translateY(-51%) scale(1.012)}100%{opacity:1;transform:translateY(-50%) scale(1)}}
      @keyframes sa-prev-out{to{opacity:0;transform:translateY(-50%) scale(.97)}}
      #sa-prev-bar{display:flex;align-items:center;gap:8px;padding:5px 8px;border-bottom:1px solid var(--ui-border)}
      #sa-prev-bar strong{font-weight:400;color:var(--ui-muted);font-size:11px;text-transform:uppercase;letter-spacing:.06em}
      #sa-prev-bar span{flex:1;color:var(--ui-muted);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #sa-prev-bar button{border:1px solid var(--ui-border-strong);background:var(--ui-bg);color:var(--ui-fg);font:400 11px/18px var(--ui-font);padding:0 8px;cursor:pointer}
      #sa-prev-bar button:hover{background:var(--ui-header);border-color:var(--ui-header);color:#fff}
      #sa-prev-body{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;background:#f5f5f5;overflow:hidden}
      #sa-prev-body iframe{width:100%;height:100%;border:0;background:#fff}
      #sa-prev-body .sa-prev-msg{padding:16px;color:var(--ui-muted);text-align:center}
      @media (prefers-reduced-motion:reduce){#sa-prev.on,#sa-prev.sa-out{animation:none}}
    `;
    const style = document.createElement('style');
    style.id = 'sa-css';
    style.textContent = css;
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'sa-panel';
    panel.innerHTML = `
      <div class="sa-grilla">
        <label class="sa-lb" for="sa-sem">Semana</label><input id="sa-sem" type="week" class="sa-f" title="Semana ISO (lunes a domingo). Por defecto: la semana pasada cerrada">
        <label class="sa-lb" for="sa-d1">Desde</label><input id="sa-d1" type="date" class="sa-f">
        <label class="sa-lb" for="sa-d2">Hasta</label><input id="sa-d2" type="date" class="sa-f">
      </div>
      <div class="sa-btns">
        <button id="sa-an" type="button" class="sa-btn go" title="Lee el listado y las cadenas de todos los permisos">Analizar</button>
        <button id="sa-zip" type="button" class="sa-btn" title="Descarga los acuses seleccionados">Descargar ZIP</button>
        <button id="sa-print" type="button" class="sa-btn" title="Une los seleccionados con portada por estación">Imprimir</button>
        <button id="sa-x" type="button" class="sa-btn stop" title="Aborta y vacía filas y caché">Limpiar</button>
      </div>
      <div class="sa-filtro">
        <input id="sa-bus" type="search" class="sa-bus" placeholder="Filtrar acuses" aria-label="Filtrar acuses">
        <span id="sa-count" class="sa-cuenta">0 acuses · 0 seleccionados</span>
      </div>
      <div id="sa-lista" class="sa-lista" tabindex="0" role="listbox" aria-multiselectable="true" aria-label="Acuses"></div>
      <div id="sa-st" class="sa-st" role="status"></div>`;
    ET.ui.tab('acuses', 'Acuses', 30, 300).appendChild(panel);

    const tip = document.createElement('div');
    tip.id = 'sa-tip';
    document.body.appendChild(tip);

    // Semana pasada cerrada por defecto.
    (function () {
      const d = new Date(); d.setDate(d.getDate() - 7);
      const w = semanaISO(d), s = semanaDe(w);
      $('#sa-sem').value = w;
      if (s) { $('#sa-d1').value = isoFecha(s.lunes); $('#sa-d2').value = isoFecha(s.domingo); }
    })();

    $('#sa-sem').addEventListener('change', () => {
      const s = semanaDe($('#sa-sem').value);
      if (!s) { st('Semana no válida'); return; }
      $('#sa-d1').value = isoFecha(s.lunes);
      $('#sa-d2').value = isoFecha(s.domingo);
    });
    /* Al escribir a mano, el rango se ajusta a su semana: lunes a domingo. */
    $('#sa-d1').addEventListener('change', () => {
      const s = semanaDe($('#sa-d1').value);
      if (s) $('#sa-d1').value = s.lunes;
      $('#sa-sem').value = '';
    });
    $('#sa-d2').addEventListener('change', () => {
      const s = semanaDe($('#sa-d2').value);
      if (s) $('#sa-d2').value = s.domingo;
      $('#sa-sem').value = '';
    });

    $('#sa-an').addEventListener('click', () => { analizar().catch(e => { if (!abortado(e)) st('Error: ' + e.message); }); });
    $('#sa-zip').addEventListener('click', () => { descargarZip().catch(e => { if (!abortado(e)) st('Error: ' + e.message); }); });
    $('#sa-print').addEventListener('click', () => { imprimir().catch(e => { if (!abortado(e)) st('Error: ' + e.message); }); });
    $('#sa-x').addEventListener('click', limpiar);
    $('#sa-bus').addEventListener('input', aplicarFiltro);

    const lista = $('#sa-lista');

    // ---------- Vista previa del acuse (documento original, media pantalla) ----------
    const prev = document.createElement('div');
    prev.id = 'sa-prev';
    prev.setAttribute('role', 'dialog');
    prev.setAttribute('aria-label', 'Vista previa del acuse');
    prev.innerHTML = '<div id="sa-prev-bar"><strong>Acuse</strong><span></span><button type="button" title="Cerrar (Esc)">Cerrar</button></div><div id="sa-prev-body"></div>';
    document.body.appendChild(prev);
    const prevCuerpo = prev.querySelector('#sa-prev-body');
    const prevUrls = new Map();
    let prevActual = '', prevTimer = 0, prevOcultar = 0, prevFin = 0;

    function prevUrlDe(it) {
      const id = it.idAcuse;
      if (prevUrls.has(id)) return Promise.resolve(prevUrls.get(id));
      return pdfDe(it).then(b => {
        const url = URL.createObjectURL(new Blob([b], { type: 'application/pdf' }));
        if (prevUrls.size >= 12) {
          const viejo = prevUrls.keys().next().value;
          URL.revokeObjectURL(prevUrls.get(viejo));
          prevUrls.delete(viejo);
        }
        prevUrls.set(id, url);
        return url;
      });
    }

    function cerrarPrev() {
      clearTimeout(prevTimer);
      clearTimeout(prevOcultar);
      clearTimeout(prevFin);
      if (!prevActual) return;
      prev.classList.add('sa-out');
      prevFin = setTimeout(() => {
        prev.classList.remove('on', 'sa-out');
        prevActual = '';
      }, 140);
    }

    /* Hover-out waits long enough to reach the panel with the mouse. */
    function ocultarPrev() {
      clearTimeout(prevOcultar);
      prevOcultar = setTimeout(cerrarPrev, 1200);
    }

    function abrirPrev(n) {
      const r = filas[n];
      if (!r || r.error || !r.it || !r.it.idAcuse) return;
      clearTimeout(prevOcultar);
      clearTimeout(prevFin);
      const id = r.it.idAcuse;
      prev.classList.remove('sa-out');
      prev.classList.add('on');
      prev.querySelector('span').textContent = id;
      if (prevActual === id) return;
      prevActual = id;
      prevCuerpo.innerHTML = '<div class="sa-prev-msg">Cargando el acuse…</div>';
      prevUrlDe(r.it).then(url => {
        if (prevActual !== id) return;
        prevCuerpo.innerHTML = '';
        const marco = document.createElement('iframe');
        marco.src = url;
        marco.title = 'Acuse ' + id;
        prevCuerpo.appendChild(marco);
      }).catch(e => {
        if (prevActual !== id) return;
        prevCuerpo.innerHTML = '<div class="sa-prev-msg">No se pudo abrir el acuse: ' + esc(e.message) + '</div>';
      });
    }

    function programarPrev(n) {
      clearTimeout(prevTimer);
      prevTimer = setTimeout(() => abrirPrev(n), 160);
    }

    prev.addEventListener('mouseenter', () => {
      clearTimeout(prevOcultar);
      clearTimeout(prevFin);
      prev.classList.remove('sa-out');
    });
    prev.addEventListener('mouseleave', ocultarPrev);
    prev.querySelector('button').addEventListener('click', cerrarPrev);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarPrev(); });

    lista.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      const row = e.target.closest('.sa-i');
      if (!row) return;
      e.preventDefault();
      const n = +row.dataset.n;
      if (e.shiftKey && anchor != null) rangoHasta(n);
      else { alternar(n); anchor = n; }
      foco = n; row.focus(); pintarSel();
    });

    lista.addEventListener('keydown', e => {
      const vis = visibles();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault(); vis.forEach(r => sel.add(r.n)); pintarSel(); actualizarCuenta(); return;
      }
      if (e.key === ' ') {
        const act = document.activeElement;
        const row = act && act.closest ? act.closest('.sa-i') : null;
        const n = row ? +row.dataset.n : foco;
        if (n != null) { e.preventDefault(); alternar(n); }
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!vis.length) return;
        e.preventDefault();
        let i = vis.findIndex(r => r.n === foco);
        if (i < 0) i = e.key === 'ArrowDown' ? 0 : vis.length - 1;
        else i = Math.min(vis.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)));
        enfocar(vis[i].n);
      }
    });

    lista.addEventListener('mouseover', e => {
      const row = e.target.closest('.sa-i');
      if (row) {
        mostrarTip(+row.dataset.n, e.clientX, e.clientY);
        programarPrev(+row.dataset.n);
      }
    });
    lista.addEventListener('mouseout', e => {
      const row = e.target.closest('.sa-i');
      if (!row) return;
      if (e.relatedTarget && row.contains(e.relatedTarget)) return;
      ocultarTip();
      ocultarPrev();
    });
    lista.addEventListener('focusin', e => {
      const row = e.target.closest('.sa-i');
      if (!row) return;
      const b = row.getBoundingClientRect();
      mostrarTip(+row.dataset.n, b.left, b.bottom - 20);
      abrirPrev(+row.dataset.n);
    });
    lista.addEventListener('focusout', e => {
      const row = e.target.closest('.sa-i');
      if (row && (!e.relatedTarget || !row.contains(e.relatedTarget))) { ocultarTip(); cerrarPrev(); }
    });
    document.addEventListener('scroll', ocultarTip, true);
    window.addEventListener('resize', ocultarTip);

    st('10 workers · todos los permisos · duplicados fuera · portada por estación');
  }

  ET.acuses = ET.acuses || {};
})();
