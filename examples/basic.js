const { Chairon } = require("chairon");

const bot = new Chairon("username", "password", {
  threadPollInterval: 2,
  friendPollInterval: 10,
});

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
  } else if (msg.content === "!whoami") {
    await bot.createMessage(
      msg.thread.id,
      `${msg.author.username} (${msg.author.id}) in "${msg.thread.subject}"`,
    );
  }
});

bot.connect();

process.on("SIGINT", () => {
  bot.destroy();
  process.exit(0);
});
