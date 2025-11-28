const http = require("http");
const https = require("https");
const net = require("net");
const url = require("url");
require("dotenv").config();

const AUTH_USER = process.env.AUTH_USER || "admin";
const AUTH_PASS = process.env.AUTH_PASS || "password";
const PORT = process.env.PORT || 3000;

function parseBasic(header) {
  if (!header) return null;
  if (header.startsWith("Basic ")) {
    try {
      const payload = Buffer.from(header.slice(6), "base64").toString("utf8");
      const idx = payload.indexOf(":");
      if (idx === -1) return null;
      return { user: payload.slice(0, idx), pass: payload.slice(idx + 1) };
    } catch (e) {
      return null;
    }
  }
  return null;
}

function isAuthorized(header) {
  const creds = parseBasic(header);
  if (!creds) return false;
  return creds.user === AUTH_USER && creds.pass === AUTH_PASS;
}

function sendProxyAuthRequiredSocket(socket) {
  socket.write("HTTP/1.1 407 Proxy Authentication Required\r\n");
  socket.write('Proxy-Authenticate: Basic realm="Proxy"\r\n');
  socket.write("\r\n");
}

function sendProxyAuthRequiredResponse(res) {
  res.writeHead(407, {
    "Content-Type": "application/json",
    "Proxy-Authenticate": 'Basic realm="Proxy"',
  });
  res.end(JSON.stringify({ error: "Proxy Authentication Required" }));
}

const server = http.createServer((req, res) => {
  // health endpoint (no auth)
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  // Handle preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Check Proxy-Authorization header (or Authorization for some clients)
  const proxyAuth =
    req.headers["proxy-authorization"] || req.headers["authorization"];
  // If header missing -> ask for proxy auth (407)
  if (!proxyAuth) {
    sendProxyAuthRequiredResponse(res);
    return;
  }
  // If header present but invalid -> Forbidden (403)
  if (!isAuthorized(proxyAuth)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Forbidden: invalid credentials" }));
    return;
  }

  // Remove proxy auth headers and common forwarding headers to avoid leaking client IP
  delete req.headers["proxy-authorization"];
  delete req.headers["authorization"];
  delete req.headers["x-forwarded-for"];
  delete req.headers["x-real-ip"];
  delete req.headers["forwarded"];
  delete req.headers["via"];

  // Support absolute-form requests (forward proxy) or relative with Host header
  let target = req.url;
  if (!/^https?:\/\//i.test(target)) {
    const host = req.headers["host"];
    if (!host) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Bad Request: missing Host header" }));
      return;
    }
    target = "http://" + host + req.url;
  }

  let parsed;
  try {
    parsed = new url.URL(target);
  } catch (e) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Bad Request: invalid target URL" }));
    return;
  }

  const protocol = parsed.protocol === "https:" ? https : http;
  const options = {
    hostname: parsed.hostname,
    port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
    path: parsed.pathname + parsed.search,
    method: req.method,
    headers: {
      ...req.headers,
      host: parsed.host,
    },
  };

  console.log(`[${new Date().toISOString()}] Proxying ${req.method} ${target}`);

  const proxyReq = protocol.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (err) => {
    console.error("Proxy request error", err && err.message);
    if (!res.headersSent)
      res.writeHead(502, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "Bad Gateway",
        details: (err && err.message) || null,
      })
    );
  });

  req.pipe(proxyReq);
});

// Handle CONNECT method for HTTPS tunneling
server.on("connect", (req, clientSocket, head) => {
  // req.url is host:port
  const proxyAuth =
    req.headers["proxy-authorization"] || req.headers["authorization"];
  // If header missing -> respond 407 on socket
  if (!proxyAuth) {
    sendProxyAuthRequiredSocket(clientSocket);
    clientSocket.destroy();
    return;
  }
  // If header present but invalid -> respond 403 on socket
  if (!isAuthorized(proxyAuth)) {
    try {
      clientSocket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    } catch (e) {}
    clientSocket.destroy();
    return;
  }

  const [host, port] = req.url.split(":");
  const serverSocket = net.connect(port || 443, host, () => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    // If there is any buffered data, write it to server
    if (head && head.length) serverSocket.write(head);
    // Bi-directional piping
    serverSocket.pipe(clientSocket);
    clientSocket.pipe(serverSocket);
  });

  serverSocket.on("error", (err) => {
    console.error("Tunnel error", err && err.message);
    try {
      clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    } catch (e) {}
    clientSocket.destroy();
  });
});

server.listen(PORT, () => {
  console.log(`Forward proxy listening on port ${PORT}`);
  console.log(`Proxy credentials: ${AUTH_USER}:<hidden>`);
  console.log("Health endpoint: GET /health (no auth)");
  console.log(
    "Use as HTTP proxy: curl -x http://BOT:PASS@HOST:PORT http://example.com"
  );
  console.log(
    "Use as HTTPS proxy (CONNECT): curl -x http://BOT:PASS@HOST:PORT https://example.com"
  );
});
