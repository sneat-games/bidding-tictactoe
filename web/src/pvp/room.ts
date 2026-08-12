// Short human-friendly room IDs for the share-link invite flow.
//
// Format: 6 characters from an unambiguous alphabet (no 0/O/1/I) so a
// friend can read the code out loud or copy it without optical confusion.
// Because the namespace is small (~31^6 ≈ 887M), collisions are possible and
// the relay MUST reject a `POST /signal/{roomId}/host/offer` for any roomId
// already known to it. We therefore probe the relay for uniqueness on host
// creation and retry a handful of times before giving up.

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".split(""); // 31 chars
const CODE_LEN = 6;
const MAX_RETRY = 10;

// PUBLIC_SIGNALING_BASE (Astro's public-env prefix — exposed to client code
// via import.meta.env, unlike an unprefixed var) lets e2e tests point this
// at an isolated local signaling-worker instance instead of the
// conventional :8787 a developer's `npm run relay`/`worker:dev` binds to —
// see playwright.config.ts's comment for why a fixed local port can't be
// assumed free on a machine that also runs the real webrtc-relay's own dev
// server. Unset in every normal build (dev or production), so this branch
// is inert outside e2e.
const SIGNALING_BASE = ((import.meta as { env?: { PUBLIC_SIGNALING_BASE?: string } }).env?.PUBLIC_SIGNALING_BASE) ??
  (typeof window !== "undefined" && window.location?.hostname?.endsWith(".sneat.games")
    ? "https://signal.bidding-tictactoe.sneat.games"
    : "http://localhost:8787");

export function newRoomId(): string {
  const out: string[] = [];
  const buf = new Uint32Array(CODE_LEN);
  crypto.getRandomValues(buf);
  for (let i = 0; i < CODE_LEN; i++) {
    out.push(ALPHABET[buf[i] % ALPHABET.length]);
  }
  return out.join("");
}

/** Probe the relay to reserve a roomId. Returns a roomId the relay has
 *  confirmed is unused, or throws after MAX_RETRY attempts. */
export async function reserveRoomId(): Promise<string> {
  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    const id = newRoomId();
    const res = await fetch(`${SIGNALING_BASE}/reserve/${id}`, { method: "POST" });
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