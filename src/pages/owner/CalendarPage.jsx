import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useFacility } from '../../context/contexts.js'
import { addDays, bookingSegments, fmt12, fmtDateLong, generateSlots, isClosedDay, toMin, todayISO } from '../../lib/time.js'
import { ACTIVE_STATUSES } from '../../lib/status.js'
import { Alert, Skeleton } from '../../components/ui.jsx'
import { useAdmin } from './OwnerLayout.jsx'
import BookingModal from './BookingModal.jsx'

const overlaps = (aS, aE, bS, bE) => toMin(aS) < toMin(bE) && toMin(aE) > toMin(bS)

/** Day view: every court × every half hour, showing who has booked what. */
export default function CalendarPage() {
  const { bookings, blocks, reload } = useAdmin()
  const { settings, courts } = useFacility()
  const [date, setDate] = useState(() => todayISO(settings.timezone))
  const [open, setOpen] = useState(null)
  const slots = useMemo(() => generateSlots(settings), [settings])
  const activeCourts = courts.filter((c) => c.isActive)

  const cell = (court, slot) => {
    const k = blocks.find((x) => x.courtId === court.id && x.date === date && overlaps(x.start, x.end, slot.start, slot.end))
    if (k) return { kind: 'blocked', label: k.reason || 'Blocked' }
    const b = (bookings || []).find((x) => x.date === date && ACTIVE_STATUSES.includes(x.status) && x.courtIds.includes(court.id) && bookingSegments(x).some((g) => overlaps(g.start, g.end, slot.start, slot.end)))
    if (b) return { kind: b.status === 'confirmed' ? 'confirmed' : 'pending', label: b.customerName, booking: b }
    return { kind: 'free' }
  }
  const live = bookings?.find((b) => b.id === open?.id)
  const closed = isClosedDay(settings, date)
  const STYLE = {
    free: 'bg-white text-muted/40', confirmed: 'bg-emerald-100 text-emerald-900 hover:bg-emerald-200', pending: 'bg-amber-100 text-amber-900 hover:bg-amber-200', blocked: 'hatch bg-slate-100 text-slate-600',
  }

  return (
    <div className="space-y-5">
      <div><h1 className="text-3xl font-extrabold">Calendar</h1><p className="text-muted">Court availability for any day. Tap a booking to open it.</p></div>
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <button onClick={() => setDate(addDays(date, -1))} className="grid size-11 place-items-center rounded-xl hover:bg-paper" aria-label="Previous day"><ChevronLeft className="size-5" aria-hidden /></button>
        <input type="date" className="input !w-auto" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Date" />
        <button onClick={() => setDate(addDays(date, 1))} className="grid size-11 place-items-center rounded-xl hover:bg-paper" aria-label="Next day"><ChevronRight className="size-5" aria-hidden /></button>
        <button onClick={() => setDate(todayISO(settings.timezone))} className="ml-auto rounded-xl px-3 py-2 text-sm font-semibold hover:bg-paper">Today</button>
      </div>
      <p className="font-semibold">{fmtDateLong(date)}{closed && <span className="ml-2 text-sm font-normal text-red-700">· closed (day off / holiday) — only manual bookings possible</span>}</p>
      {!bookings ? <Skeleton className="h-96" /> : !activeCourts.length ? <Alert tone="warn">You have no active courts.</Alert> : (
        <div className="card overflow-x-auto">
          <div className="grid min-w-[34rem]" style={{ gridTemplateColumns: `5.5rem repeat(${activeCourts.length}, minmax(7rem, 1fr))` }} role="table" aria-label="Court availability">
            <div className="sticky left-0 z-10 border-b border-line bg-paper p-2 text-xs font-semibold text-muted" role="columnheader">Time</div>
            {activeCourts.map((c) => <div key={c.id} className="border-b border-l border-line bg-paper p-2 text-center text-sm font-bold" role="columnheader">{c.name}</div>)}
            {slots.map((s) => (
              <div key={s.start} className="contents" role="row">
                <div className="sticky left-0 z-10 border-b border-line bg-white px-2 py-1.5 text-xs text-muted" role="rowheader">{fmt12(s.start)}</div>
                {activeCourts.map((c) => {
                  const x = cell(c, s)
                  return (
                    <button key={c.id} disabled={!x.booking} onClick={() => setOpen(x.booking)} role="cell"
                      className={`truncate border-b border-l border-line px-2 py-1.5 text-left text-xs font-medium ${STYLE[x.kind]} ${x.booking ? '' : 'cursor-default'}`}
                      aria-label={`${c.name} ${fmt12(s.start)} ${x.kind}${x.label ? ` ${x.label}` : ''}`}>
                      {x.kind === 'free' ? '·' : x.label}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted" aria-label="Legend">
        {[['bg-white ring-1 ring-line', 'Free'], ['bg-emerald-200', 'Confirmed'], ['bg-amber-200', 'Awaiting payment'], ['bg-slate-200 hatch', 'Blocked']].map(([c, l]) => <li key={l} className="flex items-center gap-1.5"><span className={`size-3 rounded-sm ${c}`} aria-hidden />{l}</li>)}
      </ul>
      <BookingModal booking={live} onClose={() => setOpen(null)} onChanged={reload} />
    </div>
  )
}
