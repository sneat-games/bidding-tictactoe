// Package btttplay is the resolution engine for Bidding Tic-Tac-Toe — a two-player
// hidden-bid ("auction") variant of tic-tac-toe.
//
// # The rule
//
// Each turn both players secretly submit a Move: a Bid (staked from their
// per-match budget) and a target Cell. The HIGHER bid wins the turn — that player
// places their mark at their target cell and spends their bid from their budget.
// It is a first-price auction: the loser keeps their whole budget and their mark
// is not placed. Equal bids are decided by an ALTERNATING tie-break (the first tie
// goes to X, the next to O, and so on) so neither side keeps a permanent tie
// advantage. Three in a row wins; a board on which no line can still be completed
// (in particular a full board) is a draw.
//
// The engine is coin-agnostic: "budget" is a plain integer. Mapping coins onto a
// match (buy-in, pot, payout) is the session layer's job, exactly as greedplay
// stays separate from the coins wallet.
package btttplay

import "errors"

// boardCells is the number of cells on the 3x3 board.
const boardCells = 9

// Mark is the owner of a cell.
type Mark uint8

const (
	// Empty is an unclaimed cell.
	Empty Mark = iota
	// X is the first player.
	X
	// O is the second player.
	O
)

// String renders a mark as a single character (X, O or "_" for empty).
func (m Mark) String() string {
	switch m {
	case X:
		return "X"
	case O:
		return "O"
	default:
		return "_"
	}
}

// Board is a 3x3 grid in row-major order (index 0..8).
type Board [boardCells]Mark

// lines are the eight winning triples (rows, columns, diagonals).
var lines = [8][3]int{
	{0, 1, 2}, {3, 4, 5}, {6, 7, 8}, // rows
	{0, 3, 6}, {1, 4, 7}, {2, 5, 8}, // columns
	{0, 4, 8}, {2, 4, 6}, // diagonals
}

// Outcome is the state of a board.
type Outcome uint8

const (
	// Ongoing means the game can still continue.
	Ongoing Outcome = iota
	// XWins means X has three in a row.
	XWins
	// OWins means O has three in a row.
	OWins
	// Draw means no line can still be completed (e.g. a full board), no winner.
	Draw
)

// String renders an Outcome for logs and test output.
func (o Outcome) String() string {
	switch o {
	case XWins:
		return "XWins"
	case OWins:
		return "OWins"
	case Draw:
		return "Draw"
	default:
		return "Ongoing"
	}
}

// Outcome reports whether the board is won, drawn, or still ongoing. A draw is
// declared as soon as no line remains winnable by either player (which includes,
// but is not limited to, a completely full board).
func (b Board) Outcome() Outcome {
	for _, ln := range lines {
		if a := b[ln[0]]; a != Empty && a == b[ln[1]] && a == b[ln[2]] {
			if a == X {
				return XWins
			}
			return OWins
		}
	}
	// No winner yet: the game continues only while some line is still open to a
	// single player (contains no cell of the other player) AND the board has room.
	winnable := false
	full := true
	for _, ln := range lines {
		var hasX, hasO bool
		for _, i := range ln {
			switch b[i] {
			case X:
				hasX = true
			case O:
				hasO = true
			}
		}
		if !(hasX && hasO) {
			winnable = true
		}
	}
	for _, c := range b {
		if c == Empty {
			full = false
			break
		}
	}
	if !winnable || full {
		return Draw
	}
	return Ongoing
}

// String renders the board as 9 characters (row-major), e.g. "X_O__X_O_".
func (b Board) String() string {
	out := make([]byte, boardCells)
	for i, m := range b {
		out[i] = m.String()[0]
	}
	return string(out)
}

// EmptyCells returns the indexes (0..8) of the unclaimed cells, in order — the
// legal targets a player may bid for.
func (b Board) EmptyCells() []int {
	var out []int
	for i, m := range b {
		if m == Empty {
			out = append(out, i)
		}
	}
	return out
}

// ParseBoard parses a 9-character board string (row-major, chars X/O/_).
func ParseBoard(s string) (Board, error) {
	var b Board
	if len(s) != boardCells {
		return b, errors.New("btttplay: board string must be 9 characters")
	}
	for i := 0; i < boardCells; i++ {
		switch s[i] {
		case 'X':
			b[i] = X
		case 'O':
			b[i] = O
		case '_':
			b[i] = Empty
		default:
			return Board{}, errors.New("btttplay: invalid board character")
		}
	}
	return b, nil
}

// Move is a player's hidden move for one turn: a Bid staked from their budget and
// the Cell they would take if they win the turn.
type Move struct {
	// Bid is the amount staked to win this turn (>= 0, must be <= the player's
	// remaining budget).
	Bid int
	// Cell is the target cell 0..8. It is used only if the player wins the turn,
	// and must be Empty then.
	Cell int
}

// Game is the full match state. It is a plain value that a session store can
// persist field by field (Board via String/ParseBoard, Budget as two ints,
// TieToX as a bool).
type Game struct {
	// Board is the current 3x3 position.
	Board Board
	// Budget is the remaining auction budget for [X, O].
	Budget [2]int
	// TieToX is which side the NEXT tied turn is awarded to. It flips every time a
	// tie-break is used, so the tie advantage alternates across the match.
	TieToX bool
}

// NewGame returns an empty-board match where both players start with the given
// budget and the first tie (if any) goes to X.
func NewGame(budget int) Game {
	return Game{Budget: [2]int{budget, budget}, TieToX: true}
}

// IsOver reports whether the match has finished (a win or a draw).
func (g Game) IsOver() bool {
	return g.Board.Outcome() != Ongoing
}

// Errors returned by ResolveTurn. Use errors.Is to test for them.
var (
	// ErrGameOver is returned when a turn is played on a finished board.
	ErrGameOver = errors.New("btttplay: game is already over")
	// ErrBidNegative is returned when a bid is below zero.
	ErrBidNegative = errors.New("btttplay: bid must be >= 0")
	// ErrBidExceedsBudget is returned when a player bids more than their budget.
	ErrBidExceedsBudget = errors.New("btttplay: bid exceeds remaining budget")
	// ErrCellOutOfRange is returned when the winner's target cell is not 0..8.
	ErrCellOutOfRange = errors.New("btttplay: target cell out of range")
	// ErrCellOccupied is returned when the winner's target cell is already taken.
	ErrCellOccupied = errors.New("btttplay: target cell is occupied")
)

// TurnResult describes one resolved turn, for rendering a results screen.
type TurnResult struct {
	// Winner is the player who won the turn and placed a mark (X or O).
	Winner Mark
	// Cell is the cell the winner took (0..8).
	Cell int
	// Bid is what the winner paid — spent from their budget.
	Bid int
	// TieBreak is true when the bids were equal and the alternating tie-break
	// decided the turn.
	TieBreak bool
	// Outcome is the board outcome AFTER this turn.
	Outcome Outcome
}

// ResolveTurn resolves one turn from both players' hidden moves. It compares the
// bids (higher wins; equal bids use the alternating tie-break), validates the
// WINNER's move only (the loser's move is discarded — their mark is not placed and
// their budget is untouched), places the winning mark, spends the winner's bid,
// and reports the resulting board outcome.
//
// Both bids must be non-negative and within the respective player's budget — a bid
// is a real commitment, so you cannot bid what you cannot afford. On any error the
// game is returned unchanged.
func ResolveTurn(g Game, xMove, oMove Move) (Game, TurnResult, error) {
	if g.IsOver() {
		return g, TurnResult{}, ErrGameOver
	}
	if xMove.Bid < 0 || oMove.Bid < 0 {
		return g, TurnResult{}, ErrBidNegative
	}
	if xMove.Bid > g.Budget[0] || oMove.Bid > g.Budget[1] {
		return g, TurnResult{}, ErrBidExceedsBudget
	}

	// Decide the winner without mutating state (so an invalid winner move leaves
	// the game — including the tie-break parity — unchanged).
	var winner Mark
	var tieBreak bool
	switch {
	case xMove.Bid > oMove.Bid:
		winner = X
	case oMove.Bid > xMove.Bid:
		winner = O
	default:
		tieBreak = true
		if g.TieToX {
			winner = X
		} else {
			winner = O
		}
	}

	win, wi := xMove, 0
	if winner == O {
		win, wi = oMove, 1
	}
	if win.Cell < 0 || win.Cell >= boardCells {
		return g, TurnResult{}, ErrCellOutOfRange
	}
	if g.Board[win.Cell] != Empty {
		return g, TurnResult{}, ErrCellOccupied
	}

	g.Board[win.Cell] = winner
	g.Budget[wi] -= win.Bid
	if tieBreak {
		g.TieToX = !g.TieToX
	}
	return g, TurnResult{Winner: winner, Cell: win.Cell, Bid: win.Bid, TieBreak: tieBreak, Outcome: g.Board.Outcome()}, nil
}
