package btttmatch

import "errors"

// Errors returned by this package. Use errors.Is to test for them.
var (
	// ErrMatchIDRequired is returned when a matchID argument is empty.
	ErrMatchIDRequired = errors.New("btttmatch: matchID is required")

	// ErrPlayerUserIDRequired is returned by Validate/Join when a player has no UserID.
	ErrPlayerUserIDRequired = errors.New("btttmatch: player userID is required")

	// ErrBuyInMustBePositive is returned by Validate when BuyIn <= 0.
	ErrBuyInMustBePositive = errors.New("btttmatch: buy-in must be > 0")

	// ErrInvalidStatus is returned by Validate for an unrecognized Status value.
	ErrInvalidStatus = errors.New("btttmatch: unknown status")

	// ErrInvalidPendingMove is returned by Validate when a recorded pending move
	// has a negative bid or an out-of-range cell.
	ErrInvalidPendingMove = errors.New("btttmatch: invalid pending move")

	// ErrMatchNotPending is returned when an operation that requires a Pending
	// match (Join, StartMatch) is attempted on a match in another status.
	ErrMatchNotPending = errors.New("btttmatch: match is not pending")

	// ErrMatchAlreadyJoined is returned by Join when the match already has both players.
	ErrMatchAlreadyJoined = errors.New("btttmatch: match already has two players")

	// ErrCannotJoinOwnChallenge is returned by Join when the joiner is the challenger.
	ErrCannotJoinOwnChallenge = errors.New("btttmatch: a player cannot join their own challenge")

	// ErrMatchNotFull is returned by StartMatch when the match does not yet have
	// two players.
	ErrMatchNotFull = errors.New("btttmatch: match does not have two players yet")

	// ErrMatchNotActive is returned when an operation that requires an Active
	// match (RecordMove, ResolveTurn) is attempted on a match in another status.
	ErrMatchNotActive = errors.New("btttmatch: match is not active")

	// ErrMatchNotFinished is returned by SettleMatch when the match has not ended.
	ErrMatchNotFinished = errors.New("btttmatch: match has not finished")

	// ErrPlayerIndexOutOfRange is returned when a playerIdx argument is not 0 or 1.
	ErrPlayerIndexOutOfRange = errors.New("btttmatch: player index must be 0 or 1")

	// ErrMoveAlreadySubmitted is returned by RecordMove when the player already
	// has a pending move recorded for the current turn. This is also the guard
	// that keeps two near-simultaneous submissions for the same player from
	// both observing "both moves are in": whichever transaction commits first
	// fills the slot, and every later one gets this error instead.
	ErrMoveAlreadySubmitted = errors.New("btttmatch: move already submitted for this turn")

	// ErrTurnNotReady is returned by ResolveTurn when one or both players have
	// not yet submitted their move for the current turn.
	ErrTurnNotReady = errors.New("btttmatch: not all moves are in for this turn")
)
