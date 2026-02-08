import "dotenv/config";
import { serve } from "@hono/node-server";
import { createBot } from "./bot.js";
import { createWeb } from "./web.js";

const WEB_PORT = parseInt(process.env.WEB_PORT || "3000");

async function main() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error("TELEGRAM_BOT_TOKEN is required");
    process.exit(1);
  }

  // Start web server
  const web = createWeb();
  serve({ fetch: web.fetch, port: WEB_PORT }, (info) => {
    console.log(`🌐 Web server running at http://localhost:${info.port}`);
  });

  // Start bot
  const bot = createBot(botToken);

  bot.catch((err) => {
    console.error("Bot error:", err);
  });

  console.log("🤖 Starting AturUang...");
  await bot.start({
    onStart: (botInfo) => {
      console.log(`✅ Bot @${botInfo.username} is running!`);
    },
  });
}

main().catch(console.error);
