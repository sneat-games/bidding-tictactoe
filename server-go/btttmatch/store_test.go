package btttmatch

import (
	"context"
	"errors"
	"testing"

	"github.com/dal-go/dalgo/adapters/dalgo2memory"
	"github.com/dal-go/dalgo/dal"
	"github.com/dal-go/record"
)

func TestSaveMatch_GetMatch_RoundTrip(t *testing.T) {
	db := dalgo2memory.NewDB()
	ctx := context.Background()

	match := newValidActiveMatch()
	if err := SaveMatch(ctx, db, "m1", match); err != nil {
		t.Fatalf("SaveMatch() = %v, want nil", err)
	}

	got, err := GetMatch(ctx, db, "m1")
	if err != nil {
		t.Fatalf("GetMatch() = %v, want nil", err)
	}
	if got.BoardStr != match.BoardStr {
		t.Errorf("BoardStr = %q, want %q", got.BoardStr, match.BoardStr)
	}
	if got.Budget != match.Budget {
		t.Errorf("Budget = %v, want %v", got.Budget, match.Budget)
	}
	if got.Players != match.Players {
		t.Errorf("Players = %+v, want %+v", got.Players, match.Players)
	}
	if got.Status != match.Status {
		t.Errorf("Status = %v, want %v", got.Status, match.Status)
	}
	if got.BuyIn != match.BuyIn {
		t.Errorf("BuyIn = %d, want %d", got.BuyIn, match.BuyIn)
	}
}

func TestGetMatch_NotFound(t *testing.T) {
	db := dalgo2memory.NewDB()
	_, err := GetMatch(context.Background(), db, "does-not-exist")
	if !record.IsNotFound(err) {
		t.Fatalf("GetMatch() err = %v, want a not-found error", err)
	}
}

func TestGetMatch_SaveMatch_RequireMatchID(t *testing.T) {
	db := dalgo2memory.NewDB()
	ctx := context.Background()

	if _, err := GetMatch(ctx, db, ""); !errors.Is(err, ErrMatchIDRequired) {
		t.Errorf("GetMatch(\"\") err = %v, want ErrMatchIDRequired", err)
	}
	if err := SaveMatch(ctx, db, "", newValidActiveMatch()); !errors.Is(err, ErrMatchIDRequired) {
		t.Errorf("SaveMatch(\"\") err = %v, want ErrMatchIDRequired", err)
	}
}

func TestSaveMatch_RejectsInvalidMatch(t *testing.T) {
	db := dalgo2memory.NewDB()
	match := newValidActiveMatch()
	match.BuyIn = 0 // invalid
	if err := SaveMatch(context.Background(), db, "m1", match); !errors.Is(err, ErrBuyInMustBePositive) {
		t.Fatalf("SaveMatch(invalid) err = %v, want ErrBuyInMustBePositive", err)
	}
}

func TestNewMatchKey(t *testing.T) {
	key := NewMatchKey("m1")
	if key.String() != "ext/bidding-tictactoe/matches/m1" {
		t.Fatalf("physical key=%s", key)
	}
	if CollectionMatches != "matches" {
		t.Fatalf("leaf=%s", CollectionMatches)
	}
	if key.Collection() != CollectionMatches {
		t.Errorf("Collection() = %q, want %q", key.Collection(), CollectionMatches)
	}
	if key.ID != "m1" {
		t.Errorf("ID = %v, want %q", key.ID, "m1")
	}
}

// Equal document IDs in old/wrong namespaces must not become this game's state.
// The real DALgo memory adapter exercises key resolution, not a key-string mock.
func TestMatchStoreRejectsLegacyAndWrongParentDecoys(t *testing.T) {
	db := dalgo2memory.NewDB()
	ctx := t.Context()
	keys := []*record.Key{
		record.NewKeyWithID("bttt-matches", "same-id"),
		record.NewKeyWithParentAndID(record.NewKeyWithID("ext", "competios"), "matches", "same-id"),
		record.NewKeyWithParentAndID(record.NewKeyWithID("ext", "other-game"), "matches", "same-id"),
	}
	for _, key := range keys {
		decoy := newValidActiveMatch()
		decoy.BuyIn = 77
		if err := db.RunReadwriteTransaction(ctx, func(ctx context.Context, tx dal.ReadwriteTransaction) error {
			return tx.Set(ctx, record.NewRecordWithData(key, decoy))
		}); err != nil {
			t.Fatal(err)
		}
	}
	if got, err := GetMatch(ctx, db, "same-id"); !record.IsNotFound(err) || got != nil {
		t.Fatalf("decoy read: %+v %v", got, err)
	}
	wallet := newFakeWallet(map[string]int{"x1": 100, "o1": 100})
	if _, err := StartMatch(ctx, db, wallet, "same-id"); !record.IsNotFound(err) {
		t.Fatalf("decoy activated: %v", err)
	}
	if balance, _ := wallet.Balance(ctx, "x1"); balance != 100 {
		t.Fatal("missing fresh match charged wallet")
	}
	if err := SaveMatch(ctx, db, "same-id", pendingJoinedMatch(20)); err != nil {
		t.Fatal(err)
	}
	fresh, err := StartMatch(ctx, db, wallet, "same-id")
	if err != nil || fresh.Status != StatusActive || fresh.BuyIn != 20 {
		t.Fatalf("fresh activation: %+v %v", fresh, err)
	}
	if got, err := GetMatch(ctx, db, "same-id"); err != nil || got.Status != StatusActive || got.Budget != [2]int{20, 20} {
		t.Fatalf("fresh roundtrip: %+v %v", got, err)
	}
	if _, err := StartMatch(ctx, db, wallet, "same-id"); !errors.Is(err, ErrMatchNotPending) {
		t.Fatalf("active replay=%v", err)
	}
	for _, user := range []string{"x1", "o1"} {
		if balance, _ := wallet.Balance(ctx, user); balance != 80 {
			t.Fatalf("%s charged incorrectly: %d", user, balance)
		}
	}
	for _, key := range keys {
		decoy := new(Match)
		if err := db.Get(ctx, record.NewRecordWithData(key, decoy)); err != nil || decoy.BuyIn != 77 {
			t.Fatalf("decoy mutated: %s %+v %v", key, decoy, err)
		}
	}
}
