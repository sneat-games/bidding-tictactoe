package btttmatch

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/dal-go/dalgo/adapters/dalgo2memory"
	"github.com/sneat-games/bidding-tictactoe/server-go/btttplay"
)

func TestRecordMove_FirstMove_BothInFalse(t *testing.T) {
	db := dalgo2memory.NewDB()
	ctx := context.Background()
	if err := SaveMatch(ctx, db, "m1", newValidActiveMatch()); err != nil {
		t.Fatal(err)
	}

	bothIn, err := RecordMove(ctx, db, "m1", 0, btttplay.Move{Bid: 5, Cell: 0})
	if err != nil {
		t.Fatalf("RecordMove() = %v, want nil", err)
	}
	if bothIn {
		t.Fatal("bothIn = true after only one move, want false")
	}

	stored, err := GetMatch(ctx, db, "m1")
	if err != nil {
		t.Fatal(err)
	}
	if stored.PendingMoves[0] == nil || *stored.PendingMoves[0] != (btttplay.Move{Bid: 5, Cell: 0}) {
		t.Fatalf("PendingMoves[0] = %v, want the recorded move", stored.PendingMoves[0])
	}
	if stored.PendingMoves[1] != nil {
		t.Fatalf("PendingMoves[1] = %v, want nil", stored.PendingMoves[1])
	}
}

func TestRecordMove_SecondMove_BothInTrue(t *testing.T) {
	db := dalgo2memory.NewDB()
	ctx := context.Background()
	if err := SaveMatch(ctx, db, "m1", newValidActiveMatch()); err != nil {
		t.Fatal(err)
	}
	if _, err := RecordMove(ctx, db, "m1", 0, btttplay.Move{Bid: 5, Cell: 0}); err != nil {
		t.Fatal(err)
	}

	bothIn, err := RecordMove(ctx, db, "m1", 1, btttplay.Move{Bid: 3, Cell: 4})
	if err != nil {
		t.Fatalf("RecordMove() = %v, want nil", err)
	}
	if !bothIn {
		t.Fatal("bothIn = false after both moves submitted, want true")
	}
}

func TestRecordMove_AlreadySubmitted(t *testing.T) {
	db := dalgo2memory.NewDB()
	ctx := context.Background()
	if err := SaveMatch(ctx, db, "m1", newValidActiveMatch()); err != nil {
		t.Fatal(err)
	}
	if _, err := RecordMove(ctx, db, "m1", 0, btttplay.Move{Bid: 5, Cell: 0}); err != nil {
		t.Fatal(err)
	}
	if _, err := RecordMove(ctx, db, "m1", 0, btttplay.Move{Bid: 1, Cell: 1}); !errors.Is(err, ErrMoveAlreadySubmitted) {
		t.Fatalf("second RecordMove() for the same player err = %v, want ErrMoveAlreadySubmitted", err)
	}
}

func TestRecordMove_Validation(t *testing.T) {
	db := dalgo2memory.NewDB()
	ctx := context.Background()
	if err := SaveMatch(ctx, db, "m1", newValidActiveMatch()); err != nil {
		t.Fatal(err)
	}

	if _, err := RecordMove(ctx, db, "m1", 2, btttplay.Move{Bid: 1, Cell: 0}); !errors.Is(err, ErrPlayerIndexOutOfRange) {
		t.Errorf("playerIdx=2 err = %v, want ErrPlayerIndexOutOfRange", err)
	}
	if _, err := RecordMove(ctx, db, "m1", 0, btttplay.Move{Bid: -1, Cell: 0}); !errors.Is(err, btttplay.ErrBidNegative) {
		t.Errorf("negative bid err = %v, want btttplay.ErrBidNegative", err)
	}
	if _, err := RecordMove(ctx, db, "m1", 0, btttplay.Move{Bid: 1, Cell: 9}); !errors.Is(err, btttplay.ErrCellOutOfRange) {
		t.Errorf("out-of-range cell err = %v, want btttplay.ErrCellOutOfRange", err)
	}
}

func TestRecordMove_RequiresMatchID(t *testing.T) {
	db := dalgo2memory.NewDB()
	if _, err := RecordMove(context.Background(), db, "", 0, btttplay.Move{Bid: 1, Cell: 0}); !errors.Is(err, ErrMatchIDRequired) {
		t.Fatalf("RecordMove(\"\") err = %v, want ErrMatchIDRequired", err)
	}
}

func TestRecordMove_MatchNotFound(t *testing.T) {
	db := dalgo2memory.NewDB()
	if _, err := RecordMove(context.Background(), db, "does-not-exist", 0, btttplay.Move{Bid: 1, Cell: 0}); err == nil {
		t.Fatal("RecordMove() on an unknown match = nil, want an error")
	}
}

func TestRecordMove_RequiresActiveMatch(t *testing.T) {
	db := dalgo2memory.NewDB()
	ctx := context.Background()
	if err := SaveMatch(ctx, db, "m1", newValidPendingMatch()); err != nil {
		t.Fatal(err)
	}
	if _, err := RecordMove(ctx, db, "m1", 0, btttplay.Move{Bid: 1, Cell: 0}); !errors.Is(err, ErrMatchNotActive) {
		t.Fatalf("RecordMove() on pending match err = %v, want ErrMatchNotActive", err)
	}
}

// TestRecordMove_ConcurrentSecondMover_ExactlyOneObservesBothIn is the
// required concurrency test: N goroutines race to record the SAME player's
// move for a turn whose other side is already in. Every RecordMove call runs
// inside its own db.RunReadwriteTransaction, and dalgo2memory serializes
// read-write transactions, so exactly one goroutine must observe the empty
// slot and report bothIn=true; every other goroutine must find the slot
// already filled and get ErrMoveAlreadySubmitted — never a second bothIn=true,
// which would mean the turn gets resolved twice.
func TestRecordMove_ConcurrentSecondMover_ExactlyOneObservesBothIn(t *testing.T) {
	db := dalgo2memory.NewDB()
	ctx := context.Background()
	if err := SaveMatch(ctx, db, "m1", newValidActiveMatch()); err != nil {
		t.Fatal(err)
	}
	// Player X (index 0) has already moved; N goroutines race to be the one
	// that records player O's (index 1) move for this turn.
	if _, err := RecordMove(ctx, db, "m1", 0, btttplay.Move{Bid: 5, Cell: 0}); err != nil {
		t.Fatal(err)
	}

	const n = 40
	var wg sync.WaitGroup
	bothIns := make([]bool, n)
	errs := make([]error, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			bothIns[i], errs[i] = RecordMove(ctx, db, "m1", 1, btttplay.Move{Bid: 3, Cell: 4})
		}(i)
	}
	wg.Wait()

	var trueCount, alreadySubmittedCount int
	for i := 0; i < n; i++ {
		switch {
		case errs[i] == nil && bothIns[i]:
			trueCount++
		case errs[i] == nil && !bothIns[i]:
			t.Errorf("goroutine %d: err=nil bothIn=false — should not happen once the slot is filled", i)
		case errors.Is(errs[i], ErrMoveAlreadySubmitted):
			alreadySubmittedCount++
		default:
			t.Errorf("goroutine %d: unexpected error %v", i, errs[i])
		}
	}
	if trueCount != 1 {
		t.Fatalf("goroutines observing bothIn=true = %d, want exactly 1", trueCount)
	}
	if alreadySubmittedCount != n-1 {
		t.Fatalf("goroutines getting ErrMoveAlreadySubmitted = %d, want %d", alreadySubmittedCount, n-1)
	}

	stored, err := GetMatch(ctx, db, "m1")
	if err != nil {
		t.Fatal(err)
	}
	if stored.PendingMoves[1] == nil || *stored.PendingMoves[1] != (btttplay.Move{Bid: 3, Cell: 4}) {
		t.Fatalf("PendingMoves[1] = %v, want the single recorded move", stored.PendingMoves[1])
	}
}
