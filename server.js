import { WebSocketServer, WebSocket } from 'ws';
import { fork } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Parse CLI args for relay mode ---
const RELAY_URL = process.argv.find(a => a.startsWith('--relay='))?.split('=')[1]
              || process.env.PARTS_TEL_RELAY;
const DRIVER_ID = process.argv.find(a => a.startsWith('--driver='))?.split('=')[1]
               || process.env.PARTS_TEL_DRIVER_ID
               || 'driver-1';
const AUTH_TOKEN = process.argv.find(a => a.startsWith('--token='))?.split('=')[1]
                || process.env.PARTS_TEL_TOKEN;

if (RELAY_URL) {
  console.log(`Agent mode: relay=${RELAY_URL}, driver=${DRIVER_ID}`);
  runAgent();
} else {
  console.log('Standalone mode: listening on ws://localhost:8080');
  runStandalone();
}

// ────────────────────── Standalone mode (original) ──────────────────────
function runStandalone() {
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

// ────────────────────── Relay agent mode ──────────────────────
function runAgent() {
  let ws = null;
  let reconnectTimer = null;
  let currentWorker = null;

  function connect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    const url = `${RELAY_URL}?token=${encodeURIComponent(AUTH_TOKEN || '')}&driverId=${encodeURIComponent(DRIVER_ID)}`;
    console.log(`Connecting to relay: ${RELAY_URL}`);

    try {
      ws = new WebSocket(url);
    } catch {
      console.error('Failed to create WebSocket, retrying in 5s...');
      reconnectTimer = setTimeout(connect, 5000);
      return;
    }

    ws.on('open', () => {
      console.log('Connected to relay');
      if (!currentWorker) {
        currentWorker = spawnWorker((packet) => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            packet.driverId = DRIVER_ID;
            try { ws.send(JSON.stringify(packet)); } catch { /* ignore */ }
          }
        });
      }
    });

    ws.on('close', () => {
      console.log('Relay disconnected, reconnecting in 5s...');
      ws = null;
      reconnectTimer = setTimeout(connect, 5000);
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err.message);
    });
  }

  connect();

  process.on('SIGINT', () => {
    if (currentWorker) currentWorker.kill();
    if (ws) ws.close();
    if (reconnectTimer) clearTimeout(reconnectTimer);
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
