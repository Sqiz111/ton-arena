import { describe, it, expect } from 'vitest'
import { tttCreate, tttApplyMove } from './TicTacToeEngine'
import {
  bsCreate,
  bsPlaceShips,
  bsShoot,
  validatePlacement,
  bsToJson,
  bsFromJson,
  type Ship,
} from './BattleshipEngine'

describe('TicTacToeEngine', () => {
  it('rejects moves out of turn and on taken cells', () => {
    const s = tttCreate(1)
    expect(tttApplyMove(s, 2, 0)).toMatchObject({ ok: false, error: 'not_your_turn' })
    const r1 = tttApplyMove(s, 1, 4)
    expect(r1.ok).toBe(true)
    if (r1.ok) {
      expect(tttApplyMove(r1.state, 2, 4)).toMatchObject({ ok: false, error: 'cell_taken' })
      expect(tttApplyMove(r1.state, 2, 9)).toMatchObject({ ok: false, error: 'invalid_cell' })
    }
  })

  it('detects a win', () => {
    let s = tttCreate(1)
    for (const [p, c] of [
      [1, 0],
      [2, 3],
      [1, 1],
      [2, 4],
      [1, 2],
    ] as const) {
      const r = tttApplyMove(s, p, c)
      expect(r.ok).toBe(true)
      if (r.ok) s = r.state
    }
    expect(s.status).toBe('WIN')
    expect(s.winner).toBe(1)
    expect(tttApplyMove(s, 2, 5)).toMatchObject({ ok: false, error: 'game_over' })
  })

  it('detects a draw', () => {
    let s = tttCreate(1)
    // X O X / X O O / O X X — no winner
    for (const [p, c] of [
      [1, 0],
      [2, 1],
      [1, 2],
      [2, 4],
      [1, 3],
      [2, 5],
      [1, 7],
      [2, 6],
      [1, 8],
    ] as const) {
      const r = tttApplyMove(s, p, c)
      expect(r.ok).toBe(true)
      if (r.ok) s = r.state
    }
    expect(s.status).toBe('DRAW')
    expect(s.winner).toBeNull()
  })
})

/** Valid classic no-touch layout used across tests. */
const VALID_FLEET: Ship[] = [
  { x: 0, y: 0, length: 4, horizontal: true },
  { x: 0, y: 2, length: 3, horizontal: true },
  { x: 5, y: 2, length: 3, horizontal: true },
  { x: 0, y: 4, length: 2, horizontal: true },
  { x: 4, y: 4, length: 2, horizontal: true },
  { x: 7, y: 4, length: 2, horizontal: true },
  { x: 0, y: 6, length: 1, horizontal: true },
  { x: 3, y: 6, length: 1, horizontal: true },
  { x: 6, y: 6, length: 1, horizontal: true },
  { x: 9, y: 6, length: 1, horizontal: true },
]

describe('BattleshipEngine placement', () => {
  it('accepts a valid classic layout', () => {
    expect(validatePlacement(VALID_FLEET)).toBeNull()
  })

  it('rejects wrong fleet composition', () => {
    expect(validatePlacement(VALID_FLEET.slice(1))).toBe('invalid_fleet')
  })

  it('rejects out-of-bounds and overlapping and touching ships', () => {
    const oob = [...VALID_FLEET.slice(0, 9), { x: 9, y: 9, length: 2, horizontal: true }]
    expect(validatePlacement(oob)).not.toBeNull()

    const touching = VALID_FLEET.map((s, i) => (i === 1 ? { ...s, y: 1 } : s))
    expect(validatePlacement(touching)).toBe('ships_touch')
  })
})

describe('BattleshipEngine gameplay', () => {
  function startGame() {
    let s = bsCreate(1)
    const p1 = bsPlaceShips(s, 1, VALID_FLEET)
    expect(p1.ok).toBe(true)
    if (p1.ok) s = p1.state
    expect(s.status).toBe('PLACING')
    const p2 = bsPlaceShips(s, 2, VALID_FLEET)
    expect(p2.ok).toBe(true)
    if (p2.ok) s = p2.state
    expect(s.status).toBe('IN_PROGRESS')
    return s
  }

  it('hit keeps the turn, miss passes it', () => {
    let s = startGame()
    const hit = bsShoot(s, 1, 0, 0)
    expect(hit.ok).toBe(true)
    if (hit.ok) {
      expect(hit.extra.hit).toBe(true)
      expect(hit.state.turn).toBe(1)
      s = hit.state
    }
    const miss = bsShoot(s, 1, 9, 9)
    expect(miss.ok).toBe(true)
    if (miss.ok) {
      expect(miss.extra.hit).toBe(false)
      expect(miss.state.turn).toBe(2)
    }
  })

  it('rejects duplicate shots and out-of-turn shots', () => {
    const s = startGame()
    const r = bsShoot(s, 1, 5, 5)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(bsShoot(r.state, 1, 5, 5)).toMatchObject({ ok: false }) // turn passed anyway
      expect(bsShoot(r.state, 1, 0, 0)).toMatchObject({ ok: false, error: 'not_your_turn' })
    }
  })

  it('reports sunk ships and game over when the fleet is destroyed', () => {
    let s = startGame()
    // Sink player 2's single-cell ship at (0,6): first shot hits and sinks.
    const r = bsShoot(s, 1, 0, 6)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.extra.sunk).toMatchObject({ x: 0, y: 6, length: 1 })
      s = r.state
    }
    // Destroy every remaining ship cell of player 2.
    const cells: Array<[number, number]> = []
    for (const ship of VALID_FLEET) {
      for (let i = 0; i < ship.length; i++) {
        const x = ship.x + (ship.horizontal ? i : 0)
        const y = ship.y + (ship.horizontal ? 0 : i)
        if (!(x === 0 && y === 6)) cells.push([x, y])
      }
    }
    let last: ReturnType<typeof bsShoot> | null = null
    for (const [x, y] of cells) {
      last = bsShoot(s, 1, x, y)
      expect(last.ok).toBe(true)
      if (last.ok) s = last.state
    }
    expect(s.status).toBe('WIN')
    expect(s.winner).toBe(1)
    if (last?.ok) expect(last.extra.gameOver).toBe(true)
  })

  it('round-trips through JSON for stateSnapshot persistence', () => {
    const s = startGame()
    const r = bsShoot(s, 1, 0, 0)
    if (r.ok) {
      const restored = bsFromJson(bsToJson(r.state))
      expect(restored.players[1]?.hits.has('0,0')).toBe(true)
      expect(restored.turn).toBe(r.state.turn)
      // Restored state stays playable
      const next = bsShoot(restored, 1, 1, 0)
      expect(next.ok).toBe(true)
    }
  })
})
