import { createServer } from "http";
import next from "next";
import { Server } from "socket.io";
import { registerLobbyHandlers } from "./lobby";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "localhost";
const port = Number(process.env.PORT ?? 3000);

async function main() {
  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();

  await app.prepare();

  const httpServer = createServer((request, response) => {
    void handle(request, response);
  });

  const io = new Server(httpServer, {
    cors: {
      origin: dev ? [`http://${hostname}:${port}`, `http://127.0.0.1:${port}`] : undefined,
    },
  });

  registerLobbyHandlers(io);

  httpServer.listen(port, () => {
    console.log(`Ready on http://${hostname}:${port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
