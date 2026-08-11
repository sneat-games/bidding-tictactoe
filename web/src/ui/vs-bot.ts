// vs-bot screen. Renders the board, the bid input (linked slider + number),
// and the turn result. A rematch restarts in the same tab.

import { Mark, Outcome, boardString, boardOutcome, newGame, resolveTurn, markString, outcomeString } from "../engine/btttplay";
import { botMove } from "../bot/bot";
import { createBidInput } from "./bid-input";

const BUDGET = 100;

export async function runVsBot(root: HTMLElement): Promise<void> {
  let game = newGame(BUDGET);
  let human: Mark = Mark.X;
  let bot: Mark = Mark.O;

  while (true) {
    const outcome = await playOneTurn(root, game, human, bot);
    if (outcome !== Outcome.Ongoing) {
      const again = await renderResult(root, outcome, game);
      if (!again) return;
      game = newGame(BUDGET);
      human = Mark.X;
      bot = Mark.O;
    }
  }
}

async function playOneTurn(
  root: HTMLElement,
  game: ReturnType<typeof newGame>,
  human: Mark,
  botMark: Mark,
): Promise<Outcome> {
  renderBoard(root, game, human, botMark);
  // Wait for human's move.
  const humanMove = await askHuman(root, game, human);
  // Bot picks its move.
  const botMoveData = botMove({
    board: game.board,
    budgetRemaining: game.budget[botMark === Mark.X ? 0 : 1],
    me: botMark,
  });
  const xMove = human === Mark.X ? humanMove : botMoveData;
  const oMove = human === Mark.X ? botMoveData : humanMove;
  try {
    const { game: next, result } = resolveTurn(game, xMove, oMove);
    renderTurnResult(root, result, next, human);
    Object.assign(game, next);
    return boardOutcome(game.board);
  } catch (e) {
    renderError(root, e instanceof Error ? e.message : String(e));
    return Outcome.Ongoing;
  }
}

function renderBoard(root: HTMLElement, game: ReturnType<typeof newGame>, human: Mark, botMark: Mark) {
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
    if (game.board[i] !== 0 /* Empty */) cell.disabled = true;
    board.appendChild(cell);
  }
  const status = document.createElement("p");
  status.className = "status";
  status.textContent = `You are ${markString(human)}. Budgets — You: ${game.budget[human === Mark.X ? 0 : 1]}, Bot: ${game.budget[botMark === Mark.X ? 0 : 1]}.`;
  root.append(board, status);
}

async function askHuman(
  root: HTMLElement,
  game: ReturnType<typeof newGame>,
  human: Mark,
): Promise<{ bid: number; cell: number }> {
  const remaining = game.budget[human === Mark.X ? 0 : 1];
  const bid = createBidInput({ max: remaining, initial: Math.floor(remaining / 2) });

  const prompt = document.createElement("div");
  prompt.className = "prompt";
  prompt.append("Click a cell, then ", bid.el);

  const submit = document.createElement("button");
  submit.type = "button";
  submit.textContent = "Submit hidden bid";
  submit.disabled = true;

  root.append(prompt, submit);

  let chosenCell: number | null = null;
  const cells = root.querySelectorAll<HTMLButtonElement>(".board__cell");
  cells.forEach((c) => {
    if (c.disabled) return;
    c.addEventListener("click", () => {
      cells.forEach((x) => x.classList.remove("selected"));
      c.classList.add("selected");
      chosenCell = parseInt(c.dataset.cell ?? "", 10);
      submit.disabled = false;
    });
  });

  return new Promise((resolve) => {
    submit.addEventListener("click", () => {
      if (chosenCell === null) return;
      resolve({ bid: bid.value(), cell: chosenCell });
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
  banner.textContent = `Game over: ${outcomeString(outcome)}. Board: ${boardString(game.board)}`;
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