import { fork } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Parse CLI args for relay mode ---
function loadAgentConfig() {
  const configPath = process.argv.find(a => a.startsWith('--config='))?.split('=')[1]
                  || process.env.PARTS_TEL_CONFIG
                  || join(__dirname, 'agent.config.json');
  try {
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      console.log('Loaded agent config from', configPath);
      return cfg;
    }
  } catch (err) {
    console.warn('Failed to load config:', err.message);
  }
  return {};
}
const agentCfg = loadAgentConfig();

const RELAY_URL = process.argv.find(a => a.startsWith('--relay='))?.split('=')[1]
              || process.env.PARTS_TEL_RELAY
              || agentCfg.relay;
const DRIVER_ID = process.argv.find(a => a.startsWith('--driver='))?.split('=')[1]
               || process.env.PARTS_TEL_DRIVER_ID
               || agentCfg.driverId
               || 'driver-1';
const AUTH_TOKEN = process.argv.find(a => a.startsWith('--token='))?.split('=')[1]
                || process.env.PARTS_TEL_TOKEN
                || agentCfg.token;

if (RELAY_URL) {
  console.log(`Agent mode: relay=${RELAY_URL}, driver=${DRIVER_ID}`);
  runAgent();
} else {
  console.log('Standalone mode: listening on ws://localhost:8080');
  runStandalone();
}

// ────────────────────── Standalone mode ──────────────────────
async function runStandalone() {
  const { WebSocketServer, WebSocket } = await import('ws');
  const wss = new WebSocketServer({ port: 8080 });
  const clients = new Set();
  let currentWorker = null;

  wss.on('connection', (ws) => {
    console.log('PARTS-L connected');
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  wss.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error('Port 8080 already in use');
      process.exit(1);
    }
  });

  function broadcast(packet) {
    const payload = JSON.stringify(packet);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        try { client.send(payload); } catch { clients.delete(client); }
      }
    }
  }

  spawnWorker(broadcast);

  process.on('SIGINT', () => {
    if (currentWorker) currentWorker.kill();
    process.exit(0);
  });
}

// ────────────────────── Relay agent mode (HTTP POST) ──────────────────────
function runAgent() {
  let interval = null;
  let currentWorker = null;
  let lastPacket = null;

  // Convert relay URL to HTTP ingest URL
  const ingestUrl = RELAY_URL
    .replace(/^ws(s)?:\/\//, (_, ssl) => ssl ? 'https://' : 'http://')
    .replace(/\/ws\/telemetry\/agent\/?$/, '/api/telemetry/ingest');

  const postUrl = `${ingestUrl}?token=${encodeURIComponent(AUTH_TOKEN || '')}&driverId=${encodeURIComponent(DRIVER_ID)}`;

  async function sendPacket(packet) {
    try {
      const res = await fetch(postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(packet),
      });
      if (!res.ok) {
        console.error(`Ingest error: ${res.status}`);
      }
    } catch { /* retry next tick */ }
  }

  currentWorker = spawnWorker((packet) => {
    lastPacket = packet;
  });

  interval = setInterval(() => {
    if (lastPacket) {
      sendPacket(lastPacket);
    }
  }, 200);

  console.log('Connected to relay (HTTP ingest)');

  process.on('SIGINT', () => {
    if (currentWorker) currentWorker.kill();
    if (interval) clearInterval(interval);
    process.exit(0);
  });
}

// ────────────────────── Shared SDK worker ──────────────────────
function spawnWorker(onMessage) {
  const worker = fork(join(__dirname, 'sdk-worker.js'), [], {
    stdio: ['inherit', 'inherit', 'inherit', 'ipc']
  });

  worker.on('message', (packet) => {
    if (onMessage) onMessage(packet);
  });

  worker.on('error', (err) => console.error('Worker error:', err));

  worker.on('exit', (code) => {
    console.log(`Worker exited (${code}), restarting in 2s...`);
    setTimeout(() => { spawnWorker(onMessage); }, 2000);
  });

  return worker;
}

console.log('iRacing bridge activo');
