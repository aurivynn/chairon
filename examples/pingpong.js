const { Chairon } = require("chairon");

// Replace USERNAME and PASSWORD with the bot account's credentials.
const bot = new Chairon("username", "password");

bot.on("ready", () => {
  console.log("Ready!");
});

bot.on("error", (err) => {
  console.error(err);
});

bot.on("messageCreate", async (msg) => {
  if (msg.content === "!ping") {
    await bot.createMessage(msg.thread.id, "Pong!");
  } else if (msg.content === "!pong") {
    await bot.createMessage(msg.thread.id, "Ping!");
  }
});

bot.on("friendRequestCreate", async (req) => {
  // Automatically accepts all friend requests sent
  await req.accept();
});

bot.connect();
