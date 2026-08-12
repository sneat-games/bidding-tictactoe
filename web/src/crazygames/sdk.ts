// CrazyGames SDK v3 wrapper.
//
// This wrapper decides WHETHER to load the SDK, loads it, initialises it, and
// gates every call by environment so the app degrades gracefully off
// CrazyGames, wiring the Play-with-Friends surface (room lifecycle, invite
// link, join listener, instant-multiplayer).
//
// The SDK script is injected on demand rather than sitting in the document
// head. A static tag there is render-blocking and third-party: on
// bidding-tictactoe.sneat.games it cost 7-10s before the menu appeared, only
// to have the SDK report `environment: "disabled"` and do nothing. Off
// CrazyGames the SDK has no job, so it is never fetched — see `shouldLoadSdk`.
//
// Reference: https://docs.crazygames.com/sdk/ (v3).

export type SdkEnvironment = "local" | "crazygames" | "disabled";

export interface PortalUser {
  username: string;
  profilePictureUrl?: string;
  /** Reserved field exposed by the SDK but unsafe for auth (per CrazyGames
   *  docs). Kept for completeness; do NOT use it for authentication. */
  __dangerousUserId?: string;
}

export interface GameSettings {
  disableChat: boolean;
  muteAudio: boolean;
}

export interface RoomUpdate {
  roomId?: string;
  isJoinable?: boolean;
  inviteParams?: Record<string, string | number>;
}

export interface RoomJoinListener {
  (inviteParams: Record<string, string>): void;
}

export interface SystemInfo {
  countryCode?: string;
  locale?: string;
  device?: { type: "desktop" | "tablet" | "mobile" };
  os?: { name?: string; version?: string };
  browser?: { name?: string; version?: string };
  applicationType?: "google_play_store" | "apple_store" | "pwa" | "web";
}

type CrazyGamesSdk = {
  init(): Promise<void>;
  environment: SdkEnvironment;
  game: {
    isInstantMultiplayer: boolean;
    inviteParams: Record<string, string> | null;
    settings: GameSettings;
    updateRoom(input: RoomUpdate): void;
    leftRoom(): void;
    inviteLink(params: Record<string, string | number>): string;
    getInviteParam(name: string): string | null;
    addJoinRoomListener(l: RoomJoinListener): void;
    removeJoinRoomListener(l: RoomJoinListener): void;
    addSettingsChangeListener(l: (s: GameSettings) => void): void;
    removeSettingsChangeListener(l: (s: GameSettings) => void): void;
    gameplayStart(): void;
    gameplayStop(): void;
    loadingStart(): void;
    loadingStop(): void;
    happytime(): void;
  };
  user: {
    isUserAccountAvailable: boolean;
    systemInfo: SystemInfo;
    getUser(): Promise<PortalUser | null>;
    listFriends(input: { page: number; size: number }): Promise<{
      friends: PortalUser[];
      page: number;
      size: number;
      hasMore: boolean;
      total: number;
    }>;
  };
  data: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
    clear(): void;
  };
};

declare global {
  interface Window {
    CrazyGames?: { SDK: CrazyGamesSdk };
  }
}

function sdk(): CrazyGamesSdk | undefined {
  return window.CrazyGames?.SDK;
}

let initialised: boolean = false;
/** Init promise so multiple callers can race safely. */
let initPromise: Promise<void> | null = null;

const SDK_SRC = "https://sdk.crazygames.com/crazygames-sdk-v3.js";

/** Never let a wedged third-party script hold the game on its loading screen. */
const SDK_BOOT_TIMEOUT_MS = 8_000;

/** crazygames.com and its regional/staging siblings. */
const CG_HOST = /(^|\.)crazygames\.(com|co\.uk|dev)$/i;

/** The signals `shouldLoadSdk` reads, passed in so it stays testable. */
export interface SdkHostContext {
  hostname: string;
  /** `location.search`, for the `?cgsdk=1` override. */
  search: string;
  /** Whether this document is inside a frame at all. */
  framed: boolean;
  /** `location.ancestorOrigins`, where the browser exposes it. */
  ancestorOrigins?: readonly string[];
  referrer: string;
}

function isCrazyGamesUrl(value: string): boolean {
  try {
    return CG_HOST.test(new URL(value).hostname);
  } catch {
    return false;
  }
}

/**
 * Whether the CrazyGames SDK is worth loading here.
 *
 * The SDK only does anything inside CrazyGames. Everywhere else — a direct
 * visit to bidding-tictactoe.sneat.games, a local dev server, a `file://`
 * open of `dist/` — it initialises to `environment: "disabled"` after a
 * costly third-party round trip. So: load it when we are served from a
 * CrazyGames domain, when we are framed by one, or when explicitly forced
 * with `?cgsdk=1` for testing the SDK path off-platform.
 *
 * When we are framed but cannot see by whom (no `ancestorOrigins`, referrer
 * suppressed), this fails OPEN: missing the SDK on CrazyGames breaks rooms
 * and monetisation, while loading it inside some other frame merely wastes a
 * request.
 */
export function shouldLoadSdk(ctx: SdkHostContext): boolean {
  if (new URLSearchParams(ctx.search).get("cgsdk") === "1") return true;
  if (CG_HOST.test(ctx.hostname)) return true;
  // A top-level page that is not on a CrazyGames domain is never a
  // CrazyGames game surface.
  if (!ctx.framed) return false;
  const ancestors = ctx.ancestorOrigins;
  if (ancestors && ancestors.length > 0) {
    for (const origin of ancestors) {
      if (isCrazyGamesUrl(origin)) return true;
    }
    return false; // Framed, and we can see it is not CrazyGames.
  }
  if (!ctx.referrer) return true; // Framed, referrer hidden — fail open.
  return isCrazyGamesUrl(ctx.referrer);
}

function currentContext(): SdkHostContext {
  const loc = window.location;
  const ancestors = loc.ancestorOrigins;
  return {
    hostname: loc.hostname,
    search: loc.search,
    framed: window.self !== window.top,
    ancestorOrigins: ancestors ? Array.from(ancestors) : undefined,
    referrer: document.referrer,
  };
}

/** Inject the SDK script and resolve once it has run. */
function loadSdkScript(): Promise<void> {
  if (sdk()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = SDK_SRC;
    el.async = true;
    el.addEventListener("load", () => resolve(), { once: true });
    el.addEventListener("error", () => reject(new Error("crazygames: SDK script failed to load")), { once: true });
    document.head.append(el);
  });
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`crazygames: ${what} timed out`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/**
 * Load and initialise the SDK, if this page is a CrazyGames surface. Safe to
 * await multiple times; resolves quickly and silently everywhere else, so the
 * menu is never waiting on a third party.
 */
export async function initSdk(): Promise<void> {
  if (initialised) return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (!shouldLoadSdk(currentContext())) return;
    try {
      await withTimeout(loadSdkScript(), SDK_BOOT_TIMEOUT_MS, "SDK script load");
      const s = sdk();
      if (!s) return;
      await withTimeout(s.init(), SDK_BOOT_TIMEOUT_MS, "SDK init");
      initialised = true;
    } catch (e) {
      // Degrade: every call is gated on `isSdkAvailable`, so the game plays on.
      console.warn("[crazygames] SDK unavailable; running in degraded mode.", e);
    }
  })();
  return initPromise;
}

export function isSdkAvailable(): boolean {
  return initialised && environment() !== "disabled";
}

export function environment(): SdkEnvironment {
  return sdk()?.environment ?? "disabled";
}

/** Run an SDK call only when the SDK is available; otherwise return a fallback. */
function withSdk<T>(fallback: T, fn: (s: CrazyGamesSdk) => T): T {
  if (!isSdkAvailable()) return fallback;
  try {
    return fn(sdk()!);
  } catch (e) {
    console.warn("[crazygames] SDK call threw; degrading.", e);
    return fallback;
  }
}

// --- game module -------------------------------------------------------

export function isInstantMultiplayer(): boolean {
  return withSdk(false, (s) => s.game.isInstantMultiplayer);
}

export function inviteParams(): Record<string, string> | null {
  return withSdk(null, (s) => s.game.inviteParams);
}

export function getInviteParam(name: string): string | null {
  return withSdk(null, (s) => s.game.getInviteParam(name));
}

export function updateRoom(input: RoomUpdate): void {
  withSdk(undefined, (s) => s.game.updateRoom(input));
}

export function leftRoom(): void {
  withSdk(undefined, (s) => s.game.leftRoom());
}

export function inviteLink(params: Record<string, string | number>): string | null {
  return withSdk(null, (s) => s.game.inviteLink(params));
}

export function addJoinRoomListener(l: RoomJoinListener): void {
  withSdk(undefined, (s) => s.game.addJoinRoomListener(l));
}

export function removeJoinRoomListener(l: RoomJoinListener): void {
  withSdk(undefined, (s) => s.game.removeJoinRoomListener(l));
}

export function addSettingsChangeListener(l: (s: GameSettings) => void): void {
  withSdk(undefined, (s) => s.game.addSettingsChangeListener(l));
}

export function removeSettingsChangeListener(l: (s: GameSettings) => void): void {
  withSdk(undefined, (s) => s.game.removeSettingsChangeListener(l));
}

export function getSettings(): GameSettings | null {
  return withSdk(null, (s) => s.game.settings);
}

export function gameplayStart(): void { withSdk(undefined, (s) => s.game.gameplayStart()); }
export function gameplayStop(): void { withSdk(undefined, (s) => s.game.gameplayStop()); }
export function loadingStart(): void { withSdk(undefined, (s) => s.game.loadingStart()); }
export function loadingStop(): void { withSdk(undefined, (s) => s.game.loadingStop()); }
export function happytime(): void { withSdk(undefined, (s) => s.game.happytime()); }

// --- user module -------------------------------------------------------

export function isUserAccountAvailable(): boolean {
  return withSdk(false, (s) => s.user.isUserAccountAvailable);
}

export function getUser(): Promise<PortalUser | null> {
  return withSdk(Promise.resolve(null), (s) => s.user.getUser());
}

export function listFriends(page: number, size: number): Promise<{
  friends: PortalUser[]; page: number; size: number; hasMore: boolean; total: number;
}> {
  return withSdk(
    Promise.resolve({ friends: [], page, size, hasMore: false, total: 0 }),
    (s) => s.user.listFriends({ page, size }),
  ) as Promise<{
    friends: PortalUser[]; page: number; size: number; hasMore: boolean; total: number;
  }>;
}

export function systemInfo(): SystemInfo | null {
  return withSdk(null, (s) => s.user.systemInfo);
}

// --- data module -------------------------------------------------------

export function dataGet(key: string): string | null {
  return withSdk(null, (s) => s.data.getItem(key));
}
export function dataSet(key: string, value: string): void {
  withSdk(undefined, (s) => s.data.setItem(key, value));
}
export function dataRemove(key: string): void {
  withSdk(undefined, (s) => s.data.removeItem(key));
}

/** True if the CrazyGames SDK script tag is present at all (i.e. this build
 *  was shipped to CrazyGames; `false` on sneat.games where the SDK is omitted
 *  by the host worker). */
export function hasSdkScript(): boolean {
  return typeof window !== "undefined" && !!window.CrazyGames;
}