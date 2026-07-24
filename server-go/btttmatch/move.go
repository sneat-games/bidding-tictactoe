package btttmatch

import (
	"context"

	"github.com/dal-go/dalgo/dal"
	"github.com/sneat-games/bidding-tictactoe/server-go/btttplay"
)

// RecordMove stores playerIdx's (0 = X, 1 = O) hidden move for the current
// turn and reports whether BOTH players' moves are now in — the caller's
// signal to call ResolveTurn.
//
// It runs entirely inside one db.RunReadwriteTransaction, so two
// near-simultaneous calls for the same player (e.g. a retried webhook
// delivery) can never both observe "both in": whichever transaction commits
// first finds the slot empty and fills it; every other one then finds it
// already filled and returns ErrMoveAlreadySubmitted instead of re-reporting
// readiness — so a turn is never resolved twice from a duplicate submission.
func RecordMove(ctx context.Context, db dal.DB, matchID string, playerIdx int, move btttplay.Move) (bothIn bool, err error) {
	if matchID == "" {
		return false, ErrMatchIDRequired
	}
	if playerIdx != 0 && playerIdx != 1 {
		return false, ErrPlayerIndexOutOfRange
	}
	if move.Bid < 0 {
		return false, btttplay.ErrBidNegative
	}
	if move.Cell < 0 || move.Cell > 8 {
		return false, btttplay.ErrCellOutOfRange
	}

	err = db.RunReadwriteTransaction(ctx, func(ctx context.Context, tx dal.ReadwriteTransaction) error {
		match, gerr := getMatch(ctx, tx, matchID)
		if gerr != nil {
			return gerr
		}
		if match.Status != StatusActive {
			return ErrMatchNotActive
		}
		if match.PendingMoves[playerIdx] != nil {
			return ErrMoveAlreadySubmitted
		}
		recorded := move
		match.PendingMoves[playerIdx] = &recorded
		bothIn = match.PendingMoves[0] != nil && match.PendingMoves[1] != nil
		return saveMatch(ctx, tx, matchID, match)
	})
	if err != nil {
		return false, err
	}
	return bothIn, nil
}
