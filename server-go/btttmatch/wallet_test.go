package btttmatch

import (
	"context"
	"errors"
	"sync"
)

// errInsufficientFunds is the fakeWallet's stand-in for the host wallet's own
// insufficient-funds error (e.g. facade4wallet.ErrInsufficientFunds); this
// package only needs Stake to fail with *some* error in that case.
var errInsufficientFunds = errors.New("fakeWallet: insufficient funds")

// fakeWallet is an in-memory CoinWallet for tests. It mirrors the real
// gamecoins service's idempotency contract: a repeated idemKey is a no-op
// that returns nil rather than moving value again, so tests can exercise
// retries/duplicates exactly as production would see them.
type fakeWallet struct {
	mu           sync.Mutex
	balances     map[string]int
	applied      map[string]bool
	stakeCalls   []walletCall
	awardCalls   []walletCall
	awardFailFor string // if set, Award for this idemKey fails once (then succeeds)
}

type walletCall struct {
	UserID  string
	Amount  int
	IdemKey string
}

func newFakeWallet(balances map[string]int) *fakeWallet {
	b := make(map[string]int, len(balances))
	for k, v := range balances {
		b[k] = v
	}
	return &fakeWallet{balances: b, applied: map[string]bool{}}
}

func (w *fakeWallet) EnsureDailyAllowance(_ context.Context, _ string) error {
	return nil
}

func (w *fakeWallet) Balance(_ context.Context, userID string) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.balances[userID], nil
}

func (w *fakeWallet) Stake(_ context.Context, userID string, amount int, idemKey string) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.stakeCalls = append(w.stakeCalls, walletCall{userID, amount, idemKey})
	if w.applied[idemKey] {
		return nil // idempotent replay: already staked, no-op success
	}
	if w.balances[userID] < amount {
		return errInsufficientFunds
	}
	w.balances[userID] -= amount
	w.applied[idemKey] = true
	return nil
}

func (w *fakeWallet) Award(_ context.Context, userID string, amount int, idemKey string) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.awardCalls = append(w.awardCalls, walletCall{userID, amount, idemKey})
	if w.applied[idemKey] {
		return nil // idempotent replay: already awarded, no-op success
	}
	if w.awardFailFor != "" && idemKey == w.awardFailFor {
		w.awardFailFor = "" // fail exactly once, so a retry can succeed
		return errors.New("fakeWallet: simulated transient award failure")
	}
	w.balances[userID] += amount
	w.applied[idemKey] = true
	return nil
}
