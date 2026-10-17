import { createHash } from "node:crypto";

import {
  BASE_URL,
  BINARY_VERSION,
  DVS,
  GAME_VERSION,
  GJP_SALT,
  LOGIN_SECRET,
  SECRET,
} from "./constants";
import { HTTPError, LoginError } from "./errors";
import type { FriendRequest, Thread, ThreadInvite } from "./structures";

export interface RawMessage {
  id: number;
  sender: number;
  content: string;
  timestamp: number;
}

export interface RawThreadPage {
  messages: RawMessage[];
  thread: Thread;
}

const sha1 = (value: string): string =>
  createHash("sha1").update(value, "utf8").digest("hex");

export const decode = (value: string): string => {
  if (!value) return "";
  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch {
    return "";
  }
};

export const stripPrefix = (raw: string): string =>
  raw.replace(/^\d+[a-z]?\r?\n/, "");

export const head = (raw: string): string =>
  stripPrefix(raw).split("#")[0] ?? "";

export const field = (entry: string, key: string): string => {
  const parts = entry.split(":");
  for (let i = 0; i + 1 < parts.length; i += 2) {
    if (parts[i] === key) return parts[i + 1] ?? "";
  }
  return "";
};

export const isError = (raw: string): boolean => {
  const trimmed = raw.trim();
  return trimmed === "" || (trimmed.startsWith("-") && !trimmed.includes(":"));
};

export class ChaironClient {
  readonly accountId: number;
  readonly playerId: number;
  readonly username: string;

  private readonly gjp2: string;
  private readonly identity: Record<string, string>;

  constructor(
    accountId: number,
    playerId: number,
    username: string,
    password: string,
  ) {
    this.accountId = accountId;
    this.playerId = playerId;
    this.username = username;
    this.gjp2 = sha1(password + GJP_SALT);

    const digest = createHash("sha1").update(username, "utf8").digest();
    this.identity = {
      gameVersion: GAME_VERSION,
      binaryVersion: BINARY_VERSION,
      udid: "S" + digest.readUInt32BE(0).toString().padStart(32, "0"),
      uuid: String(digest.readUInt32BE(4) % 1_000_000_000),
      dvs: DVS,
    };
  }

  static async login(
    username: string,
    password: string,
  ): Promise<ChaironClient> {
    const digest = createHash("sha1").update(username, "utf8").digest();
    const raw = await ChaironClient.request("accounts/loginGJAccount.php", {
      gameVersion: GAME_VERSION,
      binaryVersion: BINARY_VERSION,
      udid: "S" + digest.readUInt32BE(0).toString().padStart(32, "0"),
      userName: username,
      gjp2: sha1(password + GJP_SALT),
      secret: LOGIN_SECRET,
    });

    const match = /^(-?\d+),(-?\d+)$/.exec(raw.trim());
    if (!match) throw new LoginError(Number(raw.trim()) || -1);

    return new ChaironClient(
      Number(match[1]),
      Number(match[2]),
      username,
      password,
    );
  }

  // User-Agent must be sent empty. Thanks robtop
  static async request(
    path: string,
    params: Record<string, string>,
  ): Promise<string> {
    const res = await fetch(BASE_URL + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "*/*",
        "User-Agent": "",
      },
      body: new URLSearchParams(params).toString(),
    });

    if (!res.ok) throw new HTTPError(path, res.status);
    return res.text();
  }

  private auth(extra: Record<string, string>): Record<string, string> {
    return {
      ...this.identity,
      accountID: String(this.accountId),
      gjp2: this.gjp2,
      secret: SECRET,
      ...extra,
    };
  }

  /**
   * Thread list entries are positional:
   *   0 threadId  2 lastMessage(b64)  3 subject(b64)  4 unread  7 participants
   *   9 lastSenderId  12 read  21 description(b64)  23 lastMessageUnix
   */
  async listThreads(): Promise<Thread[]> {
    const raw = await ChaironClient.request(
      "getGJThreads.php",
      this.auth({ page: "0", filter: "0", removed: "1" }),
    );

    const threads: Thread[] = [];
    for (const entry of head(raw).split("|").filter(Boolean)) {
      const parts = entry.split(":");
      const id = Number(parts[0]);
      if (!Number.isFinite(id) || id <= 0) continue;

      const isGroup = Number(parts[1]) === 0;

      const subject = isGroup ? decode(parts[3] ?? "") : decode(parts[2] ?? "");
      const description = isGroup ? decode(parts[21] ?? "") : "";

      threads.push({
        id,
        subject,
        description,
        isGroup,
        memberIds: [],
        unreadCount: Number(parts[4]) || 0,
        // status code, not a boolean. 8 means removed from the group
        removed: parts[25] === "8",
      });
    }
    return threads;
  }

  async getMessages(threadId: number, afterId = 0): Promise<RawThreadPage> {
    const raw = await ChaironClient.request(
      "getGJThreadMessages.php",
      this.auth({
        threadID: String(threadId),
        beforeID: "0",
        afterID: String(afterId),
      }),
    );

    const parts = stripPrefix(raw).split("##");

    // Group DMs: part 0 is <messages>#<members> and part 1 holds the meta chunk
    // DM: everything is in part 0
    const primary = parts[0] ?? "";
    const secondary = parts[1] ?? "";

    const cut = primary.indexOf("#");
    const messageBlob = cut === -1 ? primary : primary.slice(0, cut);
    const afterMessages = cut === -1 ? "" : primary.slice(cut + 1);

    if (!messageBlob || messageBlob === "none") {
      return { messages: [], thread: emptyThread(threadId) };
    }

    const memberIds: number[] = [];
    let meta = "";

    for (const segment of afterMessages.split("|").filter(Boolean)) {
      const boundary = segment.indexOf("#");

      if (boundary !== -1) {
        const memberPart = segment.slice(0, boundary);
        const name = memberPart.split(":")[1] ?? "";
        void name;
        meta = segment.slice(boundary + 1);
      }

      const memberFields = (
        boundary === -1 ? segment : segment.slice(0, boundary)
      ).split(":");
      if (memberFields[0] === "1" && memberFields.length > 1) {
        // Account ids sit in field 2 of the member object
        const accountId = Number(memberFields[2]);
        if (Number.isFinite(accountId) && accountId > 0)
          memberIds.push(accountId);
      }
    }

    if (!meta) {
      for (const segment of secondary.split("|").filter(Boolean)) {
        const boundary = segment.indexOf("#");
        if (boundary !== -1) {
          meta = segment.slice(boundary + 1);
          break;
        }
      }
    }

    const metaFields = meta.split(":");
    // Field 8 is the groups display name
    // field 3 is its description
    const subject = decode(metaFields[8] ?? "");
    const description = decode(metaFields[3] ?? "");

    const messages: RawMessage[] = [];
    for (const entry of messageBlob.split("|").filter(Boolean)) {
      const [id, sender, body, timestamp] = entry.split(":");
      messages.push({
        id: Number(id),
        sender: Number(sender),
        content: decode(body ?? ""),
        timestamp: Number(timestamp),
      });
    }

    return {
      messages,
      thread: {
        id: threadId,
        subject,
        description,
        isGroup: undefined,
        memberIds,
        unreadCount: 0,
      },
    };
  }

  /**
   * Returns the new message id, or null if the server rejected the send
   */
  async sendMessage(threadId: number, content: string): Promise<number | null> {
    const raw = await ChaironClient.request(
      "sendGJThreadMessage.php",
      this.auth({
        threadID: String(threadId),
        body: Buffer.from(content, "utf8").toString("base64"),
      }),
    );

    const match = /(\d+):(\d+)\s*$/.exec(raw.trim());
    return match ? Number(match[2]) : null;
  }

  /**
   * start (or continue) a direct message thread with a user
   */
  async sendDirectMessage(
    userId: number,
    content: string,
    subject = "",
  ): Promise<number | null> {
    const raw = await ChaironClient.request(
      "sendGJThreadMessage.php",
      this.auth({
        threadID: "0",
        isDM: "1",
        toAccountID: String(userId),
        subject: Buffer.from(subject, "utf8").toString("base64"),
        body: Buffer.from(content, "utf8").toString("base64"),
      }),
    );

    const match = /(\d+):(\d+)\s*$/.exec(raw.trim());
    return match ? Number(match[2]) : null;
  }

  async getUsername(userId: number): Promise<string> {
    const raw = await ChaironClient.request(
      "getGJUserInfo20.php",
      this.auth({ targetAccountID: String(userId) }),
    );

    if (isError(raw)) return `user${userId}`;

    const name = (raw.split(":")[1] ?? "").trim();
    return name && !/^-?\d+$/.test(name) ? name : `user${userId}`;
  }

  /**
   * Pending group DM invites
   *
   * Fields: 0 threadId  1 inviterId  2 inviterName(b64)  3 name(b64)  8 desc(b64)
   */
  async listThreadInvites(): Promise<ThreadInvite[]> {
    const raw = await ChaironClient.request(
      "getGJThreadInvites.php",
      this.auth({}),
    );

    const block = head(raw);
    if (!block || block === "none" || block.startsWith("-")) return [];

    const parts = block.split(":");
    const threadId = Number(parts[0]);
    const inviterId = Number(parts[1]);

    const invite: ThreadInvite = {
      threadId,
      inviterId: Number.isFinite(inviterId) ? inviterId : 0,
      inviterName: decode(parts[2] ?? ""),
      name: decode(parts[3] ?? ""),
      description: decode(parts[8] ?? ""),
      accept: () => this.acceptThreadInvite(threadId),
      decline: () => this.declineThreadInvite(threadId),
    };

    return Number.isFinite(threadId) && threadId > 0 ? [invite] : [];
  }

  /** Join a group DM. Returns true when the server accepted. */
  async acceptThreadInvite(threadId: number): Promise<boolean> {
    const raw = await ChaironClient.request(
      "updateGJThread.php",
      this.auth({ threadID: String(threadId), mode: "8" }),
    );
    return raw.trim() === "1";
  }

  /**
   * Decline ("ignore") a group DM invite. Returns true when the server accepted.
   */
  async declineThreadInvite(threadId: number): Promise<boolean> {
    const raw = await ChaironClient.request(
      "updateGJThread.php",
      this.auth({ threadID: String(threadId), mode: "9" }),
    );
    return raw.trim() === "1";
  }

  /** Leave a group DM. Returns true when the server accepted. */
  async leaveGroup(threadId: number): Promise<boolean> {
    const raw = await ChaironClient.request(
      "updateGJThread.php",
      this.auth({ threadID: String(threadId), mode: "18" }),
    );
    return raw.trim() === "1";
  }

  async listFriendRequests(): Promise<FriendRequest[]> {
    const raw = await ChaironClient.request(
      "getGJFriendRequests20.php",
      this.auth({ page: "0", total: "0" }),
    );

    const block = head(raw);
    if (!block || isError(raw)) return [];

    const requests: FriendRequest[] = [];
    for (const entry of block.split("|").filter(Boolean)) {
      const userId = Number(field(entry, "16"));
      const requestId = Number(field(entry, "32"));
      const username = field(entry, "1").trim();
      if (!Number.isFinite(userId) || userId <= 0 || !username) continue;

      requests.push({
        userId,
        username,
        accept: () => this.acceptFriendRequest(userId, requestId),
        decline: () => this.declineFriendRequest(userId, requestId),
      });
    }
    return requests;
  }

  /**
   * `targetAccountID` despite its name takes a user id, not an account id
   */
  async acceptFriendRequest(
    userId: number,
    requestId: number,
  ): Promise<boolean> {
    const raw = await ChaironClient.request(
      "acceptGJFriendRequest20.php",
      this.auth({
        targetAccountID: String(userId),
        requestID: String(requestId),
      }),
    );
    return raw.trim() === "1";
  }

  /**
   * Declines or removes a friend request. `isSender` is 0 when acting on a request someone sent us, 1 when removing one we sent.
   */
  async declineFriendRequest(
    userId: number,
    requestId: number,
  ): Promise<boolean> {
    const raw = await ChaironClient.request(
      "deleteGJFriendRequests20.php",
      this.auth({
        accounts: String(userId),
        targetAccountID: String(userId),
        isSender: "0",
        requestID: String(requestId),
      }),
    );
    return raw.trim() === "1";
  }
}

const emptyThread = (id: number): Thread => ({
  id,
  subject: "",
  description: "",
  isGroup: false,
  memberIds: [],
  unreadCount: 0,
  removed: false,
});
