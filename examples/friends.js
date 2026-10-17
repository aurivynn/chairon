const { Chairon } = require("chairon");

// Geometry Dash only lets friends message each other, so a bot that nobody has added cannot reply to anyone.
const bot = new Chairon("username", "password");

bot.on("ready", () => {
  console.log("Ready!");
});

bot.on("friendRequestCreate", async (req) => {
  // req.accept()  -> resolves true when the server took it
  // req.decline() -> resolves true when the server took it
  console.log(`${req.username} (${req.userId}) wants to be friends`);

  if (req.username === "someone-you-dont-like") {
    await req.decline();
    console.log(`declined ${req.username}`);
    return;
  }

  await req.accept();
  console.log(`accepted ${req.username}, we can talk now`);
});

bot.on("messageCreate", async (msg) => {
  const who = msg.author ? msg.author.username : "someone";

  if (msg.content === "!ping") {
    await bot.createMessage(msg.thread.id, `Pong! (${who})`);
  }
});

bot.connect();
