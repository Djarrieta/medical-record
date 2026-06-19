# Plan: aislamiento de datos y UI web por usuario

Objetivo: que cada `ALLOWED_USER_ID` tenga (1) su propia carpeta de archivos en disco y (2) una URL web única y privada, de modo que cada usuario solo vea, busque y suba sus propios documentos.

## Decisiones acordadas

- **Identidad web por sesión (con vencimiento)**: el link deja de ser un token permanente. Pasa a `/.../u/<userId>?token=<sessionToken>`, donde `sessionToken` es un **secreto aleatorio de sesión** (32 bytes) guardado en memoria. El link **vence por inactividad**: cuando la sesión expira, el token deja de funcionar (401) y la conversación se borra.
- **Conversaciones con memoria (solo Telegram)**: el asistente recuerda los turnos previos de la misma sesión (multi-turno) **en Telegram**. La web es **solo carga/administración de archivos** (sin chat); comparte la sesión únicamente para autenticar el token. El historial vive en la sesión y se borra cuando esta vence.
- **Sesión auto-creada**: cualquier interacción autorizada en el bot **crea la sesión si no existe** (vía `touch` en el middleware de auth), de modo que la memoria funciona aunque el usuario nunca pida el link de carga.
- **Vencimiento por inactividad con aviso previo (dos fases)**: tras `SESSION_TTL` sin interacción la sesión se cierra. Antes del cierre, a falta de `SESSION_WARNING_GRACE` segundos, el asistente **avisa** ("tu sesión está por cerrarse; escribe algo para mantenerla activa"). Cualquier interacción reinicia el contador y limpia el aviso.
- **Carpetas**: `data/files/<userId>/<uuid>.<ext>`.
- **Aislamiento total**: SQLite, Qdrant (RAG/búsqueda), web y bot filtran SIEMPRE por `userId`. Cada usuario solo accede a lo suyo.
- **Datos existentes**: se resetea con `./reset.sh` (no hay migración).

## Estado actual (diagnóstico)

El `userId` se guarda en SQLite pero **nunca se usa para filtrar**:

- `data/files/<uuid>.<ext>` plano, sin separación por usuario.
- `SqliteDocumentRepository.list()/get()` devuelven TODO sin filtrar por usuario.
- Qdrant: colección única `documents`, los vectores **no** llevan `userId` en el payload; `search()` no filtra.
- Web: `WEB_PASSWORD` compartido; uploads quedan con `userId: 0` fijo; `/api/files` lista todo.
- `AskQuestion` busca en todos los vectores sin filtro de usuario.
- Bot `/List` muestra archivos de todos.

## Cambios por capa

### 1. Configuración — `src/infrastructure/config.ts` + `.env`

- El **token de sesión es un secreto aleatorio del lado servidor** (no HMAC), así que ya **no hace falta `WEB_TOKEN_SECRET`**. Se descarta esa variable del plan anterior.
- Nuevas variables de sesión (con valores por defecto razonables):
  - `SESSION_TTL_SECONDS` (p. ej. `1800` = 30 min): inactividad total antes de cerrar la sesión.
  - `SESSION_WARNING_GRACE_SECONDS` (p. ej. `120`): cuántos segundos antes del cierre se envía el aviso. Debe ser `< SESSION_TTL_SECONDS`.
  - `SESSION_SWEEP_SECONDS` (p. ej. `30`): cada cuánto corre el barrido que avisa/cierra sesiones.
- Añadir `sessionTtlMs`, `sessionWarningGraceMs`, `sessionSweepMs` a `BotConfig` (convertidos a ms).
- `.env.example` y `.env`: documentar las tres variables y el formato de `WEB_URL` (base sin token; el bot añade `/u/<userId>?token=...`).
- `WEB_PASSWORD` queda **obsoleto/eliminado** (la auth pasa a ser por token de sesión por usuario).

### 2. Dominio — `src/domain/types.ts` y `src/domain/ports.ts`

- `ChunkMetadata`: añadir `userId: number` (para etiquetar vectores y poder filtrar en Qdrant).
- Nuevos tipos para conversaciones/sesiones en `types.ts`:
  - `ConversationMessage { role: "user" | "assistant"; content: string; createdAt: string }`.
  - `Session { userId: number; token: string; createdAt: string; lastActivityAt: string; warned: boolean }`.
- Nuevo port `SessionStore` (interfaz que la infraestructura implementa):
  - `getOrCreate(userId: number): Session` — crea sesión + token aleatorio si no hay una activa.
  - `getByToken(userId: number, token: string): Session | null` — para validar el link web (devuelve null si no existe o venció).
  - `touch(userId: number): Session` — **crea la sesión si no existe**, reinicia `lastActivityAt` y pone `warned = false` (cualquier interacción). Devuelve la sesión vigente.
  - `appendMessage(userId: number, msg: ConversationMessage): void` y `history(userId: number): ConversationMessage[]`.
  - `close(userId: number): void` — borra historial e invalida token.
  - `dueForWarning(now): Session[]` y `dueForClose(now): Session[]` — usados por el barrido.
  - `markWarned(userId: number): void`.
- `Llm` (port): añadir historial. `answer(systemPrompt, history: ConversationMessage[], userMessage, tools)`.
- `DocumentRepository` (port): cambiar firmas para que reciban/filtren por usuario:
  - `list(userId: number): FileRecord[]`
  - `get(id: string, userId: number): FileRecord | null` — **decisión**: la firma lleva `userId` y TODOS los call sites lo pasan (incluidos los internos de `AskQuestion.sendTool` y `DeleteDocument`), no se valida "en el caller".
  - `saveStream(userId, ...)` se **mantiene** (ya recibe `userId`); guarda en la carpeta del usuario igual que `save`.
  - `findByContent(buffer, userId)` (dedup por usuario, no global).
  - `delete(id, userId)` (solo borra si pertenece al usuario).
- `VectorIndex` (port):
  - `index(chunks, vectors, fileId, fileName, userId)`.
  - `search(vector, userId, topK)` → con filtro por `userId`.
  - `deleteByFileId(fileId, userId)` — **decisión**: añadir `userId` al filtro (`must` con `fileId` **y** `userId`) como defensa extra contra IDOR.

### 3. Persistencia — `src/infrastructure/persistence/sqliteDocumentRepository.ts`

- Guardar archivos en `data/files/<userId>/<uuid>.<ext>` (crear subcarpeta por usuario en `save` **y** `saveStream`, que se mantiene).
- `list(userId)`: `WHERE user_id = ?`.
- `get(id, userId)`: validar pertenencia (`WHERE id = ? AND user_id = ?`).
- `findByContent(buffer, userId)`: dedup acotada al usuario (`WHERE sha256 = ? AND user_id = ?`).
- `delete(id, userId)`: borrar solo si pertenece al usuario (usa `get(id, userId)` internamente).
- Índice SQL: `idx_files_user` sobre `user_id`.
- **Reset limpio (decisión)**: eliminar los bloques de migración existentes (`PRAGMA table_info` + `ALTER TABLE` para `indexed`/`sha256`); dejar solo el `CREATE TABLE IF NOT EXISTS` final con todas las columnas (`user_id`, `indexed`, `sha256`). Como se resetea con `./reset.sh`, no hay bases viejas que migrar.

### 4. Vector index — `src/infrastructure/vector/qdrantVectorIndex.ts`

- `index(...)`: incluir `userId` en el payload de cada punto.
- `search(vector, userId, topK)`: añadir `filter.must` con `{ key: "userId", match: { value: userId } }`.
- `deleteByFileId(fileId, userId)`: `filter.must` con `fileId` **y** `userId`.
- Crear índice de payload en Qdrant sobre `userId` (para que el filtro sea eficiente) en `ensureCollection()`.

### 5. Casos de uso — `src/application/`

- **`indexPdf.ts`**: `IndexPdfInput` añade `userId`; pasarlo a `vectorIndex.index(...)` y a `repo.setIndexed`/dedup donde aplique.
- **`askQuestion.ts`**: `run(question, userId)`; pasar `userId` a `vectorIndex.search(..., userId, ...)` y al `repo.get(fileId, userId)` interno del `sendTool`. **Memoria de conversación**: antes de llamar al LLM, cargar `sessionStore.history(userId)` y pasarlo a `llm.answer(systemPrompt, history, question, tools)`; después, hacer `appendMessage` del turno del usuario y de la respuesta. **Decisión sobre la respuesta "limpia"**: el `answer` del LLM ya viene sin pie de "Fuentes:" (ese pie/los documentos los arma y envía el bot, no el caso de uso), así que se guarda el `answer` tal cual, sin lógica extra de stripping. Inyectar `SessionStore` en el constructor. No necesita `getOrCreate`: el middleware del bot ya garantiza una sesión vigente antes de invocar el caso de uso.
- **`deleteDocument.ts`**: `run(id, userId)`; el `repo.get` interno pasa a `get(id, userId)` y se valida pertenencia antes de borrar archivo + vectores (`deleteByFileId(id, userId)`).

### 6. Bot Telegram — `src/infrastructure/telegram/botApp.ts`

- Ya tiene `ctx.from!.id`; propagarlo a TODAS las llamadas: `save`, `list(userId)`, `findByContent(buffer, userId)` (en `:document`), `repo.get(pending.recordId, userId)` (flujo de contraseña), `indexPdf.run({..., userId})`, `askQuestion.run(text, userId)`, `delete(id, userId)`.
- **Marcar actividad / auto-crear sesión**: llamar `sessionStore.touch(userId)` en el **middleware de auth**, de modo que CUALQUIER interacción autorizada (texto, PDF, foto, comando) reinicie el contador, limpie el aviso y **cree la sesión si no existía**. Así la memoria de conversación funciona aunque el usuario nunca pida el link de carga.
- Botón/respuesta **"Upload"**: generar el link de la **sesión activa** del usuario:
  `${webUrl}/u/${userId}?token=${sessionStore.getOrCreate(userId).token}`.
- **Cambio de constructor**: `BotApp` recibe ahora también el `SessionStore` (para `touch`, generar el link con token y enviar aviso/cierre). Ajustar la firma del constructor y el wiring en `main.ts`.
- **Aviso y cierre por inactividad** (lo dispara el barrido, ver sección nueva): el bot expone un **método público `notify(userId, text)`** que usa `this.bot.api.sendMessage(userId, text)` (en chats privados `chatId === userId`). Lo invoca el barrido desde `main.ts`:
  - Aviso: `⏳ Tu sesión está por cerrarse por inactividad. Escribe algo para mantenerla activa; de lo contrario se borrará esta conversación (y el enlace de carga dejará de funcionar).`
  - Cierre: `🔒 Sesión cerrada por inactividad: se borró esta conversación. El enlace de carga, si lo tenías abierto, también venció.`
- `/List`: filtrar por `userId`.

### 7. Servidor web — `src/infrastructure/web/webServer.ts`

- **Eliminar por completo `WEB_PASSWORD`** (decisión): quitar `password` de `WebServerOptions`, la función `getPassword(...)`, el parámetro `passwordRequired`/campo de contraseña del HTML, el header `X-Password` y el `?password=`. Su lugar lo toma el token de sesión.
- Reemplazar la auth por `WEB_PASSWORD` por **auth por token de sesión**:
  - Ruta principal `GET /u/:userId` con `?token=`. Verificar `sessionStore.getByToken(userId, token)`; si es null (no existe o venció) → 401.
  - Cada request válido hace `sessionStore.touch(userId)` (abrir/usar la web cuenta como actividad y mantiene viva la sesión).
  - Resolver `userId` desde la URL (no más `userId: 0`).
  - Todas las rutas API pasan a operar bajo el `userId` autenticado:
    - `GET /api/files` → `repo.list(userId)`.
    - `GET /api/files/:id/raw` → `repo.get(id, userId)` (404 si no es suyo).
    - `DELETE /api/files/:id` → `deleteDocument.run(id, userId)`.
    - `POST /upload` → `repo.save(userId, ...)` + `indexPdf.run({..., userId})`.
  - El token viaja en cada request del front. Cuando la sesión vence, las APIs devuelven 401 y el front muestra "sesión expirada".
  - `GET /` (sin `userId`) responde 404 (texto neutro); el único punto de entrada válido es `/u/<userId>?token=...`.
- **Transporte de auth (query params)**: el front lee `userId` + `token` de la URL (`/u/<userId>?token=...`) y los envía como **query params** en cada llamada (`/api/files`, `/api/files/:id/raw`, `/upload`, `DELETE /api/files/:id`). Se usa query y no headers porque "Ver/descargar" abre el archivo con `window.open`, que no puede fijar headers. Se elimina el `?password=` anterior.
- Ajustar el HTML/JS embebido: leer `userId` + `token` de la URL y mandarlos en cada fetch (en vez de `password`); ante un 401 mostrar aviso de sesión expirada.

### 8. Composición — `src/main.ts`

- Construir el `SessionStore` **en memoria** con `cfg.sessionTtlMs` / `sessionWarningGraceMs` e inyectarlo en `AskQuestion`, `BotApp` y `startWebServer`. (Reiniciar el proceso borra sesiones y conversaciones; persistir queda fuera de alcance.)
- Arrancar el **barrido de sesiones** (`setInterval` cada `sessionSweepMs`): por cada sesión en `dueForWarning` que no fue avisada → `bot.notify(userId, avisoMsg)` + `markWarned`; por cada sesión en `dueForClose` → `sessionStore.close(userId)` + `bot.notify(userId, cierreMsg)`. Guardar el id del intervalo y limpiarlo (`clearInterval`) en SIGINT/SIGTERM junto al `bot.stop()`.

## Sesiones y conversaciones (memoria + vencimiento por inactividad)

Nueva pieza de infraestructura: `SessionStore` (p. ej. `src/infrastructure/session/sessionStore.ts`), un adaptador que implementa el port `SessionStore`.

- **Una sesión por usuario.** Estructura: `{ userId, token, createdAt, lastActivityAt, warned, messages: ConversationMessage[] }`.
- **Token**: secreto aleatorio (`crypto.randomBytes(32).toString("hex")`) generado al crear la sesión. Es lo que viaja en el link web `/u/<userId>?token=...`.
- **Almacenamiento**: empezar **en memoria** (`Map<userId, Session>`) por simplicidad; la conversación es efímera y se borra al vencer. (Opción futura: persistir en SQLite `data/sessions.db` si se quiere sobrevivir reinicios.)
- **Memoria de conversación**: `appendMessage` agrega cada turno (user/assistant); `history(userId)` lo devuelve para que `AskQuestion` lo inyecte en el LLM. Tope fijo de los **últimos 20 mensajes** (~10 turnos) para no inflar el prompt; se guarda la respuesta **limpia** (sin el pie de "Fuentes:").

### Ciclo de vida (dos fases)

`SESSION_TTL = inactividad total`; `SESSION_WARNING_GRACE = segundos antes del cierre para avisar`.

1. **Actividad** (texto/PDF/foto/comando en el bot, o cualquier request web válido) → `touch(userId)`: **crea la sesión si no existe**, fija `lastActivityAt = now`, `warned = false`. Esto reinicia ambos plazos.
2. **Aviso** (barrido): si `now - lastActivityAt >= SESSION_TTL - SESSION_WARNING_GRACE` y `!warned` → el bot envía el mensaje de aviso y se marca `warned = true`.
3. **Cierre** (barrido): si `now - lastActivityAt >= SESSION_TTL` → `close(userId)`: borrar `messages`, invalidar `token` (eliminar la sesión). El bot envía el mensaje de cierre. A partir de ahí el link da 401 y la siguiente interacción crea una sesión nueva sin memoria previa.
4. Si el usuario interactúa **después del aviso** pero antes del cierre, `touch` cancela el cierre y limpia `warned`.

### Notas de diseño

- El aviso/cierre se envían por **Telegram** (chat privado: `chatId === userId`). La web no tiene chat: solo reacciona al 401 (en operaciones de archivos) mostrando "sesión expirada".
- El barrido vive en `main.ts` y usa el bot para enviar mensajes; mantener el `SessionStore` desacoplado del bot (no importa grammY).
- Valores de prueba bajos (p. ej. TTL 60s, grace 20s, sweep 5s) para validar rápido; valores reales por `.env`.

## Seguridad

- Token de sesión = secreto aleatorio (32 bytes, `crypto.randomBytes`). Comparación en tiempo constante (`crypto.timingSafeEqual`) **con guarda de longitud**: si los tokens difieren en largo → 401 sin comparar (porque `timingSafeEqual` lanza con buffers de distinto tamaño).
- Verificar pertenencia (`user_id`) en TODAS las rutas que reciben un `id` (archivos y borrado) para evitar IDOR.
- El token va en la URL: queda en logs/historial. Mitigación: el token **vence por inactividad** (acota la ventana de exposición). Mejora futura: cookie `HttpOnly` tras el primer acceso (no en este alcance).
- La conversación se **borra** al cerrar la sesión: no quedan datos clínicos en historiales antiguos.

## Orden de implementación sugerido

1. `config.ts` + `.env`/`.env.example` (`SESSION_TTL_SECONDS`, `SESSION_WARNING_GRACE_SECONDS`, `SESSION_SWEEP_SECONDS`).
2. Dominio: `types.ts` (`ChunkMetadata.userId`, `ConversationMessage`, `Session`), `ports.ts` (`SessionStore`, `Llm.answer` con historial, firmas con `userId`).
3. Persistencia: carpetas por usuario + filtros SQL.
4. `SessionStore` (infraestructura): store de sesiones + historial + token aleatorio + barrido (avisar/cerrar).
5. Qdrant: payload `userId` + filtro en `search` + payload index.
6. LLM: `DeepseekLlm.answer` mapea el historial a mensajes Human/AI antes del turno actual.
7. Casos de uso: `indexPdf`, `askQuestion` (memoria), `deleteDocument`.
8. Bot: propagar `userId` + `touch` en cada interacción + link de sesión en "Upload" + método para enviar aviso/cierre.
9. Web server: auth por token de sesión + rutas por usuario + HTML/JS (manejo de 401).
10. `main.ts`: wiring + barrido de sesiones (`setInterval`) + apagado limpio.
11. `bun run typeCheck`.
12. `./reset.sh` y prueba end-to-end (aislamiento + conversación multi-turno + aviso/cierre por inactividad).
13. **Desplegar al servidor desde Windows** (ver sección "Despliegue").

## Validación

- `bun run typeCheck` sin errores.
- Prueba manual aislamiento: dos `ALLOWED_USER_ID`; cada uno sube un PDF; verificar carpetas `data/files/<A>/` y `data/files/<B>/`; cada link `/u/<id>` solo muestra/busca lo propio; preguntas RAG no cruzan datos.
- Prueba manual conversación: hacer una pregunta, luego una de seguimiento que dependa de la anterior (p. ej. "¿y la dosis?") y verificar que el asistente usa el contexto previo.
- Prueba manual inactividad: con `SESSION_TTL_SECONDS` y `SESSION_WARNING_GRACE_SECONDS` bajos, esperar sin interactuar → llega el aviso; seguir sin interactuar → llega el cierre, el link `/u/<id>` da 401 y una nueva pregunta empieza sin memoria previa. Interactuar tras el aviso debe cancelar el cierre.

## Despliegue (al terminar)

La app no corre en Windows: vive en Docker en el servidor Linux. Cuando los cambios estén validados (`bun run typeCheck` ok), desplegar siguiendo el skill `deploy-from-windows`:

1. **Validar local**: `bun run typeCheck`.
2. **Commit + push** desde Windows (`git add -A && git commit -m "..." && git push`).
3. **Pull + rebuild en el servidor** por SSH (repo es root-owned, usa `sudo`; carga `DEPLOY_USER`/`DEPLOY_HOST`/`DEPLOY_PATH` desde `.env`):
   `ssh -t "$DEPLOY_USER@$DEPLOY_HOST" "cd $DEPLOY_PATH && sudo git pull && sudo ./start.sh"`.
4. **Como se resetea la base de datos** (sin migración), tras el primer deploy correr `./reset.sh` en el servidor en lugar de `./start.sh`, para limpiar datos viejos incompatibles con el aislamiento por usuario.
5. **Verificar** que los contenedores levantaron: `sudo docker compose logs --tail=60 app` (debe terminar con `medical-record-app Started` y `medical-record-qdrant Healthy`).

## Fuera de alcance (posible siguiente iteración)

- Cookie de sesión para ocultar el token de la URL.
- Persistir sesiones/conversaciones entre reinicios del proceso (si el store es en memoria).
- Resumen automático del historial cuando crece mucho (ventana/condensado de contexto).
- Migración de datos previos (se decidió resetear).
