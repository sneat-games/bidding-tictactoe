package btttmatch

import (
	"context"
	"errors"
	"testing"

	"github.com/dal-go/dalgo/adapters/dalgo2memory"
	"github.com/dal-go/dalgo/dal"
	"github.com/dal-go/record"
	"github.com/sneat-games/bidding-tictactoe/server-go/btttplay"
)

// forceSaveMatch persists match verbatim, bypassing Match.Validate — used
// only to set up defensive-branch tests for records that could never be
// written through the normal SaveMatch path (e.g. a corrupted legacy record).
func forceSaveMatch(t *testing.T, ctx context.Context, db dal.DB, matchID string, match *Match) {
	t.Helper()
	err := db.RunReadwriteTransaction(ctx, func(ctx context.Context, tx dal.ReadwriteTransaction) error {
		rec := record.NewRecordWithData(NewMatchKey(matchID), match)
		// forceSaveMatch exists to plant deliberately-invalid matches for the
		// error-path tests. dalgo v0.64 validates on the framework write path,
		// so the opt-out has to be explicit — that is what this helper means
		// by "force".
		return dal.WithoutValidation(tx).Set(ctx, rec)
	})
	if err != nil {
		t.Fatal(err)
	}
}

// playTurn records both players' moves and resolves the turn, failing the
// test on any error.
func playTurn(t *testing.T, ctx context.Context, db dal.DB, w CoinWallet, matchID string, xMove, oMove btttplay.Move) (*Match, btttplay.TurnResult) {
	t.Helper()
	if _, err := RecordMove(ctx, db, matchID, 0, xMove); err != nil {
		t.Fatalf("RecordMove(X) = %v, want nil", err)
	}
	bothIn, err := RecordMove(ctx, db, matchID, 1, oMove)
	if err != nil {
		t.Fatalf("RecordMove(O) = %v, want nil", err)
	}
	if !bothIn {
		t.Fatal("bothIn = false after both moves, want true")
	}
	match, result, err := ResolveTurn(ctx, db, w, matchID)
	if err != nil {
		t.Fatalf("ResolveTurn() = %v, want nil", err)
	}
	return match, result
}

func TestResolveTurn_PersistsBoardAndBudgets(t *testing.T) {
	db := dalgo2memory.NewDB()
	ctx := context.Background()
	if err := SaveMatch(ctx, db, "m1", newValidActiveMatch()); err != nil {
		t.Fatal(err)
	}
	w := newFakeWallet(nil)

	match, result := playTurn(t, ctx, db, w, "m1",
		btttplay.Move{Bid: 5, Cell: 0}, btttplay.Move{Bid: 1, Cell: 4})

	if result.Winner != btttplay.X || result.Cell != 0 || result.Bid != 5 {
		t.Fatalf("result = %+v, want X wins cell 0 bid 5", result)
	}
	if result.Outcome != btttplay.Ongoing {
		t.Fatalf("Outcome = %v, want Ongoing", result.Outcome)
	}
	if match.Status != StatusActive {
		t.Fatalf("Status = %v, want StatusActive", match.Status)
	}
	if match.Budget[0] != 15 || match.Budget[1] != 20 {
		t.Fatalf("Budget = %v, want [15 20]", match.Budget)
	}
	if match.PendingMoves[0] != nil || match.PendingMoves[1] != nil {
		t.Fatalf("PendingMoves = %v, want both cleared for the next turn", match.PendingMoves)
	}
	board, err := match.Board()
	if err != nil {
		t.Fatal(err)
	}
	if board[0] != btttplay.X {
		t.Fatalf("board[0] = %v, want X", board[0])
	}

	// Persisted, not just returned.
	stored, err := GetMatch(ctx, db, "m1")
	if err != nil {
		t.Fatal(err)
	}
	if stored.Budget != match.Budget || stored.BoardStr != match.BoardStr {
		t.Fatalf("stored match = %+v, want it to match the returned one %+v", stored, match)
	}
	if len(w.awardCalls) != 0 {
		t.Fatalf("awardCalls = %v, want none (match still ongoing)", w.awardCalls)
	}
}

func TestResolveTurn_RequiresBothMovesIn(t *testing.T) {
	db := dalgo2memory.NewDB()
	ctx := context.Background()
	if err := SaveMatch(ctx, db, "m1", newValidActiveMatch()); err != nil {
		t.Fatal(err)
	}
	if _, _, err := ResolveTurn(ctx, db, newFakeWallet(nil), "m1"); !errors.Is(err, ErrTurnNotReady) {
		t.Fatalf("ResolveTurn() with no moves err = %v, want ErrTurnNotReady", err)
	}
	if _, err := RecordMove(ctx, db, "m1", 0, btttplay.Move{Bid: 5, Cell: 0}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := ResolveTurn(ctx, db, newFakeWallet(nil), "m1"); !errors.Is(err, ErrTurnNotReady) {
		t.Fatalf("ResolveTurn() with one move err = %v, want ErrTurnNotReady", err)
	}
}

func TestResolveTurn_RequiresMatchID(t *testing.T) {
	db := dalgo2memory.NewDB()
	if _, _, err := ResolveTurn(context.Background(), db, newFakeWallet(nil), ""); !errors.Is(err, ErrMatchIDRequired) {
		t.Fatalf("ResolveTurn(\"\") err = %v, want ErrMatchIDRequired", err)
	}
}

// TestResolveTurn_PropagatesEngineError checks that when btttplay.ResolveTurn
// itself rejects the turn (here: the bid-winner's target cell is already
// occupied), ResolveTurn surfaces that exact error and leaves the match
// completely unchanged — no partial board/budget update, moves still pending.
func TestResolveTurn_PropagatesEngineError(t *testing.T) {
	db := dalgo2memory.NewDB()
	ctx := context.Background()
	match := &Match{
		BoardStr: "X________",
		Budget:   [2]int{20, 20},
		TieToX:   true,
		Players:  [2]Player{{UserID: "x1"}, {UserID: "o1"}},
		Status:   StatusActive,
		BuyIn:    20,
	}
	if err := SaveMatch(ctx, db, "m1", match); err != nil {
		t.Fatal(err)
	}
	// O wins the bid (5 > 1) but targets cell 0, which X already occupies.
	if _, err := RecordMove(ctx, db, "m1", 0, btttplay.Move{Bid: 1, Cell: 1}); err != nil {
		t.Fatal(err)
	}
	if _, err := RecordMove(ctx, db, "m1", 1, btttplay.Move{Bid: 5, Cell: 0}); err != nil {
		t.Fatal(err)
	}

	if _, _, err := ResolveTurn(ctx, db, newFakeWallet(nil), "m1"); !errors.Is(err, btttplay.ErrCellOccupied) {
		t.Fatalf("ResolveTurn() err = %v, want btttplay.ErrCellOccupied", err)
	}

	stored, err := GetMatch(ctx, db, "m1")
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != StatusActive {
		t.Fatalf("Status = %v, want StatusActive (turn was not resolved)", stored.Status)
	}
	if stored.BoardStr != "X________" {
		t.Fatalf("BoardStr = %q, want unchanged", stored.BoardStr)
	}
	if stored.PendingMoves[0] == nil || stored.PendingMoves[1] == nil {
		t.Fatalf("PendingMoves = %v, want both still recorded (nothing changed)", stored.PendingMoves)
	}
}

func TestResolveTurn_MatchNotFound(t *testing.T) {
	db := dalgo2memory.NewDB()
	if _, _, err := ResolveTurn(context.Background(), db, newFakeWallet(nil), "does-not-exist"); err == nil {
		t.Fatal("ResolveTurn() on an unknown match = nil, want an error")
	}
}

// TestResolveTurn_CorruptedBoardInTransaction covers the defensive
// m.Board()-parse-error branch inside the resolve transaction, using a
// record that could never arise through the normal RecordMove/SaveMatch
// path (both validate the board on every write).
func TestResolveTurn_CorruptedBoardInTransaction(t *testing.T) {
	db := dalgo2memory.NewDB()
	ctx := context.Background()
	bid1, bid2 := 1, 5
	match := &Match{
		BoardStr:     "not-a-board",
		Budget:       [2]int{20, 20},
		Players:      [2]Player{{UserID: "x1"}, {UserID: "o1"}},
		PendingMoves: [2]*btttplay.Move{{Bid: bid1, Cell: 0}, {Bid: bid2, Cell: 1}},
		Status:       StatusActive,
		BuyIn:        20,
	}
	forceSaveMatch(t, ctx, db, "m1", match)

	if _, _, err := ResolveTurn(ctx, db, newFakeWallet(nil), "m1"); err == nil {
		t.Fatal("ResolveTurn() = nil, want an error for a corrupted board")
	}
}

// TestResolveTurn_SaveValidationFailureInTransaction covers the defensive
// branch where the mutated match fails to persist because it fails
// Match.Validate() — reached here via a record whose BuyIn was set to 0
// through a path that bypasses SaveMatch's own validation.
func TestResolveTurn_SaveValidationFailureInTransaction(t *testing.T) {
	db := dalgo2memory.NewDB()
	ctx := context.Background()
	match := &Match{
		BoardStr:     btttplay.Board{}.String(),
		Budget:       [2]int{20, 20},
		TieToX:       true,
		Players:      [2]Player{{UserID: "x1"}, {UserID: "o1"}},
		PendingMoves: [2]*btttplay.Move{{Bid: 5, Cell: 0}, {Bid: 1, Cell: 4}},
		Status:       StatusActive,
		BuyIn:        0, // invalid: bypasses Validate only because we write it directly
	}
	forceSaveMatch(t, ctx, db, "m1", match)

	if _, _, err := ResolveTurn(ctx, db, newFakeWallet(nil), "m1"); !errors.Is(err, ErrBuyInMustBePositive) {
		t.Fatalf("ResolveTurn() err = %v, want ErrBuyInMustBePositive", err)
	}
}

// TestResolveTurn_OWinsSettlesPayout mirrors TestResolveTurn_WinSettlesPayout
// with the winner flipped, to cover settleOutcome's OWins branch.
func TestResolveTurn_OWinsSettlesPayout(t *testing.T) {
	db := dalgo2memory.NewDB()
	ctx := context.Background()
	if err := SaveMatch(ctx, db, "m1", pendingJoinedMatch(20)); err != nil {
		t.Fatal(err)
	}
	w := newFakeWallet(map[string]int{"x1": 100, "o1": 100})
	if _, err := StartMatch(ctx, db, w, "m1"); err != nil {
		t.Fatal(err)
	}

	var match *Match
	var result btttplay.TurnResult
	for _, cell := range []int{0, 1, 2} {
		match, result = playTurn(t, ctx, db, w, "m1",
			btttplay.Move{Bid: 1, Cell: 4}, btttplay.Move{Bid: 5, Cell: cell})
	}

	if result.Outcome != btttplay.OWins {
		t.Fatalf("final Outcome = %v, want OWins", result.Outcome)
	}
	if match.Status != StatusFinished {
		t.Fatalf("Status = %v, want StatusFinished", match.Status)
	}
	if bal, _ := w.Balance(ctx, "o1"); bal != 120 {
		t.Errorf("o1 balance = %d, want 120 (staked 20, paid 40)", bal)
	}
	if bal, _ := w.Balance(ctx, "x1"); bal != 80 {
		t.Errorf("x1 balance = %d, want 80 (staked, no payout)", bal)
	}
}

// TestSettleMatch_Draw_PartialAwardFailureIsRetryable covers settleOutcome's
// Draw-loop error return: the first refund fails, so the second is never
// attempted in that call — and a retry then completes both, exactly once.
func TestSettleMatch_Draw_PartialAwardFailureIsRetryable(t *testing.T) {
	db := dalgo2memory.NewDB()
	ctx := context.Background()
	match := &Match{
		BoardStr: "XOXXOOOXX", // a full-board draw (see btttplay's own test fixture)
		Budget:   [2]int{0, 0},
		Players:  [2]Player{{UserID: "x1"}, {UserID: "o1"}},
		Status:   StatusFinished,
		BuyIn:    20,
	}
	if board, err := match.Board(); err != nil || board.Outcome() != btttplay.Draw {
		t.Fatalf("sanity check failed: board outcome = %v, err = %v, want Draw/nil", board.Outcome(), err)
	}
	forceSaveMatch(t, ctx, db, "m1", match)

	w := newFakeWallet(map[string]int{"x1": 80, "o1": 80})
	w.awardFailFor = refundKey("m1", "x1") // fails the first refund in Players order

	if err := SettleMatch(ctx, db, w, "m1"); err == nil {
		t.Fatal("SettleMatch() = nil, want the simulated award error")
	}
	if bal, _ := w.Balance(ctx, "o1"); bal != 80 {
		t.Fatalf("o1 balance = %d, want untouched at 80 (never reached after x1's refund failed)", bal)
	}

	if err := SettleMatch(ctx, db, w, "m1"); err != nil {
		t.Fatalf("retry SettleMatch() = %v, want nil", err)
	}
	if bal, _ := w.Balance(ctx, "x1"); bal != 100 {
		t.Fatalf("x1 balance = %d, want 100", bal)
	}
	if bal, _ := w.Balance(ctx, "o1"); bal != 100 {
		t.Fatalf("o1 balance = %d, want 100", bal)
	}
}

func TestResolveTurn_RequiresActiveMatch(t *testing.T) {
	db := dalgo2memory.NewDB()
	ctx := context.Background()
	if err := SaveMatch(ctx, db, "m1", newValidPendingMatch()); err != nil {
		t.Fatal(err)
	}
	if _, _, err := ResolveTurn(ctx, db, newFakeWallet(nil), "m1"); !errors.Is(err, ErrMatchNotActive) {
		t.Fatalf("ResolveTurn() on pending match err = %v, want ErrMatchNotActive", err)
	}
}

// TestResolveTurn_WinSettlesPayout plays a full match (X wins the top row
// over three turns) end to end — StartMatch through the final ResolveTurn —
// and checks the winner is paid the full 2x BuyIn pot exactly once.
func TestResolveTurn_WinSettlesPayout(t *testing.T) {
	db := dalgo2memory.NewDB()
	ctx := context.Background()
	if err := SaveMatch(ctx, db, "m1", pendingJoinedMatch(20)); err != nil {
		t.Fatal(err)
	}
	w := newFakeWallet(map[string]int{"x1": 100, "o1": 100})
	if _, err := StartMatch(ctx, db, w, "m1"); err != nil {
		t.Fatal(err)
	}

	var match *Match
	var result btttplay.TurnResult
	for _, cell := range []int{0, 1, 2} {
		match, result = playTurn(t, ctx, db, w, "m1",
			btttplay.Move{Bid: 5, Cell: cell}, btttplay.Move{Bid: 1, Cell: 4})
	}

	if result.Outcome != btttplay.XWins {
		t.Fatalf("final Outcome = %v, want XWins", result.Outcome)
	}
	if match.Status != StatusFinished {
		t.Fatalf("Status = %v, want StatusFinished", match.Status)
	}
	if bal, _ := w.Balance(ctx, "x1"); bal != 120 { // 100 - 20 stake + 40 payout
		t.Errorf("x1 balance = %d, want 120", bal)
	}
	if bal, _ := w.Balance(ctx, "o1"); bal != 80 { // 100 - 20 stake, no payout
		t.Errorf("o1 balance = %d, want 80", bal)
	}
	if len(w.awardCalls) != 1 {
		t.Fatalf("awardCalls = %v, want exactly 1 payout", w.awardCalls)
	}
	if got := w.awardCalls[0]; got.UserID != "x1" || got.Amount != 40 || got.IdemKey != payoutKey("m1") {
		t.Fatalf("payout call = %+v, want {x1 40 %s}", got, payoutKey("m1"))
	}
}

// TestResolveTurn_DrawSettlesRefund constructs an already-almost-full board
// (classic tic-tac-toe draw pattern) one move away from completion, resolves
// the final turn as a Draw, and checks both players are refunded their BuyIn.
func TestResolveTurn_DrawSettlesRefund(t *testing.T) {
	db := dalgo2memory.NewDB()
	ctx := context.Background()

	// Pre-move board (cell 1 empty): X _ O / O O X / X O X. It is still
	// Ongoing (O could complete column 1 by taking cell 1) — but this turn X
	// wins the bid and takes cell 1 instead, filling the board with no
	// three-in-a-row: a Draw.
	const preMoveBoard = "X_OOOXXOX"
	board, err := btttplay.ParseBoard(preMoveBoard)
	if err != nil {
		t.Fatal(err)
	}
	if board.Outcome() != btttplay.Ongoing {
		t.Fatalf("sanity check failed: pre-move board outcome = %v, want Ongoing", board.Outcome())
	}

	match := &Match{
		BoardStr: preMoveBoard,
		Budget:   [2]int{20, 20},
		TieToX:   true,
		Players:  [2]Player{{UserID: "x1"}, {UserID: "o1"}},
		Status:   StatusActive,
		BuyIn:    20,
	}
	if err := SaveMatch(ctx, db, "m1", match); err != nil {
		t.Fatal(err)
	}
	w := newFakeWallet(map[string]int{"x1": 80, "o1": 80}) // both already staked 20 of 100

	_, result := playTurn(t, ctx, db, w, "m1",
		btttplay.Move{Bid: 5, Cell: 1}, btttplay.Move{Bid: 1, Cell: 8})

	if result.Outcome != btttplay.Draw {
		t.Fatalf("Outcome = %v, want Draw", result.Outcome)
	}
	stored, err := GetMatch(ctx, db, "m1")
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != StatusFinished {
		t.Fatalf("Status = %v, want StatusFinished", stored.Status)
	}
	if bal, _ := w.Balance(ctx, "x1"); bal != 100 {
		t.Errorf("x1 balance = %d, want 100 (refunded)", bal)
	}
	if bal, _ := w.Balance(ctx, "o1"); bal != 100 {
		t.Errorf("o1 balance = %d, want 100 (refunded)", bal)
	}
	if len(w.awardCalls) != 2 {
		t.Fatalf("awardCalls = %v, want exactly 2 refunds", w.awardCalls)
	}
}

// TestResolveTurn_SettlementFailure_IsRetryableViaSettleMatch simulates a
// transient wallet outage on the payout: ResolveTurn still persists the
// finished match and reports the error, and a later SettleMatch call
// succeeds and pays exactly once (no double payout).
func TestResolveTurn_SettlementFailure_IsRetryableViaSettleMatch(t *testing.T) {
	db := dalgo2memory.NewDB()
	ctx := context.Background()
	if err := SaveMatch(ctx, db, "m1", pendingJoinedMatch(20)); err != nil {
		t.Fatal(err)
	}
	w := newFakeWallet(map[string]int{"x1": 100, "o1": 100})
	if _, err := StartMatch(ctx, db, w, "m1"); err != nil {
		t.Fatal(err)
	}
	w.awardFailFor = payoutKey("m1") // fail the payout exactly once

	for _, cell := range []int{0, 1} {
		if _, err := RecordMove(ctx, db, "m1", 0, btttplay.Move{Bid: 5, Cell: cell}); err != nil {
			t.Fatal(err)
		}
		if _, err := RecordMove(ctx, db, "m1", 1, btttplay.Move{Bid: 1, Cell: 4}); err != nil {
			t.Fatal(err)
		}
		if _, _, err := ResolveTurn(ctx, db, w, "m1"); err != nil {
			t.Fatal(err)
		}
	}
	// Winning turn: settlement fails once.
	if _, err := RecordMove(ctx, db, "m1", 0, btttplay.Move{Bid: 5, Cell: 2}); err != nil {
		t.Fatal(err)
	}
	if _, err := RecordMove(ctx, db, "m1", 1, btttplay.Move{Bid: 1, Cell: 4}); err != nil {
		t.Fatal(err)
	}
	match, _, err := ResolveTurn(ctx, db, w, "m1")
	if err == nil {
		t.Fatal("ResolveTurn() = nil, want the simulated settlement error")
	}
	if match == nil || match.Status != StatusFinished {
		t.Fatalf("match = %+v, want a returned, persisted Finished match despite the settlement error", match)
	}
	if bal, _ := w.Balance(ctx, "x1"); bal != 80 {
		t.Fatalf("x1 balance = %d, want 80 (payout not yet applied)", bal)
	}

	// Retry: succeeds now, and pays exactly once.
	if err := SettleMatch(ctx, db, w, "m1"); err != nil {
		t.Fatalf("SettleMatch() retry = %v, want nil", err)
	}
	if bal, _ := w.Balance(ctx, "x1"); bal != 120 {
		t.Fatalf("x1 balance = %d, want 120 after the retried payout", bal)
	}

	// A further retry is a safe no-op (idempotent key already applied).
	if err := SettleMatch(ctx, db, w, "m1"); err != nil {
		t.Fatalf("second SettleMatch() retry = %v, want nil", err)
	}
	if bal, _ := w.Balance(ctx, "x1"); bal != 120 {
		t.Fatalf("x1 balance = %d, want still 120 (no double payout)", bal)
	}
}

func TestSettleMatch_RequiresFinishedMatch(t *testing.T) {
	db := dalgo2memory.NewDB()
	ctx := context.Background()
	if err := SaveMatch(ctx, db, "m1", newValidActiveMatch()); err != nil {
		t.Fatal(err)
	}
	if err := SettleMatch(ctx, db, newFakeWallet(nil), "m1"); !errors.Is(err, ErrMatchNotFinished) {
		t.Fatalf("SettleMatch() on active match err = %v, want ErrMatchNotFinished", err)
	}
}

func TestSettleMatch_MatchNotFound(t *testing.T) {
	db := dalgo2memory.NewDB()
	if err := SettleMatch(context.Background(), db, newFakeWallet(nil), "does-not-exist"); !record.IsNotFound(err) {
		t.Fatalf("SettleMatch() err = %v, want a not-found error", err)
	}
}

// TestSettleMatch_CorruptedBoard covers the defensive Board()-parse-error
// branch: a Match record that could never be written through SaveMatch (its
// Validate rejects a bad board string) but might exist from, say, a legacy
// or hand-edited record.
func TestSettleMatch_CorruptedBoard(t *testing.T) {
	db := dalgo2memory.NewDB()
	ctx := context.Background()
	match := &Match{
		BoardStr: "not-a-board",
		Players:  [2]Player{{UserID: "x1"}, {UserID: "o1"}},
		Status:   StatusFinished,
		BuyIn:    20,
	}
	forceSaveMatch(t, ctx, db, "m1", match)

	if err := SettleMatch(ctx, db, newFakeWallet(nil), "m1"); err == nil {
		t.Fatal("SettleMatch() = nil, want an error for a corrupted board")
	}
}

// TestSettleMatch_InconsistentFinishedMatch covers settleOutcome's default
// branch: a match marked Finished whose board is not actually terminal —
// again, not reachable through the normal ResolveTurn/SaveMatch path, but
// guarded against defensively.
func TestSettleMatch_InconsistentFinishedMatch(t *testing.T) {
	db := dalgo2memory.NewDB()
	ctx := context.Background()
	match := &Match{
		BoardStr: btttplay.Board{}.String(), // empty: Outcome() == Ongoing
		Players:  [2]Player{{UserID: "x1"}, {UserID: "o1"}},
		Status:   StatusFinished,
		BuyIn:    20,
	}
	forceSaveMatch(t, ctx, db, "m1", match)

	if err := SettleMatch(ctx, db, newFakeWallet(nil), "m1"); err == nil {
		t.Fatal("SettleMatch() = nil, want an error for an inconsistent finished match")
	}
}
