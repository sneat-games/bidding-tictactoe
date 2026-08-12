// Asking the local player for a move, under the turn clock.
//
// Shared by both modes so the clock behaves identically in vs-bot and
// vs-friend. The player commits by clicking a board cell (the bid is
// whatever the bid panel is showing). If a deadline expires first, THIS
// client submits the move on its own player's behalf — see turn-clock.ts for
// why that direction matters.
//
// Which deadline applies:
//
//   - Opponent's bid already in  -> LATE_BID_MS, auto-bid LATE_BID_DEFAULT.
//   - Nobody has bid yet         -> STALL_MS, auto-bid stallBid(...).
//     If the opponent's bid lands while this clock is running, it is
//     replaced by a fresh LATE_BID_MS clock.
//
// vs-bot passes `opponentBidIn: true` — the bot commits its hidden bid at the
// start of the turn — so the human always plays the 10s clock there and the
// stall case cannot arise.

import { Board, Mark, Move } from "../engine/btttplay";
import { botMove } from "../bot/bot";
import type { BidPanel } from "./bid-panel";
import { LATE_BID_DEFAULT, LATE_BID_MS, STALL_MS, stallBid } from "./turn-clock";

/** Thrown when a turn is interrupted — currently only by "New game". */
export class MoveAbortedError extends Error {
  constructor() {
    super("askMove: the turn was aborted");
    this.name = "MoveAbortedError";
  }
}

export interface AskMoveOptions {
  /** Container holding the rendered board — its cells are the commit control. */
  boardArea: HTMLElement;
  bidPanel: BidPanel;
  board: Board;
  /** The local player's mark. */
  me: Mark;
  ownBalance: number;
  opponentBalance: number;
  /** True when the opponent's bid is already in as this turn starts. */
  opponentBidIn: boolean;
  /**
   * Subscribe to the opponent's bid landing mid-turn (vs-friend only). The
   * returned function must unsubscribe, so a late message cannot restart a
   * clock on an already-finished turn.
   */
  onOpponentBid?(fn: () => void): () => void;
  /** Abandon the turn — rejects with MoveAbortedError and stops the clock. */
  abort?: AbortSignal;
  /** Answer window once the opponent's bid is in. Defaults to the PvP
   *  LATE_BID_MS; vs-bot passes the longer VS_BOT_LATE_BID_MS. */
  lateBidMs?: number;
}

/**
 * Resolve with the local player's move: either what they clicked, or the
 * default their expired clock submitted for them.
 */
export function askMove(opts: AskMoveOptions): Promise<Move> {
  const { boardArea, bidPanel, board, me, ownBalance, opponentBalance } = opts;

  bidPanel.beginTurn({ max: ownBalance, initial: Math.floor(ownBalance / 2) });

  // Where an auto-submitted move plays. Computed from the board as it stands
  // at the start of the turn (no mark lands mid-turn), so an away player
  // still takes a sensible square rather than the first empty one.
  const autoCell = botMove({ board, budgetRemaining: ownBalance, me, opponentBudget: opponentBalance }).cell;

  return new Promise<Move>((resolve, reject) => {
    let settled = false;
    let unsubscribe: (() => void) | undefined;

    const settle = (run: () => void) => {
      if (settled) return;
      settled = true;
      unsubscribe?.();
      opts.abort?.removeEventListener("abort", onAbort);
      bidPanel.stopClock();
      run();
    };

    const finish = (move: Move) => settle(() => resolve(move));
    function onAbort() {
      settle(() => reject(new MoveAbortedError()));
    }

    if (opts.abort?.aborted) {
      onAbort();
      return;
    }
    opts.abort?.addEventListener("abort", onAbort, { once: true });

    const runLateBidClock = () => {
      if (settled) return;
      bidPanel.runClock({
        ms: opts.lateBidMs ?? LATE_BID_MS,
        label: "Opponent has bid — answer within",
        autoBid: LATE_BID_DEFAULT,
        onExpire: () => finish({ bid: LATE_BID_DEFAULT, cell: autoCell }),
      });
    };

    if (opts.opponentBidIn) {
      runLateBidClock();
    } else {
      const auto = stallBid(ownBalance, opponentBalance);
      bidPanel.runClock({
        ms: STALL_MS,
        label: "Bid within",
        autoBid: auto,
        onExpire: () => finish({ bid: auto, cell: autoCell }),
      });
      // A bid from the opponent swaps the stall cap for the 10s answer clock.
      unsubscribe = opts.onOpponentBid?.(runLateBidClock);
    }

    for (const cell of boardArea.querySelectorAll<HTMLButtonElement>(".board__cell")) {
      if (cell.disabled) continue;
      cell.addEventListener("click", () => {
        finish({ bid: bidPanel.value(), cell: Number(cell.dataset.cell) });
      });
    }
  });
}
