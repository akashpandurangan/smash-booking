import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { CalendarDays, ChevronDown, LayoutDashboard, LogOut, Ticket, User, FlaskConical, RotateCcw, MapPin, Clock, Phone, Mail } from 'lucide-react'
import { useAuth, useFacility } from '../context/contexts.js'
import { api } from '../lib/api/index.js'
import { isDemo, LOGO_TEXT } from '../lib/config.js'
import { fmt12 } from '../lib/time.js'

function DemoBanner() {
  if (!isDemo) return null
  return (
    <div className="bg-amber-300 text-forest-950">
      <div className="container-page flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[13px] font-medium">
        <FlaskConical className="size-4 shrink-0" aria-hidden />
        <span>
          <strong>DEMO MODE</strong> — sample data kept only in this browser tab. No real bookings, payments, emails or SMS.
        </span>
        <button onClick={() => { api.resetDemo(); window.location.assign('/') }} className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold underline-offset-2 hover:underline">
          <RotateCcw className="size-3.5" aria-hidden /> Reset demo
        </button>
      </div>
    </div>
  )
}

function AccountMenu() {
  const { user, signOut, isOwner } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const navigate = useNavigate()
  const loc = useLocation()

  useEffect(() => { setOpen(false) }, [loc.pathname])
  useEffect(() => {
    if (!open) return undefined
    const away = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const esc = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [open])

  if (!user) {
    return (
      <Link to="/auth" state={{ from: loc.pathname }} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-volt-400 px-4 text-sm font-semibold text-forest-950 hover:bg-volt-300">
        <User className="size-4" aria-hidden /> Log in
      </Link>
    )
  }
  const initial = (user.name || user.email || '?').trim()[0].toUpperCase()
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu"
        className="flex min-h-10 items-center gap-2 rounded-xl border border-white/15 py-1 pl-1 pr-2.5 text-sm text-white hover:bg-white/10">
        <span className="grid size-8 place-items-center rounded-lg bg-volt-400 font-bold text-forest-950">{initial}</span>
        <span className="hidden max-w-32 truncate sm:block">{user.name || user.email}</span>
        <ChevronDown className="size-4 opacity-70" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="sheet absolute right-0 z-40 mt-2 w-60 overflow-hidden rounded-2xl border border-line bg-white text-ink shadow-lift">
          <div className="border-b border-line px-4 py-3">
            <p className="truncate text-sm font-semibold">{user.name || 'Your account'}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
            {isOwner && <p className="mt-1 text-xs font-semibold text-volt-700">Owner account</p>}
          </div>
          <Link role="menuitem" to="/bookings" className="flex items-center gap-2.5 px-4 py-3 text-sm hover:bg-paper"><Ticket className="size-4" aria-hidden /> My bookings</Link>
          {isOwner && <Link role="menuitem" to="/admin" className="flex items-center gap-2.5 px-4 py-3 text-sm hover:bg-paper"><LayoutDashboard className="size-4" aria-hidden /> Owner dashboard</Link>}
          <button role="menuitem" onClick={async () => { await signOut(); navigate('/') }} className="flex w-full items-center gap-2.5 border-t border-line px-4 py-3 text-left text-sm text-red-700 hover:bg-red-50">
            <LogOut className="size-4" aria-hidden /> Log out
          </button>
        </div>
      )}
    </div>
  )
}

const navCls = ({ isActive }) =>
  `inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors ${isActive ? 'bg-white/12 text-white' : 'text-white/70 hover:text-white'}`

export function Header() {
  const { settings } = useFacility()
  const { isOwner } = useAuth()
  return (
    <header className="on-dark sticky top-0 z-30 bg-forest-900 text-white">
      <div className="container-page flex h-16 items-center gap-6">
        <Link to="/" className="flex items-center gap-3" aria-label={`${settings?.name || 'Home'} — home`}>
          <span className="grid size-9 place-items-center rounded-xl bg-volt-400 font-display text-sm font-extrabold text-forest-950">{LOGO_TEXT}</span>
          <span className="font-display text-lg font-bold tracking-tight">{settings?.name || 'Court Booking'}</span>
        </Link>
        <nav className="ml-4 hidden items-center gap-1 sm:flex" aria-label="Main">
          <NavLink to="/" end className={navCls}><CalendarDays className="size-4" aria-hidden /> Book a Court</NavLink>
          <NavLink to="/bookings" className={navCls}><Ticket className="size-4" aria-hidden /> My Bookings</NavLink>
          {isOwner && <NavLink to="/admin" className={navCls}><LayoutDashboard className="size-4" aria-hidden /> Owner</NavLink>}
        </nav>
        <div className="ml-auto"><AccountMenu /></div>
      </div>
      <nav className="container-page flex gap-1 pb-2 sm:hidden" aria-label="Main">
        <NavLink to="/" end className={navCls}><CalendarDays className="size-4" aria-hidden /> Book a Court</NavLink>
        <NavLink to="/bookings" className={navCls}><Ticket className="size-4" aria-hidden /> My Bookings</NavLink>
        {isOwner && <NavLink to="/admin" className={navCls}><LayoutDashboard className="size-4" aria-hidden /> Owner</NavLink>}
      </nav>
    </header>
  )
}

export function Footer() {
  const { settings } = useFacility()
  if (!settings) return null
  return (
    <footer className="on-dark mt-16 bg-forest-950 pb-28 text-white/70 sm:pb-10">
      <div className="container-page grid gap-8 py-10 sm:grid-cols-3">
        <div>
          <p className="font-display text-lg font-bold text-white">{settings.name}</p>
          <p className="mt-1 text-sm">{settings.tagline}</p>
        </div>
        <ul className="space-y-2 text-sm">
          <li className="flex gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-volt-400" aria-hidden />{settings.address}</li>
          <li className="flex gap-2"><Clock className="mt-0.5 size-4 shrink-0 text-volt-400" aria-hidden />Open daily {fmt12(settings.openingTime)} – {fmt12(settings.closingTime)}</li>
        </ul>
        <ul className="space-y-2 text-sm">
          <li className="flex gap-2"><Phone className="mt-0.5 size-4 shrink-0 text-volt-400" aria-hidden />{settings.contactPhone || 'Phone not set yet'}</li>
          <li className="flex gap-2"><Mail className="mt-0.5 size-4 shrink-0 text-volt-400" aria-hidden />{settings.contactEmail || 'Email not set yet'}</li>
        </ul>
      </div>
    </footer>
  )
}

export function Layout() {
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-volt-400 focus:px-4 focus:py-2 focus:font-semibold">Skip to content</a>
      <DemoBanner />
      <Header />
      <main id="main" className="flex-1"><Outlet /></main>
      <Footer />
    </div>
  )
}
