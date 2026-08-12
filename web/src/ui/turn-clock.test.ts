import { describe, it, expect, vi, afterEach } from "vitest";
import { stallBid, startCountdown, LATE_BID_MS, STALL_MS, LATE_BID_DEFAULT, VS_BOT_LATE_BID_MS } from "./turn-clock";

describe("stallBid", () => {
  it("stakes half the balance when both sides are level", () => {
    expect(stallBid(100, 100)).toBe(50);
    expect(stallBid(1, 1)).toBe(0);
    expect(stallBid(0, 0)).toBe(0);
  });

  it("stakes half the balance when behind", () => {
    expect(stallBid(40, 160)).toBe(20);
    expect(stallBid(0, 200)).toBe(0);
  });

  it("outbids by exactly one when strictly richer", () => {
    expect(stallBid(160, 40)).toBe(41);
    expect(stallBid(101, 99)).toBe(100);
    expect(stallBid(1, 0)).toBe(1);
  });

  it("never returns a bid the player cannot afford", () => {
    // The engine rejects a bid above the player's budget, so the outbid
    // branch must stay within it for every ordering of the two balances.
    for (let own = 0; own <= 60; own++) {
      for (let opp = 0; opp <= 60; opp++) {
        const bid = stallBid(own, opp);
        expect(bid).toBeGreaterThanOrEqual(0);
        expect(bid).toBeLessThanOrEqual(own);
      }
    }
  });

  it("guarantees the turn when strictly richer", () => {
    // opp cannot bid more than their whole balance, so opp+1 always wins
    // outright — no tie-break needed.
    for (let opp = 0; opp <= 60; opp++) {
      const own = opp + 7;
      expect(stallBid(own, opp)).toBeGreaterThan(opp);
    }
  });

  it("floors fractional balances instead of bidding a fraction", () => {
    expect(stallBid(75, 75)).toBe(37);
    expect(stallBid(7.9, 7.2)).toBe(3);
  });

  it("treats negative balances as zero", () => {
    expect(stallBid(-5, 10)).toBe(0);
    expect(stallBid(10, -5)).toBe(1);
  });
});

describe("clock constants", () => {
  it("gives the answering player 10s and caps a silent turn at 30s", () => {
    expect(LATE_BID_MS).toBe(10_000);
    expect(STALL_MS).toBe(30_000);
    expect(LATE_BID_DEFAULT).toBe(0);
  });

  it("caps a silent turn later than it caps an unanswered bid", () => {
    expect(STALL_MS).toBeGreaterThan(LATE_BID_MS);
  });
});

describe("startCountdown", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports the full duration before the first tick", () => {
    vi.useFakeTimers();
    const onTick = vi.fn();
    const onExpire = vi.fn();
    startCountdown({ ms: 10_000, onTick, onExpire });
    expect(onTick).toHaveBeenCalledWith(10_000);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("expires once, with a final zero tick", () => {
    vi.useFakeTimers();
    const onTick = vi.fn();
    const onExpire = vi.fn();
    startCountdown({ ms: 1_000, onTick, onExpire });
    vi.advanceTimersByTime(5_000);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(onTick).toHaveBeenLastCalledWith(0);
  });

  it("counts down against wall-clock time, not tick count", () => {
    vi.useFakeTimers();
    const seen: number[] = [];
    startCountdown({ ms: 1_000, onTick: (ms) => seen.push(ms), onExpire: () => {} });
    vi.advanceTimersByTime(300);
    expect(seen[seen.length - 1]).toBe(700);
  });

  it("does not expire after stop()", () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const c = startCountdown({ ms: 1_000, onTick: () => {}, onExpire });
    c.stop();
    vi.advanceTimersByTime(5_000);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("tolerates stop() being called twice, and after expiry", () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const c = startCountdown({ ms: 1_000, onTick: () => {}, onExpire });
    vi.advanceTimersByTime(2_000);
    c.stop();
    c.stop();
    vi.advanceTimersByTime(5_000);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});

describe("mode-specific answer windows", () => {
  it("gives more time against the bot than against a person", () => {
    expect(VS_BOT_LATE_BID_MS).toBe(20_000);
    expect(VS_BOT_LATE_BID_MS).toBeGreaterThan(LATE_BID_MS);
  });

  it("still resolves a bot turn before the stall cap could matter", () => {
    // vs-bot never stalls (the bot always bids), but the ordering keeps the
    // two windows meaningful if that ever changes.
    expect(VS_BOT_LATE_BID_MS).toBeLessThan(STALL_MS);
  });
});
