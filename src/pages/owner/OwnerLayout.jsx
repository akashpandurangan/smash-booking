import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, NavLink, Outlet, useLocation, useOutletContext } from 'react-router-dom'
import { Activity, CreditCard, Globe } from 'lucide-react'
import { useAuth } from '../../context/contexts.js'
import { FacilityContext } from '../../context/contexts.js'
import { api } from '../../lib/api/index.js'
import { friendlyError } from '../../lib/errors.js'
import { FACILITY_STATUS } from '../../lib/status.js'
import { bookingUrl } from '../../lib/tenant.js'
import { ownerRefresh } from '../../lib/ownerRefresh.js'
import { Alert, Badge, Skeleton } from '../../components/ui.jsx'

export const useAdmin = () => useOutletContext()

// The main sections (Dashboard, Bookings, Courts, Availability, Settings) live in the header; these are the rest.
const LINKS = [
  ['/owner/payments', 'Payments', CreditCard],
  ['/owner/page', 'Booking page', Globe],
  ['/owner/activity', 'Activity log', Activity],
]

/**
 * Owner dashboard shell. "Owner" is not a flag on the user: access comes from a facility_members row,
 * loaded from the database (RLS shows each user only their own memberships).
 */
export default function OwnerLayout() {
  const { user, loading } = useAuth()
  const loc = useLocation()
  const [facilities, setFacilities] = useState(null)
  const [fid, setFid] = useState(null)
  const [data, setData] = useState(null) // { settings, courts }
  const [bookings, setBookings] = useState(null)
  const [blocks, setBlocks] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user) return
    api.owner.myFacilities().then((l) => { setFacilities(l); setFid((cur) => cur || l[0]?.id || null) }).catch((e) => { setFacilities([]); setError(friendlyError(e)) })
  }, [user])

  const reloadFacility = useCallback(async () => {
    if (!fid) return
    try { setData(await api.owner.facility(fid)) } catch (e) { setError(friendlyError(e)) }
  }, [fid])

  const reload = useCallback(async () => {
    if (!fid) return
    setError('')
    try {
      const [b, k] = await Promise.all([api.admin.listBookings(fid), api.admin.listBlocks(fid)])
      setBookings(b)
      setBlocks(k)
    } catch (e) {
      setError(friendlyError(e))
    }
  }, [fid])

  useEffect(() => { reloadFacility(); reload() }, [reloadFacility, reload])

  // Header "Refresh": reloads facility, courts, bookings, blocks (and the owner's facility list) from the database.
  const refreshAll = useCallback(async () => {
    if (!fid) return
    const [fl, d, b, k] = await Promise.all([api.owner.myFacilities(), api.owner.facility(fid), api.admin.listBookings(fid), api.admin.listBlocks(fid)])
    setFacilities(fl)
    setData(d)
    setBookings(b)
    setBlocks(k)
    setError('')
  }, [fid])
  useEffect(() => ownerRefresh.register(async () => {
    try { await refreshAll() } catch (e) { setError(friendlyError(e)); throw e }
  }), [refreshAll])
  const stamped = useRef(false)
  useEffect(() => {
    if (data && bookings && !stamped.current) { stamped.current = true; ownerRefresh.markFresh() }
  }, [data, bookings])

  const facilityCtx = useMemo(
    () => ({ settings: data?.settings || null, courts: data?.courts || [], banners: data?.banners || [], tenantState: 'live', loading: !data, error: null, reload: reloadFacility }),
    [data, reloadFacility],
  )

  if (loading || (user && facilities === null)) return <div className="container-page py-10"><Skeleton className="h-64" /></div>
  if (!user) return <Navigate to="/owner/login" state={{ from: loc.pathname }} replace />
  if (!facilities.length) return <Navigate to="/owner/setup" replace />
  const s = data?.settings
  const st = s && FACILITY_STATUS[s.status]

  return (
    <FacilityContext.Provider value={facilityCtx}>
      <div className="container-page py-6 sm:py-10 lg:grid lg:grid-cols-[230px_1fr] lg:gap-8">
        <nav aria-label="More owner pages" className="-mx-4 mb-6 flex gap-1.5 overflow-x-auto px-4 no-scrollbar lg:mx-0 lg:mb-0 lg:flex-col lg:px-0">
          <div className="mb-2 hidden px-3 lg:block">
            {facilities.length > 1 ? (
              <select aria-label="Facility" className="input !py-2 text-sm" value={fid || ''} onChange={(e) => { setData(null); setBookings(null); setFid(e.target.value) }}>
                {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            ) : <p className="truncate font-display text-lg font-bold">{s?.name || '…'}</p>}
            {st && <Badge tone={st.tone} className="mt-1.5">{st.label}</Badge>}
          </div>
          {LINKS.map(([to, label, Icon, end]) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) => `flex min-h-11 shrink-0 items-center gap-2.5 rounded-xl px-3.5 text-sm font-semibold transition-colors ${isActive ? 'bg-forest-900 text-white' : 'text-ink hover:bg-forest-900/5'}`}>
              <Icon className="size-4" aria-hidden />{label}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0">
          {s && (
            <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl bg-forest-900 px-4 py-3 text-sm text-white lg:hidden">
              <span className="font-display font-bold">{s.name}</span>
              {st && <Badge tone={st.tone}>{st.label}</Badge>}
              <span className="truncate text-volt-400">{bookingUrl(s.slug).replace(/^https?:\/\//, '')}</span>
            </div>
          )}
          {s?.status === 'suspended' && <Alert tone="error" title="Your booking page is suspended" className="mb-4">{s.suspendedReason ? `Reason: ${s.suspendedReason}. ` : ''}Players can’t book until a platform administrator reactivates it.</Alert>}
          {s?.status === 'pending' && <Alert tone="warn" title="Awaiting approval" className="mb-4">A platform administrator is reviewing your facility. You can preview your page, but players can’t book yet.</Alert>}
          {error && <Alert tone="error" className="mb-4">{error} <button className="font-semibold underline" onClick={() => { setError(''); reloadFacility(); reload() }}>Retry</button></Alert>}
          {!data ? <Skeleton className="h-64" /> : <Outlet context={{ bookings, blocks, reload, reloadFacility }} />}
        </div>
      </div>
    </FacilityContext.Provider>
  )
}
