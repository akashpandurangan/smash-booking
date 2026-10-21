import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Modal } from './ui.jsx'

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/** Month-grid date picker in a sheet. Days outside [min, max] are disabled. */
export default function CalendarPopup({ open, onClose, value, min, max, onPick, isDisabled }) {
  if (!open) return null
  return <Inner onClose={onClose} value={value} min={min} max={max} onPick={onPick} isDisabled={isDisabled} />
}

function Inner({ onClose, value, min, max, onPick, isDisabled }) {
  const [ym, setYm] = useState(() => ({ y: Number(value.slice(0, 4)), m: Number(value.slice(5, 7)) }))
  const first = new Date(Date.UTC(ym.y, ym.m - 1, 1))
  const offset = (first.getUTCDay() + 6) % 7 // Monday-first
  const days = new Date(Date.UTC(ym.y, ym.m, 0)).getUTCDate()
  const cells = [...Array(offset).fill(null), ...Array.from({ length: days }, (_, k) => k + 1)]
  const label = first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })

  const shift = (n) => {
    const d = new Date(Date.UTC(ym.y, ym.m - 1 + n, 1))
    setYm({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 })
  }
  const prevOk = iso(ym.y, ym.m, 1) > min.slice(0, 8) + '01' // there is a bookable day in an earlier month
  const nextOk = iso(ym.y, ym.m, days) < max

  return (
    <Modal open onClose={onClose} title="Pick a date">
      <div className="flex items-center justify-between">
        <button onClick={() => shift(-1)} disabled={!prevOk} aria-label="Previous month" className="grid size-11 place-items-center rounded-xl hover:bg-paper disabled:opacity-30"><ChevronLeft className="size-5" aria-hidden /></button>
        <p className="font-display text-lg font-bold" aria-live="polite">{label}</p>
        <button onClick={() => shift(1)} disabled={!nextOk} aria-label="Next month" className="grid size-11 place-items-center rounded-xl hover:bg-paper disabled:opacity-30"><ChevronRight className="size-5" aria-hidden /></button>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1 text-center" role="grid" aria-label={label}>
        {WEEK.map((w) => <span key={w} className="py-1 text-xs font-semibold text-muted" role="columnheader">{w}</span>)}
        {cells.map((d, i) => {
          if (!d) return <span key={`e${i}`} />
          const id = iso(ym.y, ym.m, d)
          const disabled = id < min || id > max || !!isDisabled?.(id)
          const on = id === value
          return (
            <button key={id} role="gridcell" disabled={disabled} aria-selected={on} aria-label={new Date(`${id}T00:00:00`).toDateString()}
              onClick={() => { onPick(id); onClose() }}
              className={`grid aspect-square place-items-center rounded-xl text-sm font-semibold transition-colors ${on ? 'bg-forest-900 text-volt-400' : disabled ? 'text-muted/40 line-through decoration-muted/30' : id === min ? 'ring-1 ring-forest-600 hover:bg-volt-300/50' : 'hover:bg-volt-300/50'}`}>
              {d}
            </button>
          )
        })}
      </div>
      <p className="mt-3 text-center text-xs text-muted">Struck-through dates are unavailable (past, closed or outside the booking window).</p>
    </Modal>
  )
}
