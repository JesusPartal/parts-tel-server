import { WebSocketServer, WebSocket } from 'ws';
import { fork } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
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

function spawnWorker() {
  const worker = fork(join(__dirname, 'sdk-worker.js'), [], {
    stdio: ['inherit', 'inherit', 'inherit', 'ipc']
  });

  currentWorker = worker;

  worker.on('message', (packet) => {
    const payload = JSON.stringify(packet);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(payload);
        } catch (err) {
          clients.delete(client);
        }
      }
    }
  });

  worker.on('error', (err) => console.error('Worker error:', err));

  worker.on('exit', (code) => {
    console.log(`Worker exited (${code}), restarting in 2s...`);
    currentWorker = null;
    setTimeout(spawnWorker, 2000);
  });
}

process.on('SIGINT', () => {
  if (currentWorker) currentWorker.kill();
  process.exit(0);
});

spawnWorker();

console.log('iRacing bridge activo en ws://localhost:8080');