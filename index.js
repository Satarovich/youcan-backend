import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

const {
  PORT = 8080,
  CORS_ORIGIN = "*",
  HMS_MANAGEMENT_TOKEN,
  HMS_ROOM_CODE_HOST,
  HMS_ROOM_CODE_GUEST,
  HMS_API_BASE // может быть пустым — добавим автоподбор
} = process.env;

// Нормализатор базового URL
const norm = (s) => (s || "").replace(/\/+$/, "");

// Кандидаты баз 100ms (попробуем по очереди)
const API_BASE_CANDIDATES = [
  norm(HMS_API_BASE),                 // то, что ты задал (может быть пустым)
  "https://prod-in2.100ms.live",      // кластер IN2 (часто у тебя в ответах)
  "https://api.100ms.live"            // универсальный
].filter(Boolean);

const app = express();
app.disable("x-powered-by");
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: CORS_ORIGIN === "*" ? true : [CORS_ORIGIN], methods: ["GET", "POST"] }));
app.use(express.json());
app.use(morgan("combined"));

app.use("/api/token", rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false
}));

// ===== Диагностика окружения (временно, УДАЛИ после починки) =====
app.get("/api/debug/env", (_req, res) => {
  res.json({
    PORT,
    CORS_ORIGIN,
    HMS_API_BASE: HMS_API_BASE || null,
    HMS_MANAGEMENT_TOKEN_SET: !!HMS_MANAGEMENT_TOKEN,
    HMS_ROOM_CODE_HOST: HMS_ROOM_CODE_HOST || null,
    HMS_ROOM_CODE_GUEST: HMS_ROOM_CODE_GUEST || null,
    API_BASE_CANDIDATES
  });
});

// ===== Получить список room codes от 100ms (временно, УДАЛИ потом) =====
app.get("/api/debug/room-codes", async (_req, res) => {
  try {
    if (!HMS_MANAGEMENT_TOKEN) {
      return res.status(400).json({ error: "HMS_MANAGEMENT_TOKEN missing" });
    }
    let lastErr = null;
    for (const base of API_BASE_CANDIDATES) {
      try {
        const url = `${base}/v2/room-codes?enabled=true`;
        const { data } = await axios.get(url, {
          headers: { Authorization: `Bearer ${HMS_MANAGEMENT_TOKEN}` }
        });
        return res.json({ api_base_used: base, data });
      } catch (e) {
        lastErr = { base, status: e?.response?.status, body: e?.response?.data || e.message };
      }
    }
    return res.status(500).json({ error: "failed_all_bases", lastErr });
  } catch (e) {
    return res.status(500).json({ error: "debug_failed", detail: e.message });
  }
});

// ===== Вспомогательная: запрос токена у 100ms по room code с авто-перебором баз =====
async function getTokenByRoomCode(roomCode, userId = "user_" + Date.now()) {
  if (!HMS_MANAGEMENT_TOKEN) throw new Error("HMS_MANAGEMENT_TOKEN is missing");
  if (!roomCode) throw new Error("roomCode is missing");

  let lastErr = null;
  for (const base of API_BASE_CANDIDATES) {
    const url = `${base}/v2/room-codes/${roomCode}/token`;
    try {
      const resp = await axios.post(
        url,
        { user_id: userId }, // role НЕ нужно — оно зашито в room code на стороне 100ms
        {
          headers: {
            Authorization: `Bearer ${HMS_MANAGEMENT_TOKEN}`,
            "Content-Type": "application/json"
          },
          timeout: 12000
        }
      );
      const token = resp?.data?.token;
      if (!token) throw new Error("No token returned from 100ms");
      // лог успеха — какую базу использовали
      console.log("TOKEN OK via", base);
      return token;
    } catch (e) {
      lastErr = { base, status: e?.response?.status, body: e?.response?.data || e.message };
      console.error("TOKEN ERROR DETAIL:", lastErr);
      // пробуем следующий base
    }
  }
  // если не сработал ни один base
  throw new Error(`All API bases failed: ${JSON.stringify(lastErr)}`);
}

// ===== Основной эндпойнт для фронта =====
// GET /api/token?role=host|guest&user=Имя
app.get("/api/token", async (req, res) => {
  try {
    const role = req.query.role === "host" ? "host" : "guest";
    const user = (req.query.user || (role === "host" ? "teacher" : "student")).toString();

    const roomCode =
      role === "host" ? HMS_ROOM_CODE_HOST : HMS_ROOM_CODE_GUEST;

    if (!roomCode) {
      return res.status(400).json({ error: "Room code for role is not configured" });
    }

    const token = await getTokenByRoomCode(roomCode, user);
    return res.json({ token });
  } catch (err) {
    const msg = err?.message || "unknown";
    console.error("TOKEN FINAL ERROR:", msg);
    return res.status(500).json({ error: "Failed to get token", detail: msg });
  }
});

app.get("/healthz", (_req, res) => res.status(200).json({ ok: true, ts: Date.now() }));
app.get("/", (_req, res) => res.send("YouCan backend OK"));

app.listen(PORT, () => {
  console.log(`✅ Backend listening on :${PORT}`);
  console.log(`   Health: GET /healthz`);
  console.log(`   Debug : GET /api/debug/env , /api/debug/room-codes`);
  console.log(`   Token : GET /api/token?role=guest&user=Test`);
});
