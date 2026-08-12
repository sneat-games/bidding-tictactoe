// WebRTC PvP transport for Bidding Tic-Tac-Toe.
//
// Uses a Cloudflare Worker signaling relay (see signaling-worker/) to
// exchange SDP+ICE by `roomId`, then opens a DataChannel. Hidden-bid
// moves use a commit-reveal protocol so neither peer can read the other's
// bid before commitment:
//
//   1. Each peer sends { kind: "commit", commit: sha256(bid|salt|cell), cell }
//      to the other over the DataChannel.
//   2. Once BOTH commits are received, each peer sends
//      { kind: "reveal", bid, salt }.
//   3. Each peer verifies the other's reveal against the stored commit hash,
//      then runs `resolveTurn` locally with both revealed moves.
//
// `roomId` is a uuid v4 (see room.ts). It acts as an unguessable capability:
// only someone holding the room link can connect.
//
// All messages over the DataChannel are JSON of type WireMessage.

import type { Move } from "../engine/btttplay";
import { Mark } from "../engine/btttplay";

export type WireMessage =
  | { kind: "hello"; youAre: Mark; roomId: string }
  | { kind: "commit"; turn: number; commit: string; cell: number }
  | { kind: "reveal"; turn: number; bid: number; salt: string }
  | { kind: "rematch-request" }
  | { kind: "rematch-accept" }
  | { kind: "leave" };

export interface PeerHandle {
  readonly role: "host" | "guest";
  readonly youAre: Mark;
  readonly dataChannel: RTCDataChannel;
  send(msg: WireMessage): void;
  close(): void;
  onMessage(cb: (msg: WireMessage) => void): void;
  /** Unregister a message callback. A finished turn MUST call this, or its
   *  stale handler keeps firing against a board that has moved on. */
  offMessage(cb: (msg: WireMessage) => void): void;
  onClose(cb: () => void): void;
  offClose(cb: () => void): void;
}

// See src/pvp/room.ts's identical constant for why this reads the Astro
// public-env PUBLIC_SIGNALING_BASE (e2e-only override) rather than an
// unprefixed var, and why the fallback stays :8787 for normal local dev.
const SIGNALING_BASE = ((import.meta as { env?: { PUBLIC_SIGNALING_BASE?: string } }).env?.PUBLIC_SIGNALING_BASE) ??
  (typeof window !== "undefined" && window.location?.hostname?.endsWith(".sneat.games")
    ? "https://signal.bidding-tictactoe.sneat.games"
    : "http://localhost:8787");

/** Signaling relay client. Only used during connection setup; once the
 *  DataChannel is open, no further signaling traffic should occur. */
interface SignalingClient {
  host: boolean;
  roomId: string;
  post: (type: "offer" | "answer" | "ice", body: string) => Promise<void>;
  poll: (type: "offer" | "answer" | "ice") => Promise<string | null>;
}

function signalingClient(roomId: string, host: boolean): SignalingClient {
  // Bug fixed here (found while wiring up the vs-Friend e2e journey): `post`
  // and `poll` MUST use different role segments. Each party POSTS under its
  // OWN role slot (offer/ice for host, answer/ice for guest), but must POLL
  // the OTHER party's slot to ever see what they posted — polling your own
  // role, as this used to do unconditionally, reads back only what you
  // yourself wrote (or nothing, for "answer"/"offer", which only the other
  // side ever posts), so an offer/answer/ICE exchange could never complete.
  // This silently broke every vs-Friend match: hostPeer's `waitFor("answer",
  // 60_000)` and guestPeer's `waitFor("offer", 60_000)` would each poll a
  // slot nobody writes and simply time out.
  const ownRole = host ? "host" : "guest";
  const peerRole = host ? "guest" : "host";
  return {
    host,
    roomId,
    async post(type, body) {
      const res = await fetch(
        `${SIGNALING_BASE}/signal/${encodeURIComponent(roomId)}/${ownRole}/${type}`,
        {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body,
        },
      );
      if (!res.ok) throw new Error(`signaling post ${type}: ${res.status}`);
    },
    async poll(type) {
      const res = await fetch(
        `${SIGNALING_BASE}/signal/${encodeURIComponent(roomId)}/${peerRole}/${type}`,
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`signing poll ${type}: ${res.status}`);
      return await res.text();
    },
  };
}

/** Create the host peer. Returns a PeerHandle plus an `inviteLinkUrl` the
 *  host can share out-of-band (or surface via the CrazyGames SDK). */
export async function hostPeer(opts: {
  roomId: string;
  rtcConfig?: RTCConfiguration;
}): Promise<{ peer: PeerHandle; inviteLinkUrl: (base: string) => string }> {
  const sig = signalingClient(opts.roomId, true);
  const pc = new RTCPeerConnection(opts.rtcConfig ?? defaultRtcConfig());
  const dc = pc.createDataChannel("bttt", { ordered: true });
  const youAre: Mark = Mark.X;

  // Create and post the offer.
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await sig.post("offer", pc.localDescription!.sdp);
  // Also post ICE candidates as they gather. The guest polls for ice too.
  pc.addEventListener("icecandidate", (e) => {
    if (e.candidate) {
      void sig.post("ice", JSON.stringify(e.candidate));
    }
  });

  // Long-poll the guest's answer and ICE.
  const answerSdp = await waitFor(sig.poll, "answer", 60_000);
  await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
  // Add guest ICE candidates as they arrive.
  race(() => drainIce(sig, pc, "ice"), 60_000);

  await opened(dc);
  return {
    peer: makeHandle("host", youAre, dc, pc),
    inviteLinkUrl: (base) => `${base.replace(/\/$/, "")}/#room=${encodeURIComponent(opts.roomId)}`,
  };
}

/** Create the guest peer. Must be called by the invitee after reading
 *  `roomId` from the share link. */
export async function guestPeer(opts: {
  roomId: string;
  rtcConfig?: RTCConfiguration;
}): Promise<PeerHandle> {
  const sig = signalingClient(opts.roomId, false);
  const pc = new RTCPeerConnection(opts.rtcConfig ?? defaultRtcConfig());
  const youAre: Mark = Mark.O;

  pc.addEventListener("icecandidate", (e) => {
    if (e.candidate) {
      void sig.post("ice", JSON.stringify(e.candidate));
    }
  });

  // Wait for the host's offer.
  const offerSdp = await waitFor(sig.poll, "offer", 60_000);
  await pc.setRemoteDescription({ type: "offer", sdp: offerSdp });
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await sig.post("answer", pc.localDescription!.sdp);
  // Drain host ICE candidates.
  race(() => drainIce(sig, pc, "ice"), 60_000);

  // Wait for the host-side DataChannel to surface via ondatachannel.
  const dc = await new Promise<RTCDataChannel>((resolve) => {
    pc.addEventListener("datachannel", (e) => resolve(e.channel), { once: true });
  });
  await opened(dc);
  return makeHandle("guest", youAre, dc, pc);
}

// --- helpers -----------------------------------------------------------

function defaultRtcConfig(): RTCConfiguration {
  // CrazyGames requires WebRTC-direct; STUN-only keeps the MVP serverless.
  // For symmetric NATs a TURN server would be needed; out of MVP scope.
  return {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  };
}

function opened(dc: RTCDataChannel): Promise<void> {
  if (dc.readyState === "open") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("datachannel open timeout")), 30_000);
    dc.addEventListener("open", () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

async function waitFor(
  poll: (type: "offer" | "answer" | "ice") => Promise<string | null>,
  type: "offer" | "answer" | "ice",
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let slept = 0;
  while (Date.now() < deadline) {
    const v = await poll(type);
    if (v !== null && v.length > 0) return v;
    await sleep(Math.min(500, 50 * ++slept));
  }
  throw new Error(`signaling: timed out waiting for ${type}`);
}

async function drainIce(sig: SignalingClient, pc: RTCPeerConnection, type: "ice"): Promise<void> {
  const deadline = Date.now() + 60_000;
  // Bug fixed here (found alongside signalingClient's role mix-up above):
  // ICE candidates accumulate newline-separated in the SAME slot (see
  // signaling-worker/index.ts's casAppend) — every poll returns the FULL
  // history so far, not just what's new since the last poll. Parsing that
  // whole string as one JSON document threw past the first candidate
  // ("Unexpected non-whitespace character after JSON"), which
  // addIceCandidate's catch below silently swallowed — so at most ONE ICE
  // candidate per peer ever actually got added, no matter how many the
  // browser gathered. `processed` tracks how many lines this call has
  // already added, so each poll only parses and adds the NEW lines.
  let processed = 0;
  while (Date.now() < deadline) {
    const v = await sig.poll(type);
    if (v !== null && v.length > 0) {
      const lines = v.split("\n").filter((line) => line.length > 0);
      for (const line of lines.slice(processed)) {
        try {
          const candidate = JSON.parse(line) as RTCIceCandidateInit;
          await pc.addIceCandidate(candidate);
        } catch (e) {
          // Late/malformed candidates may arrive after close; safe to ignore.
          console.debug("[pvp] addIceCandidate ignored", e);
        }
      }
      processed = lines.length;
    }
    await sleep(200);
  }
}

async function race<T>(fn: () => Promise<T>, _timeoutMs: number): Promise<void> {
  void fn().catch((e) => console.debug("[pvp] background drain failed", e));
}

function makeHandle(
  role: "host" | "guest",
  youAre: Mark,
  dc: RTCDataChannel,
  pc: RTCPeerConnection,
): PeerHandle {
  const msgCbs = new Set<(m: WireMessage) => void>();
  const closeCbs = new Set<() => void>();
  dc.addEventListener("message", (e) => {
    try {
      const msg = JSON.parse(e.data) as WireMessage;
      // Snapshot: a handler commonly unregisters itself and registers the
      // next turn's from inside this loop.
      for (const cb of [...msgCbs]) cb(msg);
    } catch (err) {
      console.warn("[pvp] dropped malformed message", err);
    }
  });
  dc.addEventListener("close", () => { for (const cb of [...closeCbs]) cb(); });
  pc.addEventListener("connectionstatechange", () => {
    if (pc.connectionState === "failed" || pc.connectionState === "closed") {
      for (const cb of [...closeCbs]) cb();
    }
  });
  return {
    role,
    youAre,
    get dataChannel() { return dc; },
    send(msg) {
      if (dc.readyState !== "open") throw new Error("datachannel not open");
      dc.send(JSON.stringify(msg));
    },
    close() {
      try { dc.close(); } catch { /* noop */ }
      try { pc.close(); } catch { /* noop */ }
    },
    onMessage(cb) { msgCbs.add(cb); },
    offMessage(cb) { msgCbs.delete(cb); },
    onClose(cb) { closeCbs.add(cb); },
    offClose(cb) { closeCbs.delete(cb); },
  };
}

// --- commit-reveal -----------------------------------------------------

/** SHA-256 hex digest of a UTF-8 string. Uses Web Crypto. */
export async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const out = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(out))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Random salt for one reveal. */
export function newSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compute the commitment hash for a move. The visible `cell` is included so
 *  the opponent can validate that the committed bid+salt correspond to the
 *  claimed cell. */
export function commitFor(move: Move, salt: string): Promise<string> {
  return sha256Hex(`${move.bid}|${salt}|${move.cell}`);
}

/** Verify an opponent's reveal against the stored commit. */
export async function verifyReveal(commit: string, move: Move, salt: string): Promise<boolean> {
  const actual = await commitFor(move, salt);
  return actual === commit;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}