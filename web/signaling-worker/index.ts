// Cloudflare Worker signaling relay for Bidding Tic-Tac-Toe PvP.
//
// Routes (all under /):
//   POST /reserve/{roomId}                       -> 200 OK | 409 conflict | 500
//   POST /signal/{roomId}/host/{type}            -> offer / ice
//   POST /signal/{roomId}/guest/{type}           -> answer / ice
//   GET  /signal/{roomId}/host/{type}            -> long-poll for guest's
//                                                   answer/ice
//   GET  /signal/{roomId}/guest/{type}           -> long-poll for host's
//                                                   offer/ice
//   DELETE /signal/{roomId}                      -> tear the room down
//
// Storage: a single Workers KV namespace `SIGNAL` with a 5-minute TTL.
// Keys:
//   room:{roomId}              -> "1" (existence marker; collision-check)
//   host:offer:{roomId}        -> SDP
//   guest:answer:{roomId}      -> SDP
//   host:ice:{roomId}          -> newline-separated ICE JSON list
//   guest:ice:{roomId}         -> newline-separated ICE JSON list
//   room:{roomId}:created      -> timestamp of maker (for review; not used
//                                 in logic)
//
// No DB, no auth, no game state. The roomId (short 6-char code) acts as a
// capability: the relay reserves it on first `POST /reserve/{roomId}`; any
// subsequent reservation for the same code returns 409;_SIGNAL lives for
// 5 minutes after the last write.
//
// Per CLAUDE.md `[[extend-own-tools-not-workarounds]]`: this relay is part
// of the sneat-games/bidding-tictactoe repo's own MVP — not a workaround
// around an inGitDB / SpecScore gap.

interface Env {
  SIGNAL: KVNamespace;
}

interface RouteMatch {
  reserve?: string;
  signal?: { roomId: string; role: "host" | "guest"; type: "offer" | "answer" | "ice" };
  teardown?: string;
}

function parseRoute(url: URL): RouteMatch | null {
  const p = url.pathname.split("/").filter(Boolean);
  if (p.length === 2 && p[0] === "reserve") {
    return { reserve: decodeURIComponent(p[1]) };
  }
  if (p.length === 4 && p[0] === "signal") {
    const role = p[2] as "host" | "guest";
    if (role !== "host" && role !== "guest") return null;
    const type = p[3] as "offer" | "answer" | "ice";
    if (type !== "offer" && type !== "answer" && type !== "ice") return null;
    return { signal: { roomId: decodeURIComponent(p[1]), role, type } };
  }
  if (p.length === 2 && p[0] === "signal") {
    return { teardown: decodeURIComponent(p[1]) };
  }
  return null;
}

const ROOM_TTL = 300; // seconds (5 minutes) — refreshed on every write
const ICE_TTL = 300;

async function readBody(req: Request): Promise<string> {
  return await req.text();
}

function casAppend(existing: string | null, value: string): string {
  if (!existing || existing.length === 0) return value;
  return existing + "\n" + value;
}

const frozenHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...frozenHeaders },
  });
}

function empty(status: number): Response {
  return new Response(null, { status, headers: frozenHeaders });
}

async function longPoll(
  kv: KVNamespace,
  key: string,
  timeoutMs: number,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  let delay = 50;
  while (Date.now() < deadline) {
    const v = await kv.get(key);
    if (v !== null && v.length > 0) return v;
    await new Promise((r) => setTimeout(r, delay));
    if (delay < 500) delay *= 1.5;
  }
  return null;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return empty(204);
    const url = new URL(req.url);
    const route = parseRoute(url);
    if (!route) return json(404, { error: "route not found" });

    // 1. Reserve a roomId (collision-check before the host even creates an
    //    offer, so a duplicate friend link fails fast).
    if (route.reserve) {
      const roomId = route.reserve;
      if (roomId.length !== 6 || !/^[A-HJ-NP-Z2-9]{6}$/.test(roomId)) {
        return json(400, { error: "invalid room id format" });
      }
      const markerKey = `room:${roomId}`;
      const existing = await env.SIGNAL.get(markerKey);
      if (existing !== null) return json(409, { error: "room id already taken" });
      await env.SIGNAL.put(markerKey, String(Date.now()), { expirationTtl: ROOM_TTL });
      // Touch the host-offer slot so subsequent polls don't 404 confusingly.
      await env.SIGNAL.put(`host:offer:${roomId}`, "", { expirationTtl: ROOM_TTL });
      return json(200, { roomId });
    }

    // 2. Teardown.
    if (route.teardown) {
      const roomId = route.teardown;
      await Promise.all([
        env.SIGNAL.delete(`room:${roomId}`),
        env.SIGNAL.delete(`host:offer:${roomId}`),
        env.SIGNAL.delete(`guest:answer:${roomId}`),
        env.SIGNAL.delete(`host:ice:${roomId}`),
        env.SIGNAL.delete(`guest:ice:${roomId}`),
      ]);
      return empty(204);
    }

    // 3. Signal POST/GET.
    if (route.signal) {
      const { roomId, role, type } = route.signal;
      // Reject signaling for an un-reserved or expired room so a stale
      // share link doesn't write into a key a new host will create later.
      const marker = await env.SIGNAL.get(`room:${roomId}`);
      if (marker === null) return json(404, { error: "room not found or expired" });

      const kvKey = `${role}:${type}:${roomId}`;
      if (req.method === "POST") {
        const body = await readBody(req);
        if (type === "ice") {
          const prev = await env.SIGNAL.get(kvKey);
          await env.SIGNAL.put(kvKey, casAppend(prev ?? null, body), {
            expirationTtl: ICE_TTL,
          });
          // Refresh the room marker too so the TTL resets on activity.
          await env.SIGNAL.put(`room:${roomId}`, String(Date.now()), {
            expirationTtl: ROOM_TTL,
          });
        } else {
          await env.SIGNAL.put(kvKey, body, { expirationTtl: ROOM_TTL });
        }
        return empty(204);
      }
      if (req.method === "GET") {
        if (type === "ice") {
          const v = await env.SIGNAL.get(kvKey);
          if (v === null || v.length === 0) return empty(404);
          return new Response(v, {
            headers: { "content-type": "text/plain", ...frozenHeaders },
          });
        }
        const v = await longPoll(env.SIGNAL, kvKey, 25_000);
        if (v === null || v.length === 0) return empty(404);
        return new Response(v, {
          headers: { "content-type": "text/plain", ...frozenHeaders },
        });
      }
      return json(405, { error: "method not allowed" });
    }

    return json(404, { error: "route not found" });
  },
};