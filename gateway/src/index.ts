import { loadConfig } from "./config.js";
import { createServer } from "./server.js";

async function main() {
  try {
    const { PORT } = loadConfig();
    const server = createServer();
    server.listen(PORT, () => {
      console.log(`Gateway server listening on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
