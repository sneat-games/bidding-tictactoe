// vs-friend screen. Hosts a private room (reserve a code, share a link), or
// joins an existing room as the guest, over @sneat/game-kit's shared `pvp`
// module (hostPeer/guestPeer/reserveRoomId) against the shared relay at
// webrtc.sneat.games — game-kit/docs/DESIGN.md's PvP protocol v1.
//
// BTTT predates the kit (the kit was extracted FROM this game) and used to
// carry its own peer.ts/room.ts/turn-inbox.ts against its own deployed
// signal.bidding-tictactoe.sneat.games worker, un-namespaced by gameId. That
// duplication is why vs-Friend shipped broken for two days (commit 777fb59):
// a signaling bug fixed in this file's old code never reached the kit's copy
// and vice versa. `gameId: "bidding-tictactoe"` below namespaces this game's
// room codes on the shared relay so a fix in the kit's peer.ts now reaches
// every game, this one included.
//
// The host already knows the (single) match shape; the guest joins straight
// off a `#room=` link (see main.ts) and has never seen a menu, so it learns
// nothing is left to negotiate only once the host's `hello` confirms
// `{game, protocol, config}` match — same handshake every other kit-based
// sneat-games title runs (see e.g. greed-game/web/src/ui/vs-friend.ts), even
// though this game currently ships exactly one mode. Host is always player 0
// (Mark.X); guest is player 1 (Mark.O) — game-kit/docs/DESIGN.md "Host is
// P1" — so `human` is derived from `peer.role`, never sent ad hoc the way
// this file's pre-migration `hello` type (declared but never actually sent)
// used to imply.
//
// Once the DataChannel is open, both peers exchange hidden-bid moves using
// the kit's commit-reveal primitives, on the 2x2 match screen (balances +
// bid panel on top, board + game log below). After a win/draw the peers can
// rematch in the same room.
//
// Turn clock: each client auto-submits only its OWN move when a deadline
// expires (see turn-clock.ts), so a timeout can never leave the two boards
// disagreeing. When a peer stops answering altogether, the match is
// abandoned with a notice rather than resolved by guesswork.

import { Mark, Outcome, newGame, resolveTurn, boardOutcome, Game, Move } from "../engine/btttplay";
import {
  reserveRoomId,
  shareLinkFor,
  hostPeer,
  guestPeer,
  openTurnInbox,
  commitPayload,
  verifyPayload,
  newSalt,
  type PeerHandle,
  type WireMessage,
} from "@sneat/game-kit";
import { askMove } from "./ask-move";
import { createMatchScreen, renderMatchOver, type MatchScreen } from "./match-screen";
import { winningLine } from "./win-line";
import * as cg from "../crazygames/sdk";

/** Namespaces this game's rooms on the shared relay; see webrtc-relay's
 *  `[a-z0-9_-]{1,32}` gameId validation. */
const GAME_ID = "bidding-tictactoe";
const PROTOCOL = 1;
const HELLO_TIMEOUT_MS = 20_000;

const BUDGET = 100;

/** The one match shape this build speaks — BTTT has no variant/size choice,
 *  unlike hex/gomoku's classic-vs-bidding menu. The guest still checks this
 *  against the host's `hello` rather than assuming, so a future rule change
 *  or a stale client is a clean refusal instead of two peers silently
 *  running different rules against each other. */
const MATCH_CONFIG = { mode: "classic", budget: BUDGET } as const;

/** How long to wait for a peer's message before declaring them gone. Their
 *  own clock forces a move within STALL_MS, so silence past this is a dead
 *  tab, not a slow player. */
const PEER_GRACE_MS = 45_000;

/** Thrown when the opponent stops responding mid-match. Never resolves a
 *  turn — it abandons the match, so both sides can only ever agree. */
class PeerGoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PeerGoneError";
  }
}

/**
 * e2e-only relay override — see playwright.config.ts. Unset in every normal
 * dev/production build (this branch is then inert), so the kit's own
 * `defaultRelayBase()` (localhost:8787, or the real webrtc.sneat.games off
 * localhost) applies. e2e needs an override because this repo's suite
 * deliberately does NOT share the kit's conventional 8787 — a real
 * `webrtc-relay` dev server can legitimately already be running there on a
 * developer's machine, and adopting it would run this suite against
 * whatever room state that instance happens to hold instead of an isolated,
 * disposable double.
 */
function relayBaseOverride(): string | undefined {
  return (import.meta as { env?: { PUBLIC_RELAY_BASE?: string } }).env?.PUBLIC_RELAY_BASE;
}

export async function runVsFriend(
  root: HTMLElement,
  opts: { as: "host" | "guest"; roomId?: string },
): Promise<void> {
  let peer: PeerHandle | null = null;
  let roomId = opts.roomId ?? "";
  const relayBase = relayBaseOverride();

  try {
    if (opts.as === "host") {
      roomId = await reserveRoomId({ gameId: GAME_ID, relayBase });
      cg.updateRoom({ roomId, isJoinable: true, inviteParams: { roomId } });
      const cgShareLink = cg.inviteLink({ roomId });
      // Render the invite UI BEFORE awaiting hostPeer: hostPeer blocks until
      // the guest's answer arrives, which can only happen once the guest has
      // read this room code — awaiting it first would leave the host staring
      // at a blank screen with nothing to share, deadlocked against a guest
      // who can never connect (see game-kit/docs/APP-PLAYBOOK.md gotcha 5).
      // shareLinkFor builds the same link from roomId (already known here),
      // so nothing here waits on the peer.
      const base = typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}` : "";
      renderInvite(root, {
        roomId,
        shareLink: shareLinkFor(base, roomId),
        cgShareLink,
      });
      peer = await hostPeer({ gameId: GAME_ID, roomId, relayBase });
      peer.send({ kind: "hello", game: GAME_ID, protocol: PROTOCOL, config: MATCH_CONFIG });
      if (!(await waitForHelloAck(peer))) {
        await renderRefused(root, "Your friend's app could not join this match.");
        return;
      }
    } else {
      if (!roomId) throw new Error("missing room id");
      cg.updateRoom({ roomId, isJoinable: true, inviteParams: { roomId } });
      // Same ordering fix as the host branch above: show "Joined room…
      // Connecting…" before blocking on guestPeer, not after.
      renderJoined(root, roomId);
      peer = await guestPeer({ gameId: GAME_ID, roomId, relayBase });
      if (!(await waitForHello(peer))) {
        await renderRefused(root, "Could not agree the match settings with your friend.");
        return;
      }
      peer.send({ kind: "hello-ack" });
    }
    await playMatchLoop(root, peer);
  } finally {
    peer?.close();
    cg.leftRoom();
  }
}

function waitForHello(peer: PeerHandle): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => finish(false), HELLO_TIMEOUT_MS);
    function onMessage(msg: WireMessage) {
      if (msg.kind !== "hello" || msg.game !== GAME_ID || msg.protocol !== PROTOCOL) return;
      const config = msg.config as { mode?: unknown; budget?: unknown };
      finish(config.mode === MATCH_CONFIG.mode && config.budget === MATCH_CONFIG.budget);
    }
    function finish(v: boolean) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      peer.offMessage(onMessage);
      resolve(v);
    }
    peer.onMessage(onMessage);
  });
}

function waitForHelloAck(peer: PeerHandle): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => finish(false), HELLO_TIMEOUT_MS);
    function onMessage(msg: WireMessage) {
      if (msg.kind === "hello-ack") finish(true);
    }
    function finish(v: boolean) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      peer.offMessage(onMessage);
      resolve(v);
    }
    peer.onMessage(onMessage);
  });
}

function renderInvite(
  root: HTMLElement,
  args: { roomId: string; shareLink: string; cgShareLink: string | null },
) {
  root.innerHTML = "";
  const card = document.createElement("section");
  card.className = "card invite-card";
  card.setAttribute("data-invite-card", "");

  const title = document.createElement("h3");
  title.className = "card__title";
  title.textContent = "Invite a friend";

  const status = document.createElement("p");
  status.className = "invite-card__status";
  status.textContent = "Waiting for your friend…";

  const code = document.createElement("button");
  code.type = "button";
  code.className = "invite-code";
  code.setAttribute("data-room-code", "");
  code.title = "Click to copy the room code";
  code.textContent = args.roomId;
  code.addEventListener("click", () => {
    void navigator.clipboard.writeText(args.roomId);
    flashCopied(code, args.roomId);
  });

  const link = document.createElement("p");
  link.className = "invite-link";
  link.textContent = args.shareLink;

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "btn btn--primary";
  copyBtn.textContent = "Copy link";
  copyBtn.addEventListener("click", () => {
    void navigator.clipboard.writeText(args.shareLink);
    flashCopied(copyBtn, "Copy link");
  });

  card.append(title, status, code, link, copyBtn);
  if (args.cgShareLink) {
    const cgLink = document.createElement("p");
    cgLink.className = "invite-card__status";
    cgLink.textContent = `Or invite via CrazyGames: ${args.cgShareLink}`;
    card.append(cgLink);
  }
  root.append(card);
}

/** Flash "Copied" on a button/chip, then restore its resting label. */
function flashCopied(el: HTMLElement, restLabel: string) {
  el.textContent = "Copied";
  setTimeout(() => (el.textContent = restLabel), 1500);
}

function renderJoined(root: HTMLElement, roomId: string) {
  root.innerHTML = "";
  const card = document.createElement("section");
  card.className = "card invite-card";
  const banner = document.createElement("p");
  banner.className = "invite-card__status";
  banner.textContent = `Joined room ${roomId}. Connecting…`;
  card.append(banner);
  root.append(card);
}

/**
 * The handshake connected but never agreed a match — a stale/incompatible
 * peer app, or nobody answered in time. Resolves only once the player
 * acknowledges it: main.ts's menu loop re-renders the moment this session
 * function returns, so returning immediately here would wipe the
 * explanation off the screen before it could be read.
 */
function renderRefused(root: HTMLElement, message: string): Promise<void> {
  root.innerHTML = "";
  const card = document.createElement("section");
  card.className = "card invite-card";
  card.setAttribute("data-connect-failed", "");

  const banner = document.createElement("p");
  banner.className = "error";
  banner.textContent = message;

  const leave = document.createElement("button");
  leave.type = "button";
  leave.textContent = "Leave";
  leave.className = "btn btn--ghost menu-btn";

  card.append(banner, leave);
  root.append(card);
  return new Promise((resolve) => {
    leave.addEventListener("click", () => resolve());
  });
}

async function playMatchLoop(root: HTMLElement, peer: PeerHandle): Promise<void> {
  // Host is always player 0 (Mark.X); guest is always player 1 (Mark.O) —
  // game-kit/docs/DESIGN.md "Host is P1". Derived from the peer's own role
  // rather than sent over the wire: both sides already agree on it the
  // instant the connection is established as host or guest.
  const human = peer.role === "host" ? Mark.X : Mark.O;
  const screen = createMatchScreen({
    root,
    initialBudget: BUDGET,
    xLabel: human === Mark.X ? "You (X)" : "Friend (X)",
    oLabel: human === Mark.O ? "You (O)" : "Friend (O)",
  });

  for (;;) {
    const game = newGame(BUDGET);
    let outcome: Outcome;
    try {
      outcome = await playTurns(screen, peer, game, human);
    } catch (e) {
      if (e instanceof PeerGoneError) {
        await renderAbandoned(screen, e.message);
        return;
      }
      throw e;
    }

    const again = await renderFinal(screen, outcome, game, human);
    if (!again) {
      trySend(peer, { kind: "leave" });
      return;
    }
    const accepted = await negotiateRematch(peer);
    if (!accepted) {
      await renderAbandoned(screen, "Your friend left the room.");
      return;
    }
    screen.reset();
  }
}

async function playTurns(
  screen: MatchScreen,
  peer: PeerHandle,
  game: Game,
  human: Mark,
): Promise<Outcome> {
  let turn = 0;
  while (boardOutcome(game.board) === Outcome.Ongoing) {
    await playOnePvpTurn(screen, peer, game, turn, human);
    turn++;
  }
  return boardOutcome(game.board);
}

async function playOnePvpTurn(
  screen: MatchScreen,
  peer: PeerHandle,
  game: Game,
  turn: number,
  human: Mark,
): Promise<void> {
  const myIdx = human === Mark.X ? 0 : 1;
  const oppIdx = myIdx === 0 ? 1 : 0;

  screen.renderBoard(game.board, undefined, { mine: human });

  // Listen before waiting — see game-kit's turn-inbox.ts doc comment.
  const inbox = openTurnInbox(peer, turn);
  try {
    const myMove = await askMove({
      boardArea: screen.boardArea,
      bidPanel: screen.bidPanel,
      board: game.board,
      me: human,
      ownBalance: game.budget[myIdx],
      opponentBalance: game.budget[oppIdx],
      opponentBidIn: inbox.hasCommit(),
      onOpponentBid: (fn) => inbox.onCommit(fn),
    });

    // The kit's commit carries an optional `public` payload alongside the
    // hash — BTTT uses it to expose the target CELL in cleartext at commit
    // time (only the bid stays hidden until reveal), matching this game's
    // pre-migration wire shape. `hash` covers [bid, cell] together so a
    // reveal can't swap in a different cell than the one already committed
    // in the clear.
    const salt = newSalt();
    const hash = await commitPayload([myMove.bid, myMove.cell], salt);
    peer.send({ kind: "commit", turn, hash, public: myMove.cell });

    screen.bidPanel.setWaiting("Bid committed. Waiting for your friend…");
    const oppCommit = await orPeerGone(inbox, inbox.commit(), "Your friend stopped responding.");

    peer.send({ kind: "reveal", turn, bid: myMove.bid, salt });
    const oppReveal = await orPeerGone(inbox, inbox.reveal(), "Your friend stopped responding.");

    if (typeof oppCommit.public !== "number") {
      throw new PeerGoneError("Your friend's committed move was invalid.");
    }
    const oppMove: Move = { bid: oppReveal.bid, cell: oppCommit.public };
    const verified = await verifyPayload(oppCommit.hash, [oppReveal.bid, oppMove.cell], oppReveal.salt);
    if (!verified) {
      throw new PeerGoneError("Your friend's revealed bid did not match their commitment.");
    }

    const xMove: Move = human === Mark.X ? myMove : oppMove;
    const oMove: Move = human === Mark.X ? oppMove : myMove;
    const budgetsBefore: [number, number] = [game.budget[0], game.budget[1]];

    const { game: next, result } = resolveTurnSafely(game, xMove, oMove);
    Object.assign(game, next);
    const outcome = boardOutcome(game.board);
    // Re-render with the post-move state so the winning mark is visible; at
    // match end, also highlight the winning line (a draw has none).
    const winLine = outcome === Outcome.XWins || outcome === Outcome.OWins ? winningLine(game.board) : null;
    screen.renderBoard(game.board, result.cell, { mine: human, winLine });
    screen.setTurnResult(result, human, "Friend");
    screen.appendTurn({
      turn,
      result,
      xMove,
      oMove,
      budgetsBefore,
      budgetsAfter: [game.budget[0], game.budget[1]],
    });
  } finally {
    inbox.close();
  }
}

// resolveTurn throws on an out-of-range/occupied cell or an over-budget bid.
// A well-behaved client's own UI never produces one, but a hostile or buggy
// peer's revealed move could (verifyPayload only proves the reveal matches
// the earlier commitment, not that the committed move was itself legal).
// Treat that like any other protocol violation: abandon rather than guess.
function resolveTurnSafely(game: Game, xMove: Move, oMove: Move): { game: Game; result: ReturnType<typeof resolveTurn>["result"] } {
  try {
    return resolveTurn(game, xMove, oMove);
  } catch (e) {
    throw new PeerGoneError(
      e instanceof Error ? `Your friend's move was invalid: ${e.message}` : "Your friend's move was invalid.",
    );
  }
}

/**
 * Await `p`, but give up if the peer goes away or simply stops talking.
 * Rejecting with PeerGoneError abandons the match; it never substitutes a
 * move, so the two boards cannot diverge.
 */
function orPeerGone<T>(inbox: ReturnType<typeof openTurnInbox>, p: Promise<T>, message: string): Promise<T> {
  const gone = inbox.closed().then((): T => {
    throw new PeerGoneError("Your friend left the room.");
  });
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PeerGoneError(message)), PEER_GRACE_MS);
  });
  return Promise.race([p, gone, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/** Ask for a rematch and wait for the other side to agree. */
function negotiateRematch(peer: PeerHandle): Promise<boolean> {
  return new Promise((resolve) => {
    const settle = (v: boolean) => {
      peer.offMessage(onMessage);
      peer.offClose(onClose);
      clearTimeout(timer);
      resolve(v);
    };
    const onMessage = (msg: WireMessage) => {
      if (msg.kind === "rematch-request") {
        trySend(peer, { kind: "rematch-accept" });
        settle(true);
      } else if (msg.kind === "rematch-accept") {
        settle(true);
      } else if (msg.kind === "leave") {
        settle(false);
      }
    };
    const onClose = () => settle(false);
    const timer = setTimeout(() => settle(false), PEER_GRACE_MS);
    peer.onMessage(onMessage);
    peer.onClose(onClose);
    trySend(peer, { kind: "rematch-request" });
  });
}

/** Send best-effort: a closed channel is a peer that has already left, which
 *  the caller handles through its own close/timeout path. */
function trySend(peer: PeerHandle, msg: WireMessage) {
  try {
    peer.send(msg);
  } catch (e) {
    console.debug("[pvp] send skipped", e);
  }
}


function renderFinal(
  screen: MatchScreen,
  outcome: Outcome,
  game: Game,
  human: Mark,
): Promise<boolean> {
  screen.bidPanel.setWaiting("Match over.");

  const banner = renderMatchOver({
    outcome,
    you: human,
    budgets: game.budget,
    youLabel: "You",
    themLabel: "Friend",
    initialBudget: BUDGET,
  });

  const again = document.createElement("button");
  again.type = "button";
  again.textContent = "Rematch (same friend)";
  again.className = "btn btn--primary rematch";

  const leave = document.createElement("button");
  leave.type = "button";
  leave.textContent = "Leave";
  leave.className = "btn btn--ghost menu-btn";

  screen.controls.append(banner, again, leave);
  return new Promise((resolve) => {
    again.addEventListener("click", () => {
      again.disabled = true;
      again.textContent = "Waiting for your friend…";
      resolve(true);
    });
    leave.addEventListener("click", () => resolve(false));
  });
}

/** Terminal notice for a match that ended without a result. Non-resolving by
 *  design: no turn is decided on the missing player's behalf. */
function renderAbandoned(screen: MatchScreen, message: string): Promise<void> {
  screen.bidPanel.setWaiting("Match abandoned.");
  screen.controls.innerHTML = "";

  const banner = document.createElement("p");
  banner.className = "error";
  banner.textContent = message;

  const leave = document.createElement("button");
  leave.type = "button";
  leave.textContent = "Leave";
  leave.className = "btn btn--ghost menu-btn";

  screen.controls.append(banner, leave);
  return new Promise((resolve) => {
    leave.addEventListener("click", () => resolve());
  });
}
