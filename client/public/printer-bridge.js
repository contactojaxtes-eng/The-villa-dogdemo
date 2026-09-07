const net = require('net');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const os = require('os');
const http = require('http');
const https = require('https');

const BRIDGE_VERSION = '1.1.0';
const DEFAULT_BACKEND_URL = 'https://the-villa-dog-backend-production.up.railway.app';
const MAX_LOG_BYTES = 1024 * 1024;
const MAX_LOCAL_RECEIPTS = 500;
const HTTP_TIMEOUT_MS = 15000;

const isPkg = typeof process.pkg !== 'undefined';
const configDir = isPkg ? path.dirname(process.execPath) : __dirname;
const configPath = path.join(configDir, 'config.json');
const logPath = path.join(configDir, 'bridge.log');
const previousLogPath = path.join(configDir, 'bridge.previous.log');
const receiptPath = path.join(configDir, 'printed-pending-confirmation.json');
const lockPath = path.join(configDir, 'bridge.lock');

function stringifyLogPart(value) {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function appendLog(level, values) {
  try {
    if (fs.existsSync(logPath) && fs.statSync(logPath).size >= MAX_LOG_BYTES) {
      try { fs.unlinkSync(previousLogPath); } catch {}
      fs.renameSync(logPath, previousLogPath);
    }
    const line = `${new Date().toISOString()} [${level}] ${values.map(stringifyLogPart).join(' ')}${os.EOL}`;
    fs.appendFileSync(logPath, line, 'utf8');
  } catch {}
}

for (const level of ['log', 'warn', 'error']) {
  const original = console[level].bind(console);
  console[level] = (...values) => {
    original(...values);
    appendLog(level.toUpperCase(), values);
  };
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireSingleInstanceLock() {
  try {
    fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
    return true;
  } catch (error) {
    try {
      const existingPid = Number(fs.readFileSync(lockPath, 'utf8').trim());
      if (processIsAlive(existingPid)) return false;
      fs.unlinkSync(lockPath);
      fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      return true;
    } catch {
      console.error('No se pudo crear el bloqueo de instancia:', error.message);
      return false;
    }
  }
}

if (!acquireSingleInstanceLock()) {
  console.log('El puente ya está ejecutándose. Esta copia se cerrará.');
  process.exit(0);
}

const releaseLock = () => {
  try {
    if (Number(fs.readFileSync(lockPath, 'utf8').trim()) === process.pid) fs.unlinkSync(lockPath);
  } catch {}
};
process.on('exit', releaseLock);
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

let config = {
  backendUrl: DEFAULT_BACKEND_URL,
  bridgeToken: '',
  pollIntervalMs: 3000,
};

if (fs.existsSync(configPath)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
    if (loaded && typeof loaded.backendUrl === 'string' && loaded.backendUrl.trim()) {
      config.backendUrl = loaded.backendUrl.trim();
    }
    if (typeof loaded.bridgeToken === 'string') config.bridgeToken = loaded.bridgeToken.trim();
    if (Number.isFinite(Number(loaded.pollIntervalMs))) {
      config.pollIntervalMs = Math.max(1000, Number(loaded.pollIntervalMs));
    }
  } catch (error) {
    console.error('No se pudo leer config.json:', error.message);
  }
} else {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  } catch (error) {
    console.error('No se pudo crear config.json:', error.message);
  }
}

config.bridgeToken = String(process.env.PRINT_BRIDGE_TOKEN || config.bridgeToken || '').trim();
config.backendUrl = String(config.backendUrl || DEFAULT_BACKEND_URL).trim().replace(/\/$/, '');

let locallyPrinted = new Set();
try {
  const savedReceipts = JSON.parse(fs.readFileSync(receiptPath, 'utf8').replace(/^\uFEFF/, ''));
  if (Array.isArray(savedReceipts)) locallyPrinted = new Set(savedReceipts.map(String).slice(-MAX_LOCAL_RECEIPTS));
} catch {}

function persistLocalReceipts() {
  try {
    const values = Array.from(locallyPrinted).slice(-MAX_LOCAL_RECEIPTS);
    locallyPrinted = new Set(values);
    fs.writeFileSync(receiptPath, JSON.stringify(values), 'utf8');
  } catch (error) {
    console.error('No se pudo guardar el control de impresiones:', error.message);
  }
}

function rememberPrinted(id) {
  locallyPrinted.add(String(id));
  persistLocalReceipts();
}

function forgetConfirmed(ids) {
  for (const id of ids) locallyPrinted.delete(String(id));
  persistLocalReceipts();
}

function makeRequest(urlString, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(urlString);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;
      const request = protocol.request({
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
      }, (response) => {
        let data = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { data += chunk; });
        response.on('end', () => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            try { resolve(JSON.parse(data)); } catch { resolve(data); }
            return;
          }
          reject(new Error(`HTTP ${response.statusCode}: ${data.slice(0, 300)}`));
        });
      });

      request.setTimeout(HTTP_TIMEOUT_MS, () => request.destroy(new Error('Tiempo de espera agotado al conectar con Railway')));
      request.on('error', reject);
      if (options.body) request.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
      request.end();
    } catch (error) {
      reject(error);
    }
  });
}

function validUsbShareName(value) {
  return /^[\p{L}\p{N} ._()-]{1,80}$/u.test(value) && value.trim().length > 0;
}

function printToSharedUsb(data, printerName) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      reject(new Error('La impresión USB compartida requiere Windows'));
      return;
    }

    const shareName = printerName.trim();
    if (!validUsbShareName(shareName)) {
      reject(new Error('Nombre compartido USB inválido. Usa letras, números, espacios, punto, guion o paréntesis'));
      return;
    }

    const tempFile = path.join(os.tmpdir(), `the_villa_dog_${process.pid}_${Date.now()}.bin`);
    try {
      fs.writeFileSync(tempFile, data);
    } catch (error) {
      reject(new Error(`No se pudo preparar la impresión USB: ${error.message}`));
      return;
    }

    const destination = `\\\\127.0.0.1\\${shareName}`;
    const command = `copy /b "${tempFile}" "${destination}" >nul`;
    execFile(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], { windowsHide: true, timeout: 10000 }, (error) => {
      try { fs.unlinkSync(tempFile); } catch {}
      if (error) {
        reject(new Error(`No se pudo imprimir en USB. Comparte la impresora en Windows con el nombre "${shareName}"`));
        return;
      }
      resolve();
    });
  });
}

function printToNetwork(data, host, port = 9100) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };

    socket.setTimeout(6000, () => finish(new Error(`Tiempo agotado conectando a ${host}:${port}`)));
    socket.once('error', finish);
    socket.connect(port, host, () => {
      socket.write(data, (error) => {
        if (error) {
          finish(error);
          return;
        }
        setTimeout(() => finish(), 500);
      });
    });
  });
}

function parsePrinterAddress(rawAddress, rawPort) {
  const address = String(rawAddress || '').trim();
  if (address.toUpperCase().startsWith('USB:')) {
    const shareName = address.slice(4).trim();
    if (!validUsbShareName(shareName)) throw new Error('Falta un nombre válido después de USB:');
    return { type: 'USB', shareName, label: `USB:${shareName}` };
  }

  let host = address;
  let port = Number(rawPort) || 9100;
  const match = address.match(/^(.+):(\d+)$/);
  if (match) {
    host = match[1];
    port = Number(match[2]);
  }
  const parts = host.split('.');
  const isIpv4 = parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
  if ((!isIpv4 && host !== 'localhost') || port < 1 || port > 65535) {
    throw new Error(`Dirección de impresora inválida: "${address}"`);
  }
  return { type: 'NETWORK', host, port, label: `${host}:${port}` };
}

async function printJob(job) {
  const target = parsePrinterAddress(job.impresora_ip, job.port || job.impresora_puerto);
  const data = Buffer.from(job.payload, 'base64');
  if (!data.length) throw new Error('La comanda llegó vacía');
  if (target.type === 'USB') await printToSharedUsb(data, target.shareName);
  else await printToNetwork(data, target.host, target.port);
  return target.label;
}

async function pollPrintQueue() {
  try {
    const queueUrl = `${config.backendUrl}/api/imprimir/cola`;
    const authHeaders = config.bridgeToken ? { 'x-print-token': config.bridgeToken } : {};
    const jobs = await makeRequest(queueUrl, { headers: authHeaders });

    if (!Array.isArray(jobs)) throw new Error('Railway devolvió una cola inválida');
    if (jobs.length > 0) {
      console.log(`Se encontraron ${jobs.length} trabajo(s) pendiente(s).`);
      const confirmedIds = [];
      let failedCount = 0;

      for (const job of jobs) {
        const localId = String(job.id);
        if (locallyPrinted.has(localId)) {
          console.log(`Trabajo ${job.id} ya impreso; reintentando solamente la confirmación.`);
          confirmedIds.push(job.id);
          continue;
        }

        try {
          const destination = await printJob(job);
          rememberPrinted(job.id);
          confirmedIds.push(job.id);
          console.log(`Trabajo ${job.id} impreso correctamente en ${destination}.`);
        } catch (error) {
          failedCount += 1;
          console.error(`Trabajo ${job.id} pendiente: ${error.message}`);
        }
      }

      if (confirmedIds.length > 0) {
        try {
          await makeRequest(queueUrl, {
            method: 'POST',
            headers: authHeaders,
            body: { ids: confirmedIds },
          });
          forgetConfirmed(confirmedIds);
          console.log(`${confirmedIds.length} trabajo(s) confirmado(s) con Railway.`);
        } catch (error) {
          console.error(`No se pudo confirmar con Railway: ${error.message}. No se volverán a imprimir localmente.`);
        }
      }
      if (failedCount > 0) console.warn(`${failedCount} trabajo(s) quedan en cola para reintentar.`);
    }
  } catch (error) {
    console.error(`Conexión pendiente: ${error.message}`);
  } finally {
    setTimeout(pollPrintQueue, config.pollIntervalMs);
  }
}

console.log(`Puente The Villa Dog v${BRIDGE_VERSION} iniciado.`);
console.log(`Servidor: ${config.backendUrl} | consulta cada ${config.pollIntervalMs} ms.`);
if (!config.bridgeToken) console.error('Falta PRINT_BRIDGE_TOKEN. Ejecuta nuevamente el instalador para configurarlo.');
pollPrintQueue();
