// Turn clock: the two deadlines that bound a turn, and the bids a player's
// own client submits on their behalf when one expires.
//
// Both deadlines are SELF-ENFORCED. A client only ever auto-submits its own
// move, through exactly the same commit-reveal path a manual move takes.
// Neither peer ever resolves a turn on the other's behalf, so a timeout can
// never make the two boards disagree.
//
//   - Once one player's bid is in, the other has LATE_BID_MS to answer.
//     Failing that their bid defaults to LATE_BID_DEFAULT (0), so the only
//     real bid wins the turn — and, under the first-price-transfer rule, is
//     paid to the player who did not answer.
//
//   - If NEITHER player has bid STALL_MS after the turn started, each silent
//     client submits `stallBid` (see below). Without this a vs-friend turn
//     with two idle players would hang forever.
//
// The LATE_BID_MS clock replaces the STALL_MS one as soon as either bid
// lands. Both are session-layer rules: `resolveTurn` already discards the
// loser's cell, so neither server-go/btttplay nor its TS port changes.

/** How long the second player gets to answer once one bid is in, against a
 *  human. A real person is sitting there waiting, so it is deliberately
 *  tight. */
export const LATE_BID_MS = 10_000;

/** The same window against the bot. Nobody is kept waiting, and the bot's bid
 *  is in from the first instant of every turn, so the human would otherwise
 *  play the whole match on a 10s clock. */
export const VS_BOT_LATE_BID_MS = 20_000;

/** How long a turn may sit with no bid from either player. */
export const STALL_MS = 30_000;

/** The bid a player is charged for letting the LATE_BID_MS clock expire. */
export const LATE_BID_DEFAULT = 0;

/**
 * The bid a client auto-submits for its own player when the STALL_MS cap
 * expires with no bid from either side.
 *
 * A player who is strictly richer bids `opponentBalance + 1`: the cheapest
 * bid the opponent cannot possibly outbid, and always affordable, because
 * `own > opp` over integers means `own >= opp + 1`. Everyone else stakes
 * half their balance. Both inputs are the balances already on screen in the
 * balances card, so the number is predictable before it fires.
 */
export function stallBid(ownBalance: number, opponentBalance: number): number {
  const own = Math.max(0, Math.floor(ownBalance));
  const opp = Math.max(0, Math.floor(opponentBalance));
  if (own > opp) return opp + 1;
  return Math.floor(own / 2);
}

export interface Countdown {
  /** Stop ticking. Idempotent; `onExpire` will not fire afterwards. */
  stop(): void;
}

export interface CountdownOptions {
  ms: number;
  /** Called with the milliseconds left, immediately and then on each tick. */
  onTick(remainingMs: number): void;
  onExpire(): void;
  /** Tick period. Defaults to 100ms — smooth enough for a progress bar. */
  tickMs?: number;
}

/**
 * A cancellable countdown driven by wall-clock time rather than by counting
 * ticks, so a throttled background tab expires at the right moment instead
 * of drifting.
 */
export function startCountdown(opts: CountdownOptions): Countdown {
  const deadline = Date.now() + opts.ms;
  let timer: ReturnType<typeof setInterval> | undefined;
  let done = false;

  const stop = () => {
    done = true;
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };

  const tick = () => {
    if (done) return;
    const left = deadline - Date.now();
    if (left <= 0) {
      stop();
      opts.onTick(0);
      opts.onExpire();
      return;
    }
    opts.onTick(left);
  };

  opts.onTick(opts.ms);
  timer = setInterval(tick, opts.tickMs ?? 100);
  return { stop };
}
