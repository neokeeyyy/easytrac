/* EasyTrac ACS
   Accept, dispatch, receive, close purchases and build the transfer PDF. */
(function () {
  'use strict';
  var ET = globalThis.EasyTrac;
  var pad2 = ET.core.dates.pad2, toISO = ET.core.dates.toISO, isoToDMA = ET.core.dates.isoToDMA,
    parseDia = ET.core.dates.parseDia, parseISO = ET.core.dates.parseISO, ahoraHora = ET.core.dates.ahoraHora;
  var limpiarHtml = ET.core.text.limpiarHtml, pick = ET.core.text.pick,
    matchInput = ET.core.text.matchInput, matchText = ET.core.text.matchText;
  var esperarMs = ET.core.http.esperarMs, textoRespuesta = ET.core.http.textoRespuesta,
    apiPost = ET.core.http.apiPost, respuestaReintentable = ET.core.http.respuestaReintentable,
    conReintentos = ET.core.http.conReintentos, apiPostDatos = ET.core.http.apiPostDatos,
    getJsonDatos = ET.core.http.getJsonDatos, datosDe = ET.core.http.datosDe,
    postMultipart = ET.core.http.postMultipart;
  var escanearPermisos = ET.core.permisos.escanearPermisos,
    permisoUrlPorId = ET.core.permisos.permisoUrlPorId, permisoDeUrl = ET.core.permisos.permisoDeUrl;
  /* ============ CONFIGURACIÓN ============ */
  var DEFAULTS = {
    DESDE: '2026-08-10',        // rango de fechaCompra (Aceptar/Despachar) y fechaDespacho (Recepcionar)
    HASTA: '2026-08-16',
    VEHICULO: 'A002252',        // vehículo que despacha (Despachar)
    PLACAS: 'JU47194',          // placa del vehículo (Despachar)
    DELAY_MS: 800,              // espera entre operaciones
    DATA_RETRIES: 3,            // reintentos solo para consultas
    DATA_RETRY_BASE_MS: 100,    // backoff inicial de consultas
    CERRAR_AL_RECEPCIONAR: true,// cierra la compra (EsCierre, Destino=13) al recepcionar
    RECORRER_PERMISOS: true,    // recorre todos los permisos de la sesión (si los descubre)
    PERMISOS: [],               // [] = descubrir del sitio; o forzar: [1295,2846,3076,3369,3920,4171,4201,4334,5621]
    PERMISO_FILTRO: '',         // permiso vendedor específico; vacío = todos
    MOTIVO_CIERRE: '',           // motivo de cierre (>=5 caracteres) si la compra lo exige (Cerrar manual)
    INCLUIR_NO_CERRADAS_FACT: false, // Facturas: incluir compras de cualquier estatus, no solo cerradas
    VERBOSE: true                // diagnóstico detallado en consola y estado del panel
  };

  var CONFIG = {};
  ET.core.http.config = CONFIG;

  function cargarConfig() {
    try { Object.assign(CONFIG, DEFAULTS, ET.store.get('acs_cfg', {})); }
    catch (e) { Object.assign(CONFIG, DEFAULTS); }
  }
  function guardarConfig() { ET.store.set('acs_cfg', CONFIG); }

  /* Estado de la UI (colapsada + pestaña activa), persistido entre navegaciones */
  var UI_STATE = { min: false, tab: 'inicio' };
  function cargarUI() {
    try { UI_STATE = Object.assign({ min: false, tab: 'inicio' }, ET.store.get('acs_ui', {})); }
    catch (e) { UI_STATE = { min: false, tab: 'inicio' }; }
  }
  function guardarUI() { ET.store.set('acs_ui', UI_STATE); }

  function verboseLog(tipo, datos) {
    if (!CONFIG.VERBOSE) return;
    var prefijo = '[ACS][' + tipo + ']';
    try {
      console.log(prefijo + ' ' + JSON.stringify(datos, null, 2));
    } catch (e) {
      console.log(prefijo, datos);
    }
  }
  ET.core.log = verboseLog;



  /* ============ HELPERS DE FECHA ============ */






  function enRango(fechaDMA) {
    try { var fc = parseDia(fechaDMA); return fc >= parseISO(CONFIG.DESDE) && fc <= parseISO(CONFIG.HASTA); }
    catch (e) { return false; }
  }
  function pasaFiltroPermiso(compra) {
    if (CONFIG.PERMISO_FILTRO && String(compra && compra.permiso_Vendedor || '').trim() !== String(CONFIG.PERMISO_FILTRO).trim()) return false;
    return true;
  }
  function actualizarFiltroPermisos(data) {
    var select = document.querySelector('#acs-permiso');
    if (!select) return;
    var actual = CONFIG.PERMISO_FILTRO || select.value || '';
    var vistos = {};
    (data || []).forEach(function (c) {
      var permiso = String(c.permiso_Vendedor || '').trim();
      if (permiso) vistos[permiso] = true;
    });
    select.innerHTML = '<option value="">Todos los permisos</option>';
    Object.keys(vistos).sort().forEach(function (permiso) {
      var option = document.createElement('option');
      option.value = permiso;
      option.textContent = permiso;
      select.appendChild(option);
    });
    select.value = actual;
    if (select.value !== actual) {
      CONFIG.PERMISO_FILTRO = '';
      guardarConfig();
    }
  }
  function fechaRegistroSQL(fdISO) {
    return fdISO + ' ' + ahoraHora();
  }

  /* ============ FETCH ============ */















  function secuencia(items, fn) {
    var seq = Promise.resolve();
    items.forEach(function (item, i) {
      seq = seq.then(function () { return STOP ? undefined : fn(item, i); }).then(espera);
    });
    return seq;
  }

  /* ============ ESTADO / PROGRESO ============ */
  var STOP = false;
  var filas = [];
  var PROG = { total: 0, hecho: 0 };

  function detener() { STOP = true; }

  function progReset() { PROG = { total: 0, hecho: 0 }; progRender(''); }
  function progAdd(n) { PROG.total += (n || 0); progRender(''); }
  function progStep(msg) { PROG.hecho++; progRender(msg); }
  function progRender(msg) {
    var bar = document.getElementById('acs-bar-fill');
    var text = document.getElementById('acs-prog-text');
    var status = document.getElementById('acs-status');
    var pct = PROG.total ? Math.min(100, Math.round(PROG.hecho * 100 / PROG.total)) : 0;
    if (bar) bar.style.width = pct + '%';
    if (text) text.textContent = PROG.hecho + ' / ' + PROG.total;
    if (status && msg) status.textContent = msg;
  }
  function actualizarResumen() {
    var summary = document.querySelector('#acs-summary');
    if (!summary) return;
    var rows = document.querySelectorAll('#acs-tabla tbody tr').length;
    var selected = document.querySelectorAll('#acs-tabla tbody input[type="checkbox"]:checked').length;
    summary.textContent = rows + ' visibles · ' + selected + ' seleccionadas';
  }

  /* ============ ACUSES ============ */


  function acuseDespacho(dc, ds, opt) {
    return '|Permiso Comprador=' + pick(dc, ['permiso_Comprador', 'permisoComprador', 'permiso']) +
      '|Razón Social Comprador=' + pick(dc, ['razonSocial_Comprador', 'razonSocialComprador', 'razonSocial']) +
      '|Dirección Comprador=' + pick(dc, ['direccion_Comprador', 'direccionComprador', 'direccion']) +
      '|Permiso Suministrador=' + pick(ds, ['permiso_Vendedor', 'permisoVendedor', 'permiso']) +
      '|Razón Social Suministrador=' + pick(ds, ['razonSocial_Vendedor', 'razonSocialVendedor', 'razonSocial']) +
      '|Dirección Suministrador=' + pick(ds, ['direccion_Vendedor', 'direccionVendedor', 'direccion']) +
      '|Representante legal=|RFC Representante legal=' +
      '|Fecha Registro=' + opt.fechaRegistro +
      '|Fecha de Despacho=' + opt.fechaDespacho +
      '|Número de Registro de Compra=' + opt.codigo +
      '|Volumen=' + opt.volumen +
      '|ID de Vehículo=' + opt.idVehiculo +
      '|Placas=' + opt.placas;
  }

  function acuseRecepcion(o) {
    return '|Permiso Comprador=' + o.permC +
      '|Razón Social Comprador=' + o.rsC +
      '|Dirección Comprador=' + o.dirC +
      '|Permiso Suministrador=' + o.permS +
      '|Razón Social Suministrador=' + o.rsS +
      '|Dirección Suministrador=' + o.dirS +
      '|Representante legal=|RFC Representante legal=' +
      '|Fecha Registro=' + o.fechaRegistro +
      '|Fecha de Recepción=' + o.fechaRecepcion +
      '|Número de Registro de Compra=' + o.numReg +
      '|Volumen=' + o.volumen +
      '|ID de Vehículo=' + o.idVehiculo +
      '|Placas=' + o.placas;
  }

  /* ============ EXTRACCIÓN DE HTML ============ */




  /* ============ PERMISOS ============ */


  function obtenerPermisos() {
    var lista = escanearPermisos(document.documentElement.outerHTML);
    if (lista.length) return Promise.resolve(lista);
    return fetch('/OrdenDePedido/SeleccionarPermiso', { credentials: 'same-origin' })
      .then(function (r) { return r.text(); })
      .then(function (html) { return escanearPermisos(html); })
      .then(function (encontrados) { return encontrados.length ? encontrados : permisosDeConfig(); })
      .catch(permisosDeConfig);
  }



  function permisosDeConfig() {
    return CONFIG.PERMISOS.map(function (id) { return { id: String(id), url: permisoUrlPorId(id) }; });
  }



  var despachosFallback = [];

  function obtenerPermisosDespacho() {
    return obtenerPermisos().then(function (permisosComprador) {
      var encontrados = {};
      despachosFallback = [];
      var vistosFallback = {};
      var permisosPorTexto = {};
      permisosComprador.forEach(function (permiso) {
        var texto = permisoDeUrl(permiso.url).trim().toUpperCase();
        if (texto) permisosPorTexto[texto] = permiso;
      });
      var secuencia = Promise.resolve();
      permisosComprador.forEach(function (permisoComprador) {
        secuencia = secuencia.then(function () {
          return cambiarPermiso(permisoComprador).then(function () {
            return apiPostDatos('/GasLP/Compras/GetRegistrosCompras', 'idEstatus=-1')
              .then(function (res) {
                var data = (res.json && res.json.data) || [];
                data.forEach(function (compra) {
                  if (Number(compra.idEstatus) === 1 && !vistosFallback[compra.idCompra]) {
                    vistosFallback[compra.idCompra] = true;
                    despachosFallback.push(compra);
                  }
                  var proveedor = String(compra.permiso_Vendedor || '').trim();
                  var m = proveedor.match(/^(?:LP|H)\/(\d+)/i);
                  if (!m) return;
                  var permisoOriginal = permisosPorTexto[proveedor.toUpperCase()];
                  var clave = permisoOriginal ? permisoOriginal.id : proveedor.toUpperCase();
                  if (encontrados[clave]) return;
                  encontrados[clave] = {
                    id: permisoOriginal ? permisoOriginal.id : m[1],
                    url: permisoOriginal ? permisoOriginal.url : permisoUrlPorId(m[1]),
                    permiso: proveedor
                  };
                });
              });
          });
        });
      });
      return secuencia.then(function () {
        return Object.keys(encontrados).map(function (id) { return encontrados[id]; });
      });
    }).then(function (permisosPlanta) {
      verboseLog('PERMISOS DESPACHO', permisosPlanta);
      return permisosPlanta;
    });
  }

  function cambiarPermiso(p) {
    var idx = p.url.indexOf('?');
    var path = idx === -1 ? p.url : p.url.substring(0, idx);
    var qs = idx === -1 ? '' : p.url.substring(idx + 1);
    verboseLog('CAMBIO PERMISO', { id: p.id, permiso: p.permiso || '', url: p.url });
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: qs, credentials: 'same-origin' }).catch(function (e) {
      progRender('No se pudo cambiar al permiso ' + p.id + ': ' + e.message);
    });
  }

  function cerrarEntrega(opts) {
    var qs = 'Destino=13&numero=' + opts.idEntrega + '&codigo=' + encodeURIComponent(opts.codigo) + '&idCompra=' + opts.idCompra;
    var url = opts.base + '?' + qs;
    return apiPost(url, '').then(function (res) {
      return { ok: res.status === 200 && res.text.indexOf('SesionExpirada') === -1, detalle: 'HTTP ' + res.status };
    });
  }

  /* ============ CIERRE MANUAL REAL (Compras: CerrarCompra + GuardarCerrarCompra) ============ */


  function cadenaCierreCompra(html) {
    var heads = [];
    var m;
    var reTh = /<th[^>]*>([\s\S]*?)<\/th>/gi;
    while ((m = reTh.exec(html))) heads.push(limpiarHtml(m[1]));
    var cells = [];
    var body = html.match(/<tbody>[\s\S]*?<tr[^>]*>([\s\S]*?)<\/tr>/i);
    if (body) {
      var reTd = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      while ((m = reTd.exec(body[1]))) cells.push(limpiarHtml(m[1]));
    }
    var cadena = '';
    for (var i = 0; i < heads.length; i++) {
      var val = cells[i] !== undefined ? cells[i] : '';
      if (val === '') continue;
      cadena += (heads[i] === 'Estado' ? heads[i] + '=Cerrada' : heads[i] + '=' + val) + '|';
    }
    return cadena;
  }

  function cerrarCompraManual(c) {
    return apiPost('/GasLP/Compras/CerrarCompra', 'idCompra=' + encodeURIComponent(c.idCompra), true)
      .then(function (det) {
        var h = det.text;
        var mc = h.match(/idComprador:\s*(\d+)/);
        var mv = h.match(/idVendedor:\s*(\d+)/);
        var mco = h.match(/CodigoRegistro:\s*['"]([^'"]+)['"]/);
        if (!mc || !mv) {
          var expirada = h.indexOf('/Home/SesionExpiradaPage') !== -1 && h.indexOf('CerrarCompraAceptada') === -1;
          throw new Error(expirada ? 'Sesión expirada' : 'CerrarCompra sin idComprador/idVendedor');
        }
        var idCompra = matchInput(h, 'id-compra') || c.idCompra;
        var codigo = mco ? mco[1] : (c.codigo || '');
        var mostrarMotivo = matchInput(h, 'mostrar-motivo-cierre') === '1';
        var motivo = mostrarMotivo ? (CONFIG.MOTIVO_CIERRE || '') : '';
        if (mostrarMotivo && String(motivo).trim().length < 5) {
          throw new Error('requiere motivo de cierre (>=5 caracteres) en configuración');
        }
        var volCierre = matchInput(h, 'idVolumenCierre') || '';
        var body = 'contenidoAcuse=' + encodeURIComponent(cadenaCierreCompra(h)) +
          '&idCompra=' + encodeURIComponent(idCompra) +
          '&strMotivoCierre=' + encodeURIComponent(motivo) +
          '&CodigoRegistro=' + encodeURIComponent(codigo) +
          '&idComprador=' + mc[1] +
          '&idVendedor=' + mv[1] +
          (volCierre ? '&volumenCierre=' + encodeURIComponent(volCierre) : '');
        return apiPost('/GasLP/Compras/GuardarCerrarCompra', body);
      })
      .then(function (res) {
        var j = res.json || {};
        if (j.result === true) return { ok: true, msg: '' };
        if (j.mensaje === 'SC') throw new Error('Sesión expirada');
        return { ok: false, msg: j.mensaje || res.text.slice(0, 200) };
      });
  }

  /* ============ FORMATO DE TRASPASO ============ */
  function generarFormatoTraspaso(compra) {
    var kg = parseFloat(compra.volumen_Entregado) || 0;
    var litros = (kg / 0.515).toFixed(0);
    var fecha = compra.fechaCompra || '';
    var diasSemana = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    var meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    var p = String(fecha).split('/');
    var d = p.length === 3 ? new Date(+p[2], +p[1] - 1, +p[0]) : new Date();
    var fechaLarga = diasSemana[d.getDay()] + ', ' + d.getDate() + ' de ' + meses[d.getMonth()] + ' de ' + d.getFullYear();
    var litrosFmt = Number(litros).toLocaleString('es-MX');

    var doc = new jspdf.jsPDF({ unit: 'mm', orientation: 'portrait', format: 'letter' });

    var W = 215.9;
    var originalW = 215.9;
    var shift = (W - originalW) / 2;
    var ptToMm = function (pt) { return pt * 25.4 / 72 + shift; };
    var xCenter = function (left, right) { return ptToMm((left + right) / 2); };
    var xRight = function (right) { return ptToMm(right); };

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('GAS DE OJUELOS,  S.A DE C.V.', xCenter(190.13, 349.20), 25, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.text('KM. 6+500 CARRETERA OJUELOS-OCAMPO,', xCenter(195.65, 374.04), 34, { align: 'center' });
    doc.text('MUNICIPIO DE OJUELOS, ESTADO DE JALISCO', xCenter(192.17, 377.61), 39, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('PERMISO CRE:', xCenter(92.05, 151.95), 58, { align: 'center' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text(compra.permiso_Vendedor || '', xCenter(200.69, 308.64), 58, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('PRODUCTO GAS LP', xCenter(180.98, 260.56), 72, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('FECHA:', xCenter(105.74, 135.53), 81, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text(fechaLarga, xRight(368.25), 81, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('LITROS TOTALES:', ptToMm(80.66), 95, { align: 'left' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(litrosFmt, xRight(296.50), 95, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text('GRACIAS.', xRight(304.37), 105, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('FIN DEL REPORTE', xCenter(137.66, 208.87), 114, { align: 'center' });

    return doc;
  }

  function nombreArchivoTraspaso(codigoRegistro) {
    var m = String(codigoRegistro).match(/LP\/(\d+)\/\d+\/(\d+)/);
    if (!m) return 'formato_traspaso.pdf';
    var permiso = m[1];
    var num = parseInt(m[2], 10);
    var contador = String(num).padStart(3, '0');
    return 'LP-' + permiso + '-' + contador + '.pdf';
  }

  function descargarFormato(compra) {
    var doc = generarFormatoTraspaso(compra);
    var filename = nombreArchivoTraspaso(compra.codigoRegistro || '');
    var blob = doc.output('blob');
    var url = URL.createObjectURL(blob);
    try {
      var a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      return true;
    } catch (e) {
      doc.save(filename);
      return true;
    }
  }



  function aplanarNodos(nodos, salida) {
    salida = salida || [];
    (nodos || []).forEach(function (n) {
      salida.push(n);
      aplanarNodos(n.children || [], salida);
    });
    return salida;
  }

  function buscarNodoFactura(compra, nodos) {
    var todos = aplanarNodos(nodos, []);
    var objetivo = todos.filter(function (n) {
      if (n.tipo !== 'RegistroCompra') return false;
      var d = n.datos && n.datos[0];
      return d && (String(d.idCompra) === String(compra.idCompra) || d.codigoRegistro === compra.codigoRegistro);
    })[0];
    if (!objetivo) return null;

    var datos = objetivo.datos && objetivo.datos[0] || {};
    var entregas = aplanarNodos(objetivo.children || [], []).filter(function (n) {
      return n.tipo === 'RegistroEntrega' && n.datos && n.datos[0];
    }).map(function (n) {
      return String(n.datos[0].idEntrega || n.id || '');
    }).filter(Boolean);

    return {
      rfc: objetivo.rfc || datos.rfc || '',
      idsEntrega: entregas
    };
  }

  function subirFormatoTraspaso(compra) {
    return fetch('/GasLP/Facturas/Index', { credentials: 'same-origin' }).then(function () {
      return getJsonDatos('/GasLP/Facturas/GetNodosDespachosSinFactura?traspaso=true');
    }).then(function (nodos) {
      var referencia = buscarNodoFactura(compra, nodos);
      if (!referencia) throw new Error('compra sin nodo de factura: ' + compra.codigoRegistro);
      if (!referencia.idsEntrega.length) throw new Error('compra sin entrega para asignar: ' + compra.codigoRegistro);

      var doc = generarFormatoTraspaso(compra);
      var filename = nombreArchivoTraspaso(compra.codigoRegistro || '');
      var pdf = doc.output('blob');
      var validar = new FormData();
      validar.append('file', pdf, filename);
      validar.append('RFCcompra', referencia.rfc);

      return postMultipart('/GasLP/Facturas/UploadFiles', validar).then(function (res) {
        var j = res.json || {};
        if (res.status < 200 || res.status >= 300 || j.success !== true) {
          throw new Error(j.mensaje || j.message || 'UploadFiles rechazó el PDF');
        }

        var asignar = new FormData();
        asignar.append('file', pdf, filename);
        asignar.append('FechaRegistro', toISO(new Date()));
        asignar.append('DatosAcuse', 'Traspaso=SI');
        asignar.append('IdsEntrega', referencia.idsEntrega.join(','));
        return postMultipart('/GasLP/Facturas/GuardarAsignacionFactura', asignar).then(function (respuesta) {
          var resultado = respuesta.json || {};
          if (respuesta.status < 200 || respuesta.status >= 300 || resultado.success !== true) {
            throw new Error(resultado.mensaje || resultado.message || 'GuardarAsignacionFactura rechazó la asignación');
          }
          return { ok: true, idsEntrega: referencia.idsEntrega };
        });
      });
    });
  }

  /* ============ LOTES ============ */
  function filtroSolicitadas(f) { return pasaFiltroPermiso(f) && Number(f.idEstatus) === 0 && enRango(f.fechaCompra); }
  function filtroAceptadas(f) { return pasaFiltroPermiso(f) && Number(f.idEstatus) === 1 && enRango(f.fechaCompra); }
  function filtroEnTransito(it) { return pasaFiltroPermiso(it) && Number(it.idEstatus) === 4 && enRango(it.fechaDespacho); }
  function filtroCerrables(c) {
    return pasaFiltroPermiso(c) && (Number(c.idEstatus) === 1 || c.estatus === 'Aceptada') && !c.fechaCierre && enRango(c.fechaCompra);
  }

  function procesarLote(items, accion, verbo, modulo, permiso) {
    return secuencia(items, function (x) {
      var fila = modulo ? nuevaFila(modulo, permiso, x.codigoRegistro) : null;
      return accion(x).then(function (r) {
        if (fila) fila.set(r.ok ? 'OK' : 'FALLO', r.msg);
        progStep(verbo + ' ' + x.codigoRegistro + ' → ' + (r.ok ? 'OK' : 'FALLO') + (!fila && r.msg ? ' · ' + r.msg : ''));
      }).catch(function (e) {
        if (fila) fila.set('FALLO', e.message);
        progStep(verbo + ' ' + x.codigoRegistro + ' → ERROR');
      });
    });
  }

  function lote(listar, filtro, accion, verbo, modulo, permiso) {
    return listar().then(function (data) {
      var pend = data.filter(filtro);
      progAdd(pend.length);
      progRender((permiso ? 'Permiso ' + permiso.id : 'Permisos') + ': ' + pend.length + ' de ' + data.length + ' · ' + verbo);
      return procesarLote(pend, accion, verbo, modulo, permiso);
    });
  }

  /* ============ MÓDULO: ACEPTAR ============ */
  function listarAceptar() { return datosDe('/GasLP/AceptarRechazarCompras/GetRegistrosCompras'); }

  function aceptarUna(f) {
    return apiPost('/GasLP/AceptarRechazarCompras/Aceptar', 'idCompra=' + f.idCompra + '&CodigoRegistro=' + encodeURIComponent(f.codigoRegistro))
      .then(function (det) {
        var mv = det.text.match(/var idVendedor\s*=\s*"(\d+)"/);
        var mc = det.text.match(/var idComprador\s*=\s*"(\d+)"/);
        if (!mv || !mc) throw new Error('detalle sin idVendedor/idComprador');
        return apiPost('/GasLP/AceptarRechazarCompras/Guardar_AceptarCompra',
          'idCompra=' + f.idCompra + '&CodigoRegistro=' + encodeURIComponent(f.codigoRegistro) +
          '&idComprador=' + mc[1] + '&idVendedor=' + mv[1] + '&cadenaAcuse=');
      })
      .then(function (res) {
        if (res.json && res.json.result === true) return { ok: true, msg: '' };
        return { ok: false, msg: (res.json && (res.json.mensaje || res.json.message)) || res.text.slice(0, 200) };
      });
  }

  function moduloAceptar(permiso) {
    return lote(listarAceptar, filtroSolicitadas, aceptarUna, 'Aceptando', 'Aceptar', permiso);
  }

  /* ============ MÓDULO: DESPACHAR ============ */
  function listarDespacho(permiso) {
    return apiPostDatos('/GasLP/Despacho/GetRegistrosComprasDespacho', 'idEstatus=-2')
      .then(function (res) {
        var data = (res.json && res.json.data) || [];
        if (data.length) return data;
        var textoPermiso = String(permiso && (permiso.permiso || permisoDeUrl(permiso.url)) || '').trim().toUpperCase();
        var respaldo = textoPermiso ? despachosFallback.filter(function (compra) {
          return String(compra.permiso_Vendedor || '').trim().toUpperCase() === textoPermiso;
        }) : despachosFallback;
        verboseLog('RESPALDO DESPACHO', { permiso: textoPermiso || 'actual', registros: respaldo.length });
        return respaldo;
      });
  }

  function despacharUna(f) {
    return apiPost('/GasLP/Despacho/VerificaRegistroCompra', 'prefixCodigoRegistro=' + encodeURIComponent(f.codigoRegistro) + '&proceso=2')
      .then(function (v) {
        var j = v.json || {};
        var d = j.data || j;
        var dc = d.datosCompra;
        var ds = d.datosSuministrador;
        if (!dc) throw new Error('VerificaRegistroCompra sin datosCompra');
        var idActComp = pick(dc, [
          'idPermisoActividad_Comprador',
          'idPermisoActividadComprador',
          'idPermisoActividad',
          'idActComp',
          'idActividad',
          'idPermisoActividad_Vendedor',
          'idPermisoActividadVendedor'
        ]);
        return apiPost('/GasLP/Despacho/VerificaRegistroVehiculo2',
          'vehiculo=' + encodeURIComponent(CONFIG.VEHICULO) +
          '&CompradorId=' + dc.idComprador +
          '&idActComp=' + encodeURIComponent(idActComp) +
          '&idVendedor=' + dc.idVendedor +
          '&showIRE=false').then(function (vv) {
            var vvj = vv.json || {};
            var idVehiculo = vvj.idVehiculo ||
              (vvj.datos && vvj.datos.idVehiculo) ||
              (vvj.data && vvj.data.idVehiculo) ||
              (vvj.data && vvj.data.VehiculoId);
            if (!idVehiculo) throw new Error('VerificaRegistroVehiculo2 sin idVehiculo (' + vv.text.slice(0, 120) + ')');
            return { dc: dc, ds: ds, idVehiculo: idVehiculo };
          });
      })
      .then(function (ctx) {
        var dc = ctx.dc;
        var fd = fechaRegistroSQL(toISO(parseDia(f.fechaCompra || dc.fechaCompra)));
        var acuse = acuseDespacho(dc, ctx.ds, {
          fechaRegistro: fd,
          fechaDespacho: isoToDMA(fd.split(' ')[0]),
          codigo: f.codigoRegistro,
          volumen: dc.volumen_Solicitado,
          idVehiculo: ctx.idVehiculo,
          placas: CONFIG.PLACAS
        });
        var body = 'de[fechaRegistro]=' + encodeURIComponent(fd) +
          '&de[FechaDespacho]=' + encodeURIComponent(fd) +
          '&de[idCompra]=' + dc.idCompra +
          '&de[CantidadDespachada]=' + dc.volumen_Solicitado +
          '&de[IdVehiculo]=' + ctx.idVehiculo +
          '&de[TransportePlaca]=' + encodeURIComponent(CONFIG.PLACAS) +
          '&CodigoRegistro=' + encodeURIComponent(f.codigoRegistro) +
          '&idComprador=' + dc.idComprador +
          '&idVendedor=' + dc.idVendedor +
          '&complementoAcuse=' + encodeURIComponent(acuse) +
          '&regCompraFlete=false';
        return apiPost('/GasLP/Despacho/Guardar_CompraDespacho', body);
      })
      .then(function (res) {
        var j = res.json || {};
        if (j.result === true || j.success === true || j.result === 'true') return { ok: true, msg: '' };
        return { ok: false, msg: (j.mensaje || j.message) || res.text.slice(0, 200) };
      });
  }

  function moduloDespachar(permiso) {
    return lote(function () { return listarDespacho(permiso); }, filtroAceptadas, despacharUna, 'Despachando', 'Despachar', permiso);
  }

  /* ============ MÓDULO: RECEPCIONAR (+ cierre EsCierre) ============ */
  function listarRecepcion() { return datosDe('/GasLP/Recepcion/GetListaDespachoRecepcion'); }

  function recepcionarConCierre(it) {
    return recepcionarUna(it).then(function (r) {
      if (!r.ok || !CONFIG.CERRAR_AL_RECEPCIONAR) return r;
      if (!r.idCompra) {
        r.msg = 'sin idCompra, usar pestaña Cerrar';
        return r;
      }
      return cerrarEntrega({ idEntrega: r.idEntrega, codigo: r.codigo, idCompra: r.idCompra, base: '/GasLP/Recepcion/PaginaConfirmacion' })
        .then(function (c) { r.msg = 'cierre: ' + (c.ok ? 'OK' : 'FALLO ' + c.detalle); return r; });
    });
  }

  function recepcionarUna(it) {
    return apiPost('/GasLP/Recepcion/AceptarRecepcion', 'idEntrega=' + it.idEntrega + '&CodigoRegistro=' + encodeURIComponent(it.codigoRegistro))
      .then(function (det) {
        var h = det.text;
        var volumen = matchInput(h, 'idVolumenCompra') || it.cantidadDespachada || '';
        var placas = matchInput(h, 'idPlacas') || CONFIG.PLACAS;
        var idVehiculo = matchInput(h, 'idVehiculo') || it.idVehiculo || '';
        var numReg = matchInput(h, 'idNoRegistroCompra') || it.codigoRegistro;
        var fd = matchInput(h, 'fecha-despacho') || it.fechaDespacho;
        var fdISO = toISO(parseDia(fd));
        var fechaReg = fechaRegistroSQL(fdISO);
        var acuse = acuseRecepcion({
          permC: matchText(h, 'datos-comprador-permiso'),
          rsC: matchText(h, 'datos-comprador-razon-social'),
          dirC: matchText(h, 'datos-comprador-direccion'),
          permS: matchText(h, 'datos-suministrador-permiso'),
          rsS: matchText(h, 'datos-suministrador-razon-social'),
          dirS: matchText(h, 'datos-suministrador-direccion'),
          fechaRegistro: fechaReg,
          fechaRecepcion: isoToDMA(fdISO),
          numReg: numReg,
          volumen: volumen,
          idVehiculo: idVehiculo,
          placas: placas
        });
        var body = 'idBodega=-1' +
          '&idEntrega=' + it.idEntrega +
          '&FechaRegistro=' + encodeURIComponent(fechaReg) +
          '&CostoFlete=*' +
          '&CantidadRecibida=' + encodeURIComponent(volumen) +
          '&CodigoRegistro=' + encodeURIComponent(it.codigoRegistro) +
          '&idComprador=' + it.idComprador +
          '&idVendedor=' + it.idVendedor +
          '&dataAcuse=' + encodeURIComponent(acuse);
        return apiPost('/GasLP/Recepcion/Guardar_AceptarRecepcionRegistroDespacho', body)
          .then(function (res) {
            var j = res.json || {};
            if (j.result !== true) {
              return { ok: false, msg: (j.mensaje || j.message) || res.text.slice(0, 200), idCompra: j.idCompra };
            }
            var idCompra = String(j.idCompra || '').replace(/^"+|"+$/g, '').trim();
            if (idCompra && idCompra !== '0') {
              return { ok: true, msg: '', idCompra: idCompra, idEntrega: it.idEntrega, codigo: it.codigoRegistro };
            }
            return apiPost('/GasLP/Despacho/VerificaRegistroCompra',
              'prefixCodigoRegistro=' + encodeURIComponent(it.codigoRegistro) + '&proceso=2')
              .then(function (verificacion) {
                var datos = verificacion.json && verificacion.json.datosCompra;
                var recuperado = datos && datos.idCompra ? String(datos.idCompra) : '';
                verboseLog('ID COMPRA RECEPCION', { codigo: it.codigoRegistro, idCompra: recuperado || null });
                return { ok: true, msg: '', idCompra: recuperado || null, idEntrega: it.idEntrega, codigo: it.codigoRegistro };
              });
          });
      });
  }

  function moduloRecepcionar(permiso) {
    return lote(listarRecepcion, filtroEnTransito, recepcionarConCierre, 'Recepcionando', 'Recepcionar', permiso);
  }

  /* ============ MÓDULO: LISTAR TODO ============ */
  function moduloListarTodo(permiso) {
    return apiPostDatos('/GasLP/Compras/GetRegistrosCompras', 'idEstatus=-1').then(function (res) {
      var data = (res.json && res.json.data) || [];
      actualizarFiltroPermisos(data);
      var cand = data.filter(function (c) { return pasaFiltroPermiso(c) && c.idEstatus !== 4 && c.estatus !== 'Rechazada' && enRango(c.fechaCompra); });
      progAdd(cand.length);
      cand.forEach(function (c) {
        agregarCandidato(c, permiso);
        progStep(c.codigoRegistro + ' · ' + (c.estatus || c.idEstatus));
      });
      progRender(cand.length ? cand.length + ' compra' + (cand.length > 1 ? 's' : '') + ' en rango.' : 'Sin resultados.');
    }).catch(function (e) { progRender('ERROR: ' + e.message); });
  }

  /* ============ MÓDULO: FACTURAS DE TRASPASO ============ */
  var facturasCandidatas = [];

  function listarNodosFacturasTraspaso() {
    return getJsonDatos('/GasLP/Facturas/GetNodosDespachosSinFactura?traspaso=true');
  }

  function agregarFacturaCandidata(compra, permiso, referencia) {
    for (var i = 0; i < facturasCandidatas.length; i++) {
      if (String(facturasCandidatas[i].compra.idCompra) === String(compra.idCompra)) return i;
    }
    facturasCandidatas.push({ compra: compra, permisoUrl: permiso ? permiso.url : null, referencia: referencia });
    var idx = facturasCandidatas.length - 1;
    filaCompra(compra, idx, 'acs-factura-check');
    return idx;
  }

  function marcarFilaFactura(idx, ok) {
    var ch = document.querySelector('.acs-factura-check[data-idx="' + idx + '"]');
    if (!ch) return;
    ch.checked = false;
    ch.disabled = true;
    var tr = ch.closest('tr');
    if (tr) tr.classList.add(ok ? 'acs-factura-ok' : 'acs-fail');
  }

  function comprasCerradas() {
    return fetch('/GasLP/Compras/Index', { credentials: 'same-origin' })
      .then(function () { return apiPostDatos('/GasLP/Compras/GetRegistrosCompras', 'idEstatus=-1'); })
      .then(function (res) {
        var data = (res.json && res.json.data) || [];
        actualizarFiltroPermisos(data);
        return data.filter(function (c) {
          if (!pasaFiltroPermiso(c) || !enRango(c.fechaCompra) || c.estatus === 'Rechazada') return false;
          return CONFIG.INCLUIR_NO_CERRADAS_FACT || Number(c.idEstatus) === 2 || String(c.fechaCierre || '').trim() !== '';
        });
      });
  }

  function moduloFacturas(permiso) {
    return comprasCerradas().then(function (cand) {
      return fetch('/GasLP/Facturas/Index', { credentials: 'same-origin' })
        .then(listarNodosFacturasTraspaso)
        .then(function (nodos) {
          cand.forEach(function (c) {
            var ref = buscarNodoFactura(c, nodos);
            if (ref) agregarFacturaCandidata(c, permiso, ref);
          });
          progRender('Facturas: ' + facturasCandidatas.length + ' traspaso(s) pendiente(s).');
        });
    }).catch(function (e) { progRender('ERROR: ' + e.message); });
  }

  function escanearFacturas() {
    return runModulo('Facturas', moduloFacturas, '/GasLP/Compras/Index', true);
  }

  function descargarFormatosRango() {
    var ok = 0;
    function moduloDescarga(permiso) {
      return comprasCerradas().then(function (cand) {
        progAdd(cand.length);
        return secuencia(cand, function (c) {
          var idx = agregarFacturaCandidata(c, permiso);
          progRender('Generando formato · ' + c.codigoRegistro + '...');
          var pdfOk = false;
          try { pdfOk = descargarFormato(c) !== false; } catch (e) { verboseLog('ERROR FORMATO', { registro: c.codigoRegistro, error: e.message }); }
          marcarFilaFactura(idx, pdfOk);
          if (pdfOk) ok++;
          progStep((pdfOk ? 'PDF guardado · ' : 'FALLO PDF · ') + c.codigoRegistro);
        });
      }).catch(function (e) { verboseLog('ERROR MODULO DESCARGA', { error: e.message }); progRender('ERROR: ' + e.message); });
    }
    return runModulo('Formatos', moduloDescarga, '/GasLP/Compras/Index', true).then(function () {
      if (!STOP) progRender('✔ Descarga terminada · ' + ok + ' formato(s) guardado(s).');
    });
  }

  function subirFacturasSeleccionadas() {
    var checks = Array.prototype.slice.call(document.querySelectorAll('.acs-factura-check:checked'));
    if (!checks.length) { progRender('Selecciona traspasos para subir.'); return Promise.resolve(); }
    progReset();
    progAdd(checks.length);
    return secuencia(checks, function (ch) {
      var item = facturasCandidatas[+ch.dataset.idx];
      if (!item) { progStep('Registro no disponible'); return; }
      progRender('Subiendo ' + item.compra.codigoRegistro + '...');
      return (item.permisoUrl ? cambiarPermiso({ url: item.permisoUrl }) : Promise.resolve())
        .then(function () { return subirFormatoTraspaso(item.compra); })
        .then(function () {
          marcarFilaFactura(+ch.dataset.idx, true);
          progStep('Traspaso subido · ' + item.compra.codigoRegistro);
        })
        .catch(function (e) { progStep('FALLO · ' + item.compra.codigoRegistro + (e.message ? ' · ' + e.message : '')); });
    });
  }

  /* ============ MÓDULO: CERRAR ============ */
  var candidatos = [];

  function moduloCerrar(permiso) {
    return apiPostDatos('/GasLP/Compras/GetRegistrosCompras', 'idEstatus=-2').then(function (res) {
      var data = (res.json && res.json.data) || [];
      actualizarFiltroPermisos(data);
      var cand = data.filter(filtroCerrables);
      progAdd(cand.length);
      cand.forEach(function (c) { agregarCandidato(c, permiso); });
      progRender(cand.length ? 'Compra del dia ' + cand[0].fechaCompra + ' · ' + cand.length + ' pendiente' + (cand.length > 1 ? 's' : '') : 'Sin compras sin cerrar.');
    }).catch(function (e) { progRender('ERROR: ' + e.message); });
  }

  function agregarCandidato(c, permiso) {
    if (candidatos.some(function (x) { return x.idCompra === c.idCompra; })) return;
    candidatos.push({ compra: c, idCompra: c.idCompra, permisoUrl: permiso ? permiso.url : null });
    filaCompra(c, candidatos.length - 1, 'acs-cand-check');
  }

  function cerrarConFormato(c) {
    return cerrarCompraManual({ idCompra: c.idCompra, codigo: c.codigoRegistro }).then(function (r) {
      if (!r.ok) { progStep('FALLO ' + r.msg + ' · ' + c.codigoRegistro); return false; }
      try { descargarFormato(c); } catch (e) {}
      return subirFormatoTraspaso(c).then(function () {
        progStep('Cerrada + PDF + traspaso subido · ' + c.codigoRegistro);
        return true;
      }, function () {
        progStep('Cerrada + PDF; traspaso pendiente · ' + c.codigoRegistro);
        return true;
      });
    }).catch(function (e) { progStep('ERROR · ' + c.codigoRegistro + ' · ' + e.message); return false; });
  }

  function cerrarTodas() {
    return apiPostDatos('/GasLP/Compras/GetRegistrosCompras', 'idEstatus=-1').then(function (res) {
      var data = (res.json && res.json.data) || [];
      actualizarFiltroPermisos(data);
      var cand = data.filter(filtroCerrables);
      progAdd(cand.length);
      progRender('Cerrando ' + cand.length + '...');
      var ok = 0;
      return secuencia(cand, function (c) {
        return cerrarConFormato(c).then(function (r) { if (r) ok++; });
      }).then(function () { return { cerradas: ok, formatos: ok }; });
    });
  }

  function cerrarSeleccionadas() {
    var checks = Array.prototype.slice.call(document.querySelectorAll('.acs-cand-check:checked'));
    if (!checks.length) { progRender('Selecciona compras para cerrar.'); return Promise.resolve(); }
    progReset();
    progAdd(checks.length);
    var items = checks.map(function (ch) { return candidatos[+ch.dataset.idx]; }).filter(function (c) { return c && c.idCompra; });
    return secuencia(items, function (c) {
      return (c.permisoUrl ? cambiarPermiso({ url: c.permisoUrl }) : Promise.resolve()).then(function () { return cerrarConFormato(c.compra); });
    });
  }

  /* ============ TABLA ============ */
  function filaCompra(c, idx, clase) {
    var estatusTxt = c.estatus || (Number(c.idEstatus) === 1 ? 'Aceptada' : Number(c.idEstatus) === 0 ? 'Solicitada' : String(c.idEstatus));
    var tr = document.createElement('tr');
    tr.innerHTML = '<td><input type="checkbox" checked class="' + clase + '" data-idx="' + idx + '"></td>' +
      '<td>' + c.codigoRegistro + '</td>' +
      '<td>' + estatusTxt + '</td>' +
      '<td>' + (c.volumen_Solicitado || '?') + ' / ' + (c.volumen_Entregado || '?') + '</td>' +
      '<td>' + (c.fechaCompra || '') + '</td>' +
      '<td>' + (c.permiso_Vendedor || '') + '</td>';
    document.querySelector('#acs-tabla tbody').appendChild(tr);
    actualizarResumen();
    return tr;
  }

  function nuevaFila(modulo, permiso, registro) {
    var tr = document.createElement('tr');
    tr.innerHTML = '<td>' + modulo + '</td><td>' + (permiso ? permiso.id : 'actual') + '</td><td>' + registro + '</td>' +
      '<td class="acs-est pend">…</td><td class="acs-det"></td>';
    document.querySelector('#acs-tabla tbody').appendChild(tr);
    var est = tr.querySelector('.acs-est');
    var det = tr.querySelector('.acs-det');
    return {
      set: function (e, d) {
        est.textContent = e;
        est.className = 'acs-est ' + (e === 'OK' ? 'ok' : e === 'FALLO' ? 'fail' : 'pend');
        det.textContent = d || '';
      }
    };
  }

  function limpiarTabla() {
    document.querySelector('#acs-tabla tbody').innerHTML = '';
    candidatos = [];
    facturasCandidatas = [];
    actualizarResumen();
  }

  function espera() {
    return new Promise(function (res) { setTimeout(res, CONFIG.DELAY_MS); });
  }

  /* ============ ORQUESTADOR ============ */
  function runModulo(nombre, fn, contextUrl, forzar) {
    STOP = false;
    return (contextUrl ? fetch(contextUrl, { credentials: 'same-origin' }) : Promise.resolve()).then(function () {
      // Despachar y Recepcionar no deben borrar la lista ni sus selecciones al iniciar.
      if (nombre !== 'Despachar' && nombre !== 'Recepcionar') limpiarTabla();
      progReset();
      progRender('Iniciando ' + nombre + ' | ' + CONFIG.DESDE + ' a ' + CONFIG.HASTA);
      verboseLog('MODULO', { nombre: nombre, desde: CONFIG.DESDE, hasta: CONFIG.HASTA, permiso: CONFIG.PERMISO_FILTRO || 'Todos' });
      if (!forzar && !CONFIG.RECORRER_PERMISOS && nombre !== 'Despachar') {
        return fn(null).then(function () { progRender('✔ Módulo ' + nombre + ' terminado.'); });
      }
      var obtener = nombre === 'Despachar' ? obtenerPermisosDespacho : obtenerPermisos;
      return obtener().then(function (perms) {
        if (!perms.length) {
          return fn(null).then(function () { progRender('✔ Módulo ' + nombre + ' terminado (permiso actual).'); });
        }
        progRender('Permisos: ' + perms.map(function (p) { return p.id; }).join(', '));
        return secuencia(perms, function (p) {
          progRender('── Permiso ' + p.id + ' ──');
          return cambiarPermiso(p).then(function () { return fn(p); });
        }).then(function () { progRender('✔ Módulo ' + nombre + ' terminado.'); });
      });
    });
  }

  function ejecutarActivo() {
    STOP = false;
    var tab = tabActiva;
    var trabajos = {
      inicio: flujoCompleto,
      aceptar: function () { return runModulo('Aceptar', moduloAceptar, '/GasLP/AceptarRechazarCompras/Index'); },
      despachar: function () { return runModulo('Despachar', moduloDespachar, '/GasLP/Despacho/Index'); },
      recepcionar: function () { return runModulo('Recepcionar', moduloRecepcionar, '/GasLP/Recepcion/Index'); },
      facturas: escanearFacturas,
      cerrar: function () { return runModulo('Cerrar', moduloCerrar, '/GasLP/Compras/Index'); }
    };
    Promise.resolve((trabajos[tab] || flujoCompleto)()).then(function () {
      if (tab === 'cerrar' && !STOP) progRender('Listo. Selecciona y usa "Cerrar seleccionadas".');
    }).catch(function (e) {
      verboseLog('ERROR MODULO', { modulo: tab, error: e.message, stack: e.stack });
      progRender('ERROR ' + tab + ': ' + e.message);
    });
  }

  function flujoCompleto() {
    STOP = false;
    progReset();
    var total = { cerradas: 0, formatos: 0 };
    var PASOS = [
      ['Aceptar', function () { return lote(listarAceptar, filtroSolicitadas, aceptarUna, 'Aceptando'); }, '/GasLP/AceptarRechazarCompras/Index'],
      ['Despachar', function () { return lote(function () { return listarDespacho(null); }, filtroAceptadas, despacharUna, 'Despachando'); }, '/GasLP/Despacho/Index'],
      ['Recepcionar', function () { return lote(listarRecepcion, filtroEnTransito, recepcionarConCierre, 'Recepcionando'); }, '/GasLP/Recepcion/Index'],
      ['Cerrar', cerrarTodas, '/GasLP/Compras/Index']
    ];

    function pipeline() {
      var seq = Promise.resolve();
      PASOS.forEach(function (p) {
        seq = seq.then(function () {
          if (STOP) return;
          progRender(p[0] + '...');
          return fetch(p[2], { credentials: 'same-origin' })
            .then(function () { return p[1](); })
            .then(function (r) {
              if (r && r.cerradas) total.cerradas += r.cerradas;
              if (r && r.formatos) total.formatos += r.formatos;
              if (!STOP) progRender(p[0] + ' OK.');
              return espera();
            });
        });
      });
      return seq;
    }

    function fin(extra) {
      if (!STOP) progRender('Terminado' + (extra || '') + '. Cerradas: ' + total.cerradas + '. Formatos: ' + total.formatos + '.');
    }

    if (!CONFIG.RECORRER_PERMISOS) return pipeline().then(function () { fin(); });
    return obtenerPermisos().then(function (perms) {
      if (!perms.length) return pipeline().then(function () { fin(); });
      progRender('Permisos: ' + perms.map(function (p) { return p.id; }).join(', '));
      return secuencia(perms, function (p) {
        progRender('── Permiso ' + p.id + ' ──');
        return cambiarPermiso(p).then(pipeline);
      }).then(function () { fin(' (' + perms.length + ' permisos)'); });
    });
  }

  /* ============ UI ============ */
  var tabActiva = 'inicio';

  function buildUI() {
    cargarUI();
    tabActiva = UI_STATE.tab;
    var panel = document.createElement('div');
    panel.id = 'acs-side';
    panel.innerHTML =
      '<div id="acs-topbar">' +
      '  <label for="acs-desde">Desde</label><input type="date" id="acs-desde" value="' + CONFIG.DESDE + '" title="Fecha de compra; en Recepcionar es la fecha de despacho">' +
      '  <label for="acs-hasta">Hasta</label><input type="date" id="acs-hasta" value="' + CONFIG.HASTA + '" title="Fecha de compra; en Recepcionar es la fecha de despacho">' +
      '  <label for="acs-permiso">Permiso</label><select id="acs-permiso" title="Permiso vendedor; Todos = sin filtro"><option value="">Todos los permisos</option></select>' +
      '  <label class="acs-opt" title="Recorre cada permiso de la sesión en lugar de solo el actual"><input type="checkbox" id="acs-permisos" ' + (CONFIG.RECORRER_PERMISOS ? 'checked' : '') + '> Recorrer permisos</label>' +
      '  <button type="button" id="acs-cfg-toggle" title="Mostrar u ocultar ajustes"><i class="fa-solid fa-gear"></i> Ajustes</button>' +
      '</div>' +
      '<div id="acs-cfg" style="display:none">' +
      '  <label for="acs-vehiculo">Vehículo</label><input type="text" id="acs-vehiculo" value="' + CONFIG.VEHICULO + '">' +
      '  <label for="acs-placas">Placas</label><input type="text" id="acs-placas" value="' + CONFIG.PLACAS + '">' +
      '  <label for="acs-delay">Espera (ms)</label><input type="number" id="acs-delay" value="' + CONFIG.DELAY_MS + '" min="0" step="100" title="Pausa entre operaciones">' +
      '  <label for="acs-motivo">Motivo cierre</label><input type="text" id="acs-motivo" value="' + (CONFIG.MOTIVO_CIERRE || '') + '" placeholder="Mínimo 5 caracteres">' +
      '  <label class="acs-opt"><input type="checkbox" id="acs-cerrar" ' + (CONFIG.CERRAR_AL_RECEPCIONAR ? 'checked' : '') + '> Cerrar al recepcionar</label>' +
      '  <label class="acs-opt"><input type="checkbox" id="acs-verbose" ' + (CONFIG.VERBOSE ? 'checked' : '') + '> Registro detallado</label>' +
      '</div>' +
      '<ul id="acs-tabs" role="tablist">' +
      '  <li data-tab="inicio" class="on" role="tab" aria-selected="true">Inicio</li>' +
      '  <li data-tab="aceptar" role="tab">Aceptar</li>' +
      '  <li data-tab="despachar" role="tab">Despachar</li>' +
      '  <li data-tab="recepcionar" role="tab">Recepcionar</li>' +
      '  <li data-tab="cerrar" role="tab">Cerrar</li>' +
      '  <li data-tab="facturas" role="tab">Facturas</li>' +
      '</ul>' +
      '<div id="acs-body">' +
      '  <div class="acs-pane" id="acs-pane-inicio"></div>' +
      '  <div class="acs-pane" id="acs-pane-aceptar" style="display:none">Acepta compras <b>Solicitadas</b> en el rango de fechas.</div>' +
      '  <div class="acs-pane" id="acs-pane-despachar" style="display:none">Despacha compras <b>Aceptadas</b> con el vehículo y placas configurados.</div>' +
      '  <div class="acs-pane" id="acs-pane-recepcionar" style="display:none">Recepciona entregas <b>En tránsito</b>. Si está activo, cierra la compra al recepcionar.</div>' +
      '  <div class="acs-pane" id="acs-pane-cerrar" style="display:none">Lista compras <b>Aceptadas</b> sin cerrar. Selecciona y usa <b>Cerrar seleccionadas</b>.</div>' +
      '  <div class="acs-pane" id="acs-pane-facturas" style="display:none"><div>Sube formatos de traspaso de compras cerradas sin factura y descarga los formatos PDF de las compras cerradas dentro del rango.</div><label class="acs-opt"><input type="checkbox" id="acs-incluir-nocerradas" ' + (CONFIG.INCLUIR_NO_CERRADAS_FACT ? 'checked' : '') + '> Incluir compras no cerradas</label></div>' +
      '  <div id="acs-facturas-acciones" style="display:none">' +
      '    <button id="acs-refrescar-facturas" class="acs-btn"><i class="fa-solid fa-rotate"></i> Actualizar</button>' +
      '    <button id="acs-subir-facturas" class="acs-btn"><i class="fa-solid fa-cloud-arrow-up"></i> Subir</button>' +
      '    <button id="acs-descargar-formatos" class="acs-btn"><i class="fa-solid fa-file-arrow-down"></i> Descargar PDFs</button>' +
      '    <button id="acs-detener-facturas" class="acs-btn"><i class="fa-solid fa-stop"></i> Detener</button>' +
      '  </div>' +
      '  <div id="acs-acciones">' +
      '    <button id="acs-ejecutar" class="acs-btn acs-btn-principal"><i class="fa-solid fa-play"></i> Procesar todo el rango</button>' +
      '    <button id="acs-detener" class="acs-btn">Detener</button>' +
      '    <button id="acs-refrescar" class="acs-btn">Actualizar lista</button>' +
      '    <button id="acs-cerrar-sel" class="acs-btn">Cerrar seleccionadas</button>' +
      '    <button id="acs-formato-sel" class="acs-btn"><i class="fa-solid fa-file-pdf"></i> Generar PDFs</button>' +
      '  </div>' +
      '  <div id="acs-status" role="status" aria-live="polite">Listo.</div>' +
      '  <div id="acs-prog"><div id="acs-bar-fill"></div><span id="acs-prog-text">0 / 0</span></div>' +
      '  <div id="acs-summary">0 visibles · 0 seleccionadas</div>' +
      '  <div id="acs-tabla-wrap"><table id="acs-tabla"><thead id="acs-thead"></thead><tbody></tbody></table></div>' +
      '</div>';
    var hubPane = ET.ui.tab('acs', 'ACS', 10, 470);
    hubPane.style.padding = '0';
    hubPane.appendChild(panel);

    var fa = document.createElement('link');
    fa.rel = 'stylesheet';
    fa.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css';
    document.head.appendChild(fa);

    var BOTONES = {
      inicio: ['<i class="fa-solid fa-play"></i> Procesar todo el rango', 'principal', 1, 1, 1, 0, 1],
      aceptar: ['<i class="fa-solid fa-check"></i> Aceptar pendientes', 'principal', 1, 1, 0, 0, 0],
      despachar: ['<i class="fa-solid fa-truck"></i> Despachar pendientes', 'principal', 1, 1, 0, 0, 0],
      recepcionar: ['<i class="fa-solid fa-box"></i> Recepcionar pendientes', 'principal', 1, 1, 0, 0, 0],
      cerrar: ['<i class="fa-solid fa-rotate"></i> Actualizar lista', '', 1, 0, 0, 1, 1],
      facturas: [null, null, 0, 1, 0, 0, 0]
    };
    var IDS_BOTON = ['ejecutar', 'detener', 'refrescar', 'cerrar-sel', 'formato-sel'];

    function actualizarBotones(tab) {
      var cfg = BOTONES[tab] || BOTONES.inicio;
      for (var i = 0; i < IDS_BOTON.length; i++) {
        panel.querySelector('#acs-' + IDS_BOTON[i]).style.display = cfg[i + 2] ? 'inline-block' : 'none';
      }
      if (cfg[0]) {
        var ejecutar = panel.querySelector('#acs-ejecutar');
        ejecutar.innerHTML = cfg[0];
        ejecutar.className = cfg[1] ? 'acs-btn acs-btn-principal' : 'acs-btn';
      }
      panel.querySelector('#acs-thead').innerHTML = (tab === 'inicio' || tab === 'cerrar' || tab === 'facturas')
        ? '<tr><th></th><th>Registro</th><th>Estatus</th><th>Volumen</th><th>Fecha</th><th>Permiso</th></tr>'
        : '<tr><th>Módulo</th><th>Permiso</th><th>Registro</th><th>Estado</th><th>Detalle</th></tr>';
      panel.querySelector('#acs-acciones').style.display = tab === 'facturas' ? 'none' : 'flex';
      panel.querySelector('#acs-facturas-acciones').style.display = tab === 'facturas' ? 'flex' : 'none';
    }

    var tabs = panel.querySelectorAll('#acs-tabs li');
    var panes = panel.querySelectorAll('.acs-pane');

    function setTab(tab, guardar) {
      tabActiva = tab;
      for (var i = 0; i < tabs.length; i++) {
        var on = tabs[i].dataset.tab === tab;
        tabs[i].className = on ? 'on' : '';
        tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
      }
      for (var k = 0; k < panes.length; k++) panes[k].style.display = panes[k].id === 'acs-pane-' + tab ? 'block' : 'none';
      actualizarBotones(tab);
      if (guardar) guardarUI();
    }

    for (var i = 0; i < tabs.length; i++) {
      (function (li) { li.addEventListener('click', function () { setTab(li.dataset.tab, true); }); })(tabs[i]);
    }

    panel.querySelector('#acs-ejecutar').addEventListener('click', ejecutarActivo);
    panel.querySelector('#acs-detener').addEventListener('click', detener);
    panel.querySelector('#acs-refrescar').addEventListener('click', function () {
      runModulo('Lista', moduloListarTodo, '/GasLP/Compras/Index', true).then(function () {
        if (!STOP) progRender(candidatos.length + ' compras listadas en total.');
      });
    });
    panel.querySelector('#acs-refrescar-facturas').addEventListener('click', function () {
      escanearFacturas().then(function () {
        if (!STOP) progRender(facturasCandidatas.length + ' traspaso(s) pendiente(s).');
      });
    });
    panel.querySelector('#acs-subir-facturas').addEventListener('click', function () {
      subirFacturasSeleccionadas().then(function () {
        if (!STOP) progRender('Subida de traspasos terminada.');
      });
    });
    panel.querySelector('#acs-descargar-formatos').addEventListener('click', function () {
      descargarFormatosRango();
    });
    panel.querySelector('#acs-incluir-nocerradas').addEventListener('change', function () {
      CONFIG.INCLUIR_NO_CERRADAS_FACT = this.checked;
      guardarConfig();
    });
    panel.querySelector('#acs-detener-facturas').addEventListener('click', detener);
    panel.querySelector('#acs-tabla tbody').addEventListener('change', actualizarResumen);
    panel.querySelector('#acs-cerrar-sel').addEventListener('click', function () {
      STOP = false;
      cerrarSeleccionadas().then(function () { progRender('Cierres terminados.'); });
    });
    panel.querySelector('#acs-formato-sel').addEventListener('click', function () {
      if (tabActiva === 'inicio') {
        if (!candidatos.length) { progRender('Actualiza la lista primero.'); return; }
        candidatos.forEach(function (c) { try { descargarFormato(c.compra); } catch (e) {} });
        progRender(candidatos.length + ' formato(s) generado(s).');
        return;
      }
      var checks = Array.prototype.slice.call(document.querySelectorAll('.acs-cand-check:checked'));
      if (!checks.length) { progRender('Selecciona compras.'); return; }
      checks.forEach(function (ch) {
        var c = candidatos[+ch.dataset.idx];
        if (c) { try { descargarFormato(c.compra); } catch (e) {} }
      });
      progRender(checks.length + ' formato(s) generado(s).');
    });

    function aplicarUI() {
      setTab(tabActiva, false);
    }

    panel.querySelector('#acs-cfg-toggle').addEventListener('click', function () {
      var cfg = panel.querySelector('#acs-cfg');
      cfg.style.display = cfg.style.display === 'none' ? 'flex' : 'none';
    });

    panel.querySelector('#acs-cerrar').addEventListener('change', function () { CONFIG.CERRAR_AL_RECEPCIONAR = this.checked; guardarConfig(); });
    panel.querySelector('#acs-verbose').addEventListener('change', function () { CONFIG.VERBOSE = this.checked; guardarConfig(); });
    panel.querySelector('#acs-permisos').addEventListener('change', function () { CONFIG.RECORRER_PERMISOS = this.checked; guardarConfig(); });
    panel.querySelector('#acs-permiso').addEventListener('change', function () { CONFIG.PERMISO_FILTRO = this.value; guardarConfig(); });

    var CAMPOS = { 'acs-desde': 'DESDE', 'acs-hasta': 'HASTA', 'acs-vehiculo': 'VEHICULO', 'acs-placas': 'PLACAS', 'acs-motivo': 'MOTIVO_CIERRE', 'acs-delay': 'DELAY_MS' };
    Object.keys(CAMPOS).forEach(function (id) {
      panel.querySelector('#' + id).addEventListener('change', function () {
        CONFIG[CAMPOS[id]] = id === 'acs-delay' ? (+this.value || 0) : this.value;
        guardarConfig();
      });
    });
    progRender('Listo.');
    aplicarUI();
  }

  /* ============ CSS ============ */
  /* house-ui (skills/house-ui/tokens.css): Geist Pixel 400, plano, esquinas rectas, paleta --ui-*.
     Tokens copiados aquí porque el userscript no puede cargar un CSS local. */
  ET.ui.style(
    '#acs-side{' +
    'position:static;width:auto;min-height:100%;display:flex;flex-direction:column;background:var(--ui-bg);color:var(--ui-fg);font-family:var(--ui-font);font-weight:400;font-size:14px;line-height:1.43;}' +
    '#acs-side *{box-sizing:border-box;}' +
    '#acs-tabs{list-style:none;margin:0;padding:0;display:flex;overflow-x:auto;background:var(--ui-bg);border-bottom:1px solid var(--ui-border-strong);}' +
    '#acs-tabs li{flex:0 0 auto;padding:9px 12px;cursor:pointer;color:var(--ui-muted);font-size:13px;font-weight: 400;text-transform:uppercase;letter-spacing:.04em;border-bottom:2px solid transparent;}' +
    '#acs-tabs li:hover{background:#f5f5f5;color:var(--ui-fg);}' +
    '#acs-tabs li.on{background:#f5f5f5;color:var(--ui-fg);border-bottom-color:var(--ui-muted);}' +
    '#acs-body{flex:1;background:var(--ui-bg);}' +
    '#acs-topbar{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--ui-bg);border-bottom:1px solid var(--ui-border);flex-wrap:wrap;}' +
    '#acs-topbar label{font-size:13px;color:var(--ui-muted);margin:0;font-weight: 400;}' +
    '#acs-topbar input[type=date],#acs-topbar select{border:1px solid var(--ui-border-input);background:var(--ui-bg);color:var(--ui-fg);font:inherit;font-size:13px;padding:4px 6px;max-width:180px;cursor:pointer;}' +
    '#acs-topbar .acs-opt{margin-left:8px;}' +
    '#acs-cfg-toggle{cursor:pointer;font:inherit;font-size:13px;margin-left:auto;color:var(--ui-fg);border:1px solid var(--ui-border-input);border-radius:0;background:#f5f5f5;padding:4px 8px;}' +
    '#acs-cfg-toggle:hover{background:#e9e9e9;}' +
    '#acs-cfg-toggle:focus-visible{outline:2px solid var(--ui-focus);outline-offset:1px;}' +
    '#acs-cfg{display:none;flex-wrap:wrap;gap:8px 12px;align-items:center;padding:10px 12px;background:#f5f5f5;border-bottom:1px solid var(--ui-border);}' +
    '#acs-cfg label{color:var(--ui-fg);font-size:13px;margin:0;font-weight: 400;}' +
    '#acs-cfg input,#acs-cfg select{border:1px solid var(--ui-border-input);background:var(--ui-bg);color:var(--ui-fg);font:inherit;font-size:13px;padding:5px 6px;max-width:180px;}' +
    '#acs-topbar input:focus,#acs-topbar select:focus,#acs-cfg input:focus,#acs-cfg select:focus{border-color:var(--ui-focus);box-shadow:0 0 8px rgba(102,175,233,.6);outline:0;}' +
    '.acs-opt{color:var(--ui-fg);display:flex;align-items:center;gap:6px;font-size:13px;}' +
    '.acs-opt input{width:14px;height:14px;margin:0;cursor:pointer;}' +
    '.acs-pane{padding:10px 12px;font-size:13px;color:var(--ui-muted);background:var(--ui-bg);border-bottom:1px solid var(--ui-border);}' +
    '#acs-acciones,#acs-facturas-acciones{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;padding:10px 12px;background:var(--ui-bg);border-bottom:1px solid var(--ui-border-strong);}' +
    '#acs-acciones{position:sticky;top:0;z-index:100;}' +
    '.acs-btn{width:100%;margin:0;padding:9px 10px;font:inherit;font-size:13px;color:var(--ui-fg);background:#f5f5f5;border:1px solid var(--ui-border-input);border-radius:0;cursor:pointer;white-space:nowrap;}' +
    '.acs-btn:hover{background:#e9e9e9;}' +
    '.acs-btn:active{background:#dfdfdf;}' +
    '.acs-btn:focus-visible{outline:2px solid var(--ui-focus);outline-offset:1px;}' +
    '.acs-btn:disabled{color:var(--ui-muted);background:#f5f5f5;border-color:var(--ui-border);cursor:not-allowed;}' +
    '.acs-btn i{margin-right:6px;}' +
    '.acs-btn-principal{border-color:var(--ui-muted);font-weight: 400;}' +
    '#acs-status{padding:8px 12px;color:var(--ui-fg);font-size:13px;background:#f5f5f5;border-bottom:1px solid var(--ui-border);}' +
    '#acs-prog{position:relative;height:22px;margin:8px 12px;background:var(--ui-bg);border:1px solid var(--ui-border);overflow:hidden;}' +
    '#acs-bar-fill{width:0;height:100%;background:var(--ui-muted);transition:width .3s;}' +
    '@media (prefers-reduced-motion:reduce){#acs-bar-fill{transition:none;}}' +
    '#acs-prog-text{position:absolute;top:0;right:8px;line-height:20px;font-size:13px;color:var(--ui-fg);}' +
    '#acs-summary{padding:6px 12px;color:var(--ui-muted);font-size:13px;background:var(--ui-bg);border-bottom:1px solid var(--ui-border);}' +
    '#acs-tabla-wrap{max-height:clamp(200px,40vh,480px);overflow:auto;background:var(--ui-bg);border-top:1px solid var(--ui-border);}' +
    '#acs-tabla{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums;}' +
    '#acs-tabla th{background:var(--ui-bg);color:var(--ui-fg);border-bottom:1px solid var(--ui-border-strong);padding:6px;text-align:left;font-weight: 400;position:sticky;top:0;z-index:1;}' +
    '#acs-tabla td{border-bottom:1px solid var(--ui-border);padding:6px;color:var(--ui-fg);overflow-wrap:anywhere;}' +
    '#acs-tabla tbody tr:nth-child(even){background:#f5f5f5;}' +
    '#acs-tabla tbody tr.acs-factura-ok{background:var(--ui-ok-bg);}' +
    '.acs-est.ok{color:var(--ui-ok-fg);}' +
    '.acs-est.fail,.acs-fail{color:var(--ui-err-fg);}'
  );

  /* ============ INICIO ============ */
  cargarConfig();
  if (document.body) buildUI();
  else window.addEventListener('DOMContentLoaded', buildUI);

  ET.acs = ET.acs || {};
})();
