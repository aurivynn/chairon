export interface User {
  /** Geometry Dash user id. */
  id: number;
  username: string;
}

export interface Thread {
  id: number;
  /** Group DM name, or the other users name for a DM. */
  subject: string;
  /** Group DM description. Empty for DM threads. */
  description: string;
  /** True when the thread has multiple participants. */
  isGroup: boolean;
  /** Participant user ids. Empty when the server does not report them. */
  memberIds: number[];
  /** Number of unread messages. */
  unreadCount: number;
}

export interface Message {
  id: number;
  content: string;
  /** Unix seconds, as reported by the server. */
  timestamp: number;
  /** Null in group DMs. */
  author: User | null;
  thread: Thread;
}

export interface FriendRequest {
  userId: number;
  username: string;
  /** Accept the request. Resolves true when the server took it. */
  accept(): Promise<boolean>;
  /** Decline the request. Resolves true when the server took it. */
  decline(): Promise<boolean>;
}

export interface Options {
  /** Seconds between polls of thread list. Default 2. */
  threadPollInterval?: number;
  /** Seconds between friend request checks. Default 10. */
  friendPollInterval?: number;
  /** Automatically accept incoming friend requests. Default false. */
  autoAcceptFriends?: boolean;
  /** Log every poll to stderr. Default false. */
  verbose?: boolean;
}
