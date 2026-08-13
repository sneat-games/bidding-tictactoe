// Short human-friendly room IDs for the share-link invite flow.
//
// Format: 6 characters from an unambiguous alphabet (no 0/O/1/I) so a
// friend can read the code out loud or copy it without optical confusion.
// Because the namespace is small (~31^6 ≈ 887M), collisions are possible
// and the shared relay (sneat-games/webrtc-relay, deployed at
// webrtc.sneat.games) MUST reject a `POST /reserve/{gameId}/{roomId}` for
// any {gameId, roomId} pair already known to it. We therefore probe the
// relay for uniqueness on host creation and retry a handful of times
// before giving up.
//
// The relay is shared across all Sneat turn-based WebRTC games; this repo
// pins its GAME_ID so its room codes never collide with another game's.

import type { GameId } from "./game-id";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".split(""); // 31 chars
const CODE_LEN = 6;
const MAX_RETRY = 10;

export const SIGNALING_BASE = ((import.meta as { env?: { SIGNALING_BASE?: string } }).env?.SIGNALING_BASE) ??
  (typeof window !== "undefined" && window.location?.hostname?.endsWith(".sneat.games")
    ? "https://webrtc.sneat.games"
    : "http://localhost:8787");

/** Stable gameId for this game on the shared Sneat relay. Per the relay's
 *  validation, this must match `[a-z0-9_-]{1,32}`. */
export const GAME_ID: GameId = "bttt";

export function newRoomId(): string {
  const out: string[] = [];
  const buf = new Uint32Array(CODE_LEN);
  crypto.getRandomValues(buf);
  for (let i = 0; i < CODE_LEN; i++) {
    out.push(ALPHABET[buf[i] % ALPHABET.length]);
  }
  return out.join("");
}

/** Probe the shared relay to reserve a {gameId, roomId} pair. Returns a
 *  roomId the relay has confirmed is unused for this game, or throws
 *  after MAX_RETRY attempts. */
export async function reserveRoomId(): Promise<string> {
  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    const id = newRoomId();
    const res = await fetch(`${SIGNALING_BASE}/reserve/${GAME_ID}/${id}`, { method: "POST" });
    if (res.ok) return id;
    if (res.status === 409) continue; // already taken, retry
    throw new Error(`reserve ${id}: ${res.status}`);
  }
  throw new Error("could not reserve a unique room id");
}

/** Read roomId from the share-link fragment `#room=<id>` (set by both the
 *  sneat.games invite link and the CrazyGames `inviteLink`). Returns null
 *  when no fragment is present. */
export function roomIdFromLocation(href: string = window.location.href): string | null {
  const hash = href.indexOf("#");
  if (hash < 0) return null;
  const qs = href.slice(hash + 1);
  const p = new URLSearchParams(qs);
  const r = p.get("room");
  if (!r) return null;
  // Validate format: CODE_LEN chars from the alphabet. This rejects typo'd
  // hand-typed links without ever round-tripping the relay.
  if (r.length !== CODE_LEN) return null;
  for (const ch of r) {
    if (!ALPHABET.includes(ch)) return null;
  }
  return r;
}

/** Build a share link with a `#room=<id>` fragment for a given base URL. */
export function shareLinkFor(base: string, roomId: string): string {
  return `${base.replace(/\/$/, "")}/#room=${encodeURIComponent(roomId)}`;
}

export const ROOM_ID_LENGTH = CODE_LEN;