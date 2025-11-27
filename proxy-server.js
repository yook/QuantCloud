const http = require("http");
const https = require("https");
const url = require("url");
require("dotenv").config();

// Аутентификация: логин/пароль (Basic) — для продакшена используйте секретный менеджер
const AUTH_USER = process.env.AUTH_USER || "admin";
const AUTH_PASS = process.env.AUTH_PASS || "password";
// Сохраняем поддержку старого ключа как опцию совместимости
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  // Разрешаем CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Auth-User, X-Auth-Pass, X-Target-URL"
  );

  // Обработка preflight запросов
  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  // Публичный health-check (не требует аутентификации)
  if (req.method === "GET" && (req.url === "/health" || req.url === "/")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  // Проверка авторизации: сначала Basic (user:pass), затем заголовки x-auth-user/x-auth-pass, затем legacy key
  const authHeader = req.headers["authorization"];
  let authorized = false;

  if (authHeader && authHeader.startsWith("Basic ")) {
    try {
      const payload = Buffer.from(authHeader.slice(6), "base64").toString(
        "utf8"
      );
      const [user, pass] = payload.split(":");
      if (user === AUTH_USER && pass === AUTH_PASS) {
        authorized = true;
      }
    } catch (e) {
      // ignore parse errors
    }
  }

  if (!authorized && req.headers["x-auth-user"] && req.headers["x-auth-pass"]) {
    const user = req.headers["x-auth-user"];
    const pass = req.headers["x-auth-pass"];
    if (user === AUTH_USER && pass === AUTH_PASS) authorized = true;
  }

  // legacy AUTH_KEY removed — only Basic auth or X-Auth-User/X-Auth-Pass supported

  if (!authorized) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ error: "Unauthorized: Invalid or missing credentials" })
    );
    return;
  }

  // Получение целевого URL
  const targetUrl = req.headers["x-target-url"] || req.url.substring(1);

  if (!targetUrl) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Bad Request: Target URL is required" }));
    return;
  }

  // Валидация URL
  let parsedUrl;
  try {
    parsedUrl = new url.URL(targetUrl);
  } catch (error) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Bad Request: Invalid target URL" }));
    return;
  }

  // Выбор протокола (http или https)
  const protocol = parsedUrl.protocol === "https:" ? https : http;

  // Настройка опций для прокси-запроса
  const headers = { ...req.headers };
  // Удаляем внутренние заголовки аутентификации, чтобы не протекали на целевой сервер
  delete headers["x-auth-key"];
  delete headers["x-auth-user"];
  delete headers["x-auth-pass"];
  delete headers["x-target-url"];
  delete headers["authorization"];

  const options = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
    path: parsedUrl.pathname + parsedUrl.search,
    method: req.method,
    headers: {
      ...headers,
      host: parsedUrl.hostname,
    },
  };

  console.log(
    `[${new Date().toISOString()}] Proxying ${
      req.method
    } request to: ${targetUrl}`
  );

  // Выполнение прокси-запроса
  const proxyReq = protocol.request(options, (proxyRes) => {
    // Копируем заголовки ответа
    res.writeHead(proxyRes.statusCode, proxyRes.headers);

    // Передаем данные от целевого сервера клиенту
    proxyRes.pipe(res);
  });

  // Обработка ошибок
  proxyReq.on("error", (error) => {
    console.error(`[${new Date().toISOString()}] Proxy error:`, error.message);

    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
    }
    res.end(
      JSON.stringify({
        error: "Bad Gateway: Failed to reach target server",
        details: error.message,
      })
    );
  });

  // Передаем тело запроса от клиента к целевому серверу
  req.pipe(proxyReq);
});

server.listen(PORT, () => {
  console.log(`Proxy server is running on port ${PORT}`);
  console.log(`Auth user: ${AUTH_USER}`);
  console.log(`\nUsage examples:`);
  console.log(`# health (no auth required)`);
  console.log(`curl http://localhost:${PORT}/health`);
  console.log(`\n# request using Basic auth (curl -u)`);
  console.log(
    `curl -u ${AUTH_USER}:${AUTH_PASS} -H \"X-Target-URL: https://api.example.com/data\" http://localhost:${PORT}`
  );
  // legacy key support removed
});
