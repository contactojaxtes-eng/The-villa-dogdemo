const net = require('net');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const os = require('os');
const http = require('http');
const https = require('https');
const readline = require('readline');

const BRIDGE_VERSION = '1.3.0';
const DEFAULT_BACKEND_URL = 'https://the-villa-dog-backend-production.up.railway.app';
const DEFAULT_BRIDGE_TOKEN = '1e855b5dc09473209300ce27a6203479ad5dcdd664ce8ccfa62d013b49100135';
const MAX_LOG_BYTES = 1024 * 1024;
const MAX_LOCAL_RECEIPTS = 500;
const HTTP_TIMEOUT_MS = 15000;

// Determinar el directorio de configuración (sea modo .exe nativo, pkg, o script .js)
const isPkg = typeof process.pkg !== 'undefined';
const isSea = Boolean(process.features && process.features.sea) || !process.argv[1] || process.argv[1] === process.execPath;
const configDir = (isPkg || isSea) ? path.dirname(process.execPath) : __dirname;
const configPath = path.join(configDir, 'config.json');
const logPath = path.join(configDir, 'bridge.log');
const previousLogPath = path.join(configDir, 'bridge.previous.log');
const receiptPath = path.join(configDir, 'printed-pending-confirmation.json');
const lockPath = path.join(configDir, 'bridge.lock');

// Manejo de argumentos por línea de comandos
const rawArgs = process.argv.slice(1);
for (const arg of rawArgs) {
  if (arg === '--version' || arg === '-v') {
    console.log(`The Villa Dog Printer Bridge v${BRIDGE_VERSION}`);
    process.exit(0);
  }
  if (arg === '--help' || arg === '-h' || arg === '/?') {
    console.log(`
===================================================================
      THE VILLA DOG - PUENTE DE IMPRESION PARA WINDOWS v${BRIDGE_VERSION}
===================================================================
Uso:
  TheVillaDogBridge.exe [opciones]

Opciones:
  --token=<clave>         Configura la clave PRINT_BRIDGE_TOKEN
  --url=<url>             Configura la URL del servidor backend
  --printer=<ip o USB>    Fija la impresora localmente (ej: 192.168.1.50 o USB:POS-80)
  --poll=<ms>             Intervalo de consulta en ms (por defecto: 1500)
  --help                  Muestra este mensaje de ayuda
  --version               Muestra la versión instalada
`);
    process.exit(0);
  }
}

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
  console.log('El puente de impresión ya está activo en este equipo.');
  if (process.stdin.isTTY) {
    console.log('Esta ventana se cerrará automáticamente en 3 segundos...');
    setTimeout(() => process.exit(0), 3000);
  } else {
    process.exit(0);
  }
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
  bridgeToken: DEFAULT_BRIDGE_TOKEN,
  printerOverride: '',
  pollIntervalMs: 1500,
};

let lastConfigMtime = 0;
function loadConfigFile() {
  if (fs.existsSync(configPath)) {
    try {
      const stats = fs.statSync(configPath);
      if (stats.mtimeMs !== lastConfigMtime) {
        lastConfigMtime = stats.mtimeMs;
        const loaded = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
        if (loaded) {
          if (typeof loaded.backendUrl === 'string' && loaded.backendUrl.trim()) {
            const u = loaded.backendUrl.trim().replace(/\/+$/, '');
            if (!u.includes('niche')) {
              config.backendUrl = u;
            }
          }
          if (typeof loaded.bridgeToken === 'string' && loaded.bridgeToken.trim()) {
            config.bridgeToken = loaded.bridgeToken.trim();
          }
          if (typeof loaded.printerOverride === 'string') {
            config.printerOverride = loaded.printerOverride.trim();
          } else if (typeof loaded.printerIp === 'string') {
            config.printerOverride = loaded.printerIp.trim();
          }
          if (Number.isFinite(Number(loaded.pollIntervalMs))) {
            config.pollIntervalMs = Math.max(1000, Number(loaded.pollIntervalMs));
          }
        }
      }
    } catch (error) {
      console.error('No se pudo leer config.json:', error.message);
    }
  }
}
loadConfigFile();

// Sobrescritura por argumentos CLI
let configModified = false;
for (const arg of rawArgs) {
  if (arg.startsWith('--token=')) {
    const val = arg.slice(8).trim();
    if (val) { config.bridgeToken = val; configModified = true; }
  } else if (arg.startsWith('--url=')) {
    const val = arg.slice(6).trim();
    if (val) { config.backendUrl = val.replace(/\/+$/, ''); configModified = true; }
  } else if (arg.startsWith('--printer=') || arg.startsWith('--ip=')) {
    const val = arg.split('=')[1]?.trim();
    if (val) { config.printerOverride = val; configModified = true; }
  } else if (arg.startsWith('--poll=')) {
    const val = Number(arg.slice(7));
    if (val >= 1000) { config.pollIntervalMs = val; configModified = true; }
  }
}

// Sobrescritura por variables de entorno
if (process.env.PRINT_BRIDGE_TOKEN && !config.bridgeToken) {
  config.bridgeToken = String(process.env.PRINT_BRIDGE_TOKEN).trim();
}
if (process.env.BRIDGE_BACKEND_URL) {
  config.backendUrl = String(process.env.BRIDGE_BACKEND_URL).trim().replace(/\/+$/, '');
}
if (!config.bridgeToken) {
  config.bridgeToken = DEFAULT_BRIDGE_TOKEN;
}
if (!config.backendUrl || config.backendUrl.includes('niche')) {
  config.backendUrl = DEFAULT_BACKEND_URL;
}
config.backendUrl = String(config.backendUrl).trim().replace(/\/+$/, '');

if (configModified || !fs.existsSync(configPath)) {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  } catch (e) {
    console.warn('Nota: No se pudo actualizar config.json:', e.message);
  }
}

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
      const requestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': `TheVillaDog-PrinterBridge/${BRIDGE_VERSION}`,
          ...(options.headers || {}),
        },
        timeout: HTTP_TIMEOUT_MS,
      };

      const req = protocol.request(requestOptions, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(body ? JSON.parse(body) : {});
            } catch {
              resolve(body);
            }
          } else if (res.statusCode === 401 || res.statusCode === 403) {
            reject(new Error(`Acceso no autorizado (${res.statusCode}). Clave PRINT_BRIDGE_TOKEN inválida.`));
          } else {
            reject(new Error(`Error del servidor (${res.statusCode}): ${body.slice(0, 160)}`));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy(new Error('Tiempo de espera agotado contactando al servidor.'));
      });
      req.on('error', reject);

      if (options.body) {
        req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
      }
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

function validUsbShareName(value) {
  return /^[\p{L}\p{N} ._()-]{1,80}$/u.test(String(value || '').trim());
}

function printToSharedUsb(data, shareName) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      reject(new Error('La impresión USB local por Windows Spooler o SMB solo está soportada en Windows.'));
      return;
    }
    const cleanTarget = String(shareName || '').replace(/^USB:\s*/i, '').trim();
    if (!cleanTarget) {
      reject(new Error('Nombre de recurso o impresora USB vacío.'));
      return;
    }

    const tempFile = path.join(os.tmpdir(), `thevilladog_print_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.bin`);
    try {
      fs.writeFileSync(tempFile, data);
    } catch (error) {
      reject(new Error(`No se pudo preparar la impresión USB: ${error.message}`));
      return;
    }

    // Script PowerShell con Win32 Spooler (RawPrinterHelper), detección inteligente de impresoras y fallback
    const psScript = `
param([string]\$FilePath, [string]\$RequestedName)

\$typeDef = @"
using System;
using System.IO;
using System.Runtime.InteropServices;

public class Win32RawPrinter
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOCINFO
    {
        [MarshalAs(UnmanagedType.LPWStr)]
        public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool OpenPrinter(string src, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO di);

    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);

    public static string Send(string printerName, byte[] bytes)
    {
        IntPtr pBytes = Marshal.AllocCoTaskMem(bytes.Length);
        Marshal.Copy(bytes, 0, pBytes, bytes.Length);

        IntPtr hPrinter = IntPtr.Zero;
        DOCINFO di = new DOCINFO();
        di.pDocName = "The Villa Dog Receipt";
        di.pDataType = null;

        string res = "OK";
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
        {
            res = "OpenPrinter_Fail_" + Marshal.GetLastWin32Error();
        }
        else
        {
            if (!StartDocPrinter(hPrinter, 1, di))
            {
                res = "StartDocPrinter_Fail_" + Marshal.GetLastWin32Error();
            }
            else
            {
                if (!StartPagePrinter(hPrinter))
                {
                    res = "StartPagePrinter_Fail_" + Marshal.GetLastWin32Error();
                }
                else
                {
                    int written = 0;
                    if (!WritePrinter(hPrinter, pBytes, bytes.Length, out written))
                    {
                        res = "WritePrinter_Fail_" + Marshal.GetLastWin32Error();
                    }
                    EndPagePrinter(hPrinter);
                }
                EndDocPrinter(hPrinter);
            }
            ClosePrinter(hPrinter);
        }
        Marshal.FreeCoTaskMem(pBytes);
        return res;
    }
}
"@

try { Add-Type -TypeDefinition \$typeDef } catch {}

\$allPrinters = @(Get-Printer | Select-Object -ExpandProperty Name)
\$normReq = (\$RequestedName -replace '[^a-zA-Z0-9]', '').ToLower()

\$bestMatch = \$allPrinters | Where-Object { \$_ -eq \$RequestedName } | Select-Object -First 1
if (-not \$bestMatch) {
    \$bestMatch = \$allPrinters | Where-Object { \$_.ToLower() -eq \$RequestedName.ToLower() } | Select-Object -First 1
}
if (-not \$bestMatch) {
    \$bestMatch = \$allPrinters | Where-Object { ((\$_.ToLower() -replace '[^a-zA-Z0-9]', '')) -eq \$normReq } | Select-Object -First 1
}
if (-not \$bestMatch) {
    \$bestMatch = \$allPrinters | Where-Object { \$_.ToLower().Contains(\$RequestedName.ToLower()) -or \$RequestedName.ToLower().Contains(\$_.ToLower()) } | Select-Object -First 1
}
if (-not \$bestMatch) {
    \$bestMatch = \$allPrinters | Where-Object { ((\$_.ToLower() -replace '[^a-zA-Z0-9]', '')).Contains(\$normReq) -or \$normReq.Contains(((\$_.ToLower() -replace '[^a-zA-Z0-9]', ''))) } | Select-Object -First 1
}

if (-not \$bestMatch) { \$bestMatch = \$RequestedName }
Write-Host "MATCHED_PRINTER:\$bestMatch"

\$bytes = [System.IO.File]::ReadAllBytes(\$FilePath)
\$result = [Win32RawPrinter]::Send(\$bestMatch, \$bytes)
Write-Host "RESULT:\$result"
`;

    const psTemp = path.join(os.tmpdir(), `thevilladog_ps_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.ps1`);
    try {
      fs.writeFileSync(psTemp, psScript, 'utf8');
    } catch (e) {
      try { fs.unlinkSync(tempFile); } catch {}
      reject(new Error(`No se pudo preparar script de impresion: ${e.message}`));
      return;
    }

    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psTemp, '-FilePath', tempFile, '-RequestedName', cleanTarget];
    execFile('powershell.exe', args, { windowsHide: true, timeout: 15000 }, (error, stdout, stderr) => {
      try { fs.unlinkSync(tempFile); } catch {}
      try { fs.unlinkSync(psTemp); } catch {}

      const out = String(stdout || '');
      const matchedLine = out.match(/MATCHED_PRINTER:(.+)/);
      const resultLine = out.match(/RESULT:(.+)/);
      const matched = matchedLine ? matchedLine[1].trim() : cleanTarget;
      const res = resultLine ? resultLine[1].trim() : '';

      if (res === 'OK') {
        log(`[USB] Impreso correctamente en impresora Windows "${matched}" (solicitada: "${cleanTarget}")`);
        resolve();
      } else {
        // Fallback secundario a SMB copy si el spooler reporta fallo
        const destination = `\\\\127.0.0.1\\${cleanTarget}`;
        const cmd = `copy /b "${tempFile}" "${destination}" >nul`;
        execFile(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', cmd], { windowsHide: true, timeout: 6000 }, (smbErr) => {
          if (smbErr) {
            reject(new Error(`No se pudo imprimir en USB "${cleanTarget}". Verifica que la impresora esté encendida, conectada y visible en Dispositivos e impresoras de Windows (Detalle: ${res || error?.message || smbErr.message})`));
          } else {
            log(`[USB] Impreso por recurso SMB local "${cleanTarget}"`);
            resolve();
          }
        });
      }
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

    socket.setTimeout(2500, () => finish(new Error(`Tiempo agotado conectando a ${host}:${port}`)));
    socket.once('error', finish);
    socket.connect(port, host, () => {
      socket.write(data, (error) => {
        if (error) {
          finish(error);
          return;
        }
        setTimeout(() => finish(), 300);
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
  const override = (config.printerOverride || config.printerIp || '').trim();
  const targetAddress = override || job.impresora_ip || job.ip || job.impresoraIp;
  if (!targetAddress) throw new Error('No hay dirección de impresora especificada en el trabajo ni en config.json');
  const target = parsePrinterAddress(targetAddress, job.port || job.impresora_puerto);
  const data = Buffer.from(job.payload, 'base64');
  if (!data.length) throw new Error('La comanda llegó vacía');
  if (target.type === 'USB') await printToSharedUsb(data, target.shareName);
  else await printToNetwork(data, target.host, target.port);
  return target.label;
}

async function pollPrintQueue() {
  loadConfigFile();
  try {
    const queueUrl = `${config.backendUrl}/api/imprimir/cola`;
    const authHeaders = config.bridgeToken ? { 'x-print-token': config.bridgeToken } : {};
    const jobs = await makeRequest(queueUrl, { headers: authHeaders });

    if (!Array.isArray(jobs)) throw new Error('El servidor devolvió una cola inválida');
    if (jobs.length > 0) {
      console.log(`Se encontraron ${jobs.length} comanda(s) pendiente(s).`);
      const confirmedIds = [];
      let failedCount = 0;

      for (const job of jobs) {
        const localId = String(job.id);
        if (locallyPrinted.has(localId)) {
          console.log(`Trabajo ${job.id} ya impreso; reintentando confirmación.`);
          confirmedIds.push(job.id);
          continue;
        }

        try {
          const destination = await printJob(job);
          rememberPrinted(job.id);
          confirmedIds.push(job.id);
          console.log(`[OK] Comanda #${job.id} impresa correctamente en ${destination}.`);
        } catch (error) {
          failedCount += 1;
          console.error(`Comanda #${job.id} no se pudo imprimir: ${error.message}`);
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
          console.log(`${confirmedIds.length} comanda(s) confirmada(s) con el servidor.`);
        } catch (error) {
          console.error(`No se pudo confirmar con el servidor: ${error.message}`);
        }
      }
      if (failedCount > 0) console.warn(`${failedCount} comanda(s) quedan pendientes para reintentar.`);
    }
  } catch (error) {
    console.error(`Estado de conexión: ${error.message}`);
  } finally {
    setTimeout(pollPrintQueue, config.pollIntervalMs);
  }
}

function promptIfMissingToken() {
  if (config.bridgeToken || !process.stdin.isTTY) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    console.log('\n==============================================================');
    console.log('       CONFIGURACION INICIAL - THE VILLA DOG');
    console.log('==============================================================');
    console.log('No se encontró la clave del restaurante (PRINT_BRIDGE_TOKEN).');
    console.log('Obtenla en la consola: Configuración -> Cocina de domicilios.');
    console.log('');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Pega la clave PRINT_BRIDGE_TOKEN y pulsa Enter: ', (tokenAns) => {
      const token = tokenAns.trim();
      if (token) config.bridgeToken = token;
      rl.question(`URL del servidor [${config.backendUrl}]: `, (urlAns) => {
        const url = urlAns.trim();
        if (url) config.backendUrl = url.replace(/\/+$/, '');
        try {
          fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
          console.log('[OK] Configuración guardada en config.json.\n');
        } catch (e) {
          console.warn('Nota:', e.message);
        }
        rl.close();
        resolve();
      });
    });
  });
}

async function start() {
  await promptIfMissingToken();

  console.log('==============================================================');
  console.log(`      PUENTE DE IMPRESION - THE VILLA DOG v${BRIDGE_VERSION}`);
  console.log('==============================================================');
  console.log(`Servidor  : ${config.backendUrl}`);
  console.log(`Consulta  : cada ${config.pollIntervalMs} ms`);
  console.log(`Carpeta   : ${configDir}`);
  console.log(`Clave     : [Configurada en Railway]`);
  if (config.printerOverride) {
    console.log(`Impresora : FIJADA LOCALMENTE -> ${config.printerOverride}`);
  } else {
    console.log(`Impresora : DINAMICA (se lee directamente de la configuración web)`);
  }
  console.log('==============================================================');
  console.log('Esperando comandas para imprimir...\n');

  pollPrintQueue();
}

start();
