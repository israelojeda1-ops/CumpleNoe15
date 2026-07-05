require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const stream = require('stream');

const PORT = process.env.PORT || 3000;
const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID;
const EVENT_PIN = process.env.EVENT_PIN || '';
const DATA_FILE = path.join(__dirname, 'data', 'photos.json');
const UPLOADS_DIR = path.join(__dirname, 'data', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Si no hay credenciales de Google configuradas todavia, la app sigue
// funcionando: guarda las fotos localmente para que la galeria funcione hoy
// mismo, y quedan listas para sincronizarse a Drive en cuanto se agreguen
// GOOGLE_SERVICE_ACCOUNT_KEY y DRIVE_FOLDER_ID (ver README).
function loadServiceAccountCredentials() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return require(path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS));
  }
  return null;
}

const driveEnabled = Boolean(DRIVE_FOLDER_ID && loadServiceAccountCredentials());
let drive = null;
if (driveEnabled) {
  const auth = new google.auth.GoogleAuth({
    credentials: loadServiceAccountCredentials(),
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  drive = google.drive({ version: 'v3', auth });
} else {
  console.warn(
    'GOOGLE_SERVICE_ACCOUNT_KEY / DRIVE_FOLDER_ID no configurados: las fotos se guardan localmente en data/uploads.'
  );
}

// --- Almacen simple de metadata (fotos, likes, comentarios) en un archivo JSON. ---
// Las escrituras se serializan con una cola para evitar corromper el archivo
// cuando varios invitados suben/comentan al mismo tiempo.
fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });

let photos = [];
try {
  photos = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
} catch {
  photos = [];
}

let writeQueue = Promise.resolve();
function persist() {
  writeQueue = writeQueue.then(
    () => fs.promises.writeFile(DATA_FILE, JSON.stringify(photos, null, 2)),
    () => fs.promises.writeFile(DATA_FILE, JSON.stringify(photos, null, 2))
  );
  return writeQueue;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten fotos o videos'));
    }
  },
});

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/api/config', (req, res) => {
  res.json({ pinRequired: Boolean(EVENT_PIN) });
});

app.use('/uploads', express.static(UPLOADS_DIR));

app.get('/api/photos', (req, res) => {
  const feed = [...photos]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((p) => ({
      id: p.id,
      guestName: p.guestName,
      mimeType: p.mimeType,
      driveFileId: p.driveFileId,
      localUrl: p.localFile ? `/uploads/${p.localFile}` : null,
      createdAt: p.createdAt,
      likes: p.likes,
      comments: p.comments,
    }));
  res.json(feed);
});

app.post('/api/upload', upload.single('photo'), async (req, res) => {
  try {
    if (EVENT_PIN && req.body.pin !== EVENT_PIN) {
      return res.status(401).json({ error: 'PIN incorrecto' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibio ningun archivo' });
    }

    const guestName = (req.body.guestName || 'Invitado').trim().slice(0, 60) || 'Invitado';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = guestName.replace(/[^a-zA-Z0-9 _-]/g, '') || 'Invitado';
    const extension = path.extname(req.file.originalname) || '';
    const fileName = `${safeName} - ${timestamp}${extension}`;

    const localFile = `${crypto.randomUUID()}${extension}`;
    await fs.promises.writeFile(path.join(UPLOADS_DIR, localFile), req.file.buffer);

    let driveFileId = null;
    if (driveEnabled) {
      const bufferStream = new stream.PassThrough();
      bufferStream.end(req.file.buffer);

      const driveResponse = await drive.files.create({
        requestBody: {
          name: fileName,
          parents: [DRIVE_FOLDER_ID],
        },
        media: {
          mimeType: req.file.mimetype,
          body: bufferStream,
        },
        fields: 'id, name',
      });
      driveFileId = driveResponse.data.id;

      // Hace el archivo visible via link para poder mostrarlo en la galeria publica.
      await drive.permissions.create({
        fileId: driveFileId,
        requestBody: { role: 'reader', type: 'anyone' },
      });
    }

    const photo = {
      id: crypto.randomUUID(),
      driveFileId,
      localFile,
      guestName,
      mimeType: req.file.mimetype,
      createdAt: new Date().toISOString(),
      likes: 0,
      comments: [],
    };
    photos.push(photo);
    await persist();

    res.json({ ok: true, id: photo.id, fileId: driveFileId, fileName });
  } catch (err) {
    console.error('Error subiendo la foto:', err);
    res.status(500).json({ error: 'No se pudo subir la foto. Intenta de nuevo.' });
  }
});

app.post('/api/photos/:id/like', async (req, res) => {
  const photo = photos.find((p) => p.id === req.params.id);
  if (!photo) return res.status(404).json({ error: 'Foto no encontrada' });
  photo.likes += 1;
  await persist();
  res.json({ ok: true, likes: photo.likes });
});

app.post('/api/photos/:id/comments', async (req, res) => {
  const photo = photos.find((p) => p.id === req.params.id);
  if (!photo) return res.status(404).json({ error: 'Foto no encontrada' });

  const author = (req.body.author || 'Invitado').trim().slice(0, 60) || 'Invitado';
  const text = (req.body.text || '').trim().slice(0, 300);
  if (!text) return res.status(400).json({ error: 'El comentario esta vacio' });

  const comment = { id: crypto.randomUUID(), author, text, createdAt: new Date().toISOString() };
  photo.comments.push(comment);
  await persist();
  res.json({ ok: true, comment });
});

app.listen(PORT, () => {
  console.log(`Servidor listo en http://localhost:${PORT}`);
});
