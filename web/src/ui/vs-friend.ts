// vs-friend screen. Hosts a private room (post /reserve, generate share
// link), or joins an existing room as the guest (peer.ts handles the
// WebRTC dance through the CF Worker signaling relay).
//
// Once the DataChannel is open, both peers exchange hidden-bid moves using
// the commit-reveal protocol in peer.ts. After a win/draw the peers can
// rematch in the same room without navigating back through the menu.
// A right-side game log shows each turn's winning (green) and losing (red)
// bids plus running budget bars.

import { Mark, Outcome, newGame, resolveTurn, boardOutcome, markString, outcomeString, Game, Move } from "../engine/btttplay";
import { createBidInput } from "./bid-input";
import { reserveRoomId } from "../pvp/room";
import { hostPeer, guestPeer, WireMessage, PeerHandle, commitFor, verifyReveal, newSalt } from "../pvp/peer";
import { createGameLog } from "./game-log";
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

  try {
    if (opts.as === "host") {
      // Reserve a fresh unique room id.
      roomId = await reserveRoomId();
      cg.updateRoom({ roomId, isJoinable: true, inviteParams: { roomId } });
      const cgShareLink = cg.inviteLink({ roomId });
      const { peer: p, inviteLinkUrl } = await hostPeer({ roomId });
      peer = p;
      renderInvite(root, {
        roomId,
        shareLink: inviteLinkUrl(typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}` : ""),
        cgShareLink,
      });
    } else {
      if (!roomId) throw new Error("missing room id");
      cg.updateRoom({ roomId, isJoinable: true, inviteParams: { roomId } });
      peer = await guestPeer({ roomId });
      renderJoined(root, roomId);
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

async function playMatchLoop(root: HTMLElement, peer: PeerHandle): Promise<void> {
  while (true) {
    let game = newGame(BUDGET);
    const human = peer.youAre;

    // Two-column layout: board area (left) + game log (right).
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
    logArea.append(log.el);
    screen.append(boardArea, logArea);
    root.append(screen);

    const outcome = await playTurns(boardArea, peer, game, human, log);
    const again = await renderFinal(boardArea, outcome, game);
    // Coordinate rematch with the other peer.
    let otherWantsRematch = false;
    const rematchPromise = new Promise<boolean>((resolve) => {
      const cb = (msg: WireMessage) => {
        if (msg.kind === "rematch-request") {
          otherWantsRematch = true;
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
    } else {
      peer.send({ kind: "leave" });
      return;
    }
    void otherWantsRematch;
  }
}

async function playTurns(
  root: HTMLElement,
  peer: PeerHandle,
  game: Game,
  human: Mark,
  log: ReturnType<typeof createGameLog>,
): Promise<Outcome> {
  let turn = 0;
  while (boardOutcome(game.board) === Outcome.Ongoing) {
    await playOnePvpTurn(root, peer, game, turn, human, log);
    turn++;
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
): Promise<void> {
  renderBoard(root, game, human);
  const humanMove = await askHuman(root, game, human);
  const salt = newSalt();
  const commit = await commitFor(humanMove, salt);
  peer.send({ kind: "commit", turn, commit, cell: humanMove.cell });

  // Wait for opponent commit + reveal.
  const pending = await waitForCommit(peer, turn);
  // Send reveal.
  peer.send({ kind: "reveal", turn, bid: humanMove.bid, salt });
  const oppReveal = await waitForReveal(peer, turn);
  const verified = await verifyReveal(pending.commit, { bid: oppReveal.bid, cell: pending.cell }, oppReveal.salt);
  if (!verified) throw new Error("opponent reveal failed verification");

  const xMove: Move = human === Mark.X ? humanMove : { bid: oppReveal.bid, cell: pending.cell };
  const oMove: Move = human === Mark.X ? { bid: oppReveal.bid, cell: pending.cell } : humanMove;
  const budgetsBefore: [number, number] = [game.budget[0], game.budget[1]];
  const { game: next, result } = resolveTurn(game, xMove, oMove);
  Object.assign(game, next);
  // Re-render the board with the post-move state so the winning mark
  // is visible (and the prompt/submit UI is cleared).
  renderBoard(root, game, human);
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
    if (game.board[i] !== 0 /* Empty */) cell.disabled = true;
    board.appendChild(cell);
  }
  const status = document.createElement("p");
  status.className = "status";
  status.textContent = `You are ${markString(human)}. Budgets — You: ${game.budget[human === Mark.X ? 0 : 1]}, Friend: ${game.budget[human === Mark.X ? 1 : 0]}.`;
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
        const cell = parseInt(c.dataset.cell ?? "", 10);
        resolve({ bid: bid.value(), cell });
      });
    });
  });
}

function waitForCommit(peer: PeerHandle, turn: number): Promise<PendingCommit> {
  return new Promise((resolve) => {
    const cb = (msg: WireMessage) => {
      if (msg.kind === "commit" && msg.turn === turn) {
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