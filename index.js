// index.js (ESM) — устойчивая версия с таймаутом и логами
import express from 'express';
import cors from 'cors';

const app = express();

// ---- базовая настройка
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: ALLOWED_ORIGIN === '*' ? true : ALLOWED_ORIGIN }));
app.use(express.json());

// ---- утилиты
function log(...args) {
  const ts = new Date().toISOString();
  console.log(`[${ts}]`, ...args);
}

function getRoomCodeByRole(role) {
  return role === 'host' ? process.env.HMS_ROOM_CODE_HOST : process.env.HMS_ROOM_CODE_GUEST;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

// ---- core: обмен room code → auth token через auth.100ms.live
async function tokenByRoomCode({ role, user }) {
  const code = getRoomCodeByRole(role);
  if (!code) {
    return { status: 400, body: { error: 'Missing room code for role', detail: { role } } };
  }

  const url = 'https://auth.100ms.live/v2/token';
  const body = JSON.stringify({ code, user_id: user || undefined });

  log('auth.fetch', { url, role, hasCode: !!code, user });

  let r;
  try {
    r = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json',
      },
      body,
    }, 10000);
  } catch (e) {
    log('auth.fetch.error', String(e));
    return { status: 504, body: { error: 'Upstream timeout', detail: String(e) } };
  }

  let data = {};
  try {
    data = await r.json();
  } catch {
    // если тело не JSON — обозначим
    data = { non_json: true };
  }

  if (!r.ok) {
    log('auth.fetch.bad', { status: r.status, data });
    return { status: r.status, body: { error: 'Failed to get token', detail: data } };
  }

  const token = data.token || data.authToken || data.access_token;
  if (!token) {
    log('auth.fetch.no_token', data);
    return { status: 502, body: { error: 'No token in response', detail: data } };
  }

  return { status: 200, body: { token } };
}

// ---- маршруты
app.post('/api/token', async (req, res) => {
  try {
    const { role, user } = req.body || {};
    log('POST /api/token', { role, user });
    const out = await tokenByRoomCode({ role, user });
    return res.status(out.status).json(out.body);
  } catch (e) {
    log('POST /api/token ERROR', e);
    return res.status(500).json({ error: 'Server error', detail: String(e) });
  }
});

app.get('/api/token', async (req, res) => {
  try {
    const { role, user } = req.query || {};
    log('GET /api/token', { role, user });
    const out = await tokenByRoomCode({ role, user });
    return res.status(out.status).json(out.body);
  } catch (e) {
    log('GET /api/token ERROR', e);
    return res.status(500).json({ error: 'Server error', detail: String(e) });
  }
});

// ---- отладочные
app.get('/api/debug/env', (_req, res) => {
  res.json({
    PORT: process.env.PORT,
    CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
    HMS_API_BASE: null,
    HMS_MANAGEMENT_TOKEN_SET: !!process.env.HMS_MANAGEMENT_TOKEN,
    HMS_ROOM_CODE_HOST: process.env.HMS_ROOM_CODE_HOST,
    HMS_ROOM_CODE_GUEST: process.env.HMS_ROOM_CODE_GUEST,
    API_BASE_CANDIDATES: ['https://prod-in2.100ms.live', 'https://api.100ms.live'],
  });
});

app.get('/api/debug/room-codes', async (_req, res) => {
  const check = async (code) => {
    if (!code) return { ok: false, status: 400, detail: 'missing_code' };
    try {
      const r = await fetchWithTimeout('https://auth.100ms.live/v2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'accept': 'application/json' },
        body: JSON.stringify({ code }),
      }, 8000);
      return { ok: r.ok, status: r.status };
    } catch (e) {
      return { ok: false, status: 504, detail: String(e) };
    }
  };

  const host = await check(process.env.HMS_ROOM_CODE_HOST);
  const guest = await check(process.env.HMS_ROOM_CODE_GUEST);
  const mask = (v) => (v ? v.replace(/.(?=.{4})/g, '*') : null);

  res.json({
    host_code_masked: mask(process.env.HMS_ROOM_CODE_HOST),
    guest_code_masked: mask(process.env.HMS_ROOM_CODE_GUEST),
    checks: { host, guest },
  });
});

app.get('/api/debug/version', (_req, res) => {
  res.json({ node: process.version, env: process.env.NODE_ENV || 'development' });
});

app.get('/', (_req, res) => res.send('youcan-backend OK'));

// ---- запуск
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => log(`Server on ${PORT}`));
