import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, extname, join, normalize, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)));
const port = Number.parseInt(process.env.MEME_WAR_PORT ?? '4173', 10) || 4173;
const url = 'http://127.0.0.1:' + port + '/';
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

function portIsOpen() {
  return new Promise((resolvePort) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (result) => {
      socket.destroy();
      resolvePort(result);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(250, () => finish(false));
  });
}

async function waitForServer(maxAttempts = 30) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (await portIsOpen()) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  return false;
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(text);
}

function createStaticServer() {
  return createServer(async (request, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url || '/', url).pathname);
    } catch {
      sendText(response, 400, 'Bad Request');
      return;
    }
    if (pathname === '/api/override-parameters') {
      sendText(response, 410, 'Runtime parameter editing is disabled in the release package.');
      return;
    }
    const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
    const candidate = normalize(join(root, requested));
    const safeRelative = relative(root, candidate);
    if (safeRelative.startsWith('..') || isAbsolute(safeRelative)) {
      sendText(response, 403, 'Forbidden');
      return;
    }
    try {
      const info = await stat(candidate);
      if (!info.isFile()) {
        sendText(response, 404, 'Not Found');
        return;
      }
      response.writeHead(200, {
        'Content-Type': MIME_TYPES[extname(candidate).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': safeRelative.split(/[\\\\/]/)[0] === 'assets' ? 'public, max-age=31536000, immutable' : 'no-store',
      });
      createReadStream(candidate).on('error', () => response.destroy()).pipe(response);
    } catch {
      sendText(response, 404, 'Not Found');
    }
  });
}

if (process.argv.includes('--server')) {
  const server = createStaticServer();
  server.listen(port, '127.0.0.1', () => console.log('梗战争模拟器发布包服务器已启动：' + url));
} else {
  if (!(await portIsOpen())) {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--server'], {
      cwd: root,
      detached: true,
      env: { ...process.env, MEME_WAR_PORT: String(port) },
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  }
  if (!(await waitForServer())) {
    console.error('无法启动游戏服务器：' + url);
    process.exitCode = 1;
  } else {
    const browser = spawn('explorer.exe', [url], { detached: true, stdio: 'ignore', windowsHide: true });
    browser.unref();
  }
}
