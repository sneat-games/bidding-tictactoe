// vs-bot screen. Renders the 2x2 match screen (balances + bid panel on top,
// board + game log below) and plays the human against the TS bot strategy.
// A rematch restarts in the same tab and clears the log.
//
// The bot's hidden bid is computed BEFORE the human is asked, which is what
// makes its bid "in" for the turn clock: the human always answers the 10s
// clock in this mode, and the 30s stall cap can never apply.

import { Mark, Outcome, boardOutcome, newGame, resolveTurn, markString, outcomeString, Game, Move } from "../engine/btttplay";
import { botMove } from "../bot/bot";
import { askMove } from "./ask-move";
import { createMatchScreen, turnResultText, type MatchScreen } from "./match-screen";

const BUDGET = 100;

export async function runVsBot(root: HTMLElement): Promise<void> {
  const human: Mark = Mark.X;
  const bot: Mark = Mark.O;
  const screen = createMatchScreen({
    root,
    initialBudget: BUDGET,
    xLabel: `You (${markString(human)})`,
    oLabel: `Bot (${markString(bot)})`,
  });

  let game = newGame(BUDGET);
  let turn = 0;

  for (;;) {
    const outcome = await playOneTurn(screen, game, human, bot, turn);
    if (outcome === Outcome.Ongoing) {
      turn++;
      continue;
    }
    const again = await renderResult(screen, outcome, game, human);
    if (!again) return;
    game = newGame(BUDGET);
    turn = 0;
    screen.reset();
  }
}

async function playOneTurn(
  screen: MatchScreen,
  game: Game,
  human: Mark,
  bot: Mark,
  turn: number,
): Promise<Outcome> {
  const humanIdx = human === Mark.X ? 0 : 1;
  const botIdx = humanIdx === 0 ? 1 : 0;

  screen.renderBoard(game.board);

  // The bot commits first (hidden), so its bid is already in when the human
  // is asked — see the module comment.
  const botChoice = botMove({
    board: game.board,
    budgetRemaining: game.budget[botIdx],
    me: bot,
  });

  const humanChoice = await askMove({
    boardArea: screen.boardArea,
    bidPanel: screen.bidPanel,
    board: game.board,
    me: human,
    ownBalance: game.budget[humanIdx],
    opponentBalance: game.budget[botIdx],
    opponentBidIn: true,
  });

  const xMove: Move = human === Mark.X ? humanChoice : botChoice;
  const oMove: Move = human === Mark.X ? botChoice : humanChoice;
  const budgetsBefore: [number, number] = [game.budget[0], game.budget[1]];

  try {
    const { game: next, result } = resolveTurn(game, xMove, oMove);
    Object.assign(game, next);
    // Re-render with the post-move state so the winning mark is visible.
    screen.renderBoard(game.board);
    screen.setNote(turnResultText(result));
    screen.appendTurn({
      turn,
      result,
      xMove,
      oMove,
      budgetsBefore,
      budgetsAfter: [game.budget[0], game.budget[1]],
    });
    return boardOutcome(game.board);
  } catch (e) {
    screen.setNote(`Invalid move: ${e instanceof Error ? e.message : String(e)}`, "error");
    return Outcome.Ongoing;
  }
}


function renderResult(
  screen: MatchScreen,
  outcome: Outcome,
  game: Game,
  human: Mark,
): Promise<boolean> {
  screen.bidPanel.setWaiting("Match over.");

  const humanIdx = human === Mark.X ? 0 : 1;
  const banner = document.createElement("p");
  banner.className = "result-banner";
  banner.textContent = `Game over: ${outcomeString(outcome)}. Balances — You: ${game.budget[humanIdx]}, Bot: ${game.budget[humanIdx === 0 ? 1 : 0]}.`;

  const again = document.createElement("button");
  again.type = "button";
  again.textContent = "Rematch";
  again.className = "rematch";

  const leave = document.createElement("button");
  leave.type = "button";
  leave.textContent = "Back to menu";
  leave.className = "menu-btn";

  screen.controls.append(banner, again, leave);
  return new Promise((resolve) => {
    again.addEventListener("click", () => resolve(true));
    leave.addEventListener("click", () => resolve(false));
  });
}
