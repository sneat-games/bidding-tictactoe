package btttmatch

import (
	"context"

	"github.com/dal-go/dalgo/dal"
	"github.com/dal-go/record"
)

// CollectionMatches is the dalgo collection name matches are stored under.
const CollectionMatches = "bttt-matches"

// NewMatchKey builds the dalgo key identifying matchID's Match record.
func NewMatchKey(matchID string) *record.Key {
	return record.NewKeyWithID(CollectionMatches, matchID)
}

// GetMatch loads matchID's Match. It returns an error satisfying
// record.IsNotFound (github.com/dal-go/record) when no such match exists.
func GetMatch(ctx context.Context, db dal.ReadSession, matchID string) (*Match, error) {
	if matchID == "" {
		return nil, ErrMatchIDRequired
	}
	return getMatch(ctx, db, matchID)
}

// getMatch is the transaction-internal counterpart of GetMatch, shared by
// every function in this package that reads a match inside its own transaction.
func getMatch(ctx context.Context, tx dal.ReadSession, matchID string) (*Match, error) {
	match := new(Match)
	rec := record.NewRecordWithData(NewMatchKey(matchID), match)
	if err := tx.Get(ctx, rec); err != nil {
		return nil, err
	}
	return match, nil
}

// SaveMatch validates and persists match under matchID, in its own
// read-write transaction.
func SaveMatch(ctx context.Context, db dal.DB, matchID string, match *Match) error {
	if matchID == "" {
		return ErrMatchIDRequired
	}
	return db.RunReadwriteTransaction(ctx, func(ctx context.Context, tx dal.ReadwriteTransaction) error {
		return saveMatch(ctx, tx, matchID, match)
	})
}

// saveMatch is the transaction-internal counterpart of SaveMatch, shared by
// every function in this package that writes a match inside its own transaction.
func saveMatch(ctx context.Context, tx dal.ReadwriteSession, matchID string, match *Match) error {
	if err := match.Validate(); err != nil {
		return err
	}
	match.UpdatedAt = now()
	rec := record.NewRecordWithData(NewMatchKey(matchID), match)
	return tx.Set(ctx, rec)
}
