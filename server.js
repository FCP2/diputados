import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));

async function loadEnv() {
  try {
    const contents = await readFile(join(root, '.env'), 'utf8');
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || match[1] in process.env) continue;
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

await loadEnv();

const port = Number(process.env.PORT || 3000);
const spreadsheetId = process.env.SHEETS_SPREADSHEET_ID;
const sheetNames = {
  locales: process.env.SHEETS_LOCALES_SHEET || 'diputados_locales',
  federales: process.env.SHEETS_FEDERALES_SHEET || 'diputados_federales',
  senadores: process.env.SHEETS_SENADORES_SHEET || 'senadores'
};
const cacheSeconds = Number(process.env.SHEETS_CACHE_SECONDS || 300);
let dataCache = null;
let dataCacheExpiresAt = 0;

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(body));
}

async function loadSheet(sheetName) {
  if (!spreadsheetId || spreadsheetId === 'tu_id_de_spreadsheet') {
    throw new Error('Falta SHEETS_SPREADSHEET_ID en el archivo .env');
  }
  const url = `https://opensheet.elk.sh/${encodeURIComponent(spreadsheetId)}/${encodeURIComponent(sheetName)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Google Sheets respondió ${response.status} para ${sheetName}`);
  return response.json();
}

async function getDeputies() {
  if (dataCache && Date.now() < dataCacheExpiresAt) return dataCache;
  const [locales, federales, senadores] = await Promise.all([
    loadSheet(sheetNames.locales),
    loadSheet(sheetNames.federales),
    loadSheet(sheetNames.senadores)
  ]);
  dataCache = { locales, federales, senadores };
  dataCacheExpiresAt = Date.now() + cacheSeconds * 1000;
  return dataCache;
}

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

async function serveStatic(pathname, res) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const relativePath = requested.startsWith('/img/')
    ? join('/public', requested)
    : requested;
  const filePath = normalize(join(root, relativePath));
  if (!filePath.startsWith(root)) return json(res, 403, { error: 'Acceso denegado' });
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream' });
    res.end(body);
  } catch (error) {
    if (error.code === 'ENOENT') return json(res, 404, { error: 'Recurso no encontrado' });
    json(res, 500, { error: 'No se pudo leer el recurso' });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/diputados') {
    try {
      return json(res, 200, await getDeputies());
    } catch (error) {
      return json(res, 500, { error: error.message });
    }
  }
  if (url.pathname === '/api/health') return json(res, 200, { ok: true });
  return serveStatic(url.pathname, res);
});

server.listen(port, () => {
  console.log(`Directorio disponible en http://localhost:${port}`);
});
