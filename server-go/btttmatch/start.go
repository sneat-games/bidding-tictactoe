package btttmatch

import (
	"context"
	"fmt"

	"github.com/dal-go/dalgo/dal"
	"github.com/sneat-games/bidding-tictactoe/server-go/btttplay"
)

// buyInKey is the idempotency key for one player's buy-in stake on matchID.
// Reusing the same key across retries is intentional: a player's stake is
// charged at most once no matter how many times StartMatch is (re)called for
// the same match.
func buyInKey(matchID, userID string) string {
	return "bttt:" + matchID + ":buyin:" + userID
}

// StartMatch buys both of matchID's players in for BuyIn coins each (via w)
// and activates the match: it resets the board and gives each player a
// bidding budget equal to BuyIn (btttplay.NewGame(BuyIn)). The match must
// already be Pending with both players joined (see NewChallenge, Join).
//
// The two stakes are charged one at a time, under idempotent keys. If the
// second player's stake fails (most commonly insufficient funds), StartMatch
// returns the error and the match is left Pending — the first player's stake
// is NOT rolled back, since it is safely parked under its idempotent key: a
// later retry of StartMatch (e.g. once the second player tops up) replays
// that same key as a no-op and only (re)attempts the missing stake, so no
// player is ever charged twice across any number of retries. A host that
// wants to abandon a match stuck in this state instead of retrying is
// responsible for its own compensating refund.
func StartMatch(ctx context.Context, db dal.DB, w CoinWallet, matchID string) (*Match, error) {
	match, err := GetMatch(ctx, db, matchID)
	if err != nil {
		return nil, err
	}
	if match.Status != StatusPending {
		return nil, ErrMatchNotPending
	}
	if match.Players[0].UserID == "" || match.Players[1].UserID == "" {
		return nil, ErrMatchNotFull
	}

	xID, oID := match.Players[0].UserID, match.Players[1].UserID
	if err := w.Stake(ctx, xID, match.BuyIn, buyInKey(matchID, xID)); err != nil {
		return nil, fmt.Errorf("btttmatch: buy-in failed for player X (%s): %w", xID, err)
	}
	if err := w.Stake(ctx, oID, match.BuyIn, buyInKey(matchID, oID)); err != nil {
		return nil, fmt.Errorf("btttmatch: buy-in failed for player O (%s): %w", oID, err)
	}

	game := btttplay.NewGame(match.BuyIn)
	match.setBoard(game.Board)
	match.Budget = game.Budget
	match.TieToX = game.TieToX
	match.PendingMoves = [2]*btttplay.Move{}
	match.Status = StatusActive

	if err := SaveMatch(ctx, db, matchID, match); err != nil {
		return nil, err
	}
	return match, nil
}
