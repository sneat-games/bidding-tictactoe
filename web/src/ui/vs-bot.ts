// vs-bot screen. Renders the 2x2 match screen (balances + bid panel on top,
// board + game log below) and plays the human against the TS bot strategy.
//
// The bot's hidden bid is computed BEFORE the human is asked, which is what
// makes its bid "in" for the turn clock: the human always answers the clock
// in this mode, and the 30s stall cap can never apply. The window here is the
// longer VS_BOT_LATE_BID_MS — nobody is kept waiting by a slow human.
//
// A "New game" button sits under the board for the whole match, so a player
// can start over without playing a lost position out to the end. It aborts
// the turn in flight rather than waiting for the current move to land.

import { Mark, Outcome, boardOutcome, newGame, resolveTurn, markString, Game, Move } from "../engine/btttplay";
import { botMove } from "../bot/bot";
import { askMove, MoveAbortedError } from "./ask-move";
import { createConfirmButton } from "@sneat/game-kit";
import { createMatchScreen, renderMatchOver, type MatchScreen } from "./match-screen";
import { VS_BOT_LATE_BID_MS } from "@sneat/game-kit";
import { winningLine } from "./win-line";

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

  // Re-pointed at each match's controller, so the button outlives the match
  // it restarts.
  let restart = new AbortController();
  const newGameBtn = createConfirmButton({
    label: "New game",
    confirmLabel: "Restart — click again",
    onConfirm: () => restart.abort(),
  });
  screen.actions.append(newGameBtn.el);

  for (;;) {
    restart = new AbortController();
    newGameBtn.disarm();
    const done = await playMatch(screen, human, bot, restart.signal);

    // Restarted mid-match: straight into a fresh one, no result screen.
    if (done === null) {
      screen.reset();
      continue;
    }

    // The match-over controls carry their own Rematch, so the persistent
    // button would just be a second one saying the same thing.
    screen.actions.hidden = true;
    const again = await renderResult(screen, done.outcome, done.budgets, human);
    if (!again) return;
    screen.reset();
  }
}

/** Play one match. Resolves with its result, or null if it was restarted. */
async function playMatch(
  screen: MatchScreen,
  human: Mark,
  bot: Mark,
  abort: AbortSignal,
): Promise<{ outcome: Outcome; budgets: [number, number] } | null> {
  const game = newGame(BUDGET);
  let turn = 0;
  for (;;) {
    let outcome: Outcome;
    try {
      outcome = await playOneTurn(screen, game, human, bot, turn, abort);
    } catch (e) {
      if (e instanceof MoveAbortedError) return null;
      throw e;
    }
    if (outcome !== Outcome.Ongoing) {
      return { outcome, budgets: [game.budget[0], game.budget[1]] };
    }
    turn++;
  }
}

async function playOneTurn(
  screen: MatchScreen,
  game: Game,
  human: Mark,
  bot: Mark,
  turn: number,
  abort: AbortSignal,
): Promise<Outcome> {
  const humanIdx = human === Mark.X ? 0 : 1;
  const botIdx = humanIdx === 0 ? 1 : 0;

  screen.renderBoard(game.board, undefined, { mine: human });

  // The bot commits first (hidden), so its bid is already in when the human
  // is asked — see the module comment.
  const botChoice = botMove({
    board: game.board,
    budgetRemaining: game.budget[botIdx],
    me: bot,
    opponentBudget: game.budget[humanIdx],
  });

  const humanChoice = await askMove({
    boardArea: screen.boardArea,
    bidPanel: screen.bidPanel,
    board: game.board,
    me: human,
    ownBalance: game.budget[humanIdx],
    opponentBalance: game.budget[botIdx],
    opponentBidIn: true,
    lateBidMs: VS_BOT_LATE_BID_MS,
    abort,
  });

  const xMove: Move = human === Mark.X ? humanChoice : botChoice;
  const oMove: Move = human === Mark.X ? botChoice : humanChoice;
  const budgetsBefore: [number, number] = [game.budget[0], game.budget[1]];

  try {
    const { game: next, result } = resolveTurn(game, xMove, oMove);
    Object.assign(game, next);
    const outcome = boardOutcome(game.board);
    // Re-render with the post-move state so the winning mark is visible; at
    // match end, also highlight the winning line (a draw has none).
    const winLine = outcome === Outcome.XWins || outcome === Outcome.OWins ? winningLine(game.board) : null;
    screen.renderBoard(game.board, result.cell, { mine: human, winLine });
    screen.setTurnResult(result, human, "Bot");
    screen.appendTurn({
      turn,
      result,
      xMove,
      oMove,
      budgetsBefore,
      budgetsAfter: [game.budget[0], game.budget[1]],
    });
    return outcome;
  } catch (e) {
    screen.setNote(`Invalid move: ${e instanceof Error ? e.message : String(e)}`, "error");
    return Outcome.Ongoing;
  }
}

function renderResult(
  screen: MatchScreen,
  outcome: Outcome,
  budgets: [number, number],
  human: Mark,
): Promise<boolean> {
  screen.bidPanel.setWaiting("Match over.");

  const banner = renderMatchOver({
    outcome,
    you: human,
    budgets,
    youLabel: "You",
    themLabel: "Bot",
    initialBudget: BUDGET,
  });

  const again = document.createElement("button");
  again.type = "button";
  again.textContent = "Rematch";
  again.className = "btn btn--primary rematch";

  const leave = document.createElement("button");
  leave.type = "button";
  leave.textContent = "Back to menu";
  leave.className = "btn btn--ghost menu-btn";

  screen.controls.append(banner, again, leave);
  return new Promise((resolve) => {
    again.addEventListener("click", () => resolve(true));
    leave.addEventListener("click", () => resolve(false));
  });
}
