// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { shouldLoadSdk, type SdkHostContext } from "./sdk";

function ctx(over: Partial<SdkHostContext> = {}): SdkHostContext {
  return {
    hostname: "bidding-tictactoe.sneat.games",
    search: "",
    framed: false,
    referrer: "",
    ...over,
  };
}

describe("shouldLoadSdk — where the SDK has no job", () => {
  it("skips it for a direct visit to sneat.games", () => {
    // The regression this whole change is about: the SDK loaded here, cost
    // 7-10s, and reported environment "disabled".
    expect(shouldLoadSdk(ctx())).toBe(false);
  });

  it("skips it on a local dev server", () => {
    expect(shouldLoadSdk(ctx({ hostname: "localhost" }))).toBe(false);
    expect(shouldLoadSdk(ctx({ hostname: "127.0.0.1" }))).toBe(false);
  });

  it("skips it for a file:// open of dist/", () => {
    expect(shouldLoadSdk(ctx({ hostname: "" }))).toBe(false);
  });

  it("skips it inside a frame that is demonstrably not CrazyGames", () => {
    expect(shouldLoadSdk(ctx({
      framed: true,
      ancestorOrigins: ["https://example.com"],
      referrer: "https://example.com/embed",
    }))).toBe(false);
  });

  it("is not fooled by a lookalike hostname", () => {
    expect(shouldLoadSdk(ctx({ hostname: "notcrazygames.com" }))).toBe(false);
    expect(shouldLoadSdk(ctx({ hostname: "crazygames.com.evil.example" }))).toBe(false);
    expect(shouldLoadSdk(ctx({
      framed: true,
      ancestorOrigins: ["https://crazygames.com.evil.example"],
    }))).toBe(false);
  });
});

describe("shouldLoadSdk — where the SDK is needed", () => {
  it("loads it when served from a CrazyGames domain", () => {
    expect(shouldLoadSdk(ctx({ hostname: "crazygames.com" }))).toBe(true);
    expect(shouldLoadSdk(ctx({ hostname: "www.crazygames.com" }))).toBe(true);
    expect(shouldLoadSdk(ctx({ hostname: "games.crazygames.co.uk" }))).toBe(true);
  });

  it("loads it when framed by CrazyGames", () => {
    expect(shouldLoadSdk(ctx({
      framed: true,
      ancestorOrigins: ["https://www.crazygames.com"],
    }))).toBe(true);
  });

  it("checks every ancestor, not just the nearest", () => {
    expect(shouldLoadSdk(ctx({
      framed: true,
      ancestorOrigins: ["https://player.example", "https://www.crazygames.com"],
    }))).toBe(true);
  });

  it("falls back to the referrer where ancestorOrigins is unavailable", () => {
    // Firefox exposes no ancestorOrigins.
    expect(shouldLoadSdk(ctx({
      framed: true,
      referrer: "https://www.crazygames.com/game/bidding-tic-tac-toe",
    }))).toBe(true);
    expect(shouldLoadSdk(ctx({
      framed: true,
      referrer: "https://example.com/embed",
    }))).toBe(false);
  });

  it("fails open when framed with no way to identify the parent", () => {
    // Missing the SDK on CrazyGames breaks rooms and monetisation; loading it
    // inside some other frame merely wastes a request.
    expect(shouldLoadSdk(ctx({ framed: true }))).toBe(true);
  });

  it("honours ?cgsdk=1 for testing the SDK path off-platform", () => {
    expect(shouldLoadSdk(ctx({ search: "?cgsdk=1" }))).toBe(true);
    expect(shouldLoadSdk(ctx({ hostname: "localhost", search: "?cgsdk=1" }))).toBe(true);
  });

  it("ignores a malformed override", () => {
    expect(shouldLoadSdk(ctx({ search: "?cgsdk=0" }))).toBe(false);
    expect(shouldLoadSdk(ctx({ search: "?cgsdk=yes" }))).toBe(false);
  });

  it("tolerates an opaque ancestor origin", () => {
    expect(shouldLoadSdk(ctx({
      framed: true,
      ancestorOrigins: ["null"],
      referrer: "https://www.crazygames.com/game/x",
    }))).toBe(false);
  });
});
