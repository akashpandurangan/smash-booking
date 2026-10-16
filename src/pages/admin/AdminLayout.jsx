import { useCallback, useEffect, useState } from 'react'
import { Navigate, NavLink, Outlet, useLocation, useOutletContext } from 'react-router-dom'
import { Activity, CalendarCheck, LayoutDashboard, Settings, ShieldOff, Wrench } from 'lucide-react'
import { useAuth, useFacility } from '../../context/contexts.js'
import { api } from '../../lib/api/index.js'
import { friendlyError } from '../../lib/errors.js'
import { Alert, Button, EmptyState, Skeleton } from '../../components/ui.jsx'

export const useAdmin = () => useOutletContext()

const LINKS = [
  ['/admin', 'Overview', LayoutDashboard, true],
  ['/admin/bookings', 'Bookings', CalendarCheck],
  ['/admin/courts', 'Courts & blocks', Wrench],
  ['/admin/settings', 'Settings', Settings],
  ['/admin/activity', 'Activity log', Activity],
]

export default function AdminLayout() {
  const { user, loading, isOwner } = useAuth()
  const { settings } = useFacility()
  const loc = useLocation()
  const [bookings, setBookings] = useState(null)
  const [blocks, setBlocks] = useState([])
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    setError('')
    try {
      const [b, k] = await Promise.all([api.admin.listBookings(), api.admin.listBlocks()])
      setBookings(b)
      setBlocks(k)
    } catch (e) {
      setError(friendlyError(e))
    }
  }, [])

  // Data is only requested for owner accounts; RLS/RPC checks reject anyone else regardless of this flag.
  useEffect(() => { if (isOwner) reload() }, [isOwner, reload])

  if (loading || !settings) return <div className="container-page py-10"><Skeleton className="h-64" /></div>
  if (!user) return <Navigate to="/auth" state={{ from: loc.pathname }} replace />
  if (!isOwner) {
    return (
      <div className="container-page max-w-xl py-12">
        <EmptyState icon={ShieldOff} title="Owner access only" action={<Button to="/" variant="dark">Back to booking</Button>}>
          This area is restricted to the facility owner account.
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="container-page py-6 sm:py-10 lg:grid lg:grid-cols-[220px_1fr] lg:gap-8">
      <nav aria-label="Owner" className="-mx-4 mb-6 flex gap-1.5 overflow-x-auto px-4 no-scrollbar lg:mx-0 lg:mb-0 lg:flex-col lg:px-0">
        <p className="mb-2 hidden px-3 text-xs font-bold uppercase tracking-wider text-muted lg:block">Owner dashboard</p>
        {LINKS.map(([to, label, Icon, end]) => (
          <NavLink key={to} to={to} end={end}
            className={({ isActive }) => `flex min-h-11 shrink-0 items-center gap-2.5 rounded-xl px-3.5 text-sm font-semibold transition-colors ${isActive ? 'bg-forest-900 text-white' : 'text-ink hover:bg-forest-900/5'}`}>
            <Icon className="size-4" aria-hidden />{label}
          </NavLink>
        ))}
      </nav>
      <div className="min-w-0">
        {error && <Alert tone="error" className="mb-4">{error} <button className="font-semibold underline" onClick={reload}>Retry</button></Alert>}
        <Outlet context={{ bookings, blocks, reload }} />
      </div>
    </div>
  )
}
