// A validated gameId for the shared Sneat relay
// (sneat-games/webrtc-relay). The relay validates this as
// `[a-z0-9_-]{1,32}` (case-insensitive) on every request so two games
// cannot collide on the same short room code.

export type GameId = string;