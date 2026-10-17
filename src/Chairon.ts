import { EventEmitter } from "node:events";

import { ChaironClient } from "./client";
import type { RawMessage } from "./client";
import type {
  FriendRequest,
  Message,
  Options,
  Thread,
  ThreadInvite,
} from "./structures";

const DEFAULTS = {
  threadPollInterval: 2,
  friendPollInterval: 10,
  autoAcceptFriends: false,
  autoAcceptInvites: false,
  autoLeaveRemoved: false,
  verbose: false,
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface ChaironEvents {
  ready: [];
  messageCreate: [message: Message];
  error: [error: Error];
  friendRequestCreate: [request: FriendRequest];
  threadInviteCreate: [invite: ThreadInvite];
}

export class Chairon extends EventEmitter {
  readonly options: Required<Options>;

  private client: ChaironClient | null = null;
  private cursors = new Map<number, number>();
  private usernames = new Map<number, string>();
  private announcedFriends = new Set<number>();
  private announcedInvites = new Set<number>();

  private threads = new Map<number, Thread>();
  private running = false;
  private lastRefresh = 0;
  private lastFriendCheck = 0;

  constructor(
    readonly username: string,
    readonly password: string,
    options: Options = {},
  ) {
    super();

    this.on("error", () => {});

    this.options = { ...DEFAULTS, ...options };
  }

  get accountId(): number {
    return this.require().accountId;
  }

  get playerId(): number {
    return this.require().playerId;
  }

  /** Send a message into a thread. Resolves to the new message id, or null. */
  createMessage(threadId: number, content: string): Promise<number | null> {
    return this.require().sendMessage(threadId, content);
  }

  /** Send a direct message to a user id. */
  sendDirectMessage(
    userId: number,
    content: string,
    subject = "",
  ): Promise<number | null> {
    return this.require().sendDirectMessage(userId, content, subject);
  }

  /** Threads currently known, in discovery order. */
  getThreads(): Thread[] {
    return [...this.threads.values()];
  }

  /**
   * Log in, then poll forever until destroyed. Resolves once the first poll cycle has finished.
   */
  async connect(): Promise<this> {
    if (this.running) return this;
    this.running = true;

    try {
      const client = await ChaironClient.login(this.username, this.password);
      this.client = client;
      this.usernames.set(client.accountId, this.username);

      for (const thread of await client.listThreads()) {
        this.threads.set(thread.id, thread);
      }

      this.emit("ready");
      void this.loop();
    } catch (error) {
      this.running = false;
      throw error;
    }

    return this;
  }

  /** Stop polling. */
  destroy(): void {
    this.running = false;
  }

  private require(): ChaironClient {
    if (!this.client)
      throw new Error("Chairon is not connected. Call connect() first.");
    return this.client;
  }

  private log(message: string): void {
    if (this.options.verbose) console.error(message);
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        await this.tick();
      } catch (error) {
        this.emit(
          "error",
          error instanceof Error ? error : new Error(String(error)),
        );
      }
      await sleep(this.options.threadPollInterval * 1000);
    }
  }

  private async tick(): Promise<void> {
    const client = this.require();
    const now = Date.now();

    if (now - this.lastFriendCheck >= this.options.friendPollInterval * 1000) {
      this.lastFriendCheck = now;
      await this.handleFriendRequests();
      await this.handleThreadInvites();
    }

    const listed = await client.listThreads();

    for (const thread of listed) {
      const known = this.threads.get(thread.id);

      // geometry dash keeps threads you were removed from in the list, so they need clearing explicitly or they get polled forever.
      if (thread.removed) {
        if (this.threads.has(thread.id)) {
          this.threads.delete(thread.id);
          this.log(`dropped thread ${thread.id}: removed from group`);
        }
        if (this.options.autoLeaveRemoved) {
          try {
            await client.leaveGroup(thread.id);
            this.log(`left removed group ${thread.id}`);
          } catch (err) {
            this.emit(
              "error",
              err instanceof Error ? err : new Error(String(err)),
            );
          }
        }
        continue;
      }

      if (!known) {
        this.log(`new thread ${thread.id} (${thread.subject})`);
        this.threads.set(thread.id, thread);
        await this.pollThread(thread.id);
        continue;
      }

      // keep whatever the message endpoint learned (members, description)
      this.threads.set(thread.id, {
        ...known,
        ...thread,
        memberIds: known.memberIds.length ? known.memberIds : thread.memberIds,
      });

      if (thread.unreadCount === 0) {
        this.log(`skip ${thread.id}: no unread`);
        continue;
      }

      await this.pollThread(thread.id);
    }
  }

  private async handleThreadInvites(): Promise<void> {
    const client = this.require();

    for (const invite of await client.listThreadInvites()) {
      if (this.announcedInvites.has(invite.threadId)) continue;
      this.announcedInvites.add(invite.threadId);

      if (this.options.autoAcceptInvites) {
        if (await invite.accept()) {
          this.log(`accepted invite to "${invite.name}"`);
        } else {
          this.announcedInvites.delete(invite.threadId);
          this.emit(
            "error",
            new Error(`Could not accept invite to "${invite.name}".`),
          );
          continue;
        }
      }

      this.emit("threadInviteCreate", invite);
    }
  }

  private async handleFriendRequests(): Promise<void> {
    const client = this.require();

    for (const request of await client.listFriendRequests()) {
      if (this.announcedFriends.has(request.userId)) continue;
      this.announcedFriends.add(request.userId);

      if (this.options.autoAcceptFriends) {
        if (await request.accept()) {
          this.log(`accepted friend request from ${request.username}`);
        } else {
          this.announcedFriends.delete(request.userId);
          this.emit(
            "error",
            new Error(
              `Could not accept friend request from ${request.username}.`,
            ),
          );
          continue;
        }
      }

      this.emit("friendRequestCreate", request);
    }
  }

  private async resolveUsername(userId: number): Promise<string> {
    const cached = this.usernames.get(userId);
    if (cached) return cached;

    const name = await this.require().getUsername(userId);
    this.usernames.set(userId, name);
    return name;
  }

  private async pollThread(threadId: number): Promise<void> {
    const client = this.require();
    const cursor = this.cursors.get(threadId);
    const first = await client.getMessages(threadId, cursor ?? 0);

    let messages: RawMessage[];

    if (cursor !== undefined) {
      messages = first.messages.filter((m) => m.id > cursor);
    } else {
      const unread = this.threads.get(threadId)?.unreadCount ?? 0;
      messages = unread > 0 ? first.messages.slice(-unread) : first.messages;
    }

    this.log(
      `poll ${threadId}: cursor=${cursor ?? "-"} of ${first.messages.length} ` +
        `processing ${messages.length}`,
    );

    const known = this.threads.get(threadId);
    if (first.thread.subject || first.thread.memberIds.length) {
      this.threads.set(threadId, {
        ...known,
        id: threadId,
        subject: first.thread.subject || known?.subject || "",
        description: first.thread.description || known?.description || "",
        isGroup: known?.isGroup ?? first.thread.isGroup,
        memberIds: first.thread.memberIds,
        unreadCount: known?.unreadCount ?? 0,
      });
    }
    const thread = this.threads.get(threadId) ?? first.thread;

    for (const raw of messages) {
      this.cursors.set(threadId, raw.id);

      // Our own messages never come back to us.
      if (raw.sender === client.accountId) continue;

      // group DMs report sender 0
      if (raw.sender === 0 && /^\d+,/.test(raw.content)) {
        this.log(`system event in ${threadId}: ${raw.content}`);
        continue;
      }

      const message: Message = {
        id: raw.id,
        content: raw.content,
        timestamp: raw.timestamp,
        // Group DMs report sender 0.
        author:
          raw.sender > 0
            ? {
                id: raw.sender,
                username: await this.resolveUsername(raw.sender),
              }
            : null,
        thread,
      };

      this.emit("messageCreate", message);
    }
  }
}

export default Chairon;
