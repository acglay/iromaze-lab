// 依存なしの静的サーバー(開発・smoke用)。 npm run dev → http://localhost:5193
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 5193);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

http
  .createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const f = path.join(root, p);
    if (!f.startsWith(root) || !fs.existsSync(f)) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": (TYPES[path.extname(f)] || "application/octet-stream") + "; charset=utf-8", "Cache-Control": "no-store" });
    fs.createReadStream(f).pipe(res);
  })
  .listen(port, () => console.log(`http://localhost:${port}`));
