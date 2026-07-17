'use client'

import { create } from 'zustand'
import type { WheelStateDto, WheelSpinDto, WheelTier } from '@/types/socket'

interface WheelStore {
  tier: WheelTier
  state: WheelStateDto | null
  spin: WheelSpinDto | null
  /** ms offset: serverTime - clientTime, for accurate countdowns */
  clockOffset: number
  setTier: (tier: WheelTier) => void
  applyState: (state: WheelStateDto) => void
  applySpin: (spin: WheelSpinDto) => void
  reset: () => void
}

/** Written exclusively by socket event handlers; components only read. */
export const useWheelStore = create<WheelStore>((set, get) => ({
  tier: 'LOW',
  state: null,
  spin: null,
  clockOffset: 0,
  setTier: (tier) => set({ tier, state: null, spin: null }),
  applyState: (state) => {
    const offset = new Date(state.serverTime).getTime() - Date.now()
    // New round arrived — clear the finished spin overlay.
    const spin = get().spin && get().spin!.roundId !== state.roundId ? null : get().spin
    set({ state, clockOffset: offset, spin })
  },
  applySpin: (spin) => set({ spin }),
  reset: () => set({ state: null, spin: null }),
}))
