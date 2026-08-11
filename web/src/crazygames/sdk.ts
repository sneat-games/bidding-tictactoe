// CrazyGames SDK v3 wrapper.
//
// The HTML5 SDK script tag is loaded in `src/layouts/Layout.astro`. This
// wrapper initialises the SDK, gates every call by environment so the app
// degrades gracefully on non-CrazyGames domains (e.g. bidding-tictactoe.
// sneat.games, localhost with no SDK), wires game/user/data/settings helpers,
// and exposes the Play-with-Friends surface (room lifecycle, invite link,
// join listener, instant-multiplayer).
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

/** Initialise the SDK. Safe to await multiple times. Resolves silently when
 *  the SDK is absent (non-CrazyGames domains, e.g. sneat.games). */
export async function initSdk(): Promise<void> {
  if (initialised) return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const s = sdk();
    if (!s) return; // No script tag present (e.g. sneat.games build run without it).
    try {
      await s.init();
      initialised = true;
    } catch (e) {
      // Swallow; environments without an init function still degrade.
      console.warn("[crazygames] SDK init failed; running in degraded mode.", e);
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