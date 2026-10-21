// Tiny shared store so the header's Refresh button can drive the owner dashboard (which owns the data).
// OwnerLayout registers a loader; the button runs it with a busy flag, a last-refreshed time and an error.
import { useSyncExternalStore } from 'react'
import { friendlyError } from './errors.js'

const COOLDOWN_MS = 1000 // blocks accidental rapid double-clicks
let state = { handler: null, busy: false, at: null, error: '', lastRun: 0 }
const subs = new Set()
const set = (patch) => { state = { ...state, ...patch }; subs.forEach((f) => f()) }

export const ownerRefresh = {
  /** Called by OwnerLayout. Returns an unregister function. */
  register(handler) {
    set({ handler, error: '' })
    return () => { if (state.handler === handler) set({ handler: null, busy: false }) }
  },
  /** Data was just loaded by someone else (initial load): stamp the time. */
  markFresh() { set({ at: new Date(), error: '' }) },
  async run() {
    if (!state.handler || state.busy || Date.now() - state.lastRun < COOLDOWN_MS) return
    set({ busy: true, error: '', lastRun: Date.now() })
    try {
      await state.handler()
      set({ at: new Date(), error: '' })
    } catch (e) {
      set({ error: friendlyError(e) })
    } finally {
      set({ busy: false })
    }
  },
}

const subscribe = (cb) => { subs.add(cb); return () => subs.delete(cb) }
export const useOwnerRefresh = () => useSyncExternalStore(subscribe, () => state)
