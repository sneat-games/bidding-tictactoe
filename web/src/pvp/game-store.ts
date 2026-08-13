// IndexedDB persistence for Bidding Tic-Tac-Toe — the single store for
// both game state AND log entries. One database, one TTL, one cleanup
// path. Replaces the earlier split (localStorage for game state +
// IndexedDB for log entries) with a unified store.

import type { LogEntry } from "../ui/game-log";

const DB_NAME = "bttt";
const DB_VERSION = 2;
const STATE_STORE = "game-state";
const LOG_STORE = "log-entries";
const STATE_KEY = "current";
const LOG_KEY = "entries";
const TTL_MS = 30 * 60 * 1000; // 30 minutes

// --- game state ---

export interface SavedState {
  mode: "vs-bot" | "vs-friend";
  roomId?: string;
  as?: "host" | "guest";
  board: string; // 9-char board string
  budget: [number, number];
  tieToX: boolean;
  turn: number;
  human: "X" | "O";
  savedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STATE_STORE)) {
        db.createObjectStore(STATE_STORE);
      }
      if (!db.objectStoreNames.contains(LOG_STORE)) {
        db.createObjectStore(LOG_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveState(state: Omit<SavedState, "savedAt">): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STATE_STORE, "readwrite");
    const full: SavedState = { ...state, savedAt: Date.now() };
    tx.objectStore(STATE_STORE).put(full, STATE_KEY);
    await txComplete(tx);
    db.close();
  } catch { /* non-fatal */ }
}

export async function loadState(): Promise<SavedState | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(STATE_STORE, "readonly");
    const req = tx.objectStore(STATE_STORE).get(STATE_KEY);
    const result = await reqDone(req);
    db.close();
    if (!result) return null;
    const state = result as SavedState;
    if (Date.now() - state.savedAt > TTL_MS) {
      await clearState();
      return null;
    }
    return state;
  } catch {
    return null;
  }
}

export async function clearState(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STATE_STORE, "readwrite");
    tx.objectStore(STATE_STORE).delete(STATE_KEY);
    await txComplete(tx);
    db.close();
  } catch { /* non-fatal */ }
}

export async function restoreGame(state: SavedState): Promise<import("../engine/btttplay").Game | null> {
  try {
    const { parseBoard, boardOutcome } = await import("../engine/btttplay");
    const board = parseBoard(state.board);
    if (boardOutcome(board) !== 0 /* Ongoing */) return null;
    return { board, budget: state.budget, tieToX: state.tieToX };
  } catch {
    return null;
  }
}

export function markToChar(m: import("../engine/btttplay").Mark): "X" | "O" {
  return m === 1 /* Mark.X */ ? "X" : "O";
}

export function charToMark(c: "X" | "O"): import("../engine/btttplay").Mark {
  return c === "X" ? 1 /* Mark.X */ : 2 /* Mark.O */;
}

export function stateFromGame(
  mode: "vs-bot" | "vs-friend",
  game: import("../engine/btttplay").Game,
  turn: number,
  human: import("../engine/btttplay").Mark,
  extra?: { roomId?: string; as?: "host" | "guest" },
): Omit<SavedState, "savedAt"> {
  return {
    mode,
    roomId: extra?.roomId,
    as: extra?.as,
    board: game.board.map((m) => m === 1 ? "X" : m === 2 ? "O" : "_").join(""),
    budget: [...game.budget] as [number, number],
    tieToX: game.tieToX,
    turn,
    human: markToChar(human),
  };
}

// --- log entries ---

interface StoredLog {
  entries: LogEntry[];
  savedAt: number;
}

export async function saveLogEntries(entries: LogEntry[]): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(LOG_STORE, "readwrite");
    const payload: StoredLog = { entries, savedAt: Date.now() };
    tx.objectStore(LOG_STORE).put(payload, LOG_KEY);
    await txComplete(tx);
    db.close();
  } catch { /* non-fatal */ }
}

export async function loadLogEntries(): Promise<LogEntry[]> {
  try {
    const db = await openDb();
    const tx = db.transaction(LOG_STORE, "readonly");
    const req = tx.objectStore(LOG_STORE).get(LOG_KEY);
    const result = await reqDone(req);
    db.close();
    if (!result) return [];
    const stored = result as StoredLog;
    if (Date.now() - stored.savedAt > TTL_MS) {
      await clearLogEntries();
      return [];
    }
    return stored.entries ?? [];
  } catch {
    return [];
  }
}

export async function clearLogEntries(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(LOG_STORE, "readwrite");
    tx.objectStore(LOG_STORE).delete(LOG_KEY);
    await txComplete(tx);
    db.close();
  } catch { /* non-fatal */ }
}

/** Wipe ALL persisted data — call when the user exits to the menu. */
export async function clearAll(): Promise<void> {
  await Promise.all([clearState(), clearLogEntries()]);
}

// --- helpers ---

function txComplete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function reqDone<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}