package btttmatch

import "context"

// CoinWallet is the coin-ledger port this package needs from its host. A host
// implements it over its own coin service (e.g.
// sneat-core-modules/wallet/gamecoins) — btttmatch itself never imports that,
// or any other host package, keeping this a dependency-free session-logic
// library.
//
// Stake and Award both take an idemKey: implementations must treat a repeated
// key as an already-applied no-op (returning nil), so a retried call after a
// transient failure never double-moves coins. This package always derives
// idemKey from the matchID and, where relevant, the userID and operation, so
// the same logical move always replays under the same key.
type CoinWallet interface {
	// EnsureDailyAllowance grants userID their free daily coin allowance, if
	// they have not already received it today. Hosts may call this on game
	// entry (outside btttmatch); it is declared here only so a host that wants
	// to gate match creation on it can do so through the same port.
	EnsureDailyAllowance(ctx context.Context, userID string) error
	// Balance returns userID's current coin balance.
	Balance(ctx context.Context, userID string) (int, error)
	// Stake debits amount coins from userID (a buy-in), idempotent by idemKey.
	// It returns an error when userID has too few coins.
	Stake(ctx context.Context, userID string, amount int, idemKey string) error
	// Award credits amount coins to userID (a payout or refund), idempotent by idemKey.
	Award(ctx context.Context, userID string, amount int, idemKey string) error
}
