/**
 * Pure battleship engine. 10×10 board, classic fleet: 4-3-3-2-2-2-1-1-1-1.
 * No I/O — gateways own persistence.
 */

export interface Ship {
  x: number
  y: number
  length: number
  horizontal: boolean
}

export interface Shot {
  x: number
  y: number
  hit: boolean
}

export interface BsPlayerState {
  ships: Ship[]
  /** cells of own ships that have been hit, as "x,y" keys */
  hits: Set<string>
}

export interface BsState {
  players: [BsPlayerState | null, BsPlayerState | null] // index 0 = player1
  turn: 1 | 2
  status: 'PLACING' | 'IN_PROGRESS' | 'WIN'
  winner: 1 | 2 | null
  shots: [Shot[], Shot[]] // shots FIRED BY each player
}

export const BOARD_SIZE = 10
export const FLEET = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1] as const

export function shipCells(ship: Ship): Array<{ x: number; y: number }> {
  return Array.from({ length: ship.length }, (_, i) => ({
    x: ship.x + (ship.horizontal ? i : 0),
    y: ship.y + (ship.horizontal ? 0 : i),
  }))
}

/** Classic rules: ships inside the board, no touching (including diagonals). */
export function validatePlacement(ships: Ship[]): string | null {
  const lengths = ships
    .map((s) => s.length)
    .sort((a, b) => b - a)
    .join(',')
  if (lengths !== [...FLEET].join(',')) return 'invalid_fleet'

  const occupied = new Set<string>()
  for (const ship of ships) {
    for (const { x, y } of shipCells(ship)) {
      if (x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE) return 'out_of_bounds'
      if (occupied.has(`${x},${y}`)) return 'overlap'
    }
    for (const { x, y } of shipCells(ship)) occupied.add(`${x},${y}`)
  }

  // No-touch rule: expand each ship by 1 and ensure no other ship's cell is inside.
  for (const ship of ships) {
    const cells = new Set(shipCells(ship).map((c) => `${c.x},${c.y}`))
    for (const { x, y } of shipCells(ship)) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const key = `${x + dx},${y + dy}`
          if (!cells.has(key) && occupied.has(key)) return 'ships_touch'
        }
      }
    }
  }
  return null
}

export function bsCreate(firstTurn: 1 | 2): BsState {
  return { players: [null, null], turn: firstTurn, status: 'PLACING', winner: null, shots: [[], []] }
}

export type BsResult<T> = { ok: true; state: BsState; extra: T } | { ok: false; error: string }

export function bsPlaceShips(state: BsState, player: 1 | 2, ships: Ship[]): BsResult<null> {
  if (state.status !== 'PLACING') return { ok: false, error: 'not_placing_phase' }
  if (state.players[player - 1]) return { ok: false, error: 'already_placed' }
  const err = validatePlacement(ships)
  if (err) return { ok: false, error: err }

  const players = [...state.players] as BsState['players']
  players[player - 1] = { ships, hits: new Set() }
  const bothPlaced = players[0] !== null && players[1] !== null
  return {
    ok: true,
    state: { ...state, players, status: bothPlaced ? 'IN_PROGRESS' : 'PLACING' },
    extra: null,
  }
}

export interface ShotOutcome {
  hit: boolean
  sunk: Ship | null
  gameOver: boolean
}

export function bsShoot(state: BsState, player: 1 | 2, x: number, y: number): BsResult<ShotOutcome> {
  if (state.status !== 'IN_PROGRESS') return { ok: false, error: 'not_in_progress' }
  if (player !== state.turn) return { ok: false, error: 'not_your_turn' }
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE) {
    return { ok: false, error: 'out_of_bounds' }
  }
  const myShots = state.shots[player - 1]
  if (myShots.some((s) => s.x === x && s.y === y)) return { ok: false, error: 'already_shot' }

  const opponentIdx = player === 1 ? 1 : 0
  const opponent = state.players[opponentIdx]!
  const key = `${x},${y}`
  const hitShip = opponent.ships.find((ship) =>
    shipCells(ship).some((c) => c.x === x && c.y === y),
  )

  const hits = new Set(opponent.hits)
  if (hitShip) hits.add(key)

  const players = [...state.players] as BsState['players']
  players[opponentIdx] = { ...opponent, hits }

  const shots = [...state.shots] as BsState['shots']
  shots[player - 1] = [...myShots, { x, y, hit: !!hitShip }]

  const sunk =
    hitShip && shipCells(hitShip).every((c) => hits.has(`${c.x},${c.y}`)) ? hitShip : null

  const totalShipCells = opponent.ships.reduce((acc, s) => acc + s.length, 0)
  const gameOver = hits.size === totalShipCells

  return {
    ok: true,
    state: {
      ...state,
      players,
      shots,
      // hit = shoot again; miss = pass the turn
      turn: hitShip ? state.turn : ((player === 1 ? 2 : 1) as 1 | 2),
      status: gameOver ? 'WIN' : 'IN_PROGRESS',
      winner: gameOver ? player : null,
    },
    extra: { hit: !!hitShip, sunk, gameOver },
  }
}

// ── JSON (de)serialization for Match.stateSnapshot ──

export interface BsStateJson {
  players: Array<{ ships: Ship[]; hits: string[] } | null>
  turn: 1 | 2
  status: BsState['status']
  winner: 1 | 2 | null
  shots: [Shot[], Shot[]]
}

export function bsToJson(state: BsState): BsStateJson {
  return {
    players: state.players.map((p) => (p ? { ships: p.ships, hits: [...p.hits] } : null)),
    turn: state.turn,
    status: state.status,
    winner: state.winner,
    shots: state.shots,
  }
}

export function bsFromJson(json: BsStateJson): BsState {
  return {
    players: json.players.map((p) =>
      p ? { ships: p.ships, hits: new Set(p.hits) } : null,
    ) as BsState['players'],
    turn: json.turn,
    status: json.status,
    winner: json.winner,
    shots: json.shots,
  }
}
