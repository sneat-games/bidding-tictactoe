package btttmatch

import (
	"fmt"
	"time"

	"github.com/sneat-games/bidding-tictactoe/server-go/btttplay"
)

// DefaultBuyIn is the coin stake each player pays to enter a match, used by
// NewChallenge when no explicit buy-in is given.
const DefaultBuyIn = 20

// Status is the lifecycle status of a Bidding Tic-Tac-Toe match.
type Status string

const (
	// StatusPending means the challenger is waiting for an opponent to join.
	StatusPending Status = "pending"
	// StatusActive means both players joined & bought in; play is in progress.
	StatusActive Status = "active"
	// StatusFinished means the match ended (a win or a draw) and coins were settled.
	StatusFinished Status = "finished"
)

// Player identifies one side of a match.
type Player struct {
	UserID string `json:"userID" firestore:"userID"`
	Name   string `json:"name" firestore:"name"`
}

// Match is the persisted state of one Bidding Tic-Tac-Toe match. It has no ID
// field of its own — its identity is the matchID passed alongside it to every
// store/session function in this package, which becomes the dal.Key ID.
type Match struct {
	// BoardStr is the current 3x3 position, in btttplay.Board.String() form.
	BoardStr string `json:"board" firestore:"board"`
	// Budget is the remaining bidding budget for [X, O] (btttplay.Game.Budget).
	Budget [2]int `json:"budget" firestore:"budget"`
	// TieToX is which side the next tied bid is awarded to (btttplay.Game.TieToX).
	TieToX bool `json:"tieToX" firestore:"tieToX"`

	// Players are the two sides of the match: index 0 plays X, index 1 plays O.
	// Players[1] is the zero value until an opponent joins a pending challenge.
	Players [2]Player `json:"players" firestore:"players"`

	// PendingMoves holds each player's hidden move for the CURRENT turn. Each
	// entry is nil until that player submits (see RecordMove), and both reset
	// to nil once the turn resolves (see ResolveTurn).
	PendingMoves [2]*btttplay.Move `json:"pendingMoves" firestore:"pendingMoves"`

	// BoardChatID and BoardMessageID locate the single shared message (e.g. a
	// Telegram chat + message) that renders this match's board, so a host can
	// edit it in place after each turn instead of posting a new one.
	BoardChatID    int64 `json:"boardChatID" firestore:"boardChatID"`
	BoardMessageID int   `json:"boardMessageID" firestore:"boardMessageID"`

	// Status is the match's lifecycle status.
	Status Status `json:"status" firestore:"status"`
	// BuyIn is the coin stake each player pays to enter (default DefaultBuyIn).
	BuyIn int `json:"buyIn" firestore:"buyIn"`

	CreatedAt time.Time `json:"createdAt" firestore:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt" firestore:"updatedAt"`
}

// now is the clock, overridable in tests.
var now = time.Now

// Board parses BoardStr into a btttplay.Board.
func (m Match) Board() (btttplay.Board, error) {
	return btttplay.ParseBoard(m.BoardStr)
}

// setBoard stores b as BoardStr.
func (m *Match) setBoard(b btttplay.Board) {
	m.BoardStr = b.String()
}

// Game returns the btttplay.Game this match currently represents, for callers
// that want to inspect it directly (e.g. to render EmptyCells()).
func (m Match) Game() (btttplay.Game, error) {
	board, err := m.Board()
	if err != nil {
		return btttplay.Game{}, err
	}
	return btttplay.Game{Board: board, Budget: m.Budget, TieToX: m.TieToX}, nil
}

// Validate reports whether the match is internally consistent. It is called
// by SaveMatch before every write, so a caller can never persist a broken match.
func (m Match) Validate() error {
	if _, err := btttplay.ParseBoard(m.BoardStr); err != nil {
		return fmt.Errorf("btttmatch: invalid board: %w", err)
	}
	if m.Budget[0] < 0 || m.Budget[1] < 0 {
		return fmt.Errorf("btttmatch: budget must be >= 0, got %v", m.Budget)
	}
	if m.BuyIn <= 0 {
		return ErrBuyInMustBePositive
	}
	switch m.Status {
	case StatusPending, StatusActive, StatusFinished:
	default:
		return fmt.Errorf("%w: %q", ErrInvalidStatus, m.Status)
	}
	if m.Status != StatusPending {
		for i, p := range m.Players {
			if p.UserID == "" {
				return fmt.Errorf("%w (player %d)", ErrPlayerUserIDRequired, i)
			}
		}
	}
	for i, pm := range m.PendingMoves {
		if pm == nil {
			continue
		}
		if pm.Bid < 0 {
			return fmt.Errorf("%w: player %d bid is negative", ErrInvalidPendingMove, i)
		}
		if pm.Cell < 0 || pm.Cell > 8 {
			return fmt.Errorf("%w: player %d cell %d is out of range", ErrInvalidPendingMove, i, pm.Cell)
		}
	}
	return nil
}

// NewChallenge creates a new Pending match with challenger as player X (index
// 0), waiting for an opponent to Join. buyIn <= 0 falls back to DefaultBuyIn.
// The match is not persisted — pass it to SaveMatch (directly, or via Join /
// StartMatch) to store it.
func NewChallenge(challenger Player, buyIn int) *Match {
	if buyIn <= 0 {
		buyIn = DefaultBuyIn
	}
	t := now()
	return &Match{
		BoardStr:  btttplay.Board{}.String(),
		Players:   [2]Player{challenger, {}},
		Status:    StatusPending,
		BuyIn:     buyIn,
		CreatedAt: t,
		UpdatedAt: t,
	}
}

// Join adds opponent as player O (index 1) to a Pending match.
func (m *Match) Join(opponent Player) error {
	if m.Status != StatusPending {
		return ErrMatchNotPending
	}
	if m.Players[1].UserID != "" {
		return ErrMatchAlreadyJoined
	}
	if opponent.UserID == "" {
		return ErrPlayerUserIDRequired
	}
	if opponent.UserID == m.Players[0].UserID {
		return ErrCannotJoinOwnChallenge
	}
	m.Players[1] = opponent
	m.UpdatedAt = now()
	return nil
}
