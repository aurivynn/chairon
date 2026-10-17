const { Chairon } = require("chairon");

// Geometry Dash only lets friends message each other, so a bot that nobody has added cannot reply to anyone.
const bot = new Chairon("username", "password");

bot.on("ready", () => {
  console.log("Ready!");
});

bot.on("friendRequestCreate", async (req) => {
  console.log(`${req.username} wants to be friends`);
});

bot.on("messageCreate", async (msg) => {
  const who = msg.author ? msg.author.username : "someone";
  const where = msg.thread.isGroup ? `group "${msg.thread.subject}"` : "DM";

  if (msg.content === "!ping") {
    await bot.createMessage(msg.thread.id, `Pong! (${who}, ${where})`);
  } else if (msg.content === "!members" && msg.thread.memberIds.length) {
    await bot.createMessage(
      msg.thread.id,
      `${msg.thread.memberIds.length} members: ${msg.thread.memberIds.join(", ")}`,
    );
  }
});

bot.connect();
