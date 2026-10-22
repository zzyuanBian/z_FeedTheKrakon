/**
 * webhook.js — GitHub push listener that auto-deploys Feed the Kraken.
 *
 * Listens on :9100 for POST /deploy, verifies the GitHub HMAC signature,
 * and only reacts to pushes on main. The actual work (pull, build, pm2
 * restart) is delegated to scripts/ftk-deploy.sh so the same script can
 * be run by hand.
 *
 * Run under pm2:  pm2 start webhook.js --name ftk-webhook
 * GitHub side:    repo → Settings → Webhooks → Add
 *                   Payload URL: http://123.206.106.165:9100/deploy
 *                   Content type: application/json
 *                   Secret: (the same value as WEBHOOK_SECRET below)
 *                   Trigger: Just the push event
 *
 * Env:
 *   WEBHOOK_SECRET  required — must match the GitHub webhook's secret
 *   WEBHOOK_PORT    optional — default 9100
 *   DEPLOY_SCRIPT   optional — default ../scripts/ftk-deploy.sh
 */

const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const SECRET = process.env.WEBHOOK_SECRET;
if (!SECRET) {
  console.error('[webhook] WEBHOOK_SECRET is required; refusing to start');
  process.exit(1);
}
const PORT = Number(process.env.WEBHOOK_PORT ?? 9100);
const SCRIPT = path.resolve(__dirname, process.env.DEPLOY_SCRIPT ?? '../scripts/ftk-deploy.sh');

let deploying = false; // one at a time; GitHub retries cover transient races
let lastHead = ''; // "x-GitHub-Delivery" of the in-flight deploy, for logs

function verify(req, raw) {
  const sig = req.headers['x-hub-signature-256'];
  if (typeof sig !== 'string') return false;
  const mac = crypto.createHmac('sha256', SECRET).update(raw).digest();
  const expect = 'sha256=' + mac;
  const a = Buffer.from(expect);
  const b = Buffer.from(sig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function deploy(delivery) {
  if (deploying) {
    console.log(`[webhook] ${delivery}: deploy already running, skipped`);
    return;
  }
  deploying = true;
  lastHead = delivery;
  console.log(`[webhook] ${delivery}: starting deploy…`);
  const child = spawn('bash', [SCRIPT], { stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = (chunk) =>
    chunk.toString().split('\n').filter(Boolean).forEach((l) => console.log(`[deploy] ${l}`));
  child.stdout.on('data', tag);
  child.stderr.on('data', tag);
  child.on('close', (code) => {
    deploying = false;
    console.log(`[webhook] ${delivery}: deploy ${code === 0 ? 'OK' : `FAILED (${code})`}`);
  });
}

http
  .createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/deploy') {
      res.writeHead(404).end();
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 5 * 1024 * 1024) req.destroy(); // GitHub pushes are tiny
      else chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const delivery = req.headers['x-github-delivery'] ?? 'unknown';
      if (!verify(req, raw)) {
        console.warn(`[webhook] ${delivery}: BAD SIGNATURE — ignored`);
        res.writeHead(403).end('bad signature');
        return;
      }
      let event = {};
      try {
        event = JSON.parse(raw.toString());
      } catch {
        res.writeHead(400).end('bad json');
        return;
      }
      // Only main-branch pushes; "zen"/"ping" payloads carry no ref.
      const ref = event.ref ?? '';
      if (event.deleted || ref !== 'refs/heads/main') {
        console.log(`[webhook] ${delivery}: ignoring ${ref || 'non-push event'}`);
        res.writeHead(200).end('ignored');
        return;
      }
      res.writeHead(202).end('deploying');
      deploy(String(delivery));
    });
  })
  .listen(PORT, () => console.log(`[webhook] listening on :${PORT} — script: ${SCRIPT}`));
