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
  CORS_ORIGIN = "*", // на проде лучше указать точный домен фронта
  HMS_MANAGEMENT_TOKEN,
  HMS_ROOM_CODE_HOST,
  HMS_ROOM_CODE_GUEST,
  HMS_API_BASE = "https://api.100ms.live"
} = process.env;

if (!HMS_MANAGEMENT_TOKEN) {
  console.warn("⚠️  HMS_MANAGEMENT_TOKEN не задан. Добавь переменную окружения.");
}

const app = express();

// Безопасность и базовая настройка
app.disable("x-powered-by");
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors({
  origin: CORS_ORIGIN === "*" ? true : [CORS_ORIGIN],
  methods: ["GET", "POST"],
  credentials: false
}));
app.use(express.json());
app.use(morgan("combined"));

// Rate limit на чувствительные роуты
const tokenLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 минута
  max: 60,             // не более 60 запросов/мин с IP
  standardHeaders: true,
  legacyHeaders: false
});
app.use("/api/token", tokenLimiter);

// Healthcheck для мониторинга
app.get("/healthz", (req, res) => {
  res.status(200).json({ ok: true, ts: Date.now() });
});

// Универсальная функция запроса токена у 100ms по room-code
async function getTokenByRoomCode(roomCode, userId = "user_" + Date.now()) {
  const url = `${HMS_API_BASE}/v2/room-codes/${roomCode}/token`;
  const headers = {
    Authorization: `Bearer ${HMS_MANAGEMENT_TOKEN}`,
    "Content-Type": "application/json"
  };

  const resp = await axios.post(url, { user_id: userId }, { headers });
  const token = resp?.data?.token;
  if (!token) throw new Error("No token returned from 100ms");
  return token;
}

// Основной эндпоинт: GET /api/token?role=host|guest&user=Имя
app.get("/api/token", async (req, res) => {
  try {
    const role = req.query.role === "host" ? "host" : "guest";
    const user = (req.query.user || (role === "host" ? "teacher" : "student")).toString();

    const roomCode = role === "host" ? HMS_ROOM_CODE_HOST : HMS_ROOM_CODE_GUEST;
    if (!roomCode) {
      return res.status(400).json({ error: "Room code for role is not configured" });
    }

    const token = await getTokenByRoomCode(roomCode, user);
    return res.json({ token });
  } catch (err) {
    console.error("TOKEN ERROR:", err?.response?.data || err?.message || err);
    return res.status(500).json({ error: "Failed to get token" });
  }
});

// Корень (проверка)
app.get("/", (req, res) => {
  res.send("YouCan backend OK");
});

// Запуск
app.listen(PORT, () => {
  console.log(`✅ Backend listening on :${PORT}`);
  console.log(`   Health: GET /healthz`);
  console.log(`   Token : GET /api/token?role=host&user=Ivan`);
});
