# 🖤 Noemi 15 — Fotos del cumple → Google Drive

Web para que los invitados suban fotos/videos desde el celular y vean una
galeria en vivo (estilo Instagram: likes y comentarios). Las fotos quedan
guardadas automaticamente en una carpeta de Google Drive.

## Como funciona

- `public/index.html`: galeria + formulario de subida, mobile-friendly.
- `server.js`: recibe el archivo, lo sube a Drive con una **cuenta de
  servicio de Google** (los invitados no necesitan iniciar sesion), y guarda
  los likes/comentarios en `data/photos.json`.

## 1. Crear la cuenta de servicio de Google (una sola vez, ~5 min)

1. Entra a https://console.cloud.google.com/ y crea un proyecto (o usa uno existente).
2. Ve a **APIs & Services → Library**, busca "Google Drive API" y actívala.
3. Ve a **APIs & Services → Credentials → Create Credentials → Service Account**.
   - Dale cualquier nombre, ej. `fotos-noemi`.
   - No necesita roles de proyecto, puedes omitir ese paso.
4. Abre la cuenta de servicio creada → pestaña **Keys → Add Key → Create new key → JSON**.
   Se descarga un archivo `.json`.
5. Copia el email de la cuenta de servicio (algo como
   `fotos-noemi@tu-proyecto.iam.gserviceaccount.com`).

## 2. Compartir la carpeta de Drive

1. En tu Google Drive, crea (o elige) la carpeta donde quieres que caigan las fotos.
2. Click derecho → **Compartir** → agrega el email de la cuenta de servicio (paso 1.5)
   con permiso de **Editor**.
3. Copia el ID de la carpeta desde la URL:
   `https://drive.google.com/drive/folders/ESTE_ES_EL_ID`

## 3. Configurar las variables de entorno

```bash
cp .env.example .env
```

Edita `.env`:

- `GOOGLE_SERVICE_ACCOUNT_KEY`: pega el **contenido completo** del JSON descargado
  (todo en una línea).
- `DRIVE_FOLDER_ID`: el ID de la carpeta del paso 2.
- `EVENT_PIN` (opcional): un PIN corto si quieres evitar que gente ajena al link suba fotos.

## 4. Ejecutar localmente

```bash
npm install
npm start
```

Abre http://localhost:3000 para probarlo.

## 5. Desplegar en produccion (Render o Railway, gratis)

1. Sube este repo a GitHub (ya está listo aquí).
2. En Render/Railway: "New Web Service" → conecta el repo → carpeta raíz: `.` →
   Build: `npm install` → Start: `npm start`.
3. Agrega las mismas variables de entorno del paso 3 en el panel del servicio.
4. Te dan una URL pública fija — compártela por WhatsApp o genera un QR con esa URL.

## Notas

- Límite de archivo: 25 MB por foto/video (configurable en `server.js`).
- Cada foto/video subido se marca como "cualquiera con el link puede ver" en
  Drive, para poder mostrarlo en la galería pública.
- Los likes y comentarios se guardan en `data/photos.json` en el disco del
  servidor. En el plan gratuito de Render/Railway ese disco no es
  permanente (se reinicia en cada deploy), pero se mantiene mientras la app
  está corriendo — suficiente para el día del evento.
- El PIN es opcional y solo protege contra gente fuera del link; no es un login real.
