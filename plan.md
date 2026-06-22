# Plan: tags automáticos + edición manual, con filtrado por el agente

## Objetivo

Cada documento indexado (PDF, imagen y nota) lleva un conjunto de **tags**:
términos médicos relevantes extraídos automáticamente del contenido (órganos /
zonas del cuerpo, procedimientos / tipos de examen, especialidad, y la **fecha**
del documento). Los tags sirven para:

1. **Mejores búsquedas del agente**: además de ver los tags de cada fragmento,
   el agente puede **filtrar** la búsqueda por uno o varios tags.
2. **Edición manual desde la UI web**: el usuario puede agregar, editar o quitar
   tags de un archivo.

## Decisiones tomadas

- **Tags libres, guiados por prompt.** No hay catálogo cerrado. Un prompt con
  ejemplos claros guía al LLM hacia términos canónicos: órganos / zonas completas
  (`estómago`, `codo`, `espalda`, `ojos`), procedimientos / exámenes de forma
  global (`hemograma`, `urianálisis`, `radiografía`), y la especialidad cuando
  sea evidente. Tags en minúscula, singular, sin frases largas.
- **Fecha = un tag de texto más**, siempre en formato `YYYY-MM-DD` para que sea
  ordenable alfabéticamente == cronológicamente. Un **util compartido** garantiza
  el mismo formato tanto al generar (indexado) como al filtrar (búsqueda).
- **Alcance: archivos y notas.** Ambos se auto-taggean y son filtrables por tag.
  Ambos se pueden listar y editar (tags / borrar) desde la UI web.
- **Agente: ver + filtrar.** La herramienta de búsqueda acepta un filtro opcional
  por tags y devuelve los tags de cada resultado. Se añade una herramienta para
  listar los tags disponibles del usuario.
- **Tags a nivel de archivo, espejados a los chunks.** La fuente de verdad vive
  en SQLite (`files.tags`, `notes.tags`); el payload de **todos** los chunks de
  ese documento en Qdrant se mantiene en sincronía (igual que hoy con
  `renameFile`). Editar tags = `UPDATE` en SQLite + `setPayload` en Qdrant. **No**
  se re-embebe.
- **Generación = post-indexado, espejo del título.** Los tags se generan tras
  indexar el texto, desde el mismo `sourceText` que ya usa el título (así un PDF
  escaneado los obtiene del texto de OCR), y se aplican con `repo.setTags` /
  `notes.setTags` + `vectorIndex.setTags`. **No** cambian las firmas de
  `embedAndIndex` ni `vectorIndex.index`.
- **Generación con un `Tagger` separado**, espejo de `LlmTitler` (no se combina
  con la generación del título en una sola llamada).
- **Datos desechables, sin migración.** Se agregan columnas/campos nuevos; como
  no se conserva data, se aplica con `./reset.sh` (recrea tabla y colección).

## Modelo de datos

### Tags
- `string[]`, minúsculas, deduplicados. La fecha, si existe, va como un tag más
  con formato `YYYY-MM-DD` (ej. `["urianálisis", "orina", "riñón", "2024-03-12"]`).

### SQLite
- `files`: nueva columna `tags TEXT NOT NULL DEFAULT '[]'` (JSON array).
- `notes`: nueva columna `tags TEXT NOT NULL DEFAULT '[]'` (JSON array).

### Qdrant (payload por chunk)
- Nuevo campo `tags: string[]` en `ChunkMetadata`.
- Nuevo **payload index** sobre `tags` (`keyword`) para filtrar eficientemente.

## Cambios

### 1. Dominio — `src/domain/`

- `types.ts`:
  - `FileRecord`: agregar `tags: string[]`.
  - `Note`: agregar `tags: string[]`.
  - `ChunkMetadata`: agregar `tags: string[]` (se propaga a `SearchResult`).
- `ports.ts`:
  - Nuevo puerto `Tagger { generate(text: string): Promise<string[]> }`.
  - `DocumentRepository`: agregar `setTags(id, tags)` y `listTags(userId): string[]`.
  - `NoteRepository`: agregar `setTags(id, tags)` y `listTags(userId): string[]`.
  - `VectorIndex` (`index(...)` **no cambia** — los tags se aplican con `setTags`
    después de indexar):
    - nuevo `setTags(fileId, tags, userId)`: actualiza el payload `tags` de todos
      los chunks de ese documento (mismo patrón que `renameFile`).
    - `search(vector, userId, topK?, tags?)`: filtro opcional por tags
      (coincide si el chunk tiene **cualquiera** de los tags pedidos).
- `date.ts` (**nuevo, puro, sin deps**): `toIsoDate(input: string): string | null`
  → normaliza fechas variadas a `YYYY-MM-DD`. Lo usa el tagger (al generar) y la
  normalización de tags escritos a mano en la web; el filtro de búsqueda recibe
  tags ya normalizados (vía `list_available_tags`), así que no lo necesita.

### 2. Infraestructura

- `llm/llmTagger.ts` (**nuevo**): implementa `Tagger` con `ChatOpenAI` (igual
  patrón que `LlmTitler`). Prompt con ejemplos; pide JSON array de strings.
  Post-proceso: minúsculas, trim, dedupe, recorte a un máximo (p. ej. 8), y
  normaliza entradas que parezcan fecha con `toIsoDate`.
- `vector/qdrantVectorIndex.ts`:
  - `index(...)`: escribir `tags: []` en el payload (se llenan luego con `setTags`).
  - `ensureCollection()`: crear payload index `tags` (keyword).
  - `setTags(fileId, tags, userId)`: `setPayload` filtrando por `fileId`+`userId`
    (mismo patrón que `renameFile`).
  - `search(...)`: si llegan `tags`, añadir al `filter.must` un
    `{ key: "tags", match: { any: tags } }`.
- `persistence/sqliteDocumentRepository.ts`:
  - `CREATE TABLE files`: columna `tags`.
  - `INSERT` / `mapRow`: serializar/parsear JSON de tags.
  - `setTags(id, tags)` y `listTags(userId)` (distintos sobre el JSON).
- `persistence/sqliteNoteRepository.ts`: análogo (columna `tags`, `setTags`,
  `listTags`).

### 3. Casos de uso — `src/application/`

- `embedAndIndex.ts`: **sin cambios** (los tags no se pasan al indexar; se
  aplican después con `vectorIndex.setTags`).
- `safeGenerateTags.ts` (**nuevo**): wrapper best-effort sobre `Tagger` (devuelve
  `[]` si no hay tagger o si falla), espejo de `safeGenerateTitle`.
- `indexPdf.ts` / `indexImage.ts` / `indexNote.ts`:
  - Recibir un `Tagger | null` opcional.
  - Tras indexar con éxito y sobre el mismo `sourceText` que usa el título (en
    PDF, el de OCR si hizo falta): generar tags best-effort y aplicarlos con
    `repo.setTags` / `notes.setTags` + `vectorIndex.setTags`. Mismo lugar y
    patrón que la asignación del título (`applyName` / bloque de rename).
- `askQuestion.ts`:
  - `search_medical_records`: nuevo parámetro opcional `tags: string[]`; se pasa a
    `vectorIndex.search`. Cada resultado incluye `tags` en el JSON devuelto.
  - Nueva herramienta `list_available_tags`: devuelve los tags distintos del
    usuario (unión de `repo.listTags` + `notes.listTags`) para que el modelo sepa
    qué puede filtrar. Requiere inyectar `NoteRepository` en `AskQuestion`.
  - Actualizar `SYSTEM_PROMPT`: explicar tags y cuándo filtrar por ellos.

### 4. UI web — `src/infrastructure/web/webServer.ts`

**Archivos**
- Render: chips de tags por fila de archivo, con botón para agregar (input) y
  quitar (✕ por chip).
- Filtro: clic en un chip filtra la lista local por ese tag (además del buscador).
- Nuevo endpoint `PATCH /api/files/:id/tags` con body `{ tags: string[] }` →
  normaliza (minúsculas, trim, dedupe, cap) → `repo.setTags(id, tags)` +
  `vectorIndex.setTags(id, tags, userId)`.
- `/api/files` ya devuelve `FileRecord`, que ahora incluye `tags`.

**Notas** (la web hoy no lista notas — se agrega)
- Nueva sección "Notas" (otra `card`) que lista las notas del usuario con su
  título, un extracto del texto y chips de tags editables.
- Endpoints nuevos:
  - `GET /api/notes` → `notes.list(userId)` (cada `Note` ahora incluye `tags`).
  - `PATCH /api/notes/:id/tags` con body `{ tags: string[] }` → normaliza →
    `notes.setTags(id, tags)` + `vectorIndex.setTags(id, tags, userId)` (las
    notas se indexan en Qdrant bajo `note.id`, así que `setTags` funciona igual).
  - `DELETE /api/notes/:id` → `DeleteNote` (borra nota + vectores).
- La creación de notas sigue siendo por Telegram (botón **Nota**); la web solo
  lista / edita tags / borra.
- `webServer.ts` recibe ahora también `notes` (NoteRepository), `deleteNote`
  (DeleteNote) y `vectorIndex` (para `setTags`).

### 5. Wiring — `src/main.ts`

- Construir `LlmTagger` cuando haya `deepseekApiKey` (igual que `LlmTitler`);
  `null` si no.
- Inyectar el tagger en `IndexPdf`, `IndexImage`, `IndexNote`.
- Inyectar `notes` (NoteRepository) en `AskQuestion`.
- Pasar `notes`, `deleteNote` y `vectorIndex` a `startWebServer` (para listar /
  editar tags / borrar notas desde la web).

## Telegram

- Los archivos/notas se auto-taggean al indexar (sin cambios de flujo para el
  usuario). Mostrar los tags en `replyFilesList` (opcional, mejora de lectura).
- **Edición manual de tags**: vive en la UI web, tanto para archivos como para
  notas (la web ahora lista notas — ver sección 4).

## Validación

- `bun run typeCheck` debe pasar sin errores.
- `./reset.sh` para recrear el esquema SQLite + la colección Qdrant con el nuevo
  payload index.
- Prueba manual: subir un PDF → ver tags auto-generados en la UI; editar tags;
  crear una nota por Telegram → verla en la web y editar sus tags / borrarla;
  preguntar al bot algo que se beneficie del filtro (ej. "exámenes de orina").

## Decisiones resueltas / menores

- **Tags de notas en la web**: sí, la web listará notas y permitirá editar sus
  tags y borrarlas (sección 4). La creación sigue por Telegram.
- **Generación de tags**: tagger separado (espejo de `LlmTitler`), no se combina
  con la generación del título.
- **Límite de tags por documento**: recortar a 8 en el post-proceso del tagger
  para evitar ruido.
- **Tags escritos a mano (web)**: el servidor los normaliza (minúsculas, trim,
  dedupe, cap a 8; fechas vía `toIsoDate`) antes de persistir.
