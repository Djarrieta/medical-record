# Plan: activar la ingesta de correo Hotmail/Outlook

Objetivo: conectar la cuenta personal de Hotmail/Outlook al bot para que lea correos
de remitentes permitidos e indexe adjuntos (PDF/imagen) y cuerpos de correo como notas.

## Contexto importante (leer antes de empezar)

- La app **no corre en este PC**. Corre en **Docker en un servidor Linux**.
- Los datos de conexión al servidor están en el archivo `.env` (NO se sube a git):
  - `DEPLOY_USER` = usuario SSH del servidor
  - `DEPLOY_HOST` = IP/host del servidor
  - `DEPLOY_PATH` = ruta del repo en el servidor
- El repo en el servidor es de **root**, así que `git` y `docker` necesitan `sudo`.
- La función de correo es **opcional**: solo se activa cuando existe `GRAPH_CLIENT_ID` en el `.env` del servidor.
- Estado actual verificado: `GRAPH_CLIENT_ID` **NO está configurado** y **no existe** `data/graph-token.json`. Hay que hacer todo desde cero.
- El flujo de auth es **una sola vez**: después el runtime refresca los tokens solo.

---

## Paso 1 — Registrar la app en Azure (manual, en el navegador)

Esto da el `GRAPH_CLIENT_ID`. Hazlo en el portal; ningún agente puede hacerlo por ti.

1. Entra a https://portal.azure.com con la cuenta de Hotmail/Outlook que quieres leer.
2. Busca **App registrations** → botón **New registration**.
3. Rellena:
   - **Name**: `medical-record-mail`
   - **Supported account types**: elige **"Personal Microsoft accounts only"**
     (esto corresponde a `authority = consumers`, que es el valor por defecto del código).
   - **Redirect URI**: en el desplegable elige **"Public client/native (mobile & desktop)"**
     y escribe exactamente:
     ```
     http://localhost:53682
     ```
4. Click **Register**.
5. En la pantalla **Overview**, copia el **Application (client) ID**.
   Ese valor es tu `GRAPH_CLIENT_ID`. Guárdalo.

## Paso 2 — Configurar permisos y flujo público en Azure (manual)

1. En el menú izquierdo de la app → **API permissions**:
   - Debe aparecer `Mail.Read` (tipo **Delegated**).
   - Si no está: **Add a permission** → **Microsoft Graph** → **Delegated permissions**
     → busca `Mail.Read` → marca → **Add permissions**.
   - (`offline_access` se concede automáticamente al pedir el scope; no hay que añadirlo.)
2. En el menú izquierdo → **Authentication**:
   - Confirma que en **Platform configurations** está la redirect URI `http://localhost:53682`
     bajo "Mobile and desktop applications".
   - Baja hasta **Advanced settings** → **Allow public client flows** → ponlo en **Yes**.
   - Click **Save**.

---

## Paso 3 — Agregar `GRAPH_CLIENT_ID` al `.env` del servidor

> Todos los comandos se ejecutan desde este repo en una terminal **bash** (PC Linux).
> Sustituye `PEGA_AQUI_EL_CLIENT_ID` por el client ID del Paso 1.

1. Carga los datos de conexión desde el `.env` local y agrega la variable al `.env` del servidor:

   ```bash
   u=$(grep '^DEPLOY_USER=' .env | cut -d= -f2- | tr -d '[:space:]')
   h=$(grep '^DEPLOY_HOST=' .env | cut -d= -f2- | tr -d '[:space:]')
   t=$(grep '^DEPLOY_PATH=' .env | cut -d= -f2- | tr -d '[:space:]')
   clientId="PEGA_AQUI_EL_CLIENT_ID"
   ssh -t "$u@$h" "cd $t && echo 'GRAPH_CLIENT_ID=$clientId' | sudo tee -a .env"
   ```

   - Te pedirá la contraseña SSH y luego la de `sudo` (la provees tú; no se escribe en ningún archivo).

2. Verifica que quedó escrita (debe imprimir `1`, sin mostrar el valor):

   ```bash
   ssh -t "$u@$h" "cd $t && sudo grep -c '^GRAPH_CLIENT_ID=' .env"
   ```

---

## Paso 4 — Autorizar la cuenta (`auth:mail`) con túnel SSH

El script `bun run auth:mail` abre un servidor local en `localhost:53682` y espera que
autorices en un navegador. Como el servidor no tiene navegador, **reenviamos ese puerto
por SSH** para autorizar desde el navegador de este PC.

1. Abre el túnel y entra al servidor (deja esta sesión SSH abierta):

   ```bash
   u=$(grep '^DEPLOY_USER=' .env | cut -d= -f2- | tr -d '[:space:]')
   h=$(grep '^DEPLOY_HOST=' .env | cut -d= -f2- | tr -d '[:space:]')
   t=$(grep '^DEPLOY_PATH=' .env | cut -d= -f2- | tr -d '[:space:]')
   ssh -L 53682:localhost:53682 -t "$u@$h"
   ```

2. Ya **dentro del servidor** (el prompt cambió al del servidor), ve al repo y corre el
   script dentro del contenedor de la app (así el token cae directo en `./data`, que está
   montado en Docker):

   ```bash
   cd <DEPLOY_PATH>          # usa la ruta real del servidor
   sudo docker compose exec app bun run auth:mail
   ```

   - Nota: reemplaza `<DEPLOY_PATH>` por la ruta real (la misma de `DEPLOY_PATH`).
   - Si el contenedor `app` no está corriendo, primero arráncalo con `sudo ./start.sh`.

3. El script imprimirá una **URL larga** de `login.microsoftonline.com`. Cópiala.

## Paso 5 — Autorizar en el navegador (en este PC)

1. Pega esa URL en el navegador de tu PC.
2. Inicia sesión con la cuenta de Hotmail/Outlook y acepta los permisos.
3. El navegador redirige a `http://localhost:53682`. Gracias al túnel, ese redirect viaja
   hasta el script en el servidor. Deberías ver el mensaje:
   `✅ Autorización completa. Ya puedes cerrar esta pestaña.`
4. En la terminal SSH, el script debe imprimir:
   `✅ Refresh token guardado en ./data/graph-token.json`
5. Cierra esa sesión SSH con `exit` (ya no necesitas el túnel).

---

## Paso 6 — Verificar que quedó activo

1. Confirma que el token existe en el servidor:

   ```bash
   u=$(grep '^DEPLOY_USER=' .env | cut -d= -f2- | tr -d '[:space:]')
   h=$(grep '^DEPLOY_HOST=' .env | cut -d= -f2- | tr -d '[:space:]')
   t=$(grep '^DEPLOY_PATH=' .env | cut -d= -f2- | tr -d '[:space:]')
   ssh -t "$u@$h" "cd $t && sudo ls -la data/graph-token.json"
   ```

2. Reinicia el contenedor para que tome el nuevo `GRAPH_CLIENT_ID` y active el polling:

   ```bash
   ssh -t "$u@$h" "cd $t && sudo ./start.sh"
   ```

3. Revisa los logs: deberías ver una línea tipo
   `Mail ingestion enabled (poll every Ns).`

   ```bash
   ssh -t "$u@$h" "cd $t && sudo docker compose logs --tail=60 app"
   ```

4. **Importante — agregar remitentes permitidos**: el bot solo ingiere correos de remitentes
   en la *allowlist*. En Telegram, abre el bot, toca el botón **Correos** → **Agregar** y añade
   las direcciones permitidas (acepta dirección exacta `alguien@dominio.com` o dominio entero
   `@dominio.com`). Sin esto, ningún correo se procesará.

---

## Variables de entorno relacionadas (opcionales, ya tienen defaults)

Solo agrégalas al `.env` del servidor si quieres cambiar los valores por defecto:

- `GRAPH_AUTHORITY` — default `consumers` (cuentas personales). Déjalo así.
- `GRAPH_TOKEN_PATH` — default `./data/graph-token.json`.
- `MAIL_POLL_SECONDS` — cada cuántos segundos revisa el correo.
- `MAIL_USER_ID` — id de Telegram bajo el que se guardan los documentos/notas ingeridos.

## Si algo falla

- **`sudo: a terminal is required`** → asegúrate de usar `ssh -t` (con la opción `-t`).
- **`detected dubious ownership`** (git) → corre una vez:
  `sudo git config --global --add safe.directory <DEPLOY_PATH>`.
- **El navegador no llega a `localhost:53682`** → la sesión SSH con `-L 53682:localhost:53682`
  debe seguir abierta mientras autorizas.
- **`AADSTS...` / error de redirect** → revisa que en Azure la redirect URI sea exactamente
  `http://localhost:53682` y que "Allow public client flows" esté en **Yes**.
- **Logs no muestran "Mail ingestion enabled"** → el `GRAPH_CLIENT_ID` no está en el `.env`
  del servidor o el contenedor no se reinició (`sudo ./start.sh`).
