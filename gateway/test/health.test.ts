import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { loadConfig } from "../src/config.js";
import { createServer } from "../src/server.js";

function listenServer(): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object" && "port" in address) {
        resolve({ server, port: (address as AddressInfo).port });
      } else {
        reject(new Error("Failed to get server address"));
      }
    });
  });
}

function request(options: http.RequestOptions, body?: string): Promise<{ statusCode: number | undefined; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res: http.IncomingMessage) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        resolve({ statusCode: res.statusCode, headers: res.headers, body: data });
      });
    });
    req.on("error", reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

test("GET /health returns 200 with correct body", async () => {
  const { server, port } = await listenServer();
  try {
    const res = await request({ hostname: "127.0.0.1", port, path: "/health", method: "GET" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "application/json; charset=utf-8");
    const json = JSON.parse(res.body);
    assert.deepEqual(json, { status: "ok", service: "gateway" });
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});

test("GET unknown path returns 404 NOT_FOUND", async () => {
  const { server, port } = await listenServer();
  try {
    const res = await request({ hostname: "127.0.0.1", port, path: "/unknown", method: "GET" });
    assert.equal(res.statusCode, 404);
    assert.equal(res.headers["content-type"], "application/json; charset=utf-8");
    const json = JSON.parse(res.body);
    assert.equal(json.error.code, "NOT_FOUND");
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});

test("POST /health returns 405 METHOD_NOT_ALLOWED", async () => {
  const { server, port } = await listenServer();
  try {
    const res = await request({ hostname: "127.0.0.1", port, path: "/health", method: "POST" }, "");
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers["content-type"], "application/json; charset=utf-8");
    const json = JSON.parse(res.body);
    assert.equal(json.error.code, "METHOD_NOT_ALLOWED");
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});

test("loadConfig returns default PORT 8080 if not set", () => {
  const config = loadConfig({});
  assert.equal(config.PORT, 8080);
});

test("loadConfig throws if PORT is not a valid integer", () => {
  assert.throws(() => loadConfig({ PORT: "abc" }), {
    message: /Invalid PORT environment variable: 'abc'/
  });
});

test("loadConfig throws if PORT is out of range", () => {
  assert.throws(() => loadConfig({ PORT: "70000" }), {
    message: /Invalid PORT environment variable: '70000'/
  });
});
