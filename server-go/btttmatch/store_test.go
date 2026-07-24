package btttmatch

import (
	"context"
	"errors"
	"testing"

	"github.com/dal-go/dalgo/adapters/dalgo2memory"
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
	if key.Collection() != CollectionMatches {
		t.Errorf("Collection() = %q, want %q", key.Collection(), CollectionMatches)
	}
	if key.ID != "m1" {
		t.Errorf("ID = %v, want %q", key.ID, "m1")
	}
}
