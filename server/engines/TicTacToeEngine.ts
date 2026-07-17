/**
 * Pure tic-tac-toe engine. No I/O — gateways own persistence.
 * Board: 9 cells, 0 = empty, 1 = player1, 2 = player2.
 */

export type TttCell = 0 | 1 | 2
export type TttBoard = TttCell[]

export interface TttState {
  board: TttBoard
  turn: 1 | 2
  status: 'IN_PROGRESS' | 'WIN' | 'DRAW'
  winner: 1 | 2 | null
}

const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
] as const

export function tttCreate(firstTurn: 1 | 2): TttState {
  return { board: Array(9).fill(0) as TttBoard, turn: firstTurn, status: 'IN_PROGRESS', winner: null }
}

export type TttMoveResult = { ok: true; state: TttState } | { ok: false; error: string }

export function tttApplyMove(state: TttState, player: 1 | 2, cell: number): TttMoveResult {
  if (state.status !== 'IN_PROGRESS') return { ok: false, error: 'game_over' }
  if (player !== state.turn) return { ok: false, error: 'not_your_turn' }
  if (!Number.isInteger(cell) || cell < 0 || cell > 8) return { ok: false, error: 'invalid_cell' }
  if (state.board[cell] !== 0) return { ok: false, error: 'cell_taken' }

  const board = [...state.board] as TttBoard
  board[cell] = player

  for (const [a, b, c] of LINES) {
    if (board[a] !== 0 && board[a] === board[b] && board[b] === board[c]) {
      return { ok: true, state: { board, turn: state.turn, status: 'WIN', winner: player } }
    }
  }
  if (board.every((c) => c !== 0)) {
    return { ok: true, state: { board, turn: state.turn, status: 'DRAW', winner: null } }
  }
  return {
    ok: true,
    state: { board, turn: player === 1 ? 2 : 1, status: 'IN_PROGRESS', winner: null },
  }
}
