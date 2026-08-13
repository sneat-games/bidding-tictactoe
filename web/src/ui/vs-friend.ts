// vs-friend screen. Hosts a private room (post /reserve, generate share
// link), or joins an existing room as the guest (peer.ts handles the
// WebRTC dance through the CF Worker signaling relay).
//
// Once the DataChannel is open, both peers exchange hidden-bid moves using
// the commit-reveal protocol in peer.ts. After a win/draw the peers can
// rematch in the same room without navigating back through the menu.
// If either peer's page reloads, the WebRTC channel is re-established
// through the relay and the game state is synced over a "sync" message
// so play can continue.

import { Mark, Outcome, newGame, resolveTurn, boardOutcome, markString, outcomeString, Game, Move, boardString } from "../engine/btttplay";
import { createBidInput } from "./bid-input";
import { reserveRoomId, shareLinkFor } from "../pvp/room";
import { hostPeer, guestPeer, WireMessage, PeerHandle, commitFor, verifyReveal, newSalt } from "../pvp/peer";
import { createGameLog } from "./game-log";
import { createBudgetDisplay } from "./budget-display";
import { saveState, clearAll, stateFromGame, loadState, restoreGame } from "../pvp/game-store";
import * as cg from "../crazygames/sdk";

const BUDGET = 100;

type PendingCommit = {
  commit: string;
  cell: number;
};

export async function runVsFriend(
  root: HTMLElement,
  opts: { as: "host" | "guest"; roomId?: string },
): Promise<void> {
  let peer: PeerHandle | null = null;
  let roomId = opts.roomId ?? "";
  const as = opts.as;

  try {
    if (as === "host") {
      roomId = await reserveRoomId();
      cg.updateRoom({ roomId, isJoinable: true, inviteParams: { roomId } });
      const cgShareLink = cg.inviteLink({ roomId });
      const shareLink = shareLinkFor(
        typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}` : "",
        roomId,
      );
      renderInvite(root, { roomId, shareLink, cgShareLink });
      const { peer: p } = await hostPeer({ roomId });
      peer = p;
    } else {
      if (!roomId) throw new Error("missing room id");
      cg.updateRoom({ roomId, isJoinable: true, inviteParams: { roomId } });
      renderJoined(root, roomId);
      peer = await guestPeer({ roomId });
    }
    await playMatchLoop(root, peer!, roomId, as);
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
  const banner = document.createElement("p");
  banner.textContent = `Room ${args.roomId}. Waiting for your friend…`;
  const link = document.createElement("p");
  link.className = "invite-link";
  link.textContent = `Share link: ${args.shareLink}`;
  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.textContent = "Copy link";
  copyBtn.addEventListener("click", () => {
    void navigator.clipboard.writeText(args.shareLink);
    copyBtn.textContent = "Copied";
    setTimeout(() => (copyBtn.textContent = "Copy link"), 1500);
  });
  root.append(banner, link, copyBtn);
  if (args.cgShareLink) {
    const cgLink = document.createElement("p");
    cgLink.textContent = `Or invite via CrazyGames: ${args.cgShareLink}`;
    root.append(cgLink);
  }
}

function renderJoined(root: HTMLElement, roomId: string) {
  root.innerHTML = "";
  const banner = document.createElement("p");
  banner.textContent = `Joined room ${roomId}. Connecting…`;
  root.append(banner);
}

function renderReconnecting(root: HTMLElement) {
  root.innerHTML = "";
  const overlay = document.createElement("div");
  overlay.className = "reconnecting";
  const spinner = document.createElement("div");
  spinner.className = "reconnecting__spinner";
  const text = document.createElement("p");
  text.className = "reconnecting__text";
  text.textContent = "Reconnecting…";
  const sub = document.createElement("p");
  sub.className = "reconnecting__sub";
  sub.textContent = "Re-establishing WebRTC channel";
  overlay.append(spinner, text, sub);
  root.append(overlay);
}

function renderDisconnected(root: HTMLElement): Promise<"reconnect" | "leave"> {
  root.innerHTML = "";
  const overlay = document.createElement("div");
  overlay.className = "disconnected";
  const text = document.createElement("p");
  text.className = "disconnected__text";
  text.textContent = "Friend disconnected";
  const sub = document.createElement("p");
  sub.className = "disconnected__sub";
  sub.textContent = "Your friend left the game. You can wait for them to reconnect or go back to the menu.";
  const reconnect = document.createElement("button");
  reconnect.type = "button";
  reconnect.textContent = "Wait & Reconnect";
  reconnect.className = "rematch";
  const leave = document.createElement("button");
  leave.type = "button";
  leave.textContent = "Back to menu";
  leave.className = "menu-btn";
  overlay.append(text, sub, reconnect, leave);
  root.append(overlay);
  return new Promise((resolve) => {
    reconnect.addEventListener("click", () => resolve("reconnect"));
    leave.addEventListener("click", () => resolve("leave"));
  });
}

/** Re-establish the WebRTC connection using the same roomId. Tears down
 *  stale SDP/ICE on the relay first, then re-negotiates. */
async function reconnectPeer(roomId: string, as: "host" | "guest"): Promise<PeerHandle> {
  // Teardown the relay to clear stale offer/answer/ICE from the previous
  // connection so the fresh negotiation doesn't pick up a stale SDP.
  const base = (typeof window !== "undefined" && window.location?.hostname?.endsWith(".sneat.games"))
    ? "https://webrtc.sneat.games"
    : "http://localhost:8787";
  try {
    await fetch(`${base}/signal/bttt/${encodeURIComponent(roomId)}`, { method: "DELETE" });
  } catch {
    // non-fatal — the relay may have already expired the entries
  }
  if (as === "host") {
    const { peer } = await hostPeer({ roomId });
    return peer;
  } else {
    return await guestPeer({ roomId });
  }
}

/** After reconnection, exchange game state so both peers agree on the
 *  board/budget/turn. The peer with the higher turn count wins (it may
 *  have completed one more turn before the disconnect). */
async function syncGameState(
  peer: PeerHandle,
  game: Game,
  turn: number,
  human: Mark,
): Promise<{ game: Game; turn: number }> {
  // Send our state to the other peer.
  peer.send({
    kind: "sync",
    board: boardString(game.board),
    budget: [...game.budget] as [number, number],
    tieToX: game.tieToX,
    turn,
  });
  // Wait for their state.
  const theirState = await new Promise<{ board: string; budget: [number, number]; tieToX: boolean; turn: number }>((resolve) => {
    const cb = (msg: WireMessage) => {
      if (msg.kind === "sync") {
        peer.offMessage(cb);
        resolve({ board: msg.board, budget: msg.budget, tieToX: msg.tieToX, turn: msg.turn });
      }
    };
    peer.onMessage(cb);
  });
  // Reconcile: use the state with the higher turn count.
  if (theirState.turn > turn) {
    const restored = await restoreGame({ mode: "vs-friend", board: theirState.board, budget: theirState.budget, tieToX: theirState.tieToX, turn: theirState.turn, human: human === Mark.X ? "X" : "O", savedAt: Date.now() });
    if (restored) return { game: restored, turn: theirState.turn };
  }
  return { game, turn };
}

async function playMatchLoop(
  root: HTMLElement,
  initialPeer: PeerHandle,
  roomId: string,
  as: "host" | "guest",
): Promise<void> {
  let peer = initialPeer;
  // Try restoring a saved game so a page reload mid-match resumes it.
  const saved = await loadState();
  let game: Game;
  let turn: number;
  let human = peer.youAre;
  if (saved && saved.mode === "vs-friend") {
    const restored = await restoreGame(saved);
    if (restored) {
      game = restored;
      turn = saved.turn;
      human = saved.human === "X" ? Mark.X : Mark.O;
    } else {
      game = newGame(BUDGET);
      turn = 0;
    }
  } else {
    game = newGame(BUDGET);
    turn = 0;
  }

  while (true) {
    // Set up the two-column layout.
    root.innerHTML = "";
    const screen = document.createElement("div");
    screen.className = "game-screen";
    const boardArea = document.createElement("div");
    boardArea.className = "game-screen__board";
    const logArea = document.createElement("div");
    logArea.className = "game-screen__log";
    const log = createGameLog({
      initialBudget: BUDGET,
      xLabel: peer.youAre === Mark.X ? "You (X)" : "Friend (X)",
      oLabel: peer.youAre === Mark.O ? "You (O)" : "Friend (O)",
    });
    const budgetDisplay = createBudgetDisplay({
      xLabel: peer.youAre === Mark.X ? "You" : "Friend",
      oLabel: peer.youAre === Mark.O ? "You" : "Friend",
      initialBudget: BUDGET,
    });
    budgetDisplay.update(game.budget);
    logArea.append(log.el);
    screen.append(boardArea, logArea);
    root.append(screen);

    if (boardOutcome(game.board) === Outcome.Ongoing) {
      let outcome: Outcome;
      try {
        outcome = await playTurns(boardArea, peer, game, human, turn, log, budgetDisplay, roomId, as);
      } catch (e) {
        if (e instanceof PeerDisconnectedError) {
          const action = await renderDisconnected(boardArea);
          if (action === "reconnect") {
            renderReconnecting(root);
            peer = await reconnectPeer(roomId, as);
            human = peer.youAre;
            const synced = await syncGameState(peer, game, turn, human);
            game = synced.game;
            turn = synced.turn;
            continue;
          } else {
            clearAll();
            return;
          }
        }
        throw e;
      }
      clearAll();
      const again = await renderFinal(boardArea, outcome, game);
      // Coordinate rematch.
      const rematchPromise = new Promise<boolean>((resolve) => {
        const cb = (msg: WireMessage) => {
          if (msg.kind === "rematch-request") {
            peer.send({ kind: "rematch-accept" });
            resolve(true);
          } else if (msg.kind === "rematch-accept") {
            resolve(true);
          }
        };
        peer.onMessage(cb);
      });
      if (again) {
        peer.send({ kind: "rematch-request" });
        await rematchPromise;
        game = newGame(BUDGET);
        turn = 0;
      } else {
        peer.send({ kind: "leave" });
        return;
      }
    } else {
      // Saved game was already terminal; start fresh.
      game = newGame(BUDGET);
      turn = 0;
    }
  }
}

class PeerDisconnectedError extends Error {
  constructor() {
    super("peer disconnected");
    this.name = "PeerDisconnectedError";
  }
}

/** Race a wait-for-message promise against the peer's close event. If the
 *  DataChannel closes first (peer closed tab, network drop), throw
 *  PeerDisconnectedError so the caller can show a reconnect/disconnect UI. */
function raceDisconnect<T>(peer: PeerHandle, p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onClose = () => reject(new PeerDisconnectedError());
    peer.onClose(onClose);
    p.then((v) => {
      peer.offClose(onClose);
      resolve(v);
    }).catch((e) => {
      peer.offClose(onClose);
      reject(e);
    });
  });
}

async function playTurns(
  root: HTMLElement,
  peer: PeerHandle,
  game: Game,
  human: Mark,
  startTurn: number,
  log: ReturnType<typeof createGameLog>,
  budgetDisplay: ReturnType<typeof createBudgetDisplay>,
  roomId: string,
  as: "host" | "guest",
): Promise<Outcome> {
  let turn = startTurn;
  while (boardOutcome(game.board) === Outcome.Ongoing) {
    await playOnePvpTurn(root, peer, game, turn, human, log, budgetDisplay);
    turn++;
    saveState(stateFromGame("vs-friend", game, turn, human, { roomId, as }));
  }
  return boardOutcome(game.board);
}

async function playOnePvpTurn(
  root: HTMLElement,
  peer: PeerHandle,
  game: Game,
  turn: number,
  human: Mark,
  log: ReturnType<typeof createGameLog>,
  budgetDisplay: ReturnType<typeof createBudgetDisplay>,
): Promise<void> {
  renderBoard(root, game, human);
  root.prepend(budgetDisplay.el);
  budgetDisplay.update(game.budget);
  const humanMove = await askHuman(root, game, human);
  const salt = newSalt();
  const commit = await commitFor(humanMove, salt);
  peer.send({ kind: "commit", turn, commit, cell: humanMove.cell });

  // Race the opponent's commit/reveal against a disconnect — if the
  // friend closes their tab, the DataChannel closes and we bail out
  // immediately instead of hanging forever.
  const pending = await raceDisconnect(peer, waitForCommit(peer, turn));
  peer.send({ kind: "reveal", turn, bid: humanMove.bid, salt });
  const oppReveal = await raceDisconnect(peer, waitForReveal(peer, turn));
  const verified = await verifyReveal(pending.commit, { bid: oppReveal.bid, cell: pending.cell }, oppReveal.salt);
  if (!verified) throw new Error("opponent reveal failed verification");

  const xMove: Move = human === Mark.X ? humanMove : { bid: oppReveal.bid, cell: pending.cell };
  const oMove: Move = human === Mark.X ? { bid: oppReveal.bid, cell: pending.cell } : humanMove;
  const budgetsBefore: [number, number] = [game.budget[0], game.budget[1]];
  const { game: next, result } = resolveTurn(game, xMove, oMove);
  Object.assign(game, next);
  renderBoard(root, game, human);
  root.prepend(budgetDisplay.el);
  budgetDisplay.update(game.budget);
  renderTurnResult(root, result, game, human);
  log.append({
    turn,
    result,
    xMove,
    oMove,
    budgetsBefore,
    budgetsAfter: [game.budget[0], game.budget[1]],
  });
}

function renderBoard(root: HTMLElement, game: Game, human: Mark) {
  root.innerHTML = "";
  const board = document.createElement("div");
  board.className = "board";
  for (let i = 0; i < 9; i++) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "board__cell";
    cell.setAttribute("data-cell", String(i));
    cell.textContent = markString(game.board[i]);
    if (game.board[i] === Mark.X) cell.classList.add("board__cell--x");
    else if (game.board[i] === Mark.O) cell.classList.add("board__cell--o");
    if (game.board[i] !== 0 /* Empty */) cell.disabled = true;
    board.appendChild(cell);
  }
  const status = document.createElement("p");
  status.className = "status";
  status.textContent = `You are ${markString(human)}.`;
  root.append(board, status);
}

async function askHuman(root: HTMLElement, game: Game, human: Mark): Promise<{ bid: number; cell: number }> {
  const remaining = game.budget[human === Mark.X ? 0 : 1];
  const bid = createBidInput({ max: remaining, initial: Math.floor(remaining / 2) });
  const prompt = document.createElement("div");
  prompt.className = "prompt";
  prompt.append("Pick your bid, then click a cell to commit:", bid.el);
  root.append(prompt);
  const cells = root.querySelectorAll<HTMLButtonElement>(".board__cell");
  return new Promise((resolve) => {
    cells.forEach((c) => {
      if (c.disabled) return;
      c.addEventListener("click", () => {
        cells.forEach((x) => x.classList.remove("selected"));
        c.classList.add("selected");
        c.textContent = markString(human);
        c.classList.add("pending");
        resolve({ bid: bid.value(), cell: parseInt(c.dataset.cell ?? "", 10) });
      });
    });
  });
}

function waitForCommit(peer: PeerHandle, turn: number): Promise<PendingCommit> {
  return new Promise((resolve) => {
    const cb = (msg: WireMessage) => {
      if (msg.kind === "commit" && msg.turn === turn) {
        peer.offMessage(cb);
        resolve({ commit: msg.commit, cell: msg.cell });
      }
    };
    peer.onMessage(cb);
  });
}

function waitForReveal(peer: PeerHandle, turn: number): Promise<{ bid: number; salt: string }> {
  return new Promise((resolve) => {
    const cb = (msg: WireMessage) => {
      if (msg.kind === "reveal" && msg.turn === turn) {
        peer.offMessage(cb);
        resolve({ bid: msg.bid, salt: msg.salt });
      }
    };
    peer.onMessage(cb);
  });
}

function renderTurnResult(
  root: HTMLElement,
  result: ReturnType<typeof resolveTurn>["result"],
  game: Game,
  human: Mark,
) {
  const line = document.createElement("p");
  line.className = "turn-result";
  const tieNote = result.tieBreak ? " (tie-break)" : "";
  line.textContent = `${markString(result.winner)} won the turn, took cell ${result.cell}, paid ${result.bid}${tieNote}.`;
  root.append(line);
  void game;
  void human;
}

function renderFinal(
  root: HTMLElement,
  outcome: Outcome,
  game: Game,
): Promise<boolean> {
  const banner = document.createElement("p");
  banner.className = "result-banner";
  banner.textContent = `Game over: ${outcomeString(outcome)}. Budgets — You: ${game.budget[0]}, Friend: ${game.budget[1]}.`;
  const again = document.createElement("button");
  again.type = "button";
  again.textContent = "Rematch (same friend)";
  again.className = "rematch";
  const leave = document.createElement("button");
  leave.type = "button";
  leave.textContent = "Leave";
  leave.className = "menu-btn";
  root.append(banner, again, leave);
  return new Promise((resolve) => {
    again.addEventListener("click", () => resolve(true));
    leave.addEventListener("click", () => resolve(false));
  });
}