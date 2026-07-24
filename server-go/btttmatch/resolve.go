package btttmatch

import (
	"context"
	"fmt"

	"github.com/dal-go/dalgo/dal"
	"github.com/sneat-games/bidding-tictactoe/server-go/btttplay"
)

// payoutKey is the idempotency key for a match's win payout.
func payoutKey(matchID string) string { return "bttt:" + matchID + ":payout" }

// refundKey is the idempotency key for one player's draw refund on matchID.
func refundKey(matchID, userID string) string { return "bttt:" + matchID + ":refund:" + userID }

// ResolveTurn resolves the current turn from matchID's two recorded pending
// moves (see RecordMove), persists the resulting board and budgets, and
// clears the pending moves ahead of the next turn — all inside one
// db.RunReadwriteTransaction. If the match just ended, it then settles the
// buy-in pot via w: the winner is Awarded 2x BuyIn, or on a draw each player
// is Awarded their BuyIn back (see settleOutcome / SettleMatch).
//
// Both pending moves must already be recorded — callers resolve a turn only
// after RecordMove reports bothIn.
func ResolveTurn(ctx context.Context, db dal.DB, w CoinWallet, matchID string) (*Match, btttplay.TurnResult, error) {
	if matchID == "" {
		return nil, btttplay.TurnResult{}, ErrMatchIDRequired
	}

	var match *Match
	var result btttplay.TurnResult

	err := db.RunReadwriteTransaction(ctx, func(ctx context.Context, tx dal.ReadwriteTransaction) error {
		m, gerr := getMatch(ctx, tx, matchID)
		if gerr != nil {
			return gerr
		}
		if m.Status != StatusActive {
			return ErrMatchNotActive
		}
		xPM, oPM := m.PendingMoves[0], m.PendingMoves[1]
		if xPM == nil || oPM == nil {
			return ErrTurnNotReady
		}
		board, berr := m.Board()
		if berr != nil {
			return berr
		}
		game := btttplay.Game{Board: board, Budget: m.Budget, TieToX: m.TieToX}
		next, res, rerr := btttplay.ResolveTurn(game, *xPM, *oPM)
		if rerr != nil {
			return rerr
		}

		m.setBoard(next.Board)
		m.Budget = next.Budget
		m.TieToX = next.TieToX
		m.PendingMoves = [2]*btttplay.Move{}
		if next.Board.Outcome() != btttplay.Ongoing {
			m.Status = StatusFinished
		}
		if serr := saveMatch(ctx, tx, matchID, m); serr != nil {
			return serr
		}
		match, result = m, res
		return nil
	})
	if err != nil {
		return nil, btttplay.TurnResult{}, err
	}

	if match.Status == StatusFinished {
		if serr := settleOutcome(ctx, w, matchID, match, result.Outcome); serr != nil {
			return match, result, fmt.Errorf("btttmatch: turn resolved but coin settlement failed: %w", serr)
		}
	}
	return match, result, nil
}

// SettleMatch pays out matchID's already-finished result via w. ResolveTurn
// calls this automatically the turn a match ends; it is exported so a host
// can retry settlement — safely, since CoinWallet.Award is idempotent by key
// — if it failed the first time (e.g. a transient wallet outage).
func SettleMatch(ctx context.Context, db dal.DB, w CoinWallet, matchID string) error {
	match, err := GetMatch(ctx, db, matchID)
	if err != nil {
		return err
	}
	if match.Status != StatusFinished {
		return ErrMatchNotFinished
	}
	board, err := match.Board()
	if err != nil {
		return err
	}
	return settleOutcome(ctx, w, matchID, match, board.Outcome())
}

// settleOutcome pays matchID's already-decided outcome via w, idempotently.
func settleOutcome(ctx context.Context, w CoinWallet, matchID string, match *Match, outcome btttplay.Outcome) error {
	switch outcome {
	case btttplay.XWins:
		return w.Award(ctx, match.Players[0].UserID, 2*match.BuyIn, payoutKey(matchID))
	case btttplay.OWins:
		return w.Award(ctx, match.Players[1].UserID, 2*match.BuyIn, payoutKey(matchID))
	case btttplay.Draw:
		for _, p := range match.Players {
			if err := w.Award(ctx, p.UserID, match.BuyIn, refundKey(matchID, p.UserID)); err != nil {
				return err
			}
		}
		return nil
	default:
		return fmt.Errorf("btttmatch: match %q is not actually finished (board outcome = %v)", matchID, outcome)
	}
}
