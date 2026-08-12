// Per-turn inbox for the commit-reveal exchange.
//
// A turn must start listening BEFORE it starts waiting: the opponent can
// commit while the local player is still choosing, and `peer.onMessage`
// delivers only to handlers registered at the moment a message arrives. A
// handler installed after the fact never sees it, and the turn deadlocks.
// The inbox is opened at the top of the turn, buffers whatever lands for
// that turn number, and is closed in a `finally` so it cannot outlive it.

import type { PeerHandle, WireMessage } from "./peer";

export interface OpponentCommit {
  commit: string;
  cell: number;
}

export interface OpponentReveal {
  bid: number;
  salt: string;
}

export interface TurnInbox {
  /** True once the opponent's commit for this turn has landed. */
  hasCommit(): boolean;
  /** Resolves with the opponent's commit, immediately if already buffered. */
  commit(): Promise<OpponentCommit>;
  /** Resolves with the opponent's reveal, immediately if already buffered. */
  reveal(): Promise<OpponentReveal>;
  /** Run `fn` when the opponent's commit lands (or now, if it already has).
   *  Returns an unsubscribe function. */
  onCommit(fn: () => void): () => void;
  /** Resolves if the peer goes away — the channel closed or the match was
   *  abandoned. Never rejects. */
  closed(): Promise<void>;
  /** Detach every listener. Always call this when the turn ends. */
  close(): void;
}

export function openTurnInbox(peer: PeerHandle, turn: number): TurnInbox {
  let commitMsg: OpponentCommit | null = null;
  let revealMsg: OpponentReveal | null = null;
  let gone = false;

  const commitWaiters = new Set<(c: OpponentCommit) => void>();
  const revealWaiters = new Set<(r: OpponentReveal) => void>();
  const commitSubs = new Set<() => void>();
  const closeWaiters = new Set<() => void>();

  const onMessage = (msg: WireMessage) => {
    if (msg.kind === "commit" && msg.turn === turn) {
      if (commitMsg) return;
      commitMsg = { commit: msg.commit, cell: msg.cell };
      for (const w of [...commitWaiters]) w(commitMsg);
      commitWaiters.clear();
      for (const s of [...commitSubs]) s();
    } else if (msg.kind === "reveal" && msg.turn === turn) {
      if (revealMsg) return;
      revealMsg = { bid: msg.bid, salt: msg.salt };
      for (const w of [...revealWaiters]) w(revealMsg);
      revealWaiters.clear();
    } else if (msg.kind === "leave") {
      onGone();
    }
  };

  const onClose = () => onGone();

  function onGone() {
    if (gone) return;
    gone = true;
    for (const w of [...closeWaiters]) w();
    closeWaiters.clear();
  }

  peer.onMessage(onMessage);
  peer.onClose(onClose);

  return {
    hasCommit: () => commitMsg !== null,
    commit: () =>
      commitMsg
        ? Promise.resolve(commitMsg)
        : new Promise<OpponentCommit>((resolve) => commitWaiters.add(resolve)),
    reveal: () =>
      revealMsg
        ? Promise.resolve(revealMsg)
        : new Promise<OpponentReveal>((resolve) => revealWaiters.add(resolve)),
    onCommit(fn) {
      if (commitMsg) {
        fn();
        return () => {};
      }
      commitSubs.add(fn);
      return () => commitSubs.delete(fn);
    },
    closed: () =>
      gone ? Promise.resolve() : new Promise<void>((resolve) => closeWaiters.add(resolve)),
    close() {
      peer.offMessage(onMessage);
      peer.offClose(onClose);
      commitWaiters.clear();
      revealWaiters.clear();
      commitSubs.clear();
      closeWaiters.clear();
    },
  };
}
