/* EasyTrac TRASPASOS
   Transfers between permits, mounted in the sidebar. */
(function () {
  'use strict';
  var ET = globalThis.EasyTrac;
  const CONFIG = {
    acusesUrl: '/GasLP/Compras/GetRegistrosCompras',
    acusesSelectUrl: '/OrdenDePedido/SeleccionarPermiso',
    suspendUrl: '/GasLP/Compras/ChecaPermisoSuspendido',
    createUrl: '/GasLP/Compras/GuardaCompraGasLP',
    acusesStatuses: [-1],
    sendDelayMs: 800,
  };

  /* La espera entre envíos se ajusta en la pestaña Ajustes y sobrevive a la recarga. */
  const DELAY_KEY = 'traspasos_delay';
  if (ET.store) {
    const guardadoDelay = ET.store.get(DELAY_KEY, null);
    if (guardadoDelay != null && isFinite(guardadoDelay)) {
      CONFIG.sendDelayMs = Math.max(0, +guardadoDelay);
    }
  }

  const STORAGE_PREFIX = 'siretrac-traspasos:v1:';
  const MAPPING_KEY = STORAGE_PREFIX + 'mapping';
  const LEDGER_KEY = STORAGE_PREFIX + 'ledger';
  const PRESETS_KEY = STORAGE_PREFIX + 'presets';
  const HOST_ID = 'siretrac-traspasos-host';
  const DAY_INDEX = {
    domingo: 0,
    lunes: 1,
    martes: 2,
    miercoles: 3,
    jueves: 4,
    viernes: 5,
    sabado: 6,
  };
  const MONTH_INDEX = {
    enero: 1,
    febrero: 2,
    marzo: 3,
    abril: 4,
    mayo: 5,
    junio: 6,
    julio: 7,
    agosto: 8,
    septiembre: 9,
    setiembre: 9,
    octubre: 10,
    noviembre: 11,
    diciembre: 12,
  };

  const state = {
    permits: [],
    mapping: {},
    globalSourceId: '',
    sourceScId: '',
    tipoSuministradorId: '19',
    tipoSuministradorName: 'Distribuidor por Planta de Distribucion',
    mappingRestored: false,
    autoMapped: false,
    parsed: null,
    preview: [],
    transfers: [],
    ledger: [],
    presets: [],
    busy: false,
  };

  let ui = null;

  // ---------------------------------------------------------------------------
  // Funciones puras (probadas desde Node)
  // ---------------------------------------------------------------------------

  function normalizeText(value) {
    return String(value == null ? '' : value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function normalizeFieldName(value) {
    return normalizeText(value).replace(/\s+/g, '');
  }

  function canonicalPermit(value) {
    const text = String(value == null ? '' : value).trim();
    const match = text.match(/LP\s*\/\s*[A-Z0-9]+(?:\s*\/\s*[A-Z0-9]+)+/i);
    return (match ? match[0] : text).replace(/\s+/g, '').toUpperCase();
  }

  // Formato exacto de la clave de deduplicación.
  function normalizeKey(permit, date, volumeKg, sourcePermit) {
    const base = canonicalPermit(permit) + '|' + date + '|' + Number(volumeKg).toFixed(3);
    return sourcePermit ? canonicalPermit(sourcePermit) + '>' + base : base;
  }

  function toISO(date) {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  function makeISO(year, month, day) {
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
    if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return null;
    }
    return toISO(date);
  }

  function parseDate(value) {
    if (value == null) return null;
    const text = String(value).trim();
    if (!text) return null;

    // "Lunes, 27 de octubre de 2025" o "27 de octubre de 2025".
    const longMatch = text.match(
      /^(?:(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo),?\s+)?(\d{1,2})\s+de\s+([a-záéíóúñü]+)\s+de\s+(\d{4})$/i
    );
    if (longMatch) {
      const month = MONTH_INDEX[normalizeText(longMatch[2])];
      if (month) return makeISO(Number(longMatch[3]), month, Number(longMatch[1]));
    }

    // Número de serie de Excel (base 1899-12-30).
    if (/^\d{5}(?:\.\d+)?$/.test(text)) {
      const serial = Number(text);
      if (serial >= 20000 && serial <= 60000) {
        return toISO(new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000));
      }
    }

    // YYYY-MM-DD, YYYY/MM/DD, con hora opcional.
    let match = text.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})(?:[T\s].*)?$/);
    if (match) return makeISO(Number(match[1]), Number(match[2]), Number(match[3]));

    // DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, con hora opcional.
    match = text.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:\s+.*)?$/);
    if (match) {
      let year = Number(match[3]);
      if (year < 100) year += 2000;
      return makeISO(year, Number(match[2]), Number(match[1]));
    }

    return null;
  }

  function parseVolume(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    let text = String(value == null ? '' : value).trim();
    if (!text) return null;

    text = text.replace(/\s*(?:kg|kgs|kilogramos?)\s*$/i, '');
    text = text.replace(/\s+/g, '');
    if (!/^[+-]?[\d.,]+$/.test(text)) return null;

    const lastComma = text.lastIndexOf(',');
    const lastDot = text.lastIndexOf('.');
    if (lastComma !== -1 && lastDot !== -1) {
      if (lastComma > lastDot) {
        text = text.replace(/\./g, '').replace(',', '.');
      } else {
        text = text.replace(/,/g, '');
      }
    } else if (lastComma !== -1) {
      if (/^\d{1,3}(?:,\d{3})+$/.test(text)) {
        text = text.replace(/,/g, '');
      } else {
        text = text.replace(',', '.');
      }
    } else if (lastDot !== -1) {
      // 0.750 es un decimal; 1.234 se mantiene como separador de miles.
      if (!/^0\.\d{3}$/.test(text) && /^\d{1,3}(?:\.\d{3})+$/.test(text)) {
        text = text.replace(/\./g, '');
      }
    }

    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  }

  function detectDelimiter(line) {
    const candidates = [
      ['\t', (line.match(/\t/g) || []).length],
      [';', (line.match(/;/g) || []).length],
      [',', (line.match(/,/g) || []).length],
    ];
    candidates.sort(function (a, b) {
      return b[1] - a[1];
    });
    return candidates[0][1] > 0 ? candidates[0][0] : '\t';
  }

  function splitDelimited(line, delimiter) {
    const cells = [];
    let current = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (quoted) {
        if (char === '"') {
          if (line[i + 1] === '"') {
            current += '"';
            i += 1;
          } else {
            quoted = false;
          }
        } else {
          current += char;
        }
      } else if (char === '"') {
        quoted = true;
      } else if (char === delimiter) {
        cells.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    cells.push(current);
    return cells;
  }

  function nextMondayISO(from) {
    const source = from instanceof Date && !Number.isNaN(from.getTime()) ? from : new Date();
    const base = new Date(Date.UTC(source.getFullYear(), source.getMonth(), source.getDate()));
    const add = (8 - base.getUTCDay()) % 7 || 7;
    base.setUTCDate(base.getUTCDate() + add);
    return toISO(base);
  }

  // Lunes de la semana anterior (semana operativa lunes-domingo).
  function previousMondayISO(from) {
    const source = from instanceof Date && !Number.isNaN(from.getTime()) ? from : new Date();
    const base = new Date(Date.UTC(source.getFullYear(), source.getMonth(), source.getDate()));
    const daysSinceMonday = (base.getUTCDay() + 6) % 7;
    base.setUTCDate(base.getUTCDate() - daysSinceMonday - 7);
    return toISO(base);
  }

  function todayISO() {
    const now = new Date();
    return makeISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }

  // Lunes de la semana que contiene la fecha (sin desplazarla a la anterior).
  function mondayISO(iso) {
    const p = String(iso || '').split('-');
    if (p.length !== 3) return '';
    const d = new Date(+p[0], +p[1] - 1, +p[2]);
    if (Number.isNaN(d.getTime())) return '';
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return makeISO(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }

  function sundayISO(iso) {
    const l = mondayISO(iso);
    if (!l) return '';
    const [y, m, day] = l.split('-').map(Number);
    const d = new Date(y, m - 1, day + 6);
    return makeISO(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }

  function resolveHeaderDate(header, weekStart) {
    const direct = parseDate(header);
    if (direct) return direct;
    const key = normalizeText(header);
    if (!Object.prototype.hasOwnProperty.call(DAY_INDEX, key)) return null;
    if (!weekStart) return null;
    const base = new Date(weekStart + 'T00:00:00Z');
    if (Number.isNaN(base.getTime())) return null;
    const offset = (DAY_INDEX[key] - base.getUTCDay() + 7) % 7;
    base.setUTCDate(base.getUTCDate() + offset);
    return toISO(base);
  }

  function findLongColumns(headers) {
    const normalized = headers.map(normalizeFieldName);
    function find(aliases) {
      for (const alias of aliases) {
        const index = normalized.findIndex(function (header) {
          return header === alias || header.includes(alias);
        });
        if (index !== -1) return index;
      }
      return -1;
    }
    return {
      station: find(['estacion', 'sitio', 'planta', 'punto', 'station', 'permiso', 'permit']),
      date: find(['fecha', 'date', 'dia']),
      volume: find(['volumen', 'cantidad', 'kg', 'kilos']),
    };
  }

  // Formato de la plantilla real: una fila "ENTRADA POR TRASPASO" y fechas largas en el encabezado.
  function parseTransferSheet(table, headers, delimiter, weekStart) {
    let transferRow = null;
    let branch = '';
    let permit = '';

    for (const cells of table) {
      const firstIndex = cells.findIndex(function (cell) {
        return String(cell).trim() !== '';
      });
      if (firstIndex === -1) continue;
      const first = normalizeText(cells[firstIndex]);
      if (first.startsWith('entrada por traspaso')) transferRow = cells;
      if (first.startsWith('sucursal')) branch = String(cells[firstIndex + 1] || '').trim();
      if (/^n[°º]?\s*de\s*permiso/.test(first)) {
        const found = cells.join(' ').match(/(?:CNE\/)?LP\/\d+\/[A-Z]+\/[A-Z]+\/\d+/i);
        if (found) permit = found[0].toUpperCase();
      }
    }
    if (!transferRow) return null;

    // El encabezado de fechas es la fila con más fechas; así se ignoran fechas sueltas en otras filas.
    let dateCells = [];
    for (const cells of table) {
      const found = [];
      cells.forEach(function (cell, index) {
        const iso = parseDate(cell);
        if (iso) found.push({ index: index, iso: iso, raw: String(cell).trim() });
      });
      if (found.length > dateCells.length) dateCells = found;
    }
    if (!dateCells.length) return null;

    const seenDates = new Set();
    const dates = dateCells.filter(function (item) {
      if (seenDates.has(item.iso)) return false;
      seenDates.add(item.iso);
      return true;
    });
    dates.sort(function (a, b) {
      return a.index - b.index;
    });

    const station = branch || permit || 'Matriz';
    const rows = [];
    for (let d = 0; d < dates.length; d += 1) {
      const start = dates[d].index;
      const end = d + 1 < dates.length ? dates[d + 1].index : transferRow.length;
      let volume = null;
      for (let index = start; index < end; index += 1) {
        const value = parseVolume(transferRow[index]);
        if (value != null && value > 0) {
          volume = value;
          break;
        }
      }
      if (volume == null) continue;
      rows.push({
        line: d + 1,
        station: station,
        rawDate: dates[d].raw,
        date: dates[d].iso,
        rawVolume: String(volume),
        volumeKg: volume,
        permitHint: permit,
      });
    }
    if (!rows.length) return null;
    return {
      format: 'transfer',
      delimiter: delimiter,
      headers: headers,
      rows: rows,
      weekStart: weekStart,
      branch: branch,
      permit: permit,
    };
  }

  function parseMatrix(text, options) {
    const settings = options || {};
    const source = String(text == null ? '' : text).replace(/\r\n?/g, '\n').trim();
    if (!source) return { format: 'empty', delimiter: '', headers: [], rows: [] };

    const lines = source.split('\n').filter(function (line) {
      return line.trim() !== '';
    });
    const delimiter = detectDelimiter(lines[0]);
    const table = lines.map(function (line) {
      return splitDelimited(line, delimiter);
    });
    let headerIndex = 0;
    for (let i = 0; i < table.length; i += 1) {
      const first = normalizeText(table[i][0] || '');
      if (/^traspasos\b/.test(first)) {
        headerIndex = i;
        break;
      }
    }
    const headers = table[headerIndex].map(function (header) {
      return header.trim();
    });
    const columns = findLongColumns(headers);
    const weekStart =
      settings.weekStart === undefined ? previousMondayISO() : parseDate(settings.weekStart);

    const transferSheet = parseTransferSheet(table, headers, delimiter, weekStart);
    if (transferSheet) return transferSheet;

    if (columns.date !== -1 && columns.volume !== -1) {
      const stationIndex = columns.station === -1 ? 0 : columns.station;
      const rows = [];
      for (let i = headerIndex + 1; i < table.length; i += 1) {
        const cells = table[i];
        const station = (cells[stationIndex] || '').trim();
        const rawDate = (cells[columns.date] || '').trim();
        const rawVolume = (cells[columns.volume] || '').trim();
        if (!station && !rawDate && !rawVolume) continue;
        rows.push({
          line: i + 1,
          station: station,
          rawDate: rawDate,
          date: parseDate(rawDate) || resolveHeaderDate(rawDate, weekStart),
          rawVolume: rawVolume,
          volumeKg: parseVolume(rawVolume),
        });
      }
      return { format: 'long', delimiter: delimiter, headers: headers, rows: rows, weekStart: weekStart };
    }

    const dates = headers.slice(1).map(function (header) {
      return resolveHeaderDate(header, weekStart);
    });
    const rows = [];
    for (let i = headerIndex + 1; i < table.length; i += 1) {
      const cells = table[i];
      const station = (cells[0] || '').trim();
      if (!station) continue;
      if (/^(total|subtotal|suma|promedio)\b/.test(normalizeText(station))) continue;
      for (let column = 1; column < headers.length; column += 1) {
        // Ignora columnas de resumen tipo "Total" para que no bloqueen la vista previa.
        if (/^(total|subtotal|suma|promedio)\b/.test(normalizeText(headers[column]))) continue;
        const rawVolume = (cells[column] || '').trim();
        if (!rawVolume) continue;
        rows.push({
          line: i + 1,
          station: station,
          rawDate: headers[column],
          date: dates[column - 1],
          rawVolume: rawVolume,
          volumeKg: parseVolume(rawVolume),
        });
      }
    }
    return {
      format: 'wide',
      delimiter: delimiter,
      headers: headers,
      rows: rows,
      weekStart: weekStart,
    };
  }

  function findFirstArray(value, depth) {
    const level = depth || 0;
    if (level > 4 || value == null) return null;
    if (Array.isArray(value)) return value;
    if (typeof value !== 'object') return null;

    const preferred = ['data', 'result', 'items', 'rows', 'acuses', 'registros'];
    for (const key of preferred) {
      if (Array.isArray(value[key])) return value[key];
    }
    for (const child of Object.values(value)) {
      if (child && typeof child === 'object') {
        const found = findFirstArray(child, level + 1);
        if (found) return found;
      }
    }
    return null;
  }

  function pickField(object, aliases) {
    const normalized = {};
    for (const [key, value] of Object.entries(object)) {
      normalized[normalizeFieldName(key)] = value;
    }
    for (const alias of aliases) {
      const key = normalizeFieldName(alias);
      if (!Object.prototype.hasOwnProperty.call(normalized, key)) continue;
      const value = normalized[key];
      if (value !== null && value !== undefined && value !== '') return value;
    }
    return null;
  }

  function extractAcuses(response) {
    if (response == null) return null;
    const list = Array.isArray(response) ? response : findFirstArray(response);
    if (!Array.isArray(list)) return null;

    return list
      .filter(function (row) {
        return row && typeof row === 'object';
      })
      .map(function (raw) {
        const permitRaw = pickField(raw, [
          'permiso_Vendedor',
          'permiso',
          'permit',
          'numeroPermiso',
          'numPermiso',
          'clavePermiso',
        ]);
        const registrationRaw = pickField(raw, [
          'codigoRegistro',
          'numeroRegistro',
          'numRegistro',
          'registro',
          'folio',
          'numeroAcuse',
          'acuse',
          'idCompra',
        ]);
        const registrationDateRaw = pickField(raw, [
          'fechaRegistro',
          'fechaAlta',
          'fechaAcuse',
        ]);
        const operationDateRaw = pickField(raw, [
          'fechaCompra',
          'fechaOperacion',
          'fechaTraspaso',
          'fecha',
        ]);
        const volumeRaw = pickField(raw, [
          'volumen_Solicitado',
          'volumen_Entregado',
          'volumen',
          'volumenKg',
          'cantidad',
          'kg',
          'kilos',
        ]);
        const traspasoRaw = pickField(raw, ['traspaso', 'esTraspaso']);
        return {
          permit: canonicalPermit(permitRaw),
          sourcePermit: canonicalPermit(permitRaw),
          traspaso:
            traspasoRaw == null
              ? null
              : traspasoRaw === true ||
                traspasoRaw === 1 ||
                String(traspasoRaw).toLowerCase() === 'true' ||
                String(traspasoRaw) === '1',
          registrationNumber:
            registrationRaw == null ? null : String(registrationRaw).trim(),
          registrationDate: parseDate(registrationDateRaw),
          operationDate: parseDate(operationDateRaw),
          volumeKg: parseVolume(volumeRaw),
          raw: raw,
        };
      });
  }

  function acuseKey(acuse, fallbackPermit) {
    if (!acuse) return null;
    // En GetRegistrosCompras, permiso_Vendedor es el permiso origen; el destino es el permiso seleccionado.
    const permit = canonicalPermit(fallbackPermit || acuse.permit);
    const source = canonicalPermit(acuse.sourcePermit);
    const date = acuse.operationDate || acuse.registrationDate;
    if (!permit || !date || acuse.volumeKg == null || !Number.isFinite(acuse.volumeKg)) return null;
    return normalizeKey(permit, date, acuse.volumeKg, source || null);
  }

  // El campo traspaso no es confiable: los traspasos manuales pueden venir en false.
  function acuseKeys(acuses, permit) {
    const keys = new Set();
    for (const acuse of acuses) {
      const key = acuseKey(acuse, permit);
      if (key) keys.add(key);
    }
    return keys;
  }

  function suggestPermit(station, permits) {
    const target = normalizeText(station);
    if (!target || !permits || !permits.length) return null;
    const targetWords = Array.from(
      new Set(
        target.split(' ').filter(function (word) {
          return word.length > 3;
        })
      )
    );
    const searchable = permits.map(function (permit) {
      return normalizeText(
        String(permit.permit || '') + ' ' + String(permit.activity || '') + ' ' + String(permit.razonSocial || '')
      );
    });

    let best = null;
    let bestScore = 0;
    permits.forEach(function (permit, index) {
      const permitText = normalizeText(permit.permit);
      let score = 0;
      if (target === permitText) score += 1000;
      else if (target.includes(permitText)) score += 500;
      else if (permitText.includes(target)) score += 300;

      const numberMatch = String(permit.permit || '').match(/\/(\d+)\//);
      if (numberMatch && targetWords.includes(numberMatch[1])) score += 200;

      for (const word of targetWords) {
        const hits = searchable.filter(function (haystack) {
          return haystack.split(' ').includes(word);
        }).length;
        // Una palabra presente en casi todos los permisos no distingue nada.
        if (hits > 0 && hits * 2 < permits.length) score += 10;
      }

      if (score > bestScore) {
        bestScore = score;
        best = permit;
      }
    });
    return bestScore > 0 ? best : null;
  }

  // Asigna por orden las estaciones sin destino. Es una sugerencia visible:
  // el envío pide confirmación y el usuario puede corregir cada fila.
  function assignByOrder(entries, permits, sourceId) {
    const sourceKey = String(sourceId || '');
    const candidates = (permits || []).filter(function (permit) {
      return String(permit.id) !== sourceKey && /\/EXP\/ES\//i.test(String(permit.permit || ''));
    });
    const pool = candidates.length
      ? candidates
      : (permits || []).filter(function (permit) {
          return String(permit.id) !== sourceKey;
        });
    const used = new Set(
      (entries || [])
        .map(function (entry) {
          return String(entry.destinationId || '');
        })
        .filter(Boolean)
    );

    let count = 0;
    for (const entry of entries || []) {
      if (entry.destinationId) continue;
      const next = pool.find(function (permit) {
        return !used.has(String(permit.id));
      });
      if (!next) break;
      entry.destinationId = String(next.id);
      used.add(String(next.id));
      count += 1;
    }
    return count;
  }

  // Relaciona cada permiso con los nombres/registros de la plantilla que lo usan.
  function relatePermits(permits, records) {
    const list = Array.isArray(records) ? records : Object.values(records || {});
    return (permits || []).map(function (permit) {
      const names = list
        .filter(function (record) {
          return record && String(record.destinationId) === String(permit.id);
        })
        .map(function (record) {
          return String(record.name || '').trim();
        })
        .filter(Boolean);
      return { permit: permit, names: names };
    });
  }

  function evaluateRows(parsed, mapping, permits, globalSourceId) {
    const byId = new Map(
      (permits || []).map(function (permit) {
        return [String(permit.id), permit];
      })
    );
    const globalSource = byId.get(String(globalSourceId)) || null;
    const rows = parsed && parsed.rows ? parsed.rows : [];

    return rows.map(function (row) {
      const entry = mapping ? mapping[normalizeText(row.station)] : null;
      let destination = entry ? byId.get(String(entry.destinationId)) || null : null;
      // La plantilla real trae "N° DE PERMISO": sirve como destino aunque la estación no esté mapeada.
      if (!destination && row.permitHint) {
        destination =
          (permits || []).find(function (permit) {
            return canonicalPermit(permit.permit) === canonicalPermit(row.permitHint);
          }) || null;
      }
      const source =
        (entry && entry.sourceId ? byId.get(String(entry.sourceId)) : null) || globalSource;
      let status = 'OK';
      if (!destination || !source) status = 'Sin mapeo';
      else if (String(destination.id) === String(source.id)) status = 'Origen y destino iguales';
      else if (!row.date) status = 'Fecha inválida';
      else if (row.volumeKg == null || !(row.volumeKg > 0)) status = 'Volumen inválido';
      return Object.assign({}, row, {
        destination: destination,
        source: source,
        status: status,
      });
    });
  }

  function buildTransfers(preview, registrationDate) {
    const regDate = parseDate(registrationDate) || todayISO();
    return (preview || [])
      .filter(function (row) {
        return row.status === 'OK';
      })
      .map(function (row) {
        return {
          station: row.station,
          destinationPermit: row.destination.permit,
          destinationPermitId: row.destination.id,
          sourcePermit: row.source.permit,
          sourcePermitId: row.source.id,
          date: row.date,
          operationDate: row.date,
          registrationDate: regDate,
          volumeKg: row.volumeKg,
        };
      });
  }

  function groupTransfers(transfers) {
    const groups = new Map();
    for (const transfer of transfers || []) {
      const key = String(transfer.destinationPermitId || transfer.destinationPermit);
      let group = groups.get(key);
      if (!group) {
        group = {
          id: transfer.destinationPermitId,
          permit: transfer.destinationPermit,
          transfers: [],
          totalKg: 0,
        };
        groups.set(key, group);
      }
      group.transfers.push(transfer);
      group.totalKg += transfer.volumeKg;
    }
    return Array.from(groups.values());
  }

  function registrationTimestamp(date) {
    const now = new Date();
    const pad = function (value) {
      return String(value).padStart(2, '0');
    };
    return (
      (date || todayISO()) +
      ' ' +
      pad(now.getHours()) +
      ':' +
      pad(now.getMinutes()) +
      ':' +
      pad(now.getSeconds())
    );
  }

  function buildTraspasoBody(transfer, sellerId, timestamp) {
    return {
      'compraNueva[compra][fechaRegistro]': timestamp,
      'compraNueva[compra][fechaCompra]': displayDate(transfer.operationDate),
      'compraNueva[compra][cantidadSolicitada]': Number(transfer.volumeKg).toFixed(2),
      'compraNueva[compra][precioAcordado]': '',
      'compraNueva[compra][idVendedor]': String(sellerId),
      'compraNueva[compra][entregaParcial]': 'false',
      'compraNueva[compra][traspaso]': 'true',
      cadenaAcuse: '|',
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers de UI
  // ---------------------------------------------------------------------------

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function option(value, text) {
    const node = document.createElement('option');
    node.value = String(value);
    node.textContent = text;
    return node;
  }

  function permitLabel(permit) {
    return permit.permit + ' — ' + (permit.activity || 'Sin actividad');
  }

  function formatNumber(value) {
    return Number(value).toLocaleString('es-MX', { maximumFractionDigits: 3 });
  }

  function formatKg(value) {
    return formatNumber(value) + ' kg';
  }

  function displayDate(iso) {
    if (!iso) return '—';
    const parts = String(iso).split('-');
    return parts.length === 3 ? parts[2] + '/' + parts[1] + '/' + parts[0] : iso;
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, Math.max(0, Number(ms) || 0));
    });
  }

  function sameOriginUrl(raw) {
    const url = new URL(String(raw), window.location.origin);
    if (url.origin !== window.location.origin) {
      throw new Error('La URL configurada debe ser del mismo origen que SIRETRAC');
    }
    return url;
  }

  function getCsrfToken() {
    const input = document.querySelector('input[name="__RequestVerificationToken"]');
    return input && typeof input.value === 'string' ? input.value : '';
  }

  // ---------------------------------------------------------------------------
  // Permisos
  // ---------------------------------------------------------------------------

  // Alias del escáner único: { id, permit, razonSocial, materia, activity } para el resto del módulo.
  function parsePermitsFromDocument(doc) {
    return ET.core.permisos.permisosDeDocumento(doc).map(function (p) {
      return {
        id: p.id,
        permit: p.nombre,
        razonSocial: p.razon,
        materia: p.materia,
        activity: p.actividad,
      };
    });
  }

  async function ensurePermits(force) {
    if (state.permits.length && !force) {
      if (ui) ui.permitsStatus.textContent = state.permits.length + ' permiso(s) cargados.';
      return;
    }
    if (!ui) return;
    ui.permitsStatus.textContent = 'Cargando permisos…';
    try {
      let permits = parsePermitsFromDocument(document);
      if (!permits.length) {
        const response = await fetch('/OrdenDePedido/Permisos', {
          credentials: 'include',
          headers: { Accept: 'text/html' },
        });
        if (!response.ok) {
          throw new Error('No se pudieron cargar los permisos (HTTP ' + response.status + ')');
        }
        const html = await response.text();
        permits = parsePermitsFromDocument(new DOMParser().parseFromString(html, 'text/html'));
      }
      if (!permits.length) {
        throw new Error('No se encontraron permisos en la tabla #example');
      }

      state.permits = permits;
      if (!state.mappingRestored) {
        restoreMapping(loadMapping());
        state.mappingRestored = true;
      }
      renderGlobalSource();
      autoSelectSource();
      syncStationsFromTextarea();
      ui.permitsStatus.textContent = permits.length + ' permiso(s) cargados.';
    } catch (error) {
      ui.permitsStatus.textContent = 'Error: ' + error.message;
    }
  }

  function renderGlobalSource() {
    ui.globalSource.textContent = '';
    ui.globalSource.append(option('', '— Selecciona origen —'));
    for (const permit of state.permits) {
      ui.globalSource.append(option(permit.id, permitLabel(permit)));
    }
    const exists = state.permits.some(function (permit) {
      return String(permit.id) === String(state.globalSourceId);
    });
    ui.globalSource.value = exists ? String(state.globalSourceId) : '';
    state.globalSourceId = ui.globalSource.value;
  }

  // Si hay una sola planta de distribución, es el origen natural.
  function autoSelectSource() {
    if (!state.permits.length) return null;
    const current = state.permits.find(function (permit) {
      return String(permit.id) === String(state.globalSourceId);
    });
    if (current) return current;
    const plants = state.permits.filter(function (permit) {
      return /DIST\/PLA/i.test(String(permit.permit || ''));
    });
    if (plants.length !== 1) return null;
    state.globalSourceId = String(plants[0].id);
    if (ui && ui.globalSource) ui.globalSource.value = state.globalSourceId;
    saveMapping();
    return plants[0];
  }

  function autoMapStations(stationNames) {
    if (!state.permits.length) return 0;
    autoSelectSource();
    const wanted = new Set(
      (stationNames || []).map(function (name) {
        return normalizeText(name);
      })
    );
    const entries = Object.values(state.mapping).filter(function (entry) {
      return !wanted.size || wanted.has(normalizeText(entry.name));
    });
    const count = assignByOrder(entries, state.permits, state.globalSourceId);
    if (count) {
      state.autoMapped = true;
      saveMapping();
      renderStations();
    }
    return count;
  }

  function uniqueStations(parsed) {
    const seen = new Set();
    const names = [];
    for (const row of parsed && parsed.rows ? parsed.rows : []) {
      const name = String(row.station || '').trim();
      const key = normalizeText(name);
      if (!name || !key || seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }
    return names;
  }

  function syncStationsFromTextarea() {
    if (!ui) return;
    const names = ui.stations.value
      .split(/\r?\n/)
      .map(function (name) {
        return name.trim();
      })
      .filter(Boolean);
    const next = {};
    const validIds = new Set(
      state.permits.map(function (permit) {
        return String(permit.id);
      })
    );

    for (const name of names) {
      const key = normalizeText(name);
      if (!key || next[key]) continue;
      const previous = state.mapping[key];
      const suggestion = previous ? null : suggestPermit(name, state.permits);
      next[key] = {
        name: name,
        destinationId: previous
          ? String(previous.destinationId || '')
          : suggestion
            ? String(suggestion.id)
            : '',
        sourceId: previous ? String(previous.sourceId || '') : '',
      };
      if (state.permits.length) {
        if (!validIds.has(next[key].destinationId)) next[key].destinationId = '';
        if (!validIds.has(next[key].sourceId)) next[key].sourceId = '';
      }
    }

    state.mapping = next;
    saveMapping();
    invalidateTransfers('Estaciones actualizadas; vuelve a generar los traspasos.');
    renderStations();
    refreshPreview();
  }

  let wireView = null;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function isSourcePermit(permit) {
    if (!permit) return false;
    if (state.globalSourceId) return String(permit.id) === String(state.globalSourceId);
    return /DIST\/PLA/i.test(permit.permit);
  }

  function findPermitById(id) {
    return (
      state.permits.find(function (permit) {
        return String(permit.id) === String(id);
      }) || null
    );
  }

  function wirePath(x1, y1, x2, y2) {
    const bend = Math.max(48, Math.abs(x2 - x1) * 0.45);
    return (
      'M ' + x1 + ' ' + y1 +
      ' C ' + (x1 + bend) + ' ' + y1 +
      ', ' + (x2 - bend) + ' ' + y2 +
      ', ' + x2 + ' ' + y2
    );
  }

  function renderMappingBoard() {
    if (!ui || !ui.mappingBoard) return;
    const board = ui.mappingBoard;
    board.textContent = '';
    wireView = null;

    if (!state.permits.length) {
      board.append(el('div', 'st-wire-empty', 'Primero escanea los permisos de SIRETRAC.'));
      return;
    }
    const entries = Object.entries(state.mapping);
    if (!entries.length) {
      board.append(el('div', 'st-wire-empty', 'Pega tu matriz o tus estaciones para ver los nombres de tu plantilla.'));
      return;
    }

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'st-wire-svg');
    svg.setAttribute('aria-hidden', 'true');

    const columns = el('div', 'st-wire-columns');
    const left = el('div', 'st-wire-col');
    const right = el('div', 'st-wire-col');
    const leftHead = el('div', 'st-wire-head');
    leftHead.append(el('strong', '', 'Permisos SIRETRAC'));
    leftHead.append(el('span', 'st-wire-sub', 'Escaneados de la página'));
    const rightHead = el('div', 'st-wire-head');
    rightHead.append(el('strong', '', 'Nombres de tu plantilla'));
    rightHead.append(el('span', 'st-wire-sub', 'Tal cual vienen en tu Excel'));
    left.append(leftHead);
    right.append(rightHead);

    const permitPorts = new Map();
    const stationPorts = new Map();

    for (const permit of state.permits) {
      const source = isSourcePermit(permit);
      const node = el('div', 'st-wire-node st-wire-permit' + (source ? ' is-source' : ''));
      node.dataset.permitId = String(permit.id);
      const port = el('span', 'st-wire-port');
      const label = el('div', 'st-wire-label');
      label.append(el('strong', '', permit.permit));
      if (source) label.append(el('small', '', 'Origen'));
      node.append(port, label);
      left.append(node);
      permitPorts.set(String(permit.id), port);
    }

    for (const [key, entry] of entries) {
      const connected = Boolean(entry.destinationId) && !isSourcePermit(findPermitById(entry.destinationId));
      const node = el('div', 'st-wire-node st-wire-station' + (connected ? ' is-connected' : ''));
      node.dataset.stationKey = key;
      node.title = entry.name;
      const port = el('span', 'st-wire-port');
      const label = el('div', 'st-wire-label');
      label.append(el('strong', '', entry.name || key));
      if (!connected) label.append(el('small', '', 'Sin conectar'));
      node.append(port, label);
      right.append(node);
      stationPorts.set(key, port);
    }

    columns.append(left, right);
    board.append(svg, columns);
    wireView = { board: board, svg: svg, permits: permitPorts, stations: stationPorts };
    requestAnimationFrame(drawMappingCables);
  }

  function drawMappingCables() {
    if (!wireView || !wireView.board.isConnected) return;
    const board = wireView.board;
    const svg = wireView.svg;
    const rect = board.getBoundingClientRect();
    if (!rect.width) return;
    const width = Math.max(board.scrollWidth, Math.round(rect.width));
    const height = Math.max(board.scrollHeight, Math.round(rect.height));
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.style.width = width + 'px';
    svg.style.height = height + 'px';
    svg.textContent = '';

    for (const entry of Object.values(state.mapping)) {
      if (!entry.destinationId) continue;
      const from = wireView.permits.get(String(entry.destinationId));
      const toKey = normalizeText(entry.name || '');
      const to = wireView.stations.get(toKey);
      if (!from || !to) continue;
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      const x1 = a.left + a.width / 2 - rect.left + board.scrollLeft;
      const y1 = a.top + a.height / 2 - rect.top + board.scrollTop;
      const x2 = b.left + b.width / 2 - rect.left + board.scrollLeft;
      const y2 = b.top + b.height / 2 - rect.top + board.scrollTop;
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', wirePath(x1, y1, x2, y2));
      path.setAttribute('class', 'st-wire-path');
      path.setAttribute('data-cable-station', toKey);
      svg.append(path);
    }
  }

  function connectStationToPermit(stationKey, permitId) {
    const entry = state.mapping[stationKey];
    const permit = findPermitById(permitId);
    if (!entry || !permit || isSourcePermit(permit)) return;
    entry.destinationId = String(permit.id);
    entry.sourceId = '';
    state.autoMapped = false;
    saveMapping();
    invalidateTransfers('Mapeo actualizado; vuelve a generar los traspasos.');
    renderStations();
    refreshPreview();
    ui.permitsStatus.textContent = 'Conectado: ' + entry.name + ' → ' + permit.permit;
  }

  function disconnectStation(stationKey) {
    const entry = state.mapping[stationKey];
    if (!entry) return;
    entry.destinationId = '';
    saveMapping();
    invalidateTransfers('Mapeo actualizado; vuelve a generar los traspasos.');
    renderStations();
    refreshPreview();
    ui.permitsStatus.textContent = 'Sin conectar: ' + entry.name;
  }

  function drawWireTemp(event) {
    if (!wireView || !wireView.drag || !wireView.temp) return;
    const board = wireView.board;
    const port = wireView.permits.get(String(wireView.drag.permitId));
    if (!port) return;
    const rect = board.getBoundingClientRect();
    const a = port.getBoundingClientRect();
    const x1 = a.left + a.width / 2 - rect.left + board.scrollLeft;
    const y1 = a.top + a.height / 2 - rect.top + board.scrollTop;
    const x2 = event.clientX - rect.left + board.scrollLeft;
    const y2 = event.clientY - rect.top + board.scrollTop;
    wireView.temp.setAttribute('d', wirePath(x1, y1, x2, y2));
  }

  function onWirePointerDown(event) {
    if (event.button !== 0 || !wireView) return;
    const node = event.target.closest('[data-permit-id]');
    if (!node || node.classList.contains('is-source')) return;
    event.preventDefault();
    wireView.drag = { permitId: node.dataset.permitId, pointerId: event.pointerId };
    try {
      node.setPointerCapture(event.pointerId);
    } catch (error) {
      /* ignore */
    }
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', 'st-wire-path st-wire-temp');
    wireView.svg.append(path);
    wireView.temp = path;
    drawWireTemp(event);
  }

  function onWirePointerMove(event) {
    if (!wireView || !wireView.drag || event.pointerId !== wireView.drag.pointerId) return;
    drawWireTemp(event);
  }

  function onWirePointerUp(event) {
    if (!wireView || !wireView.drag) return;
    const drag = wireView.drag;
    wireView.drag = null;
    if (wireView.temp) {
      wireView.temp.remove();
      wireView.temp = null;
    }
    if (event.pointerId !== drag.pointerId) return;
    const target = ui.root.elementFromPoint
      ? ui.root.elementFromPoint(event.clientX, event.clientY)
      : document.elementFromPoint(event.clientX, event.clientY);
    const station = target && target.closest('[data-station-key]');
    if (station) connectStationToPermit(station.dataset.stationKey, drag.permitId);
  }

  function onWireClick(event) {
    const cable = event.target.closest('[data-cable-station]');
    if (!cable) return;
    disconnectStation(cable.getAttribute('data-cable-station'));
  }

  function renderStations() {
    if (!ui) return;
    ui.stationList.textContent = '';
    renderMappingBoard();
    renderPermitRelations();
    if (!state.permits.length) {
      ui.stationList.append(el('div', 'st-note', 'Carga los permisos para asignar destinos.'));
      return;
    }
    if (state.autoMapped) {
      ui.stationList.append(
        el('div', 'st-note', 'Mapeo automático por orden. Revisa que cada estación tenga el permiso correcto.')
      );
    }
    const entries = Object.entries(state.mapping);
    if (!entries.length) {
      ui.stationList.append(
        el('div', 'st-note', 'Pega las estaciones (una por línea) o cárgalas desde la matriz.')
      );
      return;
    }
    for (const [key, entry] of entries) {
      const row = el('div', 'st-map-row');
      row.dataset.key = key;
      row.append(el('div', 'st-map-name', entry.name));
      row.append(selectField('Destino', 'dest', entry.destinationId, '— Sin asignar —'));
      row.append(selectField('Origen', 'src', entry.sourceId, 'Usar origen global'));
      ui.stationList.append(row);
    }
  }

  function renderPermitRelations() {
    if (!ui || !ui.permitRelations) return;
    ui.permitRelations.textContent = '';
    if (!state.permits.length) {
      ui.permitRelations.append(
        el('div', 'st-note', 'Carga los permisos para ver la relación con tu plantilla.')
      );
      return;
    }
    for (const relation of relatePermits(state.permits, state.mapping)) {
      const row = el('div', 'st-map-row');
      row.append(el('div', 'st-map-name', permitLabel(relation.permit)));
      if (!relation.names.length) {
        const isSource = String(relation.permit.id) === String(state.globalSourceId);
        row.append(el('div', 'st-note', isSource ? 'Origen' : 'Sin estación'));
      } else if (relation.names.length > 1) {
        row.append(el('div', 'st-warn', 'Varias estaciones: ' + relation.names.join(', ')));
      } else {
        row.append(el('div', 'st-note', relation.names[0]));
      }
      ui.permitRelations.append(row);
    }
  }

  function selectField(labelText, role, value, placeholder) {
    const label = el('label', 'st-field st-field-sm');
    label.append(document.createTextNode(labelText));
    const select = document.createElement('select');
    select.dataset.role = role;
    select.append(option('', placeholder));
    for (const permit of state.permits) {
      select.append(option(permit.id, permitLabel(permit)));
    }
    const exists = Array.from(select.options).some(function (item) {
      return item.value === String(value);
    });
    select.value = exists ? String(value) : '';
    label.append(select);
    return label;
  }

  // ---------------------------------------------------------------------------
  // Mapeo persistido
  // ---------------------------------------------------------------------------

  function loadMapping() {
    try {
      const raw = localStorage.getItem(MAPPING_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      return data && data.version === 1 ? data : null;
    } catch (error) {
      return null;
    }
  }

  function restoreMapping(saved) {
    if (!saved) return;
    state.globalSourceId = String(saved.globalSourceId || '');
    state.sourceScId = String(saved.sourceScId || '');
    state.tipoSuministradorId = String(saved.tipoSuministradorId || state.tipoSuministradorId);
    state.tipoSuministradorName = String(
      saved.tipoSuministradorName || state.tipoSuministradorName
    );
    if (ui && !ui.stations.value.trim()) {
      const names = Array.isArray(saved.stations)
        ? saved.stations
            .map(function (item) {
              return item && item.name;
            })
            .filter(Boolean)
        : [];
      ui.stations.value =
        typeof saved.stationsText === 'string' && saved.stationsText.trim()
          ? saved.stationsText
          : names.join('\n');
    }
    const mapping = {};
    for (const item of Array.isArray(saved.stations) ? saved.stations : []) {
      if (!item || !item.name) continue;
      const key = normalizeText(item.name);
      if (!key) continue;
      mapping[key] = {
        name: String(item.name),
        destinationId: String(item.destinationId || ''),
        sourceId: String(item.sourceId || ''),
      };
    }
    state.mapping = mapping;
  }

  function saveMapping() {
    if (!ui) return;
    const payload = {
      version: 1,
      stationsText: ui.stations.value,
      globalSourceId: state.globalSourceId,
      sourceScId: state.sourceScId,
      tipoSuministradorId: state.tipoSuministradorId,
      tipoSuministradorName: state.tipoSuministradorName,
      stations: Object.values(state.mapping).map(function (entry) {
        return {
          name: entry.name,
          destinationId: entry.destinationId,
          sourceId: entry.sourceId,
        };
      }),
    };
    try {
      localStorage.setItem(MAPPING_KEY, JSON.stringify(payload));
    } catch (error) {
      // Sin persistencia el mapeo sigue funcionando en esta sesión.
    }
  }

  // ---------------------------------------------------------------------------
  // Presets de origen
  // ---------------------------------------------------------------------------

  // Reutiliza el SC_Id que ACS-RC.txt captura de una compra manual.
  function importLegacySource() {
    try {
      const raw = localStorage.getItem('acsrep_params');
      if (!raw) return;
      const params = JSON.parse(raw);
      if (!state.sourceScId && params.SC_Id) state.sourceScId = String(params.SC_Id);
      if (params.TipoSuministradorId) {
        state.tipoSuministradorId = String(params.TipoSuministradorId);
      }
      if (params.NombreTipoSuministrador) {
        state.tipoSuministradorName = String(params.NombreTipoSuministrador);
      }
    } catch (error) {
      // Sin ACS-RC se captura a mano.
    }
  }

  function loadPresets() {
    try {
      const raw = localStorage.getItem(PRESETS_KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) return [];
      return data
        .filter(function (item) {
          return item && typeof item.name === 'string' && item.name.trim();
        })
        .map(function (item) {
          return {
            name: item.name.trim(),
            globalSourceId: String(item.globalSourceId || ''),
            sourceScId: String(item.sourceScId || ''),
            tipoSuministradorId: String(item.tipoSuministradorId || '19'),
            tipoSuministradorName: String(
              item.tipoSuministradorName || 'Distribuidor por Planta de Distribucion'
            ),
            sources: item.sources && typeof item.sources === 'object' ? item.sources : {},
          };
        });
    } catch (error) {
      return [];
    }
  }

  function savePresets(presets) {
    try {
      localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
      return true;
    } catch (error) {
      return false;
    }
  }

  function renderPresets(selectedName) {
    if (!ui || !ui.preset) return;
    ui.preset.textContent = '';
    ui.preset.append(option('', '— Presets de origen —'));
    for (const preset of state.presets) {
      ui.preset.append(option(preset.name, preset.name));
    }
    if (selectedName && state.presets.some(function (item) { return item.name === selectedName; })) {
      ui.preset.value = selectedName;
    }
  }

  function savePreset() {
    if (!ui) return;
    const name = window.prompt('Nombre del preset de origen:');
    if (name == null) return;
    const clean = name.trim();
    if (!clean) return;

    const sources = {};
    for (const entry of Object.values(state.mapping)) {
      sources[normalizeText(entry.name)] = entry.sourceId || '';
    }
    const preset = {
      name: clean,
      globalSourceId: state.globalSourceId,
      sourceScId: state.sourceScId,
      tipoSuministradorId: state.tipoSuministradorId,
      tipoSuministradorName: state.tipoSuministradorName,
      sources: sources,
    };
    const index = state.presets.findIndex(function (item) {
      return item.name === clean;
    });
    if (index === -1) state.presets.push(preset);
    else state.presets[index] = preset;

    if (!savePresets(state.presets)) {
      ui.permitsStatus.textContent = 'No se pudo guardar el preset en localStorage.';
      return;
    }
    renderPresets(clean);
    ui.permitsStatus.textContent = 'Preset de origen guardado: ' + clean;
  }

  function applyPreset(name) {
    if (!ui || !name) return;
    const preset = state.presets.find(function (item) {
      return item.name === name;
    });
    if (!preset) return;

    state.globalSourceId = preset.globalSourceId;
    state.sourceScId = preset.sourceScId || '';
    state.tipoSuministradorId = preset.tipoSuministradorId || '19';
    state.tipoSuministradorName =
      preset.tipoSuministradorName || 'Distribuidor por Planta de Distribucion';
    if (ui.sourceScId) ui.sourceScId.value = state.sourceScId;
    for (const entry of Object.values(state.mapping)) {
      const key = normalizeText(entry.name);
      if (Object.prototype.hasOwnProperty.call(preset.sources, key)) {
        entry.sourceId = preset.sources[key] || '';
      }
    }
    saveMapping();
    renderGlobalSource();
    renderStations();
    invalidateTransfers('Preset aplicado; vuelve a generar los traspasos.');
    refreshPreview();
    ui.permitsStatus.textContent = 'Preset aplicado: ' + name;
  }

  function deletePreset() {
    if (!ui) return;
    const name = ui.preset.value;
    if (!name) {
      ui.permitsStatus.textContent = 'Selecciona un preset para eliminar.';
      return;
    }
    if (!window.confirm('¿Eliminar el preset "' + name + '"?')) return;
    state.presets = state.presets.filter(function (item) {
      return item.name !== name;
    });
    savePresets(state.presets);
    renderPresets('');
    ui.permitsStatus.textContent = 'Preset eliminado: ' + name;
  }

  function loadLedger() {
    try {
      const raw = localStorage.getItem(LEDGER_KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch (error) {
      return [];
    }
  }

  function saveLedger() {
    try {
      localStorage.setItem(LEDGER_KEY, JSON.stringify(state.ledger));
      return true;
    } catch (error) {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Matriz / vista previa
  // ---------------------------------------------------------------------------

  function matrixText() {
    const el = ui && ui.matrix;
    if (!el) return '';
    if (typeof el.value === 'string') return el.value;
    return ET.grid.serializar(el);
  }

  function analyzeMatrix() {
    if (!ui) return null;
    const text = matrixText();
    if (!text.trim()) {
      state.parsed = null;
      state.preview = [];
      ui.preview.textContent = '';
      ui.matrixStatus.textContent = 'Pega una matriz TSV o CSV.';
      return null;
    }
    if (!ui.weekStart.value) ui.weekStart.value = previousMondayISO();

    const parsed = parseMatrix(text, { weekStart: ui.weekStart.value });
    state.parsed = parsed;

    const stations = uniqueStations(parsed);
    if (stations.length) {
      const current = ui.stations.value
        .split(/\r?\n/)
        .map(function (name) {
          return name.trim();
        })
        .filter(Boolean);
      const missing = stations.filter(function (name) {
        return !current.some(function (item) {
          return normalizeText(item) === normalizeText(name);
        });
      });
      if (missing.length) {
        ui.stations.value = current.concat(missing).join('\n');
        syncStationsFromTextarea();
      }
    }

    const mapped = autoMapStations(stations);
    if (mapped) {
      ui.permitsStatus.textContent =
        mapped + ' estación(es) asignadas por orden. Revisa el mapeo antes de enviar.';
    }

    refreshPreview();
    renderMatrixStatus();
    if (parsed && parsed.rows && parsed.rows.length) switchTab('revisa');
    return parsed;
  }

  function invalidateTransfers(message) {
    if (!state.transfers.length) return;
    state.transfers = [];
    if (!ui) return;
    renderEnvio();
    if (message) ui.sendStatus.textContent = message;
  }

  function refreshPreview() {
    if (!ui || !state.parsed) return;
    state.preview = evaluateRows(
      state.parsed,
      state.mapping,
      state.permits,
      state.globalSourceId
    );
    renderPreview(state.preview);
  }

  function renderMatrixStatus() {
    if (!ui || !state.parsed) return;
    const counts = {
      OK: 0,
      'Sin mapeo': 0,
      'Fecha inválida': 0,
      'Volumen inválido': 0,
    };
    let totalKg = 0;
    for (const row of state.preview) {
      counts[row.status] = (counts[row.status] || 0) + 1;
      if (row.status === 'OK') totalKg += row.volumeKg;
    }
    const format =
      state.parsed.format === 'wide'
        ? 'ancho'
        : state.parsed.format === 'long'
          ? 'largo'
          : state.parsed.format === 'transfer'
            ? 'plantilla de traspasos'
            : 'vacío';
    ui.matrixStatus.textContent =
      'Formato ' +
      format +
      ' · ' +
      state.preview.length +
      ' fila(s) · ' +
      counts.OK +
      ' OK · ' +
      counts['Sin mapeo'] +
      ' sin mapeo · ' +
      counts['Fecha inválida'] +
      ' fecha inválida · ' +
      counts['Volumen inválido'] +
      ' volumen inválido · ' +
      formatKg(totalKg) +
      ' en filas OK';
  }

  function renderPreview(preview) {
    if (!ui) return;
    ui.preview.textContent = '';
    if (!preview.length) {
      ui.preview.append(el('div', 'st-note', 'No hay filas con volumen para previsualizar.'));
      return;
    }

    const maxRows = 500; // shortcut: tope de render, subir si la matriz es mayor y hace falta verla toda.
    const shown = preview.slice(0, maxRows);
    const regDate = parseDate(ui.registrationDate.value);
    const table = el('table');
    const head = el('thead');
    const headRow = el('tr');
    for (const title of ['Estación', 'Destino', 'Origen', 'Fecha operación', 'Fecha registro', 'Volumen kg', 'Estado']) {
      headRow.append(el('th', '', title));
    }
    head.append(headRow);
    table.append(head);

    const body = el('tbody');
    for (const row of shown) {
      const tr = el('tr');
      tr.append(el('td', '', row.station));
      tr.append(el('td', '', row.destination ? row.destination.permit : '—'));
      tr.append(el('td', '', row.source ? row.source.permit : '—'));
      tr.append(el('td', '', row.date ? displayDate(row.date) : row.rawDate || '—'));
      tr.append(el('td', '', regDate ? displayDate(regDate) : '—'));
      tr.append(
        el('td', 'st-num', row.volumeKg == null ? row.rawVolume || '—' : formatNumber(row.volumeKg))
      );
      const statusClass =
        row.status === 'OK' ? 'st-ok' : row.status === 'Sin mapeo' ? 'st-warn' : 'st-error';
      const statusCell = el('td');
      statusCell.append(el('span', 'st-badge ' + statusClass, row.status));
      tr.append(statusCell);
      body.append(tr);
    }
    table.append(body);
    ui.preview.append(table);

    if (preview.length > shown.length) {
      ui.preview.append(
        el(
          'div',
          'st-note',
          'Mostrando ' + shown.length + ' de ' + preview.length + ' filas (la validación usa todas).'
        )
      );
    }
  }

  function generateTransfers() {
    if (!ui) return;
    const parsed = analyzeMatrix();
    if (!parsed || parsed.format === 'empty') return;
    if (!state.preview.length) {
      ui.matrixStatus.textContent = 'No hay filas para generar.';
      return;
    }
    const registrationDate = parseDate(ui.registrationDate.value);
    if (!registrationDate) {
      ui.matrixStatus.textContent =
        'Fecha de registro inválida. Indica el martes en que se registrarán los traspasos.';
      return;
    }
    const invalid = state.preview.filter(function (row) {
      return row.status !== 'OK';
    });
    if (invalid.length) {
      ui.matrixStatus.textContent =
        'No se generaron traspasos: ' +
        invalid.length +
        ' de ' +
        state.preview.length +
        ' fila(s) tienen error. Corrige el mapeo, las fechas o los volúmenes.';
      return;
    }

    state.transfers = buildTransfers(state.preview, registrationDate);
    renderEnvio();
    switchTab('envio');
    ui.sendStatus.textContent =
      state.transfers.length +
      ' traspaso(s) generados. Usa Simular para revisar el cuerpo del POST.';
  }

  // ---------------------------------------------------------------------------
  // Envío / acuses
  // ---------------------------------------------------------------------------

  function renderEnvio() {
    if (!ui) return;
    ui.summary.textContent = '';
    ui.output.textContent = '';
    if (!state.transfers.length) {
      ui.summary.append(el('div', 'st-note', 'Genera los traspasos en la pestaña Matriz.'));
    } else {
      const groups = groupTransfers(state.transfers);
      const totalKg = state.transfers.reduce(function (sum, transfer) {
        return sum + transfer.volumeKg;
      }, 0);
      ui.summary.append(
        el(
          'div',
          'st-summary-line',
          state.transfers.length + ' traspaso(s) · ' + formatKg(totalKg)
        )
      );
      for (const group of groups) {
        const line = el('div', 'st-group');
        line.append(el('span', 'st-group-permit', group.permit));
        line.append(
          el('span', '', group.transfers.length + ' traspaso(s) · ' + formatKg(group.totalKg))
        );
        ui.summary.append(line);
      }
    }
    renderLedgerNote();
    updateConfigWarning();
    updateSendButtons();
  }

  function renderLedgerNote() {
    if (!ui) return;
    ui.ledgerNote.textContent = 'Ledger local: ' + state.ledger.length + ' registro(s) guardado(s).';
  }

  function updateConfigWarning() {
    if (!ui) return;
    ui.configWarning.textContent = '';
    const missing = [];
    if (!CONFIG.createUrl) missing.push('CONFIG.createUrl');
    if (!CONFIG.acusesUrl) missing.push('CONFIG.acusesUrl');
    if (missing.length) {
      ui.configWarning.append(
        el('strong', '', 'Falta configuración. '),
        document.createTextNode(
          'Falta ' + missing.join(', ') + '. La simulación funciona; el envío real está bloqueado.'
        )
      );
      return;
    }
    ui.configWarning.append(
      el(
        'div',
        'st-note',
        'Envío: POST directo a GuardaCompraGasLP con el permiso origen. Acuses: GetRegistrosCompras con estatus -1.'
      )
    );
  }

  function updateSendButtons() {
    if (!ui) return;
    const configured = Boolean(CONFIG.createUrl && CONFIG.acusesUrl);
    const hasTransfers = state.transfers.length > 0;
    ui.send.disabled = state.busy || !configured || !hasTransfers;
    ui.send.title = !configured
      ? 'Configura CONFIG.createUrl y CONFIG.acusesUrl'
      : !hasTransfers
        ? 'Genera traspasos primero'
        : '';
    ui.simulate.disabled = state.busy;
    ui.export.disabled = state.busy || state.ledger.length === 0;
  }

  function stringifyBody(body) {
    if (body == null) return 'undefined';
    if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
      return body.toString();
    }
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      const data = {};
      for (const [key, value] of body.entries()) data[key] = value;
      return JSON.stringify(data, null, 2);
    }
    try {
      return JSON.stringify(body, null, 2);
    } catch (error) {
      return String(body);
    }
  }

  function simulate() {
    if (!ui) return;
    if (!state.transfers.length) {
      ui.output.textContent = '';
      ui.output.append(el('div', 'st-note', 'No hay traspasos generados.'));
      return;
    }
    ui.output.textContent = '';
    ui.output.append(el('h4', 'st-h4', 'Vista previa local (sin red)'));

    for (const group of groupTransfers(state.transfers)) {
      ui.output.append(
        el(
          'h4',
          'st-h4',
          group.permit +
            ' · ' +
            group.transfers.length +
            ' traspaso(s) · ' +
            formatKg(group.totalKg)
        )
      );
      for (const transfer of group.transfers) {
        const body = buildTraspasoBody(
          transfer,
          transfer.sourcePermitId || state.sourceScId || '(origen)',
          registrationTimestamp(transfer.registrationDate)
        );
        ui.output.append(el('pre', 'st-pre', stringifyBody(body)));
      }
    }

    ui.sendStatus.textContent = 'Simulación local: no se envió nada.';
  }

  function isExpiredSessionHtml(html) {
    const visible = String(html == null ? '' : html)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ');
    return /sesi[oó]n\s+(?:ha\s+)?expirad|iniciar\s+sesi[oó]n|session\s+expired/i.test(visible);
  }

  async function selectPermit(permit) {
    const base = CONFIG.acusesSelectUrl || '/OrdenDePedido/SeleccionarPermiso';
    const url = sameOriginUrl(base);
    url.searchParams.set('idPermiso', String(permit.id));
    url.searchParams.set('permiso', permit.permit);
    url.searchParams.set('idPermisionario', '0');
    url.searchParams.set('idPermisoMateria', '0');
    url.searchParams.set('idPermisoActividad', '0');
    url.searchParams.set('razonSocial', permit.razonSocial || '');
    url.searchParams.set('estatus', 'False');
    url.searchParams.set('capacidadOperativa', '0');

    const response = await fetch(url.toString(), {
      credentials: 'include',
      headers: { Accept: 'text/html,application/xhtml+xml' },
    });
    if (!response.ok) {
      throw new Error('No se pudo seleccionar el permiso ' + permit.permit + ' (HTTP ' + response.status + ')');
    }
    const html = await response.text();
    if (isExpiredSessionHtml(html)) {
      throw new Error('La sesión de SIRETRAC expiró; vuelve a iniciar sesión.');
    }
  }

  async function postComprasStatus(status) {
    const url = sameOriginUrl(CONFIG.acusesUrl);
    const body = new URLSearchParams();
    body.set('idEstatus', String(status));

    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'x-requested-with': 'XMLHttpRequest',
      Accept: 'application/json, text/javascript, */*; q=0.01',
    };
    const token = getCsrfToken();
    if (token) headers.RequestVerificationToken = token;

    const response = await fetch(url.toString(), {
      method: 'POST',
      credentials: 'include',
      headers: headers,
      body: body,
    });
    const text = await response.text();
    if (response.status === 401 || response.status === 403) {
      const error = new Error('La sesión de SIRETRAC expiró; vuelve a iniciar sesión.');
      error.raw = text;
      throw error;
    }
    if (!response.ok) {
      const error = new Error(
        'Error HTTP ' + response.status + ' al consultar acuses (estatus ' + status + ')'
      );
      error.raw = text;
      throw error;
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch (parseError) {
      const error = new Error('La respuesta de acuses no es JSON');
      error.raw = text;
      throw error;
    }
    if (json && String(json.mensaje || '').toUpperCase() === 'SC') {
      const error = new Error('La sesión de SIRETRAC expiró; vuelve a iniciar sesión.');
      error.raw = text;
      throw error;
    }
    if (json && json.success === false) {
      const error = new Error(
        typeof json.message === 'string'
          ? json.message
          : 'La consulta de acuses falló (estatus ' + status + ')'
      );
      error.raw = text;
      throw error;
    }

    const rows = extractAcuses(json);
    if (!rows) {
      const error = new Error('No se pudo interpretar la respuesta de acuses');
      error.raw = text;
      throw error;
    }
    return rows;
  }

  async function fetchAcuses(permit, fromDate, toDate) {
    if (!CONFIG.acusesUrl) throw new Error('Endpoint de acuses no configurado');

    const selected =
      typeof permit === 'string'
        ? state.permits.find(function (item) {
            return canonicalPermit(item.permit) === canonicalPermit(permit);
          })
        : permit;
    if (!selected || !selected.id) {
      throw new Error('No se encontró el permiso para consultar acuses');
    }

    // CANDIDATO: GetRegistrosCompras no recibe rango de fechas; se conservan por contrato.
    void fromDate;
    void toDate;

    await selectPermit(selected);

    const statuses =
      Array.isArray(CONFIG.acusesStatuses) && CONFIG.acusesStatuses.length
        ? CONFIG.acusesStatuses
        : [-2];
    const merged = [];
    const seen = new Set();

    for (const status of statuses) {
      const rows = await postComprasStatus(status);
      for (const row of rows) {
        const key = row.registrationNumber || JSON.stringify(row.raw);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(row);
      }
    }

    if (
      merged.length &&
      !merged.some(function (row) {
        return acuseKey(row, selected.permit);
      })
    ) {
      throw new Error(
        'Los acuses se leyeron pero no tienen permiso, fecha y volumen reconocibles; se cancela el envío.'
      );
    }
    return merged;
  }

  // SIRETRAC responde "true" cuando el permiso está activo, no suspendido.
  function sourcePermitStatus(text) {
    const value = String(text == null ? '' : text).trim().toLowerCase();
    if (value === 'true') return 'active';
    if (value === 'false') return 'suspended';
    return 'unknown';
  }

  async function assertSourceActive(transfer, sellerId) {
    const body = new URLSearchParams();
    body.set('idFechaCompra', displayDate(transfer.operationDate));
    body.set('idPermiso', String(sellerId));
    const response = await fetch(sameOriginUrl(CONFIG.suspendUrl).toString(), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json, text/javascript, */*; q=0.01',
      },
      body: body,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error('No se pudo verificar el permiso origen (HTTP ' + response.status + ')');
    }
    const status = sourcePermitStatus(text);
    if (status === 'suspended') {
      throw new Error(
        'El permiso origen está suspendido para ' + displayDate(transfer.operationDate) + '.'
      );
    }
    if (status !== 'active') {
      throw new Error(
        'SIRETRAC no confirmó que el permiso origen esté activo para ' +
          displayDate(transfer.operationDate) +
          '.'
      );
    }
  }

  async function postTransfer(transfer) {
    const sellerId = String(transfer.sourcePermitId || state.sourceScId || '').trim();
    if (!sellerId) {
      throw new Error('No se pudo determinar el permiso origen del traspaso.');
    }
    await assertSourceActive(transfer, sellerId);

    const fields = buildTraspasoBody(
      transfer,
      sellerId,
      registrationTimestamp(transfer.registrationDate)
    );
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(fields)) body.set(key, value);

    const response = await fetch(sameOriginUrl(CONFIG.createUrl).toString(), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json, text/javascript, */*; q=0.01',
      },
      body: body,
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error('Error HTTP ' + response.status + ' al crear el traspaso');
      error.raw = text;
      throw error;
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch (parseError) {
      const error = new Error('La respuesta de GuardaCompraGasLP no es JSON');
      error.raw = text;
      throw error;
    }
    if (!json || json.result !== true) {
      const message =
        json && (json.mensaje || json.message)
          ? String(json.mensaje || json.message)
          : 'SIRETRAC rechazó el traspaso';
      const error = new Error(
        message === 'SC' ? 'La sesión de SIRETRAC expiró; vuelve a iniciar sesión.' : message
      );
      error.raw = text;
      throw error;
    }
    return text;
  }

  function findField(value, aliases, depth) {
    const level = depth || 0;
    if (value == null || level > 4) return null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findField(item, aliases, level + 1);
        if (found != null) return found;
      }
      return null;
    }
    if (typeof value !== 'object') return null;

    const wanted = aliases.map(normalizeFieldName);
    for (const [key, item] of Object.entries(value)) {
      if (wanted.includes(normalizeFieldName(key)) && item !== null && item !== undefined && item !== '') {
        return String(item);
      }
    }
    for (const item of Object.values(value)) {
      if (item && typeof item === 'object') {
        const found = findField(item, aliases, level + 1);
        if (found != null) return found;
      }
    }
    return null;
  }

  function findRegistrationNumber(text) {
    if (!text) return null;
    let data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      return null;
    }
    if (data && data.result === true && data.mensaje) return String(data.mensaje).trim();
    const rows = extractAcuses(data);
    if (rows) {
      const hit = rows.find(function (row) {
        return row.registrationNumber;
      });
      if (hit) return hit.registrationNumber;
    }
    return findField(data, [
      'codigoRegistro',
      'numeroRegistro',
      'numRegistro',
      'registro',
      'folio',
      'numeroAcuse',
      'acuse',
      'idCompra',
    ]);
  }

  async function sendAll() {
    if (!ui || state.busy) return;
    if (!CONFIG.createUrl || !CONFIG.acusesUrl) {
      updateConfigWarning();
      return;
    }
    if (!state.transfers.length) return;
    if (
      state.transfers.some(function (transfer) {
        return !transfer.operationDate || !transfer.registrationDate;
      })
    ) {
      ui.sendStatus.textContent =
        'Faltan fechas de operación o de registro. Vuelve a generar los traspasos.';
      return;
    }

    const totalKg = state.transfers.reduce(function (sum, transfer) {
      return sum + transfer.volumeKg;
    }, 0);
    const autoNote = state.autoMapped
      ? '\n\nEl mapeo se asignó por orden. Revisa que cada estación tenga el permiso correcto.'
      : '';
    const confirmed = window.confirm(
      'Se enviarán ' +
        state.transfers.length +
        ' traspaso(s) por ' +
        formatKg(totalKg) +
        '.' +
        autoNote +
        '\n\n¿Continuar?'
    );
    if (!confirmed) return;

    state.busy = true;
    updateSendButtons();
    ui.output.textContent = '';
    ui.sendStatus.textContent = '';
    const log = [];
    function say(message) {
      log.push(message);
      ui.sendStatus.textContent = log.slice(-10).join('\n');
    }

    let sent = 0;
    let skipped = 0;

    try {
      for (const group of groupTransfers(state.transfers)) {
        const permit =
          state.permits.find(function (item) {
            return String(item.id) === String(group.id);
          }) || { id: group.id, permit: group.permit, razonSocial: '' };

        say('Consultando acuses de ' + group.permit + '…');
        const dates = group.transfers
          .map(function (transfer) {
            return transfer.operationDate;
          })
          .sort();
        const acuses = await fetchAcuses(permit, dates[0], dates[dates.length - 1]);
        const existing = acuseKeys(acuses, group.permit);
        say(
          'Acuses ' +
            group.permit +
            ': ' +
            acuses.length +
            ' registro(s), ' +
            existing.size +
            ' clave(s) para deduplicar.'
        );

        const batchKeys = new Set();
        for (const transfer of group.transfers) {
          const key = normalizeKey(
            transfer.destinationPermit,
            transfer.operationDate,
            transfer.volumeKg,
            transfer.sourcePermit
          );
          if (batchKeys.has(key)) {
            skipped += 1;
            say('Omitido (duplicado en el lote): ' + transfer.destinationPermit + ' ' + transfer.operationDate + ' ' + formatKg(transfer.volumeKg));
            continue;
          }
          if (existing.has(key)) {
            skipped += 1;
            say('Omitido (ya existe): ' + transfer.destinationPermit + ' ' + transfer.operationDate + ' ' + formatKg(transfer.volumeKg));
            continue;
          }

          say('Enviando ' + transfer.destinationPermit + ' ' + transfer.operationDate + ' ' + formatKg(transfer.volumeKg) + '…');
          const text = await postTransfer(transfer);
          const registrationNumber = findRegistrationNumber(text);
          batchKeys.add(key);
          existing.add(key);
          state.ledger.push({
            key: key,
            permit: transfer.destinationPermit,
            date: transfer.operationDate,
            operationDate: transfer.operationDate,
            registrationDate: transfer.registrationDate,
            volumeKg: transfer.volumeKg,
            registrationNumber: registrationNumber,
            sentAt: new Date().toISOString(),
            response: String(text).slice(0, 4000), // shortcut: respuesta truncada; ampliar si se requiere auditoría completa.
          });
          if (!saveLedger()) say('Aviso: no se pudo guardar el ledger en localStorage.');
          sent += 1;
          say(
            'OK ' +
              transfer.destinationPermit +
              ' ' +
              transfer.operationDate +
              ' ' +
              formatKg(transfer.volumeKg) +
              (registrationNumber ? ' · ' + registrationNumber : '')
          );
          await sleep(CONFIG.sendDelayMs);
        }
      }
      say('Terminado: ' + sent + ' enviado(s), ' + skipped + ' omitido(s) por acuse existente.');
      state.transfers = [];
      renderEnvio();
    } catch (error) {
      say('DETENIDO: ' + error.message);
      if (error.raw) {
        ui.output.textContent = '';
        ui.output.append(el('h4', 'st-h4', 'Respuesta cruda'));
        ui.output.append(el('pre', 'st-pre', String(error.raw).slice(0, 20000)));
      }
    } finally {
      state.busy = false;
      updateSendButtons();
      renderLedgerNote();
    }
  }

  // ---------------------------------------------------------------------------
  // Ledger CSV
  // ---------------------------------------------------------------------------

  function csvCell(value) {
    const text = String(value == null ? '' : value);
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function exportLedger() {
    if (!state.ledger.length) {
      ui.sendStatus.textContent = 'El ledger está vacío.';
      return;
    }
    const rows = [
      [
        'key',
        'permit',
        'operationDate',
        'registrationDate',
        'volumeKg',
        'registrationNumber',
        'sentAt',
        'response',
      ],
    ];
    for (const entry of state.ledger) {
      rows.push([
        entry.key,
        entry.permit,
        entry.operationDate || entry.date,
        entry.registrationDate,
        entry.volumeKg,
        entry.registrationNumber,
        entry.sentAt,
        entry.response,
      ]);
    }
    const csv =
      '\uFEFF' +
      rows
        .map(function (row) {
          return row.map(csvCell).join(',');
        })
        .join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'siretrac-traspasos-ledger-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () {
      URL.revokeObjectURL(link.href);
    }, 1000);
  }

  // ---------------------------------------------------------------------------
  // Navegación / eventos
  // ---------------------------------------------------------------------------

  function switchTab(name) {
    if (!ui) return;
    for (const tab of ui.tabs) {
      const active = tab.dataset.tab === name;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    }
    for (const panel of ui.panels) {
      panel.hidden = panel.dataset.panel !== name;
    }
    if (name === 'config') requestAnimationFrame(drawMappingCables);
  }

  function openPanel() {
    if (!ui) return;
    ui.panel.hidden = false;
    requestAnimationFrame(drawMappingCables);
    ensurePermits(false);
  }

  function closePanel() {
    if (!ui) return;
    ui.panel.hidden = true;
  }

  function onRootClick(event) {
    const tab = event.target.closest('[data-tab]');
    if (tab) {
      switchTab(tab.dataset.tab);
      return;
    }
    const action = event.target.closest('[data-action]');
    if (!action) return;
    const actions = {
      'reload-permits': function () {
        ensurePermits(true);
      },
      'preset-save': savePreset,
      'preset-delete': deletePreset,
      'stations-from-matrix': stationsFromMatrix,
      suggest: suggestDestinations,
      analyze: analyzeMatrix,
      clear: limpiarTodo,
      generate: generateTransfers,
      simulate: simulate,
      send: sendAll,
      export: exportLedger,
    };
    const handler = actions[action.dataset.action];
    if (handler) handler();
  }

  /* Clears what was pasted and every derived output, keeping permits, mapping and dates. */
  function limpiarTodo() {
    if (!ui || state.busy) return;
    state.parsed = null;
    state.preview = [];
    state.transfers = [];
    state.autoMapped = false;
    ui.matrix.innerHTML = '';
    ui.preview.textContent = '';
    ui.output.textContent = '';
    ui.sendStatus.textContent = '';
    ui.matrixStatus.textContent = '';
    switchTab('pega');
    renderEnvio();
    updateConfigWarning();
  }

  function stationsFromMatrix() {
    if (!ui) return;
    const text = matrixText().trim();
    if (!text) {
      ui.permitsStatus.textContent = 'Pega primero una matriz en la pestaña Matriz.';
      return;
    }
    if (!ui.weekStart.value) ui.weekStart.value = previousMondayISO();
    const parsed = parseMatrix(text, { weekStart: ui.weekStart.value });
    const names = uniqueStations(parsed);
    if (!names.length) {
      ui.permitsStatus.textContent = 'La matriz no tiene estaciones reconocibles.';
      return;
    }
    ui.stations.value = names.join('\n');
    syncStationsFromTextarea();
    ui.permitsStatus.textContent = names.length + ' estación(es) cargadas desde la matriz.';
  }

  function suggestDestinations() {
    if (!ui) return;
    if (!state.permits.length) {
      ui.permitsStatus.textContent = 'Carga los permisos primero.';
      return;
    }
    let count = 0;
    for (const entry of Object.values(state.mapping)) {
      if (entry.destinationId) continue;
      const suggestion = suggestPermit(entry.name, state.permits);
      if (suggestion) {
        entry.destinationId = String(suggestion.id);
        count += 1;
      }
    }
    saveMapping();
    invalidateTransfers('Destinos actualizados; vuelve a generar los traspasos.');
    renderStations();
    refreshPreview();
    ui.permitsStatus.textContent = count
      ? count + ' destino(s) sugeridos. Revisa y ajusta antes de generar.'
      : 'No hubo coincidencias para sugerir destinos.';
  }

  function onStationChange(event) {
    const row = event.target.closest('.st-map-row');
    if (!row) return;
    const entry = state.mapping[row.dataset.key];
    if (!entry) return;
    const role = event.target.dataset.role;
    if (role === 'dest') entry.destinationId = event.target.value;
    if (role === 'src') entry.sourceId = event.target.value;
    saveMapping();
    invalidateTransfers('Mapeo actualizado; vuelve a generar los traspasos.');
    renderMappingBoard();
    refreshPreview();
  }

  function bindEvents() {
    ui.fab.addEventListener('click', openPanel);
    ui.close.addEventListener('click', closePanel);
    ui.root.addEventListener('click', onRootClick);
    ui.globalSource.addEventListener('change', function () {
      state.globalSourceId = ui.globalSource.value;
      saveMapping();
      invalidateTransfers('Origen actualizado; vuelve a generar los traspasos.');
      refreshPreview();
      updateConfigWarning();
    });
    ui.sourceScId.addEventListener('change', function () {
      state.sourceScId = ui.sourceScId.value.trim();
      saveMapping();
      invalidateTransfers('SC_Id del origen actualizado; vuelve a generar los traspasos.');
      updateConfigWarning();
    });
    ui.preset.addEventListener('change', function () {
      if (ui.preset.value) applyPreset(ui.preset.value);
    });
    ui.stations.addEventListener('change', syncStationsFromTextarea);
    ui.stationList.addEventListener('change', onStationChange);
    ui.mappingBoard.addEventListener('pointerdown', onWirePointerDown);
    ui.mappingBoard.addEventListener('pointermove', onWirePointerMove);
    ui.mappingBoard.addEventListener('pointerup', onWirePointerUp);
    ui.mappingBoard.addEventListener('pointercancel', onWirePointerUp);
    ui.mappingBoard.addEventListener('click', onWireClick);
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(function () {
        drawMappingCables();
      }).observe(ui.mappingBoard);
    }
    ui.matrix.addEventListener('input', function () {
      invalidateTransfers('Matriz modificada; vuelve a generarla.');
    });
    ui.weekStart.addEventListener('change', function () {
      invalidateTransfers('Semana modificada; vuelve a generar los traspasos.');
      if (state.parsed) analyzeMatrix();
    });
    ui.registrationDate.addEventListener('change', function () {
      const registrationDate = parseDate(ui.registrationDate.value);
      if (registrationDate && state.transfers.length) {
        for (const transfer of state.transfers) transfer.registrationDate = registrationDate;
        renderEnvio();
      }
      if (state.parsed) refreshPreview();
    });
  }

  // ---------------------------------------------------------------------------
  // Plantilla / inicialización
  // ---------------------------------------------------------------------------

  const TEMPLATE = `
    <button class="st-fab" type="button" data-role="fab">
      <span class="st-fab-dot" aria-hidden="true"></span>
      Traspasos GLP
    </button>
    <section class="st-panel" data-role="panel" hidden aria-label="SIRETRAC Traspasos GLP">
      <header class="st-head">
        <div class="st-brand">
          <span class="st-mark" aria-hidden="true">GLP</span>
          <div class="st-title">
            <strong>Traspasos SIRETRAC</strong>
            <span class="st-sub">Inventario entre permisos · kg</span>
          </div>
        </div>
        <button class="st-icon" type="button" data-role="close" aria-label="Cerrar">×</button>
      </header>
      <nav class="st-tabs" role="tablist" aria-label="Pasos">
        <button type="button" role="tab" data-tab="pega" class="is-active" aria-selected="true"><span>1</span> Pega</button>
        <button type="button" role="tab" data-tab="revisa" aria-selected="false"><span>2</span> Revisa</button>
        <button type="button" role="tab" data-tab="envio" aria-selected="false"><span>3</span> Envía</button>
        <button type="button" role="tab" data-tab="config" class="st-tab-config" aria-selected="false">Configuración</button>
      </nav>
      <div class="st-body">
        <section data-panel="pega">
          <div class="st-hero">
            <span class="st-kicker">Paso 1</span>
            <h2>Pega tus traspasos aquí</h2>
            <p>Copia el bloque <b>TRASPASOS (KILOS)</b> de tu Excel y pégalo abajo. También puedes pegar la hoja completa: el script ignora AUTOCONSUMOS, PLANTA y Total.</p>
          </div>
          <div class="st-grid-2">
            <label class="st-field">Semana que inicia
              <input type="date" data-role="week-start">
            </label>
            <label class="st-field">Fecha de registro
              <input type="date" data-role="registration-date">
            </label>
          </div>
          <label class="st-field st-field-paste">Matriz de la semana
            <div data-role="matrix" class="st-matrix"></div>
          </label>
          <div class="st-actions">
            <button type="button" class="st-primary st-big" data-action="analyze">Analizar matriz</button>
            <button type="button" data-action="clear">Limpiar</button>
            <span class="st-note">No se envía nada al analizar.</span>
          </div>
        </section>
        <section data-panel="revisa" hidden>
          <div class="st-section-head">
            <div>
              <span class="st-kicker">Paso 2</span>
              <h2>Revisa antes de enviar</h2>
            </div>
            <span class="st-pill">Solo se enviarán las filas en verde</span>
          </div>
          <div class="st-note" data-role="matrix-status"></div>
          <div class="st-table-wrap" data-role="preview"></div>
          <div class="st-actions">
            <button type="button" class="st-primary st-big" data-action="generate">Generar traspasos</button>
          </div>
        </section>
        <section data-panel="envio" hidden>
          <div class="st-section-head">
            <div>
              <span class="st-kicker">Paso 3</span>
              <h2>Envía a SIRETRAC</h2>
            </div>
            <span class="st-pill st-pill-warn">Revisa el resumen</span>
          </div>
          <div class="st-warn" data-role="config-warning"></div>
          <div class="st-summary" data-role="summary"></div>
          <div class="st-note" data-role="ledger-note"></div>
          <div class="st-actions">
            <button type="button" data-action="simulate">Simular</button>
            <button type="button" class="st-danger st-big" data-action="send">Enviar a SIRETRAC</button>
            <button type="button" data-action="export">Exportar CSV</button>
            <button type="button" data-action="clear">Limpiar</button>
          </div>
          <div class="st-log" data-role="send-status"></div>
          <div class="st-output" data-role="output"></div>
        </section>
        <section data-panel="config" hidden>
          <div class="st-section-head">
            <div>
              <span class="st-kicker">Configuración</span>
              <h2>Mapeo de estaciones y permisos</h2>
            </div>
          </div>
          <p class="st-help">Relaciona cada estación de tu plantilla con su permiso de SIRETRAC. Se guarda en este navegador.</p>
          <div class="st-note" data-role="permits-status">Abre el panel para cargar los permisos.</div>
          <div class="st-card">
            <div class="st-grid-2">
              <label class="st-field">Origen global
                <select data-role="global-source"></select>
              </label>
              <div class="st-inline-actions">
                <button type="button" data-action="reload-permits">Escanear permisos</button>
              </div>
            </div>
            <div class="st-grid-2">
              <label class="st-field">Preset de origen
                <select data-role="preset"></select>
              </label>
              <div class="st-inline-actions">
                <button type="button" data-action="preset-save">Guardar preset</button>
                <button type="button" data-action="preset-delete">Eliminar</button>
              </div>
            </div>
            <details class="st-details">
              <summary>Avanzado: SC_Id del origen</summary>
              <label class="st-field">SC_Id del origen (idVendedor)
                <input type="text" data-role="source-sc-id" inputmode="numeric" placeholder="Ej. 1295">
              </label>
              <p class="st-note">Normalmente se usa el id del permiso origen. Solo cámbialo si SIRETRAC te pide otro vendedor.</p>
            </details>
          </div>
          <div class="st-card">
            <label class="st-field">Estaciones (una por línea)
              <textarea data-role="stations" rows="5" placeholder="Una estación por línea"></textarea>
            </label>
            <div class="st-actions">
              <button type="button" data-action="stations-from-matrix">Cargar de la matriz</button>
              <button type="button" data-action="suggest">Sugerir destinos</button>
            </div>
            <div class="st-wire" data-role="mapping-board"></div>
            <p class="st-note">Arrastra un cable desde un permiso hasta el nombre de tu plantilla. Clic en un cable para quitarlo.</p>
            <details class="st-details">
              <summary>Lista de respaldo (seleccionar permiso)</summary>
              <div class="st-stations" data-role="station-list"></div>
            </details>
          </div>
          <details class="st-details">
            <summary>Ver relación permiso ↔ estación</summary>
            <div class="st-stations" data-role="permit-relations"></div>
          </details>
        </section>
      </div>
    </section>
  `;


  const STYLE = `
    :host {
      all: initial;
      display: block;
      /* house-ui palette, repeated because all:initial blocks inheritance from :root. */
      --ui-font: 'Geist Pixel', ui-monospace, monospace;
      --ui-bg: #fff; --ui-fg: #333; --ui-muted: #706F6F;
      --ui-border: #e5e5e5; --ui-border-strong: #ddd; --ui-border-input: #ccc;
      --ui-header: #706F6F; --ui-header-hover: #555454;
      --ui-primary: #2EA836; --ui-primary-hover: #317636;
      --ui-danger: #C60C0E; --ui-danger-hover: #701617;
      --shub-spring: cubic-bezier(.34,1.4,.64,1);
      --shub-ease: cubic-bezier(.2,.8,.2,1);
      --ui-link: #337ab7; --ui-focus: #66afe9;
    }
    *, *::before, *::after { box-sizing: border-box; }
    [hidden] { display: none !important; }
    button, select, input, textarea { font: inherit; }
    button { cursor: pointer; }

    .st-fab {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 2147483646;
      padding: 10px 15px;
      border: 1px solid var(--ui-header);
      border-radius: 0;
      background: var(--ui-header);
      color: #fff;
      font: 600 13px/1.2 var(--ui-font);
      box-shadow: none;
    }
    .st-fab:hover { background: var(--ui-header-hover); }

    .st-panel {
      position: fixed;
      right: 18px;
      bottom: 76px;
      z-index: 2147483647;
      width: min(980px, calc(100vw - 36px));
      max-height: min(82vh, 820px);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: #fff;
      color: #111827;
      border: 1px solid #cbd5e1;
      border-radius: 0;
      box-shadow: none;
      font: 13px/1.4 var(--ui-font);
    }
    .st-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 14px;
      background: var(--ui-header);
      color: #fff;
    }
    .st-title strong { display: block; font-size: 14px; }
    .st-sub { display: block; font-size: 11px; opacity: .8; }
    .st-icon {
      border: 0;
      background: transparent;
      color: #fff;
      font-size: 22px;
      line-height: 1;
      padding: 2px 6px;
      border-radius: 0;
    }
    .st-icon:hover { background: rgba(255, 255, 255, .15); }

    .st-tabs {
      display: flex;
      gap: 2px;
      padding: 0 8px;
      background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
    }
    .st-tabs button {
      border: 0;
      border-bottom: 2px solid transparent;
      background: transparent;
      color: #475569;
      padding: 9px 12px;
      font-weight: 500;
    }
    .st-tabs button.is-active {
      color: var(--ui-header-hover);
      border-bottom-color: var(--ui-header-hover);
      font-weight: 400;
    }

    .st-body { padding: 12px 14px; overflow: auto; }
    .st-row { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px; margin: 8px 0; }
    .st-row > button { flex: 0 0 auto; }
    .st-field {
      display: flex;
      flex: 1 1 240px;
      min-width: 0;
      flex-direction: column;
      gap: 4px;
      color: #475569;
      font-size: 12px;
    }
    .st-field-sm { flex: 1 1 180px; }
    .st-field-date { flex: 0 1 220px; }
    .st-field select, .st-field input, .st-field textarea {
      width: 100%;
      padding: 6px 8px;
      border: 1px solid #cbd5e1;
      border-radius: 0;
      background: #fff;
      color: #111827;
      font-size: 13px;
    }
    .st-field textarea {
      min-height: 80px;
      resize: vertical;
      font-family: var(--ui-font);
      font-size: 12px;
    }
    .st-field select:focus, .st-field input:focus, .st-field textarea:focus {
      outline: 2px solid #99f6e4;
      border-color: var(--ui-header-hover);
    }

    .st-stations { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
    .st-map-row {
      display: grid;
      grid-template-columns: minmax(150px, 1.2fr) minmax(180px, 2fr) minmax(180px, 2fr);
      align-items: end;
      gap: 8px;
      padding: 8px;
      border: 1px solid #e2e8f0;
      border-radius: 0;
      background: #f8fafc;
    }
    .st-map-name {
      padding-bottom: 6px;
      color: #0f172a;
      font-weight: 400;
      overflow-wrap: anywhere;
    }

    .st-table-wrap {
      max-height: 360px;
      margin-top: 8px;
      overflow: auto;
      border: 1px solid #e2e8f0;
      border-radius: 0;
    }
    .st-table-wrap table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .st-table-wrap th {
      position: sticky;
      top: 0;
      z-index: 1;
      padding: 6px;
      border-bottom: 1px solid #cbd5e1;
      background: #f1f5f9;
      color: #334155;
      text-align: left;
      white-space: nowrap;
    }
    .st-table-wrap td {
      padding: 5px 6px;
      border-bottom: 1px solid #eef2f7;
      vertical-align: top;
      overflow-wrap: anywhere;
    }
    .st-num { text-align: right; white-space: nowrap; }

    .st-badge {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 0;
      font-size: 11px;
      font-weight: 400;
      white-space: nowrap;
    }
    .st-ok { background: #dcfce7; color: #166534; }
    .st-warn { background: #fef3c7; color: #92400e; }
    .st-error { background: #fee2e2; color: #991b1b; }

    .st-note { margin: 6px 0; color: #64748b; font-size: 12px; white-space: pre-line; }
    .st-warn {
      margin-bottom: 8px;
      padding: 8px 10px;
      border: 1px solid #fed7aa;
      border-radius: 0;
      background: #fff7ed;
      color: #9a3412;
      font-size: 12px;
    }
    .st-summary { margin-bottom: 4px; }
    .st-summary-line { margin-bottom: 4px; font-weight: 400; }
    .st-group {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 4px 0;
      border-bottom: 1px dashed #e2e8f0;
      color: #334155;
      font-size: 12px;
    }
    .st-group-permit { font-weight: 400; overflow-wrap: anywhere; }
    .st-log {
      max-height: 160px;
      min-height: 0;
      margin: 8px 0;
      padding: 8px;
      overflow: auto;
      border: 1px solid #e2e8f0;
      border-radius: 0;
      background: #f8fafc;
      color: #334155;
      font: 12px/1.45 var(--ui-font);
      white-space: pre-line;
    }
    .st-output { margin-top: 8px; }
    .st-h4 { margin: 12px 0 4px; color: #0f172a; font-size: 13px; }
    .st-pre {
      max-height: 320px;
      margin: 4px 0;
      padding: 10px;
      overflow: auto;
      border-radius: 0;
      background: #0f172a;
      color: #e2e8f0;
      font: 12px/1.45 var(--ui-font);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .st-primary { background: var(--ui-header-hover); border-color: var(--ui-header-hover); color: #fff; }
    .st-danger { background: #b91c1c; border-color: #b91c1c; color: #fff; }
    .st-row button {
      padding: 6px 10px;
      border: 1px solid #cbd5e1;
      border-radius: 0;
      background: #f8fafc;
      color: #1e293b;
      font-size: 12px;
    }
    button:disabled { opacity: .45; cursor: not-allowed; }

    @media (max-width: 640px) {
      .st-panel { right: 8px; left: 8px; width: auto; bottom: 70px; max-height: 86vh; }
      .st-map-row { grid-template-columns: 1fr; }
      .st-field-date { flex: 1 1 100%; }
    }

    /* Tema SIRETRAC: Geist Pixel para todo, gris institucional, plano (sin degradados ni sombras). */
    @font-face {
      font-family: 'Geist Pixel';
      font-style: normal;
      font-weight: 400;
      font-display: swap;
      src: url('https://cdn.jsdelivr.net/npm/@fontsource/geist-pixel/files/geist-pixel-latin-400-normal.woff2') format('woff2');
    }

    .st-fab {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 11px 16px;
      border: 1px solid #5a5959;
      border-radius: 0;
      background: #706F6F;
      color: #fff;
      font: 500 12px/1 'Geist Pixel', ui-monospace, monospace;
      box-shadow: none;
    }
    .st-fab:hover { background: #555454; }
    .st-fab-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #fff;
      opacity: .7;
    }

    .st-panel {
      width: min(1040px, calc(100vw - 32px));
      max-height: min(88vh, 860px);
      background: #fff;
      color: #333;
      border: 1px solid #e5e5e5;
      border-radius: 0;
      box-shadow: none;
      font: 400 12px/1.5 'Geist Pixel', ui-monospace, monospace;
    }
    .st-head {
      padding: 10px 14px;
      background: #706F6F;
      color: #fff;
      border-bottom: 1px solid #5a5959;
    }
    .st-brand { display: flex; align-items: center; gap: 12px; }
    .st-mark {
      display: grid;
      place-items: center;
      width: 38px;
      height: 38px;
      flex: 0 0 38px;
      border: 1px solid #4a4949;
      border-radius: 0;
      background: #555454;
      color: #fff;
      font: 400 10px/1 'Geist Pixel', ui-monospace, monospace;
      letter-spacing: .08em;
    }
    .st-title strong {
      display: block;
      font: 400 20px/1.15 'Geist Pixel', ui-monospace, monospace;
      letter-spacing: .01em;
    }
    .st-sub {
      display: block;
      margin-top: 2px;
      color: #e5e5e5;
      font: 400 9px/1.4 'Geist Pixel', ui-monospace, monospace;
      letter-spacing: .1em;
      text-transform: uppercase;
    }
    .st-icon {
      border-radius: 0;
      font: 400 22px/1 'Geist Pixel', ui-monospace, monospace;
    }

    .st-tabs {
      gap: 2px;
      padding: 0 8px;
      background: #fff;
      border-bottom: 1px solid #ddd;
      overflow-x: auto;
    }
    .st-tabs button {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 9px 12px;
      border: 0;
      border-bottom: 2px solid transparent;
      border-radius: 0;
      background: transparent;
      color: #555;
      font: 500 11px/1 'Geist Pixel', ui-monospace, monospace;
      white-space: nowrap;
    }
    .st-tabs button span {
      display: grid;
      place-items: center;
      width: 20px;
      height: 20px;
      border: 1px solid #ddd;
      border-radius: 50%;
      background: #f5f5f5;
      color: #706F6F;
      font: 400 10px/1 'Geist Pixel', ui-monospace, monospace;
    }
    .st-tabs button.is-active {
      background: #fff;
      color: #333;
      border-color: transparent;
      border-bottom-color: #706F6F;
    }
    .st-tabs button.is-active span { background: #706F6F; border-color: #706F6F; color: #fff; }
    .st-tab-config { margin-left: auto; }

    .st-body {
      padding: 16px;
      background: #fff;
    }
    .st-hero { margin-bottom: 16px; }
    .st-kicker {
      display: block;
      margin-bottom: 6px;
      color: #706F6F;
      font: 500 9px/1 'Geist Pixel', ui-monospace, monospace;
      letter-spacing: .16em;
      text-transform: uppercase;
    }
    .st-hero h2,
    .st-section-head h2 {
      margin: 0 0 6px;
      color: #333;
      font: 400 24px/1.15 'Geist Pixel', ui-monospace, monospace;
      letter-spacing: .01em;
    }
    .st-hero p,
    .st-help {
      max-width: 72ch;
      margin: 0;
      color: #706F6F;
      font: 400 12px/1.65 'Geist Pixel', ui-monospace, monospace;
    }
    .st-help { margin-bottom: 14px; }
    .st-section-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }
    .st-pill {
      display: inline-block;
      padding: 5px 9px;
      border: 1px solid #ccc;
      border-radius: 0;
      background: #f5f5f5;
      color: #706F6F;
      font: 500 9px/1.2 'Geist Pixel', ui-monospace, monospace;
      letter-spacing: .06em;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .st-pill-warn { border-color: #faebcc; background: #fcf8e3; color: #8a6d3b; }

    .st-grid-2 {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      margin: 12px 0;
    }
    .st-field {
      gap: 6px;
      color: #333;
      font: 500 10px/1.4 'Geist Pixel', ui-monospace, monospace;
      letter-spacing: .04em;
      text-transform: uppercase;
    }
    .st-field input,
    .st-field select,
    .st-field textarea {
      padding: 8px 10px;
      border: 1px solid #ccc;
      border-radius: 0;
      background: #fff;
      color: #333;
      font: 400 12px/1.5 'Geist Pixel', ui-monospace, monospace;
      letter-spacing: 0;
      text-transform: none;
    }
    .st-field textarea { min-height: 90px; }
    .st-field-paste textarea { min-height: 220px; }
    .st-field input:focus,
    .st-field select:focus,
    .st-field textarea:focus {
      outline: 0;
      border-color: #66afe9;
      box-shadow: none;
    }
    .st-field-sm { flex: 1 1 180px; }

    .st-actions,
    .st-inline-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin: 14px 0;
    }
    .st-inline-actions { align-items: flex-end; margin: 0; }
    .st-card {
      margin: 12px 0;
      padding: 14px;
      border: 1px solid #e5e5e5;
      border-radius: 0;
      background: #fff;
    }
    .st-row button,
    .st-actions button,
    .st-inline-actions button {
      padding: 8px 12px;
      border: 1px solid #ccc;
      border-radius: 0;
      background: #f5f5f5;
      color: #333;
      font: 400 11px/1 'Geist Pixel', ui-monospace, monospace;
    }
    .st-row button:hover:not(:disabled),
    .st-actions button:hover:not(:disabled),
    .st-inline-actions button:hover:not(:disabled) { background: #e6e6e6; }
    .st-big { padding: 11px 17px; font-size: 12px; }
    .st-primary { background: #2EA836; border-color: #2EA836; color: #fff; text-shadow: none; }
    .st-primary:hover:not(:disabled) { background: var(--ui-primary-hover); }
    .st-danger { background: #C60C0E; border-color: #C60C0E; color: #fff; text-shadow: none; }
    .st-danger:hover:not(:disabled) { background: var(--ui-danger-hover); }

    .st-note {
      margin: 6px 0;
      color: #706F6F;
      font: 400 10px/1.55 'Geist Pixel', ui-monospace, monospace;
      white-space: pre-line;
    }
    .st-warn {
      margin-bottom: 10px;
      padding: 10px 12px;
      border: 1px solid #faebcc;
      border-radius: 0;
      background: #fcf8e3;
      color: #8a6d3b;
      font: 400 11px/1.55 'Geist Pixel', ui-monospace, monospace;
    }
    .st-badge { padding: 0 6px; border: 0; margin: 0; border-radius: 0; font: 400 11px/20px 'Geist Pixel', ui-monospace, monospace; }
    .st-badge.st-ok { background: #dff0d8; color: #3c763d; }
    .st-badge.st-warn { background: #fcf8e3; color: #8a6d3b; }
    .st-badge.st-error { background: #f2dede; color: #a94442; }

    .st-table-wrap {
      border: 1px solid #ddd;
      border-radius: 0;
      background: #fff;
    }
    .st-table-wrap th {
      background: #f5f5f5;
      color: #333;
      border-bottom: 2px solid #ddd;
      font: 500 9px/1.3 'Geist Pixel', ui-monospace, monospace;
      letter-spacing: .04em;
      text-transform: uppercase;
    }
    .st-table-wrap td { font: 400 11px/1.45 'Geist Pixel', ui-monospace, monospace; }
    .st-stations { gap: 7px; }
    .st-map-row {
      border: 1px solid #ddd;
      border-radius: 0;
      background: #fff;
    }
    .st-map-name { color: #333; font: 500 11px/1.4 'Geist Pixel', ui-monospace, monospace; }
    .st-summary-line { color: #333; font: 500 12px/1.4 'Geist Pixel', ui-monospace, monospace; }
    .st-group {
      color: #706F6F;
      font: 400 11px/1.4 'Geist Pixel', ui-monospace, monospace;
      border-bottom-color: #eee;
    }
    .st-log {
      border: 1px solid #ddd;
      border-radius: 0;
      background: #f5f5f5;
      color: #333;
      font: 400 11px/1.6 'Geist Pixel', ui-monospace, monospace;
    }
    .st-pre {
      background: #f5f5f5;
      color: #333;
      font: 400 11px/1.6 'Geist Pixel', ui-monospace, monospace;
    }
    .st-h4 { color: #333; font: 400 14px/1.2 'Geist Pixel', ui-monospace, monospace; }
    .st-details { margin-top: 12px; padding-top: 10px; border-top: 1px solid #e5e5e5; }
    .st-details summary {
      cursor: pointer;
      color: #337ab7;
      font: 500 10px/1.4 'Geist Pixel', ui-monospace, monospace;
      letter-spacing: .06em;
      text-transform: uppercase;
    }

    .st-wire {
      position: relative;
      margin: 12px 0 8px;
      padding: 14px;
      border: 1px solid #ddd;
      border-radius: 0;
      background: #fff;
      overflow: auto;
      min-height: 240px;
    }
    .st-wire-svg {
      position: absolute;
      top: 0;
      left: 0;
      pointer-events: none;
      overflow: visible;
    }
    .st-wire-columns {
      position: relative;
      z-index: 1;
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 150px;
      align-items: start;
    }
    .st-wire-col { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
    .st-wire-head { display: flex; flex-direction: column; gap: 2px; padding: 0 4px 4px; }
    .st-wire-head strong {
      color: #333;
      font: 500 10px/1.3 'Geist Pixel', ui-monospace, monospace;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .st-wire-sub { color: #706F6F; font: 400 10px/1.4 'Geist Pixel', ui-monospace, monospace; }
    .st-wire-node {
      display: flex;
      align-items: center;
      gap: 9px;
      padding: 9px 10px;
      border: 1px solid #ccc;
      border-radius: 0;
      background: #fff;
      cursor: grab;
      user-select: none;
    }
    .st-wire-node:active { cursor: grabbing; }
    .st-wire-node.is-source { background: #f5f5f5; cursor: not-allowed; opacity: .82; }
    .st-wire-node.is-connected { border-color: #2EA836; box-shadow: none; }
    .st-wire-station { cursor: default; }
    .st-wire-port {
      flex: 0 0 auto;
      width: 11px;
      height: 11px;
      border: 2px solid #2EA836;
      border-radius: 50%;
      background: #fff;
      touch-action: none;
    }
    .st-wire-permit .st-wire-port { order: 2; margin-left: auto; }
    .st-wire-station .st-wire-port { order: 0; }
    .st-wire-node.is-source .st-wire-port { border-color: #ccc; }
    .st-wire-label {
      min-width: 0;
      overflow-wrap: anywhere;
      color: #333;
      font: 500 11px/1.4 'Geist Pixel', ui-monospace, monospace;
    }
    .st-wire-label small {
      display: block;
      color: #706F6F;
      font: 400 10px/1.4 'Geist Pixel', ui-monospace, monospace;
    }
    .st-wire-path {
      fill: none;
      stroke: #706F6F;
      stroke-width: 2;
      stroke-linecap: round;
      pointer-events: stroke;
      cursor: pointer;
    }
    .st-wire-path:hover { stroke: #C60C0E; }
    .st-wire-temp { stroke: #C6670C; stroke-dasharray: 5 5; pointer-events: none; }
    .st-wire-empty {
      padding: 22px;
      color: #706F6F;
      text-align: center;
      font: 400 12px/1.5 'Geist Pixel', ui-monospace, monospace;
    }

    @media (max-width: 720px) {
      .st-panel { right: 8px; left: 8px; width: auto; bottom: 70px; max-height: 88vh; }
      .st-body { padding: 16px; }
      .st-grid-2 { grid-template-columns: 1fr; }
      .st-section-head { flex-direction: column; }
      .st-tab-config { margin-left: 0; }
      .st-hero h2, .st-section-head h2 { font-size: 21px; }
      .st-field-paste textarea { min-height: 180px; }
      .st-wire-columns { gap: 70px; }
      .st-wire-node { padding: 8px; }
    }
    /* Mounted inside the EasyTrac sidebar: no floating chrome. */
    .st-fab { display: none; }
    .st-head { display: none; }
    .st-panel {
      position: static;
      width: 100%;
      max-height: none;
      border: 0;
      border-radius: 0;
      box-shadow: none;
      font-size: 13px;
    }
    .st-matrix {
      min-height: 90px;
      padding: 10px;
      background: #f5f5f5;
      border: 1px solid var(--ui-border);
    }
    .st-matrix:empty::before {
      content: "Pega aquí el bloque desde Excel";
      display: block;
      padding-top: 26px;
      text-align: center;
      color: var(--ui-muted);
    }
    .st-output {
      padding: 10px;
      background: #f5f5f5;
      border: 1px solid var(--ui-border);
    }
    .st-output:empty { display: none; }

    /* Soft spring on every state change; the page keeps its calm. */
    .st-tabs button,
    .st-tabs button span { transition: background 120ms linear, color 120ms linear, transform 160ms var(--shub-spring); }
    .st-tabs button:active { transform: scale(.97); }
    .st-tabs button.is-active span { animation: st-pop 240ms var(--shub-spring); }
    .st-body { animation: st-fade 200ms var(--shub-spring) both; }
    .st-table-wrap tbody tr { animation: st-row 200ms var(--shub-ease) both; }
    @keyframes st-pop { from { transform: scale(.72); } to { transform: none; } }
    @keyframes st-fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    @keyframes st-row { from { opacity: 0; } to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) {
      .st-tabs button, .st-tabs button span { transition: none; }
      .st-tabs button.is-active span, .st-body, .st-table-wrap tbody tr { animation: none; }
    }

  `;


  function init() {
    if (typeof document === 'undefined' || !document.body) return;
    if (document.getElementById(HOST_ID)) return;

    const host = document.createElement('div');
    host.id = HOST_ID;
    /* Mounted inside the shared sidebar instead of floating over the page. */
    const pane = ET.ui.tab('traspasos', 'Traspasos', 60, 780);
    pane.innerHTML = '';
    pane.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>' + STYLE + '</style>' + TEMPLATE;

    ui = {
      root: root,
      fab: root.querySelector('[data-role="fab"]'),
      panel: root.querySelector('[data-role="panel"]'),
      close: root.querySelector('[data-role="close"]'),
      tabs: Array.from(root.querySelectorAll('[data-tab]')),
      panels: Array.from(root.querySelectorAll('[data-panel]')),
      permitsStatus: root.querySelector('[data-role="permits-status"]'),
      globalSource: root.querySelector('[data-role="global-source"]'),
      sourceScId: root.querySelector('[data-role="source-sc-id"]'),
      preset: root.querySelector('[data-role="preset"]'),
      stations: root.querySelector('[data-role="stations"]'),
      stationList: root.querySelector('[data-role="station-list"]'),
      mappingBoard: root.querySelector('[data-role="mapping-board"]'),
      permitRelations: root.querySelector('[data-role="permit-relations"]'),
      matrix: root.querySelector('[data-role="matrix"]'),
      weekStart: root.querySelector('[data-role="week-start"]'),
      registrationDate: root.querySelector('[data-role="registration-date"]'),
      matrixStatus: root.querySelector('[data-role="matrix-status"]'),
      preview: root.querySelector('[data-role="preview"]'),
      configWarning: root.querySelector('[data-role="config-warning"]'),
      summary: root.querySelector('[data-role="summary"]'),
      ledgerNote: root.querySelector('[data-role="ledger-note"]'),
      sendStatus: root.querySelector('[data-role="send-status"]'),
      output: root.querySelector('[data-role="output"]'),
      simulate: root.querySelector('[data-action="simulate"]'),
      send: root.querySelector('[data-action="send"]'),
      export: root.querySelector('[data-action="export"]'),
    };

    state.ledger = loadLedger();
    state.presets = loadPresets();
    importLegacySource();
    ui.sourceScId.value = state.sourceScId;
    ui.weekStart.value = previousMondayISO();
    ui.registrationDate.value = sundayISO(ui.weekStart.value);
    ui.weekStart.addEventListener('change', () => {
      const lunes = mondayISO(ui.weekStart.value);
      if (!lunes) return;
      ui.weekStart.value = lunes;
      ui.registrationDate.value = sundayISO(lunes);
    });
    renderPresets('');
    bindEvents();
    renderEnvio();
    switchTab('pega');
    ET.grid.montar(ui.matrix);
    ui.panel.hidden = false;
    /* The first interaction opens the panel's data; a page nobody visits makes no requests. */
    pane.addEventListener('click', function abrir() {
      pane.removeEventListener('click', abrir);
      openPanel();
    });
  }

  // ---------------------------------------------------------------------------
  // Exportación para pruebas desde Node
  // ---------------------------------------------------------------------------

  const api = {
    CONFIG: CONFIG,
    parseMatrix: parseMatrix,
    parsePermitsFromDocument: parsePermitsFromDocument,
    parseVolume: parseVolume,
    parseDate: parseDate,
    normalizeText: normalizeText,
    normalizeKey: normalizeKey,
    extractAcuses: extractAcuses,
    acuseKey: acuseKey,
    acuseKeys: acuseKeys,
    suggestPermit: suggestPermit,
    assignByOrder: assignByOrder,
    relatePermits: relatePermits,
    evaluateRows: evaluateRows,
    buildTransfers: buildTransfers,
    groupTransfers: groupTransfers,
    buildTraspasoBody: buildTraspasoBody,
    registrationTimestamp: registrationTimestamp,
    findRegistrationNumber: findRegistrationNumber,
    sourcePermitStatus: sourcePermitStatus,
    isExpiredSessionHtml: isExpiredSessionHtml,
    nextMondayISO: nextMondayISO,
    previousMondayISO: previousMondayISO,
    todayISO: todayISO,
  };

  // Acceso de depuración desde la consola del navegador; no se usa en el flujo normal.
  if (typeof window !== 'undefined') {
    window.SIRETRAC_TRASPASOS = {
      state: state,
      selectPermit: selectPermit,
      fetchAcuses: fetchAcuses,
      postTransfer: postTransfer,
      buildTraspasoBody: buildTraspasoBody,
      normalizeKey: normalizeKey,
      acuseKey: acuseKey,
      acuseKeys: acuseKeys,
      findRegistrationNumber: findRegistrationNumber,
      sourcePermitStatus: sourcePermitStatus,
      isExpiredSessionHtml: isExpiredSessionHtml,
    };
  }

  if (
    typeof module !== 'undefined' &&
    module.exports &&
    typeof process !== 'undefined' &&
    process.versions &&
    process.versions.node
  ) {
    module.exports = api;
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
      init();
    }
  }

  ET.traspasos = ET.traspasos || {};
  /* Única puerta a CONFIG.sendDelayMs para la pestaña Ajustes. */
  ET.traspasos.sendDelay = function (v) {
    if (v === undefined) return CONFIG.sendDelayMs;
    CONFIG.sendDelayMs = Math.max(0, +v || 0);
    if (ET.store) ET.store.set(DELAY_KEY, CONFIG.sendDelayMs);
    return CONFIG.sendDelayMs;
  };
  if (ET.config) {
    ET.config.add({
      seccion: 'Traspasos',
      clave: 'traspasos.espera',
      etiqueta: 'Espera entre envíos (ms)',
      tipo: 'number',
      defecto: 800,
      leer: function () { return ET.traspasos.sendDelay(); },
      guardar: function (v) { ET.traspasos.sendDelay(v); },
    });
  }
})();
