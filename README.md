# EasyTRAC

Una barra lateral para SIRETRAC que reúne las herramientas de trabajo diario en un solo script. Cada función aparece solo en las páginas donde funciona.

Reemplaza a cinco userscripts que vivían sueltos. Los originales quedan en `legacy/` como referencia.

## Qué incluye

| Pestaña | Para qué sirve | Ancho |
|---|---|---|
| **ACS** | Aceptar, despachar, recepcionar y cerrar compras, y generar el formato de traspaso en PDF. | 470 px |
| **Acuses** | Descarga de acuses en lote (ZIP con PDFs), con vista previa al pasar el ratón. | 300 px |
| **Venta** | Autollenado de los formularios de venta, en DisPla y ES. | 300 px |
| **Fecha** | Ajuste de fechas en SToolkit. | 300 px |
| **Traspasos** | Carga de la matriz de traspasos de GLP desde una hoja editable. | 780 px |
| **Ajustes** | Todas las opciones persistentes en un solo sitio, con revisión obligatoria al estrenar versión. | 420 px |

La barra se puede contraer a una franja delgada para no tapar la página, y recuerda la última pestaña que usaste.

## Instalación

1. Instala [Tampermonkey](https://www.tampermonkey.net/) o Violentmonkey.
2. Abre [EasyTrac.user.js](https://raw.githubusercontent.com/neokeeyyy/easytrac/main/EasyTrac.user.js) y confirma la instalación.
3. Recarga SIRETRAC. La barra aparece en las páginas compatibles.

Las actualizaciones llegan solas: el script revisa el repositorio cada 12 h y avisa cuando hay una versión nueva.

**Si tu red bloquea jsDelivr**, usa `dist/EasyTrac.standalone.user.js`. Incluye todo el código, pero no se actualiza solo: hay que reemplazarlo a mano en cada versión.

## Recomendaciones

- Usa siempre la versión más reciente antes de procesar datos importantes.
- Revisa la matriz de traspasos antes de enviarla. Un pegado con formato distinto puede desplazar valores.
- Si una pestaña no aparece, recarga la página: casi siempre es que SIRETRAC terminó de cargar después del script.
- Al reportar un problema, indica la página exacta y lo que hiciste justo antes.

## Estructura

```
EasyTrac.user.js        loader instalable (3 librerías + 16 módulos @require)
src/
  01-core.js            globalThis.EasyTrac, log, ready, on
  02-store.js           get/set/del en localStorage (sustituye GM_*)
  03-http.js            apiPost, getJsonDatos, reintentos, multipart
  04-dates.js           pad2, toISO, semanas de lunes a domingo
  05-text.js            limpiarHtml, pick, matchInput, matchText
  06-permisos.js        escaneo único de permisos y URLs
  10-ui-tokens.js       tokens.css del house style, inlineado
  11-ui-sidebar.js      sidebar único (superpuesto / riel de 44 px)
  13-ui-grid.js         hoja de cálculo para pegar matrices
  14-ui-config.js       Ajustes únicos y revisión al arrancar
  20-acs.js             ACS completo
  30-acuses.js          descarga de acuses
  40-venta.js           auto-fill de venta (DisPla y ES)
  50-fecha.js           SToolkit
  70-traspasos.js       traspasos GLP
test/                   bun test (146 pruebas)
tools/                  build, syntax, preview, release
dist/                   bundle y standalone generados
legacy/                 los 5 userscripts originales
```

Los números son el orden de `@require`; no los renombres sin actualizar `tools/build.mjs`.

## Comandos

```powershell
bun install             # una vez: jsdom, solo para las pruebas
bun test                # 146 pruebas
bun tools/syntax.mjs
bun tools/build.mjs     # regenera EasyTrac.user.js, dist/easytrac.bundle.js y el standalone
bun tools/preview.mjs   # página local tipo SIRETRAC para revisar la interfaz sin datos reales
```

## Actualizaciones

La cabecera lleva `@updateURL` y `@downloadURL` al `EasyTrac.user.js` de `main`, y cada
`@require` apunta a un tag fijo: `…/easytrac@vX.Y.Z/src/…`. Así Tampermonkey compara
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

Si jsDelivr responde 404 en un módulo recién publicado, es una caché negativa del borde:
`https://purge.jsdelivr.net/gh/neokeeyyy/easytrac@vX.Y.Z/src/archivo.js` la limpia.

Los archivos de una rama en `raw.githubusercontent.com` también tardan unos minutos en
refrescar tras el push; el commit y el tag sí están al instante.

## Decisiones

- **`@grant none`**: ACUSES, Venta y Fecha dependen del jQuery de la página y con grants lo pierden. Las cuatro llamadas `GM_*` de ACS pasaron a `ET.store` y a `<a download>`.
- **Un scope**: los `@require` comparten alcance, así que cada módulo es una IIFE y publica en `EasyTrac.<área>`; los nombres locales pueden repetirse sin colisión.
- **Sidebar**: expandido se superpone a la página; colapsado es un riel de 44 px que sí desplaza el contenido. Conserva `localStorage.shub_tab` y `shub_min`.
- **Matriz de traspasos**: se pega en una hoja de cálculo real (`13-ui-grid.js`), se edita celda por celda y se serializa a TSV antes de `parseMatrix`; el parser no cambió.
- **Un escáner de permisos**: `06-permisos.js` lee la tabla de SIRETRAC una vez y lo usan Acuses y Traspasos; ACS conserva el suyo por regex porque trabaja sobre HTML crudo.
- **Sin datos de empresa en el código**: ni vehículos, ni placas, ni fechas, ni listas de estados. Todo se configura en Ajustes y se guarda en el navegador.

## Próximamente

- Verificación del nombre de campo del vehículo en `GuardaCompraGasLP` contra la API real.
- Mensajes de error que indiquen qué paso falló.

## Versiones

Consulta el [historial de versiones](https://github.com/neokeeyyy/easytrac/tags) para ver qué cambió en cada release.

Para contribuir o entender la estructura interna, revisa [CONTRIBUTING.md](CONTRIBUTING.md).
