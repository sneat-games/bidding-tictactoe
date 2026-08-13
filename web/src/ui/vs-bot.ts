// vs-bot screen. Renders the board, the bid input (linked slider + number),
// the turn result, and a right-side game log with bid-size progress bars.
// A rematch restarts in the same tab (and clears the log).

import { Mark, Outcome, boardOutcome, newGame, resolveTurn, markString, outcomeString, Move } from "../engine/btttplay";
import { botMove } from "../bot/bot";
import { createBidInput } from "./bid-input";
import { createGameLog } from "./game-log";
import { createBudgetDisplay } from "./budget-display";
import { loadState, restoreGame, saveState, clearAll, charToMark, stateFromGame } from "../pvp/game-store";

const BUDGET = 100;

export async function runVsBot(root: HTMLElement): Promise<void> {
  // Try restoring a saved vs-bot game so a page reload doesn't lose the board.
  const saved = await loadState();
  let game: ReturnType<typeof newGame>;
  let human: Mark;
  let botMark: Mark;
  let turn: number;
  if (saved && saved.mode === "vs-bot") {
    const restored = await restoreGame(saved);
    if (restored) {
      game = restored;
      human = charToMark(saved.human);
      botMark = human === Mark.X ? Mark.O : Mark.X;
      turn = saved.turn;
    } else {
      game = newGame(BUDGET);
      human = Mark.X;
      botMark = Mark.O;
      turn = 0;
    }
  } else {
    game = newGame(BUDGET);
    human = Mark.X;
    botMark = Mark.O;
    turn = 0;
  }

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
    xLabel: "You",
    oLabel: "Bot",
  });
  const budgetDisplay = createBudgetDisplay({
    xLabel: "You",
    oLabel: "Bot",
    initialBudget: BUDGET,
  });
  logArea.append(log.el);
  screen.append(boardArea, logArea);
  root.append(screen);

  while (true) {
    const outcome = await playOneTurn(boardArea, game, human, botMark, log, budgetDisplay, turn);
    if (outcome !== Outcome.Ongoing) {
      clearAll();
      budgetDisplay.update(game.budget);
      const again = await renderResult(boardArea, outcome, game);
      if (!again) return;
      game = newGame(BUDGET);
      human = Mark.X;
      botMark = Mark.O;
      turn = 0;
      log.clear();
      budgetDisplay.update(game.budget);
    } else {
      turn++;
      saveState(stateFromGame("vs-bot", game, turn, human));
    }
  }
}

async function playOneTurn(
  root: HTMLElement,
  game: ReturnType<typeof newGame>,
  human: Mark,
  botMark: Mark,
  log: ReturnType<typeof createGameLog>,
  budgetDisplay: ReturnType<typeof createBudgetDisplay>,
  turn: number,
): Promise<Outcome> {
  renderBoard(root, game, human, botMark);
  root.prepend(budgetDisplay.el);
  budgetDisplay.update(game.budget);
  // Wait for human's move.
  const humanMove = await askHuman(root, game, human);
  // Bot picks its move.
  const botMoveData = botMove({
    board: game.board,
    budgetRemaining: game.budget[botMark === Mark.X ? 0 : 1],
    me: botMark,
  });
  const xMove: Move = human === Mark.X ? humanMove : botMoveData;
  const oMove: Move = human === Mark.X ? botMoveData : humanMove;
  const budgetsBefore: [number, number] = [game.budget[0], game.budget[1]];
  try {
    const { game: next, result } = resolveTurn(game, xMove, oMove);
    Object.assign(game, next);
    renderBoard(root, game, human, botMark);
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
    return boardOutcome(game.board);
  } catch (e) {
    renderError(root, e instanceof Error ? e.message : String(e));
    return Outcome.Ongoing;
  }
}

function renderBoard(root: HTMLElement, game: ReturnType<typeof newGame>, human: Mark, _botMark: Mark) {
  root.innerHTML = "";
  const board = document.createElement("div");
  board.className = "board";
  board.setAttribute("role", "grid");
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

async function askHuman(
  root: HTMLElement,
  game: ReturnType<typeof newGame>,
  human: Mark,
): Promise<{ bid: number; cell: number }> {
  const botMark: Mark = human === Mark.X ? Mark.O : Mark.X;
  const remaining = game.budget[human === Mark.X ? 0 : 1];
  const botRemaining = game.budget[botMark === Mark.X ? 0 : 1];
  // Strategic auto-default: if the bot can't afford more than half our
  // budget, bid just above what the bot could possibly match to guarantee
  // winning the turn. Falls back to half-remaining otherwise.
  let initial = Math.floor(remaining / 2);
  if (botRemaining < Math.floor(remaining / 2) && botRemaining + 1 <= remaining) {
    initial = botRemaining + 1;
  }
  const bid = createBidInput({ max: remaining, initial });

  const prompt = document.createElement("div");
  prompt.className = "prompt";
  prompt.append("Pick your bid, then click a cell to commit:", bid.el);
  root.append(prompt);

  const cells = root.querySelectorAll<HTMLButtonElement>(".board__cell");
  return new Promise((resolve) => {
    cells.forEach((c) => {
      if (c.disabled) return;
      c.addEventListener("click", () => {
        cells.forEach((x) => x.classList.remove("selected", "pending"));
        c.classList.add("selected", "pending");
        c.textContent = markString(human);
        resolve({ bid: bid.value(), cell: parseInt(c.dataset.cell ?? "", 10) });
      });
    });
  });
}

function renderTurnResult(
  root: HTMLElement,
  result: ReturnType<typeof resolveTurn>["result"],
  game: ReturnType<typeof newGame>,
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

function renderResult(
  root: HTMLElement,
  outcome: Outcome,
  game: ReturnType<typeof newGame>,
): Promise<boolean> {
  const banner = document.createElement("p");
  banner.className = "result-banner";
  banner.textContent = `Game over: ${outcomeString(outcome)}. Budgets — You: ${game.budget[0]}, Bot: ${game.budget[1]}.`;
  const again = document.createElement("button");
  again.type = "button";
  again.textContent = "Rematch";
  again.className = "rematch";
  const leave = document.createElement("button");
  leave.type = "button";
  leave.textContent = "Back to menu";
  leave.className = "menu-btn";
  root.append(banner, again, leave);
  return new Promise((resolve) => {
    again.addEventListener("click", () => resolve(true));
    leave.addEventListener("click", () => resolve(false));
  });
}

function renderError(root: HTMLElement, message: string) {
  const err = document.createElement("p");
  err.className = "error";
  err.textContent = `Invalid move: ${message}`;
  root.append(err);
}