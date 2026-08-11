package btttplay

import (
	"errors"
	"testing"
)

// --- Board.Outcome ----------------------------------------------------------

func TestBoard_Outcome(t *testing.T) {
	cases := []struct {
		name  string
		board string
		want  Outcome
	}{
		{"empty", "_________", Ongoing},
		{"x-top-row", "XXX______", XWins},
		{"o-middle-row", "___OOO___", OWins},
		{"x-left-col", "X__X__X__", XWins},
		{"o-right-col", "__O__O__O", OWins},
		{"x-main-diag", "X___X___X", XWins},
		{"o-anti-diag", "__O_O_O__", OWins},
		{"full-draw", "XOXXOOOXX", Draw},
		{"early-draw-with-empty", "OXOX_OXOX", Draw}, // every line blocked, centre empty
		{"ongoing", "X_______O", Ongoing},
	}
	for _, c := range cases {
		b, err := ParseBoard(c.board)
		if err != nil {
			t.Fatalf("%s: ParseBoard(%q): %v", c.name, c.board, err)
		}
		if got := b.Outcome(); got != c.want {
			t.Errorf("%s: Outcome(%q) = %v, want %v", c.name, c.board, got, c.want)
		}
	}
}

func TestBoard_StringParseRoundTrip(t *testing.T) {
	for _, s := range []string{"_________", "XOX__O__X", "XOXXOOOXX"} {
		b, err := ParseBoard(s)
		if err != nil {
			t.Fatalf("ParseBoard(%q): %v", s, err)
		}
		if got := b.String(); got != s {
			t.Errorf("round-trip: %q -> %q", s, got)
		}
	}
}

func TestParseBoard_Invalid(t *testing.T) {
	if _, err := ParseBoard("XOX"); err == nil {
		t.Error("ParseBoard accepted a short string")
	}
	if _, err := ParseBoard("XOXXOOOX?"); err == nil {
		t.Error("ParseBoard accepted an invalid character")
	}
}

func TestBoard_EmptyCells(t *testing.T) {
	b, _ := ParseBoard("X_O__X_O_")
	got := b.EmptyCells()
	want := []int{1, 3, 4, 6, 8}
	if len(got) != len(want) {
		t.Fatalf("EmptyCells = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("EmptyCells = %v, want %v", got, want)
		}
	}
}

// --- ResolveTurn ------------------------------------------------------------

func TestResolveTurn_HigherBidWins_PlacesAndTransfers(t *testing.T) {
	g := NewGame(10)
	next, res, err := ResolveTurn(g, Move{Bid: 5, Cell: 0}, Move{Bid: 3, Cell: 4})
	if err != nil {
		t.Fatal(err)
	}
	if res.Winner != X || res.Cell != 0 || res.Bid != 5 || res.TieBreak {
		t.Fatalf("result = %+v, want X wins cell 0 bid 5 no-tiebreak", res)
	}
	if next.Board[0] != X {
		t.Error("winner's mark not placed")
	}
	if next.Budget[0] != 5 {
		t.Errorf("winner budget = %d, want 5 (paid the bid)", next.Budget[0])
	}
	if next.Budget[1] != 15 {
		t.Errorf("loser budget = %d, want 15 (received winner's bid: 10 + 5)", next.Budget[1])
	}
	if next.Budget[0]+next.Budget[1] != 20 {
		t.Errorf("total budget not conserved: %d + %d = %d, want 20", next.Budget[0], next.Budget[1], next.Budget[0]+next.Budget[1])
	}
	if res.Outcome != Ongoing {
		t.Errorf("outcome = %v, want Ongoing", res.Outcome)
	}
}

func TestResolveTurn_TieBreakAlternates(t *testing.T) {
	g := NewGame(10) // TieToX = true
	// First tie -> X (X transfers 5 to O).
	g, res, err := ResolveTurn(g, Move{Bid: 5, Cell: 0}, Move{Bid: 5, Cell: 1})
	if err != nil {
		t.Fatal(err)
	}
	if !res.TieBreak || res.Winner != X {
		t.Fatalf("first tie: %+v, want tie-break to X", res)
	}
	if g.TieToX {
		t.Error("TieToX should flip to false after a tie")
	}
	if g.Budget[0] != 5 || g.Budget[1] != 15 {
		t.Errorf("after first tie: budget = %v, want [5 15] (X transfers 5 to O)", g.Budget)
	}
	// Second tie -> O (O transfers 4 to X).
	g, res, err = ResolveTurn(g, Move{Bid: 4, Cell: 2}, Move{Bid: 4, Cell: 3})
	if err != nil {
		t.Fatal(err)
	}
	if !res.TieBreak || res.Winner != O {
		t.Fatalf("second tie: %+v, want tie-break to O", res)
	}
	if g.Board[3] != O || g.Budget[1] != 11 {
		t.Errorf("O should have taken cell 3 for 4 (transferring it to X): board=%q budgetO=%d", g.Board.String(), g.Budget[1])
	}
	if g.Budget[0] != 9 {
		t.Errorf("X should have received O's 4 bid: budgetX = %d, want 9", g.Budget[0])
	}
	if !g.TieToX {
		t.Error("TieToX should flip back to true")
	}
	if g.Budget[0]+g.Budget[1] != 20 {
		t.Errorf("total budget not conserved after tie: %d + %d = %d", g.Budget[0], g.Budget[1], g.Budget[0]+g.Budget[1])
	}
}

func TestResolveTurn_Errors(t *testing.T) {
	g := NewGame(10)
	if _, _, err := ResolveTurn(g, Move{Bid: -1}, Move{Bid: 1, Cell: 0}); !errors.Is(err, ErrBidNegative) {
		t.Errorf("negative bid err = %v, want ErrBidNegative", err)
	}
	if _, _, err := ResolveTurn(g, Move{Bid: 11, Cell: 0}, Move{Bid: 1, Cell: 1}); !errors.Is(err, ErrBidExceedsBudget) {
		t.Errorf("over-budget err = %v, want ErrBidExceedsBudget", err)
	}
	if _, _, err := ResolveTurn(g, Move{Bid: 5, Cell: 9}, Move{Bid: 1, Cell: 0}); !errors.Is(err, ErrCellOutOfRange) {
		t.Errorf("cell-out-of-range err = %v, want ErrCellOutOfRange", err)
	}
	// Occupied cell: X takes 0, then wins again and targets 0.
	g2, _, _ := ResolveTurn(g, Move{Bid: 5, Cell: 0}, Move{Bid: 1, Cell: 4})
	if _, _, err := ResolveTurn(g2, Move{Bid: 3, Cell: 0}, Move{Bid: 1, Cell: 5}); !errors.Is(err, ErrCellOccupied) {
		t.Errorf("occupied-cell err = %v, want ErrCellOccupied", err)
	}
}

func TestResolveTurn_ErrorLeavesGameUnchanged(t *testing.T) {
	g := NewGame(10)
	g, _, _ = ResolveTurn(g, Move{Bid: 5, Cell: 0}, Move{Bid: 5, Cell: 1}) // a tie -> flips TieToX
	before := g
	// An invalid winner cell must leave everything (board, budgets, tie parity) intact.
	after, _, err := ResolveTurn(g, Move{Bid: 2, Cell: 0}, Move{Bid: 1, Cell: 3}) // X wins, cell 0 occupied
	if !errors.Is(err, ErrCellOccupied) {
		t.Fatalf("expected ErrCellOccupied, got %v", err)
	}
	if after != before {
		t.Errorf("game changed on error: before=%+v after=%+v", before, after)
	}
}

func TestResolveTurn_GameOver(t *testing.T) {
	// X wins the top row over three turns, then a further turn must error.
	g := NewGame(100)
	for _, cell := range []int{0, 1, 2} {
		var err error
		g, _, err = ResolveTurn(g, Move{Bid: 5, Cell: cell}, Move{Bid: 1, Cell: 4})
		if err != nil {
			t.Fatal(err)
		}
	}
	if g.Board.Outcome() != XWins {
		t.Fatalf("expected XWins, board=%q outcome=%v", g.Board.String(), g.Board.Outcome())
	}
	if !g.IsOver() {
		t.Error("IsOver should be true after a win")
	}
	if _, _, err := ResolveTurn(g, Move{Bid: 1, Cell: 5}, Move{Bid: 1, Cell: 6}); !errors.Is(err, ErrGameOver) {
		t.Errorf("playing on a finished board: err = %v, want ErrGameOver", err)
	}
}

func TestResolveTurn_BudgetRunsOut(t *testing.T) {
	// A player who transfers away everything can still bid 0 (and only win
	// via tie-break). The loser receiving transfers can grow above the
	// initial budget.
	g := NewGame(5)
	// X bids 5 (all of it) vs O's 0. X wins and transfers 5 to O.
	g, _, err := ResolveTurn(g, Move{Bid: 5, Cell: 0}, Move{Bid: 0, Cell: 4})
	if err != nil {
		t.Fatal(err)
	}
	if g.Budget[0] != 0 {
		t.Fatalf("X budget = %d, want 0 (paid the bid as transfer to O)", g.Budget[0])
	}
	if g.Budget[1] != 10 {
		t.Fatalf("O budget = %d, want 10 (received 5 from X: 5 + 5)", g.Budget[1])
	}
	// X now can only bid 0; O outbids with 1 and takes a cell, paying X 1.
	g, res, err := ResolveTurn(g, Move{Bid: 0, Cell: 1}, Move{Bid: 1, Cell: 4})
	if err != nil {
		t.Fatal(err)
	}
	if res.Winner != O || g.Board[4] != O {
		t.Fatalf("O should win when X is out of budget: %+v", res)
	}
	if g.Budget[0] != 1 || g.Budget[1] != 9 {
		t.Errorf("after O wins a 1-bid turn: budget = %v, want [1 9] (O transferred 1 to X)", g.Budget)
	}
	// Bidding more than the (now 1) budget must error.
	if _, _, err := ResolveTurn(g, Move{Bid: 2, Cell: 1}, Move{Bid: 0, Cell: 2}); !errors.Is(err, ErrBidExceedsBudget) {
		t.Errorf("over-budget after spend: err = %v, want ErrBidExceedsBudget", err)
	}
}

func TestMarkString(t *testing.T) {
	if X.String() != "X" || O.String() != "O" || Empty.String() != "_" {
		t.Error("Mark.String mismatch")
	}
}

func TestOutcomeString(t *testing.T) {
	for o, want := range map[Outcome]string{Ongoing: "Ongoing", XWins: "XWins", OWins: "OWins", Draw: "Draw"} {
		if o.String() != want {
			t.Errorf("Outcome(%d).String() = %q, want %q", o, o.String(), want)
		}
	}
}
