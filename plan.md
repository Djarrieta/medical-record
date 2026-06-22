# Plan: renombrar el archivo en vez de guardar un título aparte

## Objetivo

Cuando se procesa un archivo (PDF o imagen) desde la web o desde Telegram, el
`Titler` genera un nombre corto a partir del contenido. Hoy ese nombre se guarda
en un campo `title` separado y el `original_name` no cambia.

Nuevo enfoque: el nombre generado **renombra `original_name`** (conservando la
extensión original) y se **elimina el concepto de `title`** para los archivos.

## Decisiones tomadas

- **Notas**: `Note` mantiene su propio `title`; `IndexNote` sigue igual. Este
  cambio es solo para *archivos*.
- **Columna `title` en SQLite**: se **elimina** del esquema (`CREATE TABLE`).
  No se usa `ALTER TABLE`/`DROP COLUMN`; como no hay datos que conservar, se
  resetean los datos con `./reset.sh` y la tabla se recrea limpia.
- **Sin migración/backfill**: se borra la lógica de `migrate()` relacionada con
  `title` (no más `ALTER TABLE ADD COLUMN` ni `UPDATE ... SET title`).
- **Extensión**: el nombre nuevo conserva la extensión original, p. ej.
  `Hemograma — Lab. Clínico, 12 mar 2024.pdf`.
- **Archivo físico en disco**: sigue guardado con su UUID; solo cambia el
  `original_name` (nombre lógico de descarga/listado).

## Cambios

### 1. Dominio

- `src/domain/types.ts`: quitar el campo `title` de `FileRecord`.
- `src/domain/ports.ts`: en `DocumentRepository`, reemplazar
  `setTitle(id, title)` por `setOriginalName(id, name)`. El puerto `Titler` se
  mantiene (sigue generando el nombre desde el texto).

### 2. Repositorio — `src/infrastructure/persistence/sqliteDocumentRepository.ts`

- Quitar la columna `title` del `CREATE TABLE files`.
- Quitar `title` de los `INSERT` y de `mapRow`.
- Eliminar de `migrate()` la lógica de `title` (no `ALTER TABLE ADD COLUMN`,
  no `UPDATE ... SET title`).
- Implementar `setOriginalName(id, name)`: actualiza `original_name`, añadiendo
  la extensión original si el nombre nuevo no la trae.

### 3. Casos de uso

- `src/application/indexPdf.ts`: `applyTitle` → `applyName`, que llama a
  `repo.setOriginalName(...)`. Sigue siendo best-effort (un fallo no rompe el
  indexado).
- `src/application/indexImage.ts`: misma idea, usar `setOriginalName`.

### 4. UI / presentación

- `src/infrastructure/web/webServer.ts`: quitar la lógica `title` vs
  `originalName`; mostrar solo `originalName`. Búsqueda solo sobre
  `originalName`.
- `src/infrastructure/telegram/botApp.ts` (`replyFilesList`): listar solo
  `originalName`.

### 5. Wiring

- `src/main.ts`: sin cambios (el `titler` se sigue inyectando igual a
  `IndexPdf` e `IndexImage`).

## Validación

- `bun run typeCheck` debe pasar sin errores.
- Resetear los datos con `./reset.sh` para recrear la tabla `files` sin la
  columna `title`.
