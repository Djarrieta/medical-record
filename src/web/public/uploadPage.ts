/**
 * HTML for the LAN-only drag-and-drop upload page (plan §8).
 * The token is embedded so the page can POST back to the right session.
 */

export function uploadPageHtml(token: string): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Subir documentos médicos</title>
<style>
  :root { font-family: system-ui, sans-serif; }
  body { margin: 0; background: #0f172a; color: #e2e8f0; display: flex; min-height: 100vh; align-items: center; justify-content: center; }
  .card { width: min(560px, 92vw); background: #1e293b; border-radius: 16px; padding: 28px; box-shadow: 0 10px 40px rgba(0,0,0,.4); }
  h1 { font-size: 1.25rem; margin: 0 0 6px; }
  p.sub { margin: 0 0 20px; color: #94a3b8; font-size: .9rem; }
  #drop { border: 2px dashed #475569; border-radius: 12px; padding: 40px 20px; text-align: center; color: #94a3b8; cursor: pointer; transition: .15s; }
  #drop.drag { border-color: #38bdf8; background: #0b2536; color: #e2e8f0; }
  #list { list-style: none; padding: 0; margin: 18px 0 0; }
  #list li { display: flex; justify-content: space-between; gap: 10px; padding: 8px 12px; background: #0f172a; border-radius: 8px; margin-bottom: 8px; font-size: .85rem; }
  .ok { color: #4ade80; } .err { color: #f87171; } .pending { color: #fbbf24; }
  input[type=file] { display: none; }
</style>
</head>
<body>
  <div class="card">
    <h1>📤 Subir documentos médicos</h1>
    <p class="sub">Arrastra PDF, imágenes o texto. Solo accesible en tu red local. El enlace caduca pronto.</p>
    <div id="drop">Arrastra archivos aquí o <strong>haz clic para elegir</strong></div>
    <input id="file" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff,.txt,.md,.csv" />
    <ul id="list"></ul>
  </div>
<script>
  const token = ${JSON.stringify(token)};
  const drop = document.getElementById('drop');
  const fileInput = document.getElementById('file');
  const list = document.getElementById('list');

  drop.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => upload(fileInput.files));
  ['dragenter','dragover'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave','drop'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.remove('drag'); }));
  drop.addEventListener('drop', ev => upload(ev.dataTransfer.files));

  function addRow(name) {
    const li = document.createElement('li');
    const span = document.createElement('span'); span.textContent = name;
    const status = document.createElement('span'); status.className = 'pending'; status.textContent = 'subiendo…';
    li.append(span, status); list.appendChild(li);
    return status;
  }

  async function upload(files) {
    for (const file of files) {
      const status = addRow(file.name);
      const form = new FormData();
      form.append('file', file);
      try {
        const res = await fetch('/api/upload/' + token, { method: 'POST', body: form });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'error');
        status.className = 'ok';
        status.textContent = json.status === 'duplicate' ? 'ya existía' : 'recibido, procesando';
      } catch (err) {
        status.className = 'err';
        status.textContent = err.message;
      }
    }
  }
</script>
</body>
</html>`;
}
