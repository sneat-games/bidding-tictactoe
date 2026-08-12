// Win-line lookup for the end-of-match board highlight — glow the three
// cells that completed the line, dim the rest (see match-screen.ts's
// renderBoard and global.css's ".board__cell--win"/"--dim").
//
// This is a read-only reader of the engine's own LINES table: it never
// re-derives the winning-triple rule, so a rule change in
// src/engine/btttplay.ts can never drift out of sync with what gets
// highlighted here.

import { Board, LINES, Mark } from "../engine/btttplay";

/** The three cells of the completed line, or null on an ongoing game or a
 *  draw (no single line is fully owned by one mark). */
export function winningLine(board: Board): readonly number[] | null {
  for (const line of LINES) {
    const [a, b, c] = line;
    const mark = board[a];
    if (mark !== Mark.Empty && mark === board[b] && mark === board[c]) {
      return line;
    }
  }
  return null;
}
