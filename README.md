# Chairon

Chairon (pronounced Chai-ron) is a little library I made for making bots in the new Geometry Dash 2.209 update.

The API is modelled on [Eris](https://github.com/abalabahaha/eris) so the structure feels familiar.

```js
const { Chairon } = require("chairon");

const bot = new Chairon("coolbot", "password123");

bot.on("ready", () => {
  console.log("Ready!");
});

bot.on("error", (err) => {
  console.error(err);
});

bot.on("messageCreate", async (msg) => {
  if (msg.content === "!ping") {
    await bot.createMessage(msg.thread.id, "Pong!");
  }
});

bot.on("friendRequestCreate", async (req) => {
  await req.accept();
});

bot.connect();
```

## Install

```bash
npm install chairon
```

Requires Node 18 or newer.

## Constructor

```js
new Chairon(username, password, options?)
```

| Option               | Default | Meaning                                                                                           |
| -------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| `threadPollInterval` | `2`     | Seconds between polls of thread list                                                              |
| `friendPollInterval` | `10`    | Seconds between friend request checks                                                             |
| `autoAcceptFriends`  | `false` | Accept incoming friend requests automatically. It is preferred you use the event instead of this. |
| `verbose`            | `false` | Log every poll to stderr                                                                          |

## Events

### `ready`

Fired once logged in and the initial thread list has loaded.

### `messageCreate`

Fired for every new message from another user.

```ts
interface Message {
  id: number;
  content: string;
  timestamp: number; // unix seconds
  author: User | null; // null in group DMs, see below
  thread: Thread;
}

interface Thread {
  id: number;
  /** Group DM name, or the other users name. */
  subject: string;
  /** Group DM description. Empty for dms. */
  description: string;
  /** True when the thread has more than two participants. */
  isGroup: boolean;
  memberIds: number[];
}

interface User {
  id: number; // Geometry Dash user id
  username: string;
}
```

**`author` is `null` in group DMs.** The server reports sender `0` for group messages, so there is no author to attribute. Check before dereferencing:

```js
bot.on("messageCreate", (msg) => {
  const who = msg.author ? msg.author.username : "someone";
  console.log(`${who} said ${msg.content}`);
});
```

### `error`

Fired when a poll fails. The loop keeps going. chairon installs a no op listener so a missing handler cannot crash your process.

### `friendRequestCreate`

Fired for each incoming friend request:

```js
bot.on("friendRequestCreate", async (req) => {
  console.log(`${req.username} wants to be friends`);
  await req.accept();
});
```

Each request carries its own actions.

```ts
interface FriendRequest {
  userId: number;
  username: string;
  accept(): Promise<boolean>; // true when the server took it
  decline(): Promise<boolean>; // true when the server took it
}
```

Declining works the same way:

```js
bot.on("friendRequestCreate", async (req) => {
  if (req.username === "blocked-list") return req.decline();
  return req.accept();
});
```

## Methods

| Method                                             | Returns                   |
| -------------------------------------------------- | ------------------------- |
| `bot.createMessage(threadId, content)`             | new message id, or `null` |
| `bot.sendDirectMessage(userId, content, subject?)` | new message id, or `null` |
| `bot.getThreads()`                                 | `Thread[]`                |
| `bot.destroy()`                                    | nothing                   |

Properties: `bot.username`, `bot.accountId`, `bot.playerId`

`null` means GD refused the send. `chat.id` and `thread.id` are interchangeable.

## Friend requests

Geometry Dash only lets **friends** message each other (outside of group dms), so a bot that nobody has added cannot talk to anyone. Two ways to handle this:

```js
// Option 1: accept automatically
const bot = new Chairon(user, pass, { autoAcceptFriends: true });

// Option 2: decide in the event (recommended)
const bot = new Chairon(user, pass);
bot.on("friendRequestCreate", async (req) => {
  console.log(`${req.username} wants in`);
  await req.accept();
});
```

It is preferred you use the event instead of autoAcceptFriends
