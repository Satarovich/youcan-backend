// backend/index.js  (CommonJS-версия — просто вставь и сохрани)
const express = require('express');
const cors = require('cors');

const app = express();

// CORS: для теста можно '*', для прод — точный домен фронта
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: ALLOWED_ORIGIN === '*' ? true : ALLOWED_ORIGIN }));
app.use(express.json());

// Берём Room Code по роли
function getRoomCodeByRole(role) {
  return role === 'host'
    ? process.env.HMS_ROOM_CODE_HOST
    : process.env.HMS_ROOM_CODE_GUEST;
}

// Меняем room code -> token через правильный сервис авторизации
async function tokenByRoomCode({ role, user }) {
  const code = getRoomCodeByRole(role);
  if (!code) {
    return { status: 400, body: { error: 'Missing room code for role', detail: { role } } };
  }
  const r = await fetch('https://auth.100ms.live/v2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, user_id: user || undefined }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return { status: r.status, body: { error: 'Failed to get token', detail: data } };

  const token = data.token || data.authToken || data.access_token;
  if (!token) return { status: 500, body: { error: 'No token in response', detail: data } };

  return { status: 200, body: { token } };
}

// Основной POST-роут для фронта
app.post('/api/token', async (req, res) => {
  try {
    const { role, user } = req.body || {};
    const out = await tokenByRoomCode({ role, user });
    return res.status(out.status).json(out.body);
  } catch (e) {
    return res.status(500).json({ error: 'Server error', detail: String(e) });
  }
});

// Дополнительный GET — удобно проверять из браузера
app.get('/api/token', async (req, res) => {
  try {
    const { role, user } = req.query || {};
    const out = await tokenByRoomCode({ role, user });
    return res.status(out.status).json(out.body);
  } catch (e) {
    return res.status(500).json({ error: 'Server error', detail: String(e) });
  }
});

// Отладка ENV — видно, что сервер «видит»
app.get('/api/debug/env', (_req, res) => {
  res.json({
    PORT: process.env.PORT,
    CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
    HMS_API_BASE: null, // больше не используем
    HMS_MANAGEMENT_TOKEN_SET: !!process.env.HMS_MANAGEMENT_TOKEN,
    HMS_ROOM_CODE_HOST: process.env.HMS_ROOM_CODE_HOST,
    HMS_ROOM_CODE_GUEST: process.env.HMS_ROOM_CODE_GUEST,
    API_BASE_CANDIDATES: ['https://prod-in2.100ms.live', 'https://api.100ms.live'],
  });
});

// Отладка Room Codes — "пингуем" через auth-сервис (без выдачи токенов)
app.get('/api/debug/room-codes', async (_req, res) => {
  const check = async (code) => {
    if (!code) return { ok: false, status: 400, detail: 'missing_code' };
    const r = await fetch('https://auth.100ms.live/v2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    return { ok: r.ok, status: r.status };
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

// Healthcheck
app.get('/', (_req, res) => res.send('youcan-backend OK'));

const PORT = process.env.PORT || 3000; // Render сам подставит PORT
app.listen(PORT, () => console.log(`Server on ${PORT}`));
