package btttmatch

import (
	"errors"
	"testing"

	"github.com/sneat-games/bidding-tictactoe/server-go/btttplay"
)

func newValidPendingMatch() *Match {
	return NewChallenge(Player{UserID: "x1", Name: "Alice"}, 20)
}

func newValidActiveMatch() *Match {
	m := newValidPendingMatch()
	if err := m.Join(Player{UserID: "o1", Name: "Bob"}); err != nil {
		panic(err)
	}
	game := btttplay.NewGame(m.BuyIn)
	m.setBoard(game.Board)
	m.Budget = game.Budget
	m.TieToX = game.TieToX
	m.Status = StatusActive
	return m
}

func TestNewChallenge_DefaultsBuyIn(t *testing.T) {
	m := NewChallenge(Player{UserID: "x1"}, 0)
	if m.BuyIn != DefaultBuyIn {
		t.Fatalf("BuyIn = %d, want DefaultBuyIn (%d)", m.BuyIn, DefaultBuyIn)
	}
	if m.Status != StatusPending {
		t.Fatalf("Status = %v, want StatusPending", m.Status)
	}
	if m.Players[0].UserID != "x1" {
		t.Fatalf("Players[0] = %+v, want challenger", m.Players[0])
	}
	if m.Players[1].UserID != "" {
		t.Fatalf("Players[1] = %+v, want empty (no opponent yet)", m.Players[1])
	}
	if err := m.Validate(); err != nil {
		t.Fatalf("Validate() = %v, want nil", err)
	}
}

func TestNewChallenge_CustomBuyIn(t *testing.T) {
	m := NewChallenge(Player{UserID: "x1"}, 50)
	if m.BuyIn != 50 {
		t.Fatalf("BuyIn = %d, want 50", m.BuyIn)
	}
}

func TestMatch_Join(t *testing.T) {
	m := newValidPendingMatch()
	if err := m.Join(Player{UserID: "o1", Name: "Bob"}); err != nil {
		t.Fatalf("Join() = %v, want nil", err)
	}
	if m.Players[1].UserID != "o1" {
		t.Fatalf("Players[1] = %+v, want joined opponent", m.Players[1])
	}
}

func TestMatch_Join_Errors(t *testing.T) {
	t.Run("empty userID", func(t *testing.T) {
		m := newValidPendingMatch()
		if err := m.Join(Player{}); !errors.Is(err, ErrPlayerUserIDRequired) {
			t.Fatalf("Join(empty) err = %v, want ErrPlayerUserIDRequired", err)
		}
	})
	t.Run("own challenge", func(t *testing.T) {
		m := newValidPendingMatch()
		if err := m.Join(Player{UserID: "x1"}); !errors.Is(err, ErrCannotJoinOwnChallenge) {
			t.Fatalf("Join(self) err = %v, want ErrCannotJoinOwnChallenge", err)
		}
	})
	t.Run("already joined", func(t *testing.T) {
		m := newValidPendingMatch()
		if err := m.Join(Player{UserID: "o1"}); err != nil {
			t.Fatal(err)
		}
		if err := m.Join(Player{UserID: "o2"}); !errors.Is(err, ErrMatchAlreadyJoined) {
			t.Fatalf("second Join() err = %v, want ErrMatchAlreadyJoined", err)
		}
	})
	t.Run("not pending", func(t *testing.T) {
		m := newValidActiveMatch()
		if err := m.Join(Player{UserID: "o2"}); !errors.Is(err, ErrMatchNotPending) {
			t.Fatalf("Join() on active match err = %v, want ErrMatchNotPending", err)
		}
	})
}

func TestMatch_Validate(t *testing.T) {
	t.Run("valid pending", func(t *testing.T) {
		if err := newValidPendingMatch().Validate(); err != nil {
			t.Fatalf("Validate() = %v, want nil", err)
		}
	})
	t.Run("valid active", func(t *testing.T) {
		if err := newValidActiveMatch().Validate(); err != nil {
			t.Fatalf("Validate() = %v, want nil", err)
		}
	})
	t.Run("invalid board", func(t *testing.T) {
		m := newValidPendingMatch()
		m.BoardStr = "bad"
		if err := m.Validate(); err == nil {
			t.Fatal("Validate() = nil, want error for invalid board")
		}
	})
	t.Run("negative budget", func(t *testing.T) {
		m := newValidActiveMatch()
		m.Budget[0] = -1
		if err := m.Validate(); err == nil {
			t.Fatal("Validate() = nil, want error for negative budget")
		}
	})
	t.Run("non-positive buy-in", func(t *testing.T) {
		m := newValidPendingMatch()
		m.BuyIn = 0
		if err := m.Validate(); !errors.Is(err, ErrBuyInMustBePositive) {
			t.Fatalf("Validate() = %v, want ErrBuyInMustBePositive", err)
		}
	})
	t.Run("unknown status", func(t *testing.T) {
		m := newValidPendingMatch()
		m.Status = Status("bogus")
		if err := m.Validate(); !errors.Is(err, ErrInvalidStatus) {
			t.Fatalf("Validate() = %v, want ErrInvalidStatus", err)
		}
	})
	t.Run("active match missing a player", func(t *testing.T) {
		m := newValidActiveMatch()
		m.Players[1] = Player{}
		if err := m.Validate(); !errors.Is(err, ErrPlayerUserIDRequired) {
			t.Fatalf("Validate() = %v, want ErrPlayerUserIDRequired", err)
		}
	})
	t.Run("pending match allows an empty second player", func(t *testing.T) {
		m := newValidPendingMatch() // Players[1] intentionally empty
		if err := m.Validate(); err != nil {
			t.Fatalf("Validate() = %v, want nil (pending match awaits an opponent)", err)
		}
	})
	t.Run("pending move with negative bid", func(t *testing.T) {
		m := newValidActiveMatch()
		m.PendingMoves[0] = &btttplay.Move{Bid: -1, Cell: 0}
		if err := m.Validate(); !errors.Is(err, ErrInvalidPendingMove) {
			t.Fatalf("Validate() = %v, want ErrInvalidPendingMove", err)
		}
	})
	t.Run("pending move with out-of-range cell", func(t *testing.T) {
		m := newValidActiveMatch()
		m.PendingMoves[1] = &btttplay.Move{Bid: 1, Cell: 9}
		if err := m.Validate(); !errors.Is(err, ErrInvalidPendingMove) {
			t.Fatalf("Validate() = %v, want ErrInvalidPendingMove", err)
		}
	})
}

func TestMatch_BoardAndGame(t *testing.T) {
	m := newValidActiveMatch()
	board, err := m.Board()
	if err != nil {
		t.Fatal(err)
	}
	if board.Outcome() != btttplay.Ongoing {
		t.Fatalf("fresh board outcome = %v, want Ongoing", board.Outcome())
	}
	game, err := m.Game()
	if err != nil {
		t.Fatal(err)
	}
	if game.Budget != m.Budget || game.TieToX != m.TieToX {
		t.Fatalf("Game() = %+v, want matching Budget/TieToX from %+v", game, m)
	}
}

func TestMatch_Board_Game_InvalidBoard(t *testing.T) {
	m := newValidActiveMatch()
	m.BoardStr = "not-a-board"
	if _, err := m.Board(); err == nil {
		t.Fatal("Board() = nil error, want an error for an invalid board string")
	}
	if _, err := m.Game(); err == nil {
		t.Fatal("Game() = nil error, want an error for an invalid board string")
	}
}
