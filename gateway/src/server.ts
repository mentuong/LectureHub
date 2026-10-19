import http from "node:http";

export function createServer() {
  return http.createServer((req, res) => {
    const { method, url } = req;

    res.setHeader("Content-Type", "application/json; charset=utf-8");

    if (url === "/health") {
      if (method === "GET") {
        res.statusCode = 200;
        res.end(JSON.stringify({ status: "ok", service: "gateway" }));
        return;
      } else {
        res.statusCode = 405;
        res.end(JSON.stringify({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed", details: null } }));
        return;
      }
    }

    if (method === "GET") {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "Not found", details: null } }));
      return;
    } else {
      res.statusCode = 405;
      res.end(JSON.stringify({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed", details: null } }));
      return;
    }
  });
}
