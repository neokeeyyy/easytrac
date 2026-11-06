# Guía para contribuir

Esta guía es para quien modifica el código de EasyTRAC. Para uso normal, consulta el [README](README.md).

## Requisitos

- [Bun](https://bun.sh/), usado para las pruebas y las herramientas de build.
- Tampermonkey o Violentmonkey, para probar el script en el navegador.
- Opcional: Chrome o Edge con el perfil limpio para `tools/preview.mjs`.

## Puesta en marcha

```powershell
git clone https://github.com/neokeeyyy/easytrac.git
cd easytrac
bun install
```

## Comandos

```powershell
bun test                # pruebas (jsdom para el arranque del sidebar)
bun tools/syntax.mjs    # validación de sintaxis de cada módulo
bun tools/build.mjs     # regenera EasyTrac.user.js y los dos archivos de dist/
bun tools/preview.mjs   # sirve una página tipo SIRETRAC en http://127.0.0.1:8099
```

Corre `bun test` y `bun tools/syntax.mjs` antes de cada commit. `bun tools/build.mjs` es
obligatorio si tocaste `src/`: el loader y el standalone no se actualizan solos.

## Estructura

```
EasyTrac.user.js     loader instalable (cabecera y 19 @require)
src/                 módulos fuente
test/                pruebas
tools/               build, syntax, preview, release
dist/                bundle y standalone generados
legacy/              userscripts originales, como referencia
```

Los módulos de `src/` siguen este orden:

| Prefijo | Área |
|---|---|
| `01`–`06` | Núcleo: namespace, almacenamiento, HTTP, fechas, texto, permisos |
| `10`–`14` | Interfaz: tokens, sidebar, hoja de cálculo, ajustes |
| `20`–`70` | Pestañas: ACS, Acuses, Venta, Fecha, Traspasos |

## Convenciones

- **El prefijo numérico define el orden de `@require`.** No lo cambies sin actualizar `tools/build.mjs` y el conteo de `test/boot.test.js`.
- **Cada módulo es una IIFE** que publica en `EasyTrac.<área>`. Así los nombres locales pueden repetirse sin colisionar.
- **`@grant none`.** Acuses, Venta y Fecha dependen del jQuery de la página, y los grants lo aíslan. No agregues `GM_*`; para persistir datos usa `ET.store` (sobre `localStorage`).
- **Las opciones persistentes se registran en `ET.config`**, no en un panel propio. Cada campo aporta `leer()` y `guardar()` sobre el store que ya existía; no crees una copia paralela.
- **Descargas** con `<a download>`, no con `GM_download`.
- **Estilos** con las variables `--ui-*` y las reglas de `house-ui`: una tipografía, plano, esquinas rectas.
- **Dependencias del navegador.** Antes de tocar un escáner de permisos o de selectores, verifica contra el HTML real de SIRETRAC, no solo contra un fixture inventado.

## Probar sin SIRETRAC

`tools/preview.mjs` levanta una página con el mismo esqueleto (navbar, `content-wrapper`, los ids que
necesitan Ventas y Fecha) y sirve `dist/easytrac.bundle.js`. Las pestañas se montan como en el sitio
real, salvo Acuses, que necesita la ruta `/GasLP/`. Recuerda correr el build antes de mirar.

## Publicar una versión

```powershell
bun tools/release.mjs patch "descripción del cambio"   # o minor / major / X.Y.Z
bun tools/release.mjs patch "solo local" --no-push
```

El script:

1. Ejecuta `tools/syntax.mjs` y las pruebas.
2. Sube `version` en `package.json`.
3. Reconstruye los archivos de `dist/` y `EasyTrac.user.js`.
4. Hace commit y crea el tag `vX.Y.Z`.
5. Empuja con `--follow-tags`.

El tag es obligatorio. Los `@require` apuntan a `…/easytrac@vX.Y.Z/src/…`, así que jsDelivr no
resuelve los módulos sin el tag en GitHub. Tampermonkey compara `@version` y descarga la versión
nueva.

### Caché de jsDelivr

Si jsDelivr responde 404 en un módulo recién publicado, es una caché negativa en el borde. Límpiala con:

```
https://purge.jsdelivr.net/gh/neokeeyyy/easytrac@vX.Y.Z/src/archivo.js
```

### Cambiar de cuenta u organización

`OWNER` en `tools/build.mjs` es la única línea que apunta al usuario de GitHub. Si el repositorio
cambia de dueño, actualiza ahí y vuelve a generar el build.

## Antes de abrir un cambio

- Describe qué problema resuelve y en qué página de SIRETRAC se probó.
- Incluye la versión de Tampermonkey o Violentmonkey y el navegador usado.
- Asegúrate de que `bun test` y `bun tools/syntax.mjs` pasen.
- Si el cambio toca una petición al servidor, di qué endpoint y qué campos cambian.
