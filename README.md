# EasyTRAC

Toolkit de SIRETRAC en **un solo userscript** y un **solo sidebar**. Reúne los cinco scripts que antes vivían sueltos:

| Pestaña | Origen | Ancho |
|---|---|---|
| ACS | `ACS.user.js` | 470 px |
| Acuses | `ACUSES.DOWNLOADER.user.js` | 300 px |
| Venta | `AUTOFILL.SIRETRAC.VENTA.user.js` | 300 px |
| Fecha | `FECHA.SIRETRAC.FRC.user.js` (SToolkit) | 300 px |
| Traspasos | `siretrac-traspasos.user.js` | 780 px |

Cada pestaña sólo aparece en las páginas donde su script funcionaba. Los originales quedan en `legacy/` como referencia y para volver a generar los módulos con `tools/split.mjs`.

## Instalar

1. Tampermonkey (o Violentmonkey) en el navegador.
2. Instala **`EasyTrac.user.js`**. Ese archivo sólo tiene la cabecera y 14 `@require`.
3. Antes de publicar, cambia `OWNER` en `tools/build.mjs` y vuelve a ejecutar `bun tools/build.mjs`: es la única línea que apunta a GitHub.

Sin repositorio todavía, usa **`dist/EasyTrac.standalone.user.js`**: la misma cabecera con todo el código dentro, para probar hoy sin publicar nada.

## Estructura

```
EasyTrac.user.js        loader instalable (14 @require)
src/
  01-core.js            globalThis.EasyTrac, log, ready, on
  02-store.js           get/set/del en localStorage (sustituye GM_*)
  03-http.js            apiPost, getJsonDatos, reintentos, multipart
  04-dates.js           pad2, toISO, parseDia, parseISO, isoToDMA
  05-text.js            limpiarHtml, pick, matchInput, matchText
  06-permisos.js        escaneo de permisos y URLs
  10-ui-tokens.js       tokens.css del house style, inlineado
  11-ui-sidebar.js      sidebar único (superpuesto / riel de 44 px)
  13-ui-grid.js         hoja de cálculo para pegar matrices
  20-acs.js             ACS completo
  30-acuses.js          descarga de acuses
  40-venta.js           auto-fill de venta (DisPla y ES)
  50-fecha.js           SToolkit
  70-traspasos.js       traspasos GLP
test/                   bun test (47 pruebas)
tools/                  split, build, syntax, tokens
dist/                   bundle y standalone generados
legacy/                 los 5 userscripts originales
```

Los números son el orden de `@require`; no los renombres sin actualizar `tools/build.mjs`.

## Comandos

```powershell
bun install       # una vez: jsdom, solo para las pruebas
bun test          # 47 pruebas
bun tools/syntax.mjs
bun tools/build.mjs   # regenera EasyTrac.user.js, dist/easytrac.bundle.js y el standalone
```

## Actualizaciones

La cabecera lleva `@updateURL` y `@downloadURL` al `EasyTrac.user.js` de `main`, y cada
`@require` apunta a un tag fijo: `…/easytrac@v1.0.0/src/…`. Así Tampermonkey compara
`@version` y, cuando sube, descarga módulos de la versión nueva, nunca de una caché vieja
de jsDelivr.

Un release es un comando:

```powershell
bun tools/release.mjs patch "arreglo del grid"      # o minor / major / 1.2.0
bun tools/release.mjs patch "solo local" --no-push
```

Hace las pruebas, sube la versión en `package.json`, reconstruye, hace commit, crea el tag
`vX.Y.Z` y empuja con `--follow-tags`. Sin tag en GitHub, jsDelivr no resuelve los módulos:
por eso el tag viaja junto al push.

Primera publicación del repositorio:

```powershell
git remote add origin https://github.com/OWNER/easytrac.git
git push -u origin main --follow-tags
```


## Decisiones

- **`@grant none`**: ACUSES, Venta y Fecha dependen del jQuery de la página y con grants lo pierden. Las cuatro llamadas `GM_*` de ACS pasaron a `ET.store` y a `<a download>`.
- **Un scope**: los `@require` comparten alcance, así que cada módulo es una IIFE y publica en `EasyTrac.<área>`; los nombres locales pueden repetirse sin colisión.
- **Sidebar**: expandido se superpone a la página; colapsado es un riel de 44 px que sí desplaza el contenido. Conserva `localStorage.shub_tab` y `shub_min`.
- **Matriz de traspasos**: se pega en una hoja de cálculo real (`13-ui-grid.js`), se edita celda por celda y se serializa a TSV antes de `parseMatrix`; el parser no cambió.
- **Sin fusiones de riesgo**: los escáneres de permisos de Acuses y Traspasos se movieron tal cual; fusionarlos queda pendiente y necesita fixture. `toISO` y `toISOUTC` siguen separados porque su semántica difiere.

## Pendiente

- Publicar en GitHub y sustituir `OWNER` (`tools/build.mjs`).
- Fusionar los dos escáneres de permisos con pruebas sobre HTML real.
- Pruebas de ACS (filtros por estatus y cuerpos de petición).
