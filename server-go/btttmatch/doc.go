// Package btttmatch is the match/session layer for Bidding Tic-Tac-Toe.
//
// It wraps the pure btttplay engine (see that package's doc comment for the
// game rule) with two host-facing seams:
//
//   - Persistence: Match is a small DBO plus a dal-go/dalgo key builder and
//     Get/Save helpers. Every call takes a dal.DB from the caller — this
//     package holds no ambient database.
//   - Coin economics: buy-in, payout and refund are expressed against the
//     CoinWallet port defined here. A host wires it to its own coin ledger
//     (e.g. sneat-core-modules/wallet/gamecoins); btttmatch never imports
//     that, or any other host package, itself.
//
// The lifecycle is: NewChallenge (Pending) -> Join (both players known) ->
// StartMatch (buy-in charged, board reset, Active) -> RecordMove x2 per turn
// -> ResolveTurn (persists the turn, settles coins once the match ends,
// Finished).
package btttmatch
