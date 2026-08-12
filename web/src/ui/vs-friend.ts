// vs-friend screen. Hosts a private room (reserve a code, share a link), or
// joins an existing room as the guest; peer.ts handles the WebRTC dance
// through the CF Worker signaling relay.
//
// Once the DataChannel is open, both peers exchange hidden-bid moves using
// the commit-reveal protocol in peer.ts, on the 2x2 match screen (balances +
// bid panel on top, board + game log below). After a win/draw the peers can
// rematch in the same room.
//
// Turn clock: each client auto-submits only its OWN move when a deadline
// expires (see turn-clock.ts), so a timeout can never leave the two boards
// disagreeing. When a peer stops answering altogether, the match is
// abandoned with a notice rather than resolved by guesswork.

import { Mark, Outcome, newGame, resolveTurn, boardOutcome, Game, Move } from "../engine/btttplay";
import { reserveRoomId, shareLinkFor } from "../pvp/room";
import { hostPeer, guestPeer, WireMessage, PeerHandle, commitFor, verifyReveal, newSalt } from "../pvp/peer";
import { openTurnInbox } from "../pvp/turn-inbox";
import { askMove } from "./ask-move";
import { createMatchScreen, renderMatchOver, type MatchScreen } from "./match-screen";
import { winningLine } from "./win-line";
import * as cg from "../crazygames/sdk";

const BUDGET = 100;

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

export async function runVsFriend(
  root: HTMLElement,
  opts: { as: "host" | "guest"; roomId?: string },
): Promise<void> {
  let peer: PeerHandle | null = null;
  let roomId = opts.roomId ?? "";

  try {
    if (opts.as === "host") {
      roomId = await reserveRoomId();
      cg.updateRoom({ roomId, isJoinable: true, inviteParams: { roomId } });
      const cgShareLink = cg.inviteLink({ roomId });
      // Render the invite UI BEFORE awaiting hostPeer: hostPeer blocks until
      // the guest's answer arrives, which can only happen once the guest has
      // read this room code — awaiting it first would leave the host staring
      // at a blank screen with nothing to share, deadlocked against a guest
      // who can never connect (see game-kit/docs/APP-PLAYBOOK.md gotcha 5).
      // shareLinkFor builds the same link hostPeer's own inviteLinkUrl would
      // (both from roomId, already known here), so nothing waits on the peer.
      const base = typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}` : "";
      renderInvite(root, {
        roomId,
        shareLink: shareLinkFor(base, roomId),
        cgShareLink,
      });
      const { peer: p } = await hostPeer({ roomId });
      peer = p;
    } else {
      if (!roomId) throw new Error("missing room id");
      cg.updateRoom({ roomId, isJoinable: true, inviteParams: { roomId } });
      // Same ordering fix as the host branch above: show "Joined room…
      // Connecting…" before blocking on guestPeer, not after.
      renderJoined(root, roomId);
      peer = await guestPeer({ roomId });
    }
    await playMatchLoop(root, peer!);
  } finally {
    peer?.close();
    cg.leftRoom();
  }
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

async function playMatchLoop(root: HTMLElement, peer: PeerHandle): Promise<void> {
  const human = peer.youAre;
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

  // Listen before waiting — see turn-inbox.ts.
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

    const salt = newSalt();
    peer.send({ kind: "commit", turn, commit: await commitFor(myMove, salt), cell: myMove.cell });

    screen.bidPanel.setWaiting("Bid committed. Waiting for your friend…");
    const oppCommit = await orPeerGone(inbox, inbox.commit(), "Your friend stopped responding.");

    peer.send({ kind: "reveal", turn, bid: myMove.bid, salt });
    const oppReveal = await orPeerGone(inbox, inbox.reveal(), "Your friend stopped responding.");

    const oppMove: Move = { bid: oppReveal.bid, cell: oppCommit.cell };
    if (!(await verifyReveal(oppCommit.commit, oppMove, oppReveal.salt))) {
      throw new PeerGoneError("Your friend's revealed bid did not match their commitment.");
    }

    const xMove: Move = human === Mark.X ? myMove : oppMove;
    const oMove: Move = human === Mark.X ? oppMove : myMove;
    const budgetsBefore: [number, number] = [game.budget[0], game.budget[1]];

    const { game: next, result } = resolveTurn(game, xMove, oMove);
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

/**
 * Await `p`, but give up if the peer goes away or simply stops talking.
 * Rejecting with PeerGoneError abandons the match; it never substitutes a
 * move, so the two boards cannot diverge.
 */
function orPeerGone<T>(inbox: ReturnType<typeof openTurnInbox>, p: Promise<T>, message: string): Promise<T> {
  const gone = inbox.closed().then(() => {
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
