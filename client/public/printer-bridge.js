const net = require('net');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');
const http = require('http');
const https = require('https');

// Config file path
const isPkg = typeof process.pkg !== 'undefined';
const configDir = isPkg ? path.dirname(process.execPath) : __dirname;
const configPath = path.join(configDir, 'config.json');

const defaultUrl = "http://localhost:3000";

// Default config
let config = {
  backendUrl: defaultUrl,
  bridgeToken: '',
  pollIntervalMs: 3000
};

// Load or create config
if (fs.existsSync(configPath)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (loaded && typeof loaded.backendUrl === 'string' && loaded.backendUrl.trim()) {
      config.backendUrl = loaded.backendUrl.trim();
    } else {
      config.backendUrl = defaultUrl;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    }
    if (typeof loaded.bridgeToken === 'string') config.bridgeToken = loaded.bridgeToken.trim();
    if (Number.isFinite(Number(loaded.pollIntervalMs))) {
      config.pollIntervalMs = Math.max(1000, Number(loaded.pollIntervalMs));
    }
    console.log(`Configuración cargada de ${configPath}`);
  } catch (e) {
    config.backendUrl = defaultUrl;
    console.error('Error al leer config.json, usando valores por defecto.', e);
  }
} else {
  try {
    config.backendUrl = defaultUrl;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    console.log(`Creado archivo de configuración por defecto en ${configPath}`);
  } catch (e) {
    config.backendUrl = defaultUrl;
    console.error('No se pudo crear config.json', e);
  }
}

if (!config.backendUrl || typeof config.backendUrl !== 'string') {
  config.backendUrl = defaultUrl;
}
config.bridgeToken = String(process.env.PRINT_BRIDGE_TOKEN || config.bridgeToken || '').trim();

console.log(`Conectando con Servidor Nube: ${config.backendUrl}`);
console.log(`Puente de Impresión Local THE VILLA DOG iniciado. Consultando cada ${config.pollIntervalMs} ms...`);
if (!config.bridgeToken) {
  console.error('Falta bridgeToken en config.json. El servidor rechazará la cola de impresión.');
}

// Helper for HTTP/S requests
function makeRequest(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(urlStr);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;
      const reqOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      };

      const req = protocol.request(reqOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              resolve(data);
            }
          } else {
            reject(new Error(`Error HTTP: ${res.statusCode} - ${data}`));
          }
        });
      });

      req.on('error', (err) => reject(err));
      
      if (options.body) {
        req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
      }
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

function printToThermal(data, ip, port = 9100) {
    return new Promise((resolve, reject) => {
        // --- CASO 1: IMPRESORA USB ---
        if (ip && ip.startsWith('USB:')) {
            const printerName = ip.substring(4); // Extrae el nombre compartido
            
            // Crea un archivo binario temporal
            const tmpFile = path.join(os.tmpdir(), `print_${Date.now()}_${Math.floor(Math.random()*1000)}.bin`);
            try {
                fs.writeFileSync(tmpFile, data);
            } catch(e) {
                return reject(new Error('No se pudo crear archivo temporal USB: ' + e.message));
            }
            // Ejecuta el comando de Windows para enviar el archivo binario directamente al puerto compartido
            const cmd = `copy /b "${tmpFile}" "\\\\127.0.0.1\\${printerName}"`;
            exec(cmd, (err) => {
                try { fs.unlinkSync(tmpFile); } catch(e){} // Borra el temporal
                if (err) return reject(new Error(`Fallo copia a USB: Asegúrate de compartir la impresora como ${printerName}`));
                setTimeout(() => resolve(), 600); // Pequeña espera para evitar colisiones
            });
            return;
        }
        
        // --- CASO 2: IMPRESORA DE RED (TCP/IP) ---
        if (!ip) {
            return reject(new Error('IP de impresora no especificada o inválida'));
        }
        
        const client = new net.Socket();
        
        // Timeout de seguridad en caso de que la impresora esté apagada o no conectada
        const timeout = setTimeout(() => { 
            client.destroy(); 
            reject(new Error('Timeout conectando a ' + ip)); 
        }, 5000);
        
        client.connect(port, ip, () => {
            client.write(data, (err) => {
                clearTimeout(timeout);
                if (err) { client.destroy(); return reject(err); }
                
                // Espera 600ms antes de cerrar para asegurar que los buffers de la impresora procesen los datos
                setTimeout(() => { 
                    client.destroy(); 
                    resolve(); 
                }, 600);
            });
        });
        
        client.on('error', (err) => { 
            clearTimeout(timeout); 
            reject(err); 
        });
    });
}

// Polling loop
async function pollPrintQueue() {
  try {
    const rawUrl = (config && typeof config.backendUrl === 'string' && config.backendUrl.trim()) ? config.backendUrl.trim() : defaultUrl;
    const backendApiUrl = rawUrl.endsWith('/') ? rawUrl.slice(0, -1) : rawUrl;
    const getUrl = `${backendApiUrl}/api/imprimir/cola`;
    
    // 1. Obtener trabajos pendientes
    const authHeaders = config.bridgeToken ? { 'x-print-token': config.bridgeToken } : {};
    const jobs = await makeRequest(getUrl, { headers: authHeaders });
    
    if (jobs && jobs.length > 0) {
      console.log(`[${new Date().toLocaleTimeString()}] Detectados ${jobs.length} trabajos de impresión en cola.`);
      const printedIds = [];
      let failedCount = 0;
      
      for (const job of jobs) {
        try {
          // Resolver puerto opcional si la IP tiene formato IP:puerto
          let ip = job.impresora_ip || '';
          let port = Number(job.port || job.impresora_puerto) || 9100;
          if (ip.includes(':') && !ip.startsWith('USB:')) {
            const parts = ip.split(':');
            ip = parts[0];
            port = parseInt(parts[1]) || 9100;
          }
          
          // Validar que la IP es una dirección válida (no un nombre como "caja" o "cocina")
          const ipParts = ip.split('.');
          const isIpv4 = ipParts.length === 4 && ipParts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
          const isValidIp = isIpv4 || ip === 'localhost' || ip.startsWith('USB:');
          if (!ip || !isValidIp) {
            console.error(`  ⚠ Trabajo ID ${job.id} espera una IP válida en Configuración: "${job.impresora_ip}".`);
            failedCount += 1;
            continue;
          }
          
          console.log(`- Imprimiendo trabajo ID ${job.id} en ${ip}:${port}...`);
          const dataBuffer = Buffer.from(job.payload, 'base64');
          
          await printToThermal(dataBuffer, ip, port);
          console.log(`  ✓ Trabajo ID ${job.id} impreso con éxito.`);
          printedIds.push(job.id);
        } catch (printErr) {
          console.error(`  ✗ Error imprimiendo trabajo ID ${job.id}:`, printErr.message);
          console.error(`    → El trabajo queda pendiente para reintentar; no se perderá la comanda.`);
          failedCount += 1;
        }
      }
      
      // 2. Confirmar únicamente trabajos realmente impresos. Los fallidos siguen
      // pendientes para que un cambio de IP o la reconexión de la impresora los recupere.
      if (printedIds.length > 0) {
        try {
          const confirmUrl = `${backendApiUrl}/api/imprimir/cola`;
          await makeRequest(confirmUrl, {
            method: 'POST',
            headers: authHeaders,
            body: { ids: printedIds }
          });
          if (printedIds.length > 0) console.log(`  ✓ ${printedIds.length} trabajos confirmados exitosamente.`);
        } catch (confirmErr) {
          console.error(`  ✗ Error confirmando trabajos:`, confirmErr.message);
          console.error(`    → Los trabajos podrían reaparecer en el próximo ciclo. Verifica la conexión al servidor.`);
        }
      }
      if (failedCount > 0) console.log(`  ⚠ ${failedCount} trabajos siguen pendientes para un nuevo intento.`);
    }
  } catch (err) {
    console.error(`[${new Date().toLocaleTimeString()}] Error de conexión o procesamiento:`, err.message);
  }
  
  // Continuar polling en 3 segundos
  setTimeout(pollPrintQueue, config.pollIntervalMs);
}

// Start polling
pollPrintQueue();
