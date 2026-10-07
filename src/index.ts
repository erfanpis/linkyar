import { serve } from "@hono/node-server";
import { config } from "./config.js";
import { createBot } from "./bot.js";
import { createApp } from "./server.js";
import { ensureStorage } from "./storage.js";

async function main() {
  await ensureStorage();

  const bot = createBot();
  const app = createApp({ botReady: Boolean(bot) });

  serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" }, (info) => {
    console.log(`[http] listening on http://127.0.0.1:${info.port}`);
    console.log(`[http] public base: ${config.publicBaseUrl}`);
  });

  if (bot) {
    bot.start({
      onStart: (info) => {
        console.log(`[bot] @${info.username} started`);
      },
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
