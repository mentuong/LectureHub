export function loadConfig(env = process.env) {
  const rawPort = env.PORT;
  if (rawPort === undefined || rawPort === "") {
    return { PORT: 8080 };
  }
  const portNum = Number(rawPort);
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    throw new Error(`Invalid PORT environment variable: '${rawPort}'. Must be an integer between 1 and 65535.`);
  }
  return { PORT: portNum };
}
