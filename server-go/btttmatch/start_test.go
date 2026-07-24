package btttmatch

import (
	"context"
	"errors"
	"testing"

	"github.com/dal-go/dalgo/adapters/dalgo2memory"
)

func pendingJoinedMatch(buyIn int) *Match {
	m := NewChallenge(Player{UserID: "x1", Name: "Alice"}, buyIn)
	if err := m.Join(Player{UserID: "o1", Name: "Bob"}); err != nil {
		panic(err)
	}
	return m
}

func TestStartMatch_HappyPath(t *testing.T) {
	db := dalgo2memory.NewDB()
	ctx := context.Background()
	if err := SaveMatch(ctx, db, "m1", pendingJoinedMatch(20)); err != nil {
		t.Fatal(err)
	}
	w := newFakeWallet(map[string]int{"x1": 100, "o1": 100})

	match, err := StartMatch(ctx, db, w, "m1")
	if err != nil {
		t.Fatalf("StartMatch() = %v, want nil", err)
	}
	if match.Status != StatusActive {
		t.Errorf("Status = %v, want StatusActive", match.Status)
	}
	if match.Budget != [2]int{20, 20} {
		t.Errorf("Budget = %v, want [20 20]", match.Budget)
	}
	if bal, _ := w.Balance(ctx, "x1"); bal != 80 {
		t.Errorf("x1 balance = %d, want 80", bal)
	}
	if bal, _ := w.Balance(ctx, "o1"); bal != 80 {
		t.Errorf("o1 balance = %d, want 80", bal)
	}

	// Persisted correctly too.
	stored, err := GetMatch(ctx, db, "m1")
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != StatusActive {
		t.Errorf("stored Status = %v, want StatusActive", stored.Status)
	}
}

func TestStartMatch_InsufficientFunds_LeavesFirstStakeParkedAndMatchPending(t *testing.T) {
	db := dalgo2memory.NewDB()
	ctx := context.Background()
	if err := SaveMatch(ctx, db, "m1", pendingJoinedMatch(20)); err != nil {
		t.Fatal(err)
	}
	// o1 cannot afford the buy-in.
	w := newFakeWallet(map[string]int{"x1": 100, "o1": 5})

	_, err := StartMatch(ctx, db, w, "m1")
	if err == nil {
		t.Fatal("StartMatch() = nil, want an error")
	}
	if !errors.Is(err, errInsufficientFunds) {
		t.Errorf("StartMatch() err = %v, want wrapping errInsufficientFunds", err)
	}

	// x1's stake already succeeded and is parked under its idempotent key —
	// StartMatch does not rescind it (see doc comment for why).
	if bal, _ := w.Balance(ctx, "x1"); bal != 80 {
		t.Errorf("x1 balance = %d, want 80 (already staked, parked)", bal)
	}
	if bal, _ := w.Balance(ctx, "o1"); bal != 5 {
		t.Errorf("o1 balance = %d, want untouched at 5", bal)
	}

	stored, gerr := GetMatch(ctx, db, "m1")
	if gerr != nil {
		t.Fatal(gerr)
	}
	if stored.Status != StatusPending {
		t.Errorf("Status = %v, want StatusPending (match never started)", stored.Status)
	}
}

func TestStartMatch_InsufficientFunds_IsRetryable(t *testing.T) {
	db := dalgo2memory.NewDB()
	ctx := context.Background()
	if err := SaveMatch(ctx, db, "m1", pendingJoinedMatch(20)); err != nil {
		t.Fatal(err)
	}
	w := newFakeWallet(map[string]int{"x1": 100, "o1": 5})

	if _, err := StartMatch(ctx, db, w, "m1"); err == nil {
		t.Fatal("expected first StartMatch to fail")
	}

	// Top up o1 and retry: the idempotent buy-in keys must not double-charge x1.
	w.mu.Lock()
	w.balances["o1"] = 100
	w.mu.Unlock()

	match, err := StartMatch(ctx, db, w, "m1")
	if err != nil {
		t.Fatalf("retry StartMatch() = %v, want nil", err)
	}
	if match.Status != StatusActive {
		t.Errorf("Status = %v, want StatusActive", match.Status)
	}
	if bal, _ := w.Balance(ctx, "x1"); bal != 80 {
		t.Errorf("x1 balance = %d, want 80 (charged exactly once across the retry)", bal)
	}
	if bal, _ := w.Balance(ctx, "o1"); bal != 80 {
		t.Errorf("o1 balance = %d, want 80", bal)
	}
}

func TestStartMatch_MatchNotFound(t *testing.T) {
	db := dalgo2memory.NewDB()
	w := newFakeWallet(map[string]int{"x1": 100, "o1": 100})
	if _, err := StartMatch(context.Background(), db, w, "does-not-exist"); err == nil {
		t.Fatal("StartMatch() on an unknown match = nil, want an error")
	}
}

func TestStartMatch_FirstPlayerInsufficientFunds(t *testing.T) {
	db := dalgo2memory.NewDB()
	ctx := context.Background()
	if err := SaveMatch(ctx, db, "m1", pendingJoinedMatch(20)); err != nil {
		t.Fatal(err)
	}
	// x1 cannot afford the buy-in; StartMatch must not even attempt o1's stake.
	w := newFakeWallet(map[string]int{"x1": 5, "o1": 100})

	if _, err := StartMatch(ctx, db, w, "m1"); !errors.Is(err, errInsufficientFunds) {
		t.Fatalf("StartMatch() err = %v, want wrapping errInsufficientFunds", err)
	}
	if bal, _ := w.Balance(ctx, "o1"); bal != 100 {
		t.Errorf("o1 balance = %d, want untouched at 100 (never staked)", bal)
	}
}

// TestStartMatch_FinalSaveValidationFailure covers the defensive branch where
// activating the match fails to persist because it fails Match.Validate() —
// reached here via a stored BuyIn of 0 that bypasses NewChallenge's default.
func TestStartMatch_FinalSaveValidationFailure(t *testing.T) {
	db := dalgo2memory.NewDB()
	ctx := context.Background()
	match := pendingJoinedMatch(20)
	match.BuyIn = 0 // invalid: bypasses Validate only because we write it directly
	forceSaveMatch(t, ctx, db, "m1", match)
	w := newFakeWallet(map[string]int{"x1": 100, "o1": 100})

	if _, err := StartMatch(ctx, db, w, "m1"); !errors.Is(err, ErrBuyInMustBePositive) {
		t.Fatalf("StartMatch() err = %v, want ErrBuyInMustBePositive", err)
	}
}

func TestStartMatch_RequiresBothPlayers(t *testing.T) {
	db := dalgo2memory.NewDB()
	ctx := context.Background()
	if err := SaveMatch(ctx, db, "m1", NewChallenge(Player{UserID: "x1"}, 20)); err != nil {
		t.Fatal(err)
	}
	w := newFakeWallet(map[string]int{"x1": 100})

	if _, err := StartMatch(ctx, db, w, "m1"); !errors.Is(err, ErrMatchNotFull) {
		t.Fatalf("StartMatch() err = %v, want ErrMatchNotFull", err)
	}
}

func TestStartMatch_RequiresPendingStatus(t *testing.T) {
	db := dalgo2memory.NewDB()
	ctx := context.Background()
	if err := SaveMatch(ctx, db, "m1", newValidActiveMatch()); err != nil {
		t.Fatal(err)
	}
	w := newFakeWallet(map[string]int{"x1": 100, "o1": 100})

	if _, err := StartMatch(ctx, db, w, "m1"); !errors.Is(err, ErrMatchNotPending) {
		t.Fatalf("StartMatch() err = %v, want ErrMatchNotPending", err)
	}
}
