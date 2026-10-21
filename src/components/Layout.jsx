import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { CalendarDays, ChevronDown, LayoutDashboard, LogOut, Ticket, User, FlaskConical, RotateCcw, MapPin, Clock, Phone, Mail, ShieldCheck, Eye, Building2, SearchX, PauseCircle, RefreshCw } from 'lucide-react'
import { useAuth, useFacility } from '../context/contexts.js'
import { api } from '../lib/api/index.js'
import { demoHint, isDemo, LOGO_URL, PLATFORM_NAME } from '../lib/config.js'
import { TENANT, platformUrl } from '../lib/tenant.js'
import { ownerRefresh, useOwnerRefresh } from '../lib/ownerRefresh.js'
import { lastFacility } from '../lib/lastFacility.js'
import { fmt12 } from '../lib/time.js'
import { Alert, Button, EmptyState, Skeleton } from './ui.jsx'

function DemoBanner() {
  if (!isDemo) return null
  return (
    <div className="bg-amber-300 text-forest-950">
      <div className="container-page flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[13px] font-medium">
        <FlaskConical className="size-4 shrink-0" aria-hidden />
        <span>
          <strong>DEMO MODE</strong> — sample data kept only in this browser. No real bookings, payments, emails or SMS.
        </span>
        {demoHint && <span className="basis-full text-[12px] font-normal" role="note">{demoHint}</span>}
        <button onClick={() => { api.resetDemo(); window.location.assign(TENANT.basename || '/') }} className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold underline-offset-2 hover:underline">
          <RotateCcw className="size-3.5" aria-hidden /> Reset demo
        </button>
      </div>
    </div>
  )
}

/** Account dropdown. Tenant sites show player links; the platform site shows owner / admin links. */
function AccountMenu({ platform }) {
  const { user, signOut, isPlatformAdmin, isOwner } = useAuth()
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
    return platform ? (
      <Link to="/owner/login" className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-volt-400 px-4 text-sm font-semibold text-forest-950 hover:bg-volt-300">
        <Building2 className="size-4" aria-hidden /> Owner login
      </Link>
    ) : (
      <Link to="/auth" state={{ from: loc.pathname }} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-volt-400 px-4 text-sm font-semibold text-forest-950 hover:bg-volt-300">
        <User className="size-4" aria-hidden /> Log in
      </Link>
    )
  }
  const initial = (user.name || user.email || '?').trim()[0].toUpperCase()
  const item = 'flex items-center gap-2.5 px-4 py-3 text-sm hover:bg-paper'
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
            <p className="mt-1 text-xs font-semibold text-volt-700">{isPlatformAdmin ? 'Platform administrator' : isOwner ? 'Facility owner' : 'Player'}</p>
          </div>
          {platform ? (
            <>
              {isOwner && <Link role="menuitem" to="/owner" className={item}><LayoutDashboard className="size-4" aria-hidden /> Owner dashboard</Link>}
              {isPlatformAdmin && <Link role="menuitem" to="/platform" className={item}><ShieldCheck className="size-4" aria-hidden /> Platform admin</Link>}
              {!isOwner && lastFacility() && <a role="menuitem" href={`/book/${lastFacility()}/bookings`} className={item}><Ticket className="size-4" aria-hidden /> My bookings</a>}
            </>
          ) : (
            <>
              <Link role="menuitem" to="/bookings" className={item}><Ticket className="size-4" aria-hidden /> My bookings</Link>
              {/* owner-only actions are never shown to players */}
              {isOwner && <a role="menuitem" href={platformUrl('/owner')} className={item}><LayoutDashboard className="size-4" aria-hidden /> Owner dashboard</a>}
            </>
          )}
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

function Brand({ name, logo }) {
  return (
    <Link to="/" className="flex min-w-0 items-center gap-3" aria-label={`${name} — home`}>
      <img src={logo || LOGO_URL} alt="" width="36" height="36" className="size-9 shrink-0 rounded-xl object-cover" />
      <span className="truncate font-display text-lg font-bold tracking-tight">{name}</span>
    </Link>
  )
}

/* ============================ tenant (facility) site ============================ */
function TenantHeader() {
  const { settings } = useFacility()
  return (
    <header className="on-dark sticky top-0 z-30 bg-forest-900 text-white">
      <div className="container-page flex h-16 items-center gap-6">
        <Brand name={settings?.name || PLATFORM_NAME} logo={settings?.logoUrl} />
        <nav className="ml-4 hidden items-center gap-1 sm:flex" aria-label="Main">
          <NavLink to="/" end className={navCls}><CalendarDays className="size-4" aria-hidden /> Book a Court</NavLink>
          <NavLink to="/bookings" className={navCls}><Ticket className="size-4" aria-hidden /> My Bookings</NavLink>
        </nav>
        <div className="ml-auto"><AccountMenu /></div>
      </div>
      <nav className="container-page flex gap-1 pb-2 sm:hidden" aria-label="Main">
        <NavLink to="/" end className={navCls}><CalendarDays className="size-4" aria-hidden /> Book a Court</NavLink>
        <NavLink to="/bookings" className={navCls}><Ticket className="size-4" aria-hidden /> My Bookings</NavLink>
      </nav>
    </header>
  )
}

function TenantFooter() {
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
          <li className="flex gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-volt-400" aria-hidden />{[settings.address, settings.city].filter(Boolean).join(', ') || 'Address not set yet'}</li>
          <li className="flex gap-2"><Clock className="mt-0.5 size-4 shrink-0 text-volt-400" aria-hidden />Open daily {fmt12(settings.openingTime)} – {fmt12(settings.closingTime)}</li>
        </ul>
        <ul className="space-y-2 text-sm">
          <li className="flex gap-2"><Phone className="mt-0.5 size-4 shrink-0 text-volt-400" aria-hidden />{settings.contactPhone || 'Phone not set yet'}</li>
          <li className="flex gap-2"><Mail className="mt-0.5 size-4 shrink-0 text-volt-400" aria-hidden />{settings.contactEmail || 'Email not set yet'}</li>
        </ul>
      </div>
      <div className="container-page border-t border-white/10 py-4 text-xs">
        Booking powered by <a href={platformUrl('/')} className="font-semibold text-white hover:underline">{PLATFORM_NAME}</a>
        {' · '}<a href={platformUrl('/owner/login')} className="hover:underline">Facility owner login</a>
      </div>
    </footer>
  )
}

/** What a visitor sees when the subdomain does not map to a bookable facility. */
function TenantUnavailable({ state }) {
  const content = {
    not_found: { icon: SearchX, title: 'This booking page doesn’t exist', text: `We couldn’t find a facility at “${TENANT.slug || 'this address'}”. Check the link, or browse facilities on ${PLATFORM_NAME}.` },
    not_live: { icon: Clock, title: 'This booking page isn’t live yet', text: 'The facility is still being set up or is awaiting approval. Please check back soon.' },
    suspended: { icon: PauseCircle, title: 'Bookings are paused', text: 'This facility is temporarily unavailable. Please contact the facility directly.' },
  }[state] || { icon: SearchX, title: 'Not available', text: '' }
  return (
    <div className="container-page max-w-xl py-16">
      <EmptyState icon={content.icon} title={content.title} action={<Button as="a" href={platformUrl('/')} variant="dark">Go to {PLATFORM_NAME}</Button>}>{content.text}</EmptyState>
    </div>
  )
}

export function Layout() {
  const { pathname } = useLocation()
  const { tenantState, loading, error, reload, settings } = useFacility()
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])

  let body
  if (loading && !settings && tenantState === 'loading') body = <div className="container-page space-y-4 py-10" aria-busy><Skeleton className="h-56" /><Skeleton className="h-96" /></div>
  else if (error && !settings) body = <div className="container-page py-16"><Alert tone="error" title="We couldn’t load this facility">{error} <button className="font-semibold underline" onClick={reload}>Try again</button></Alert></div>
  else if (!['live', 'preview'].includes(tenantState)) body = <TenantUnavailable state={tenantState} />
  else body = <Outlet />

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-volt-400 focus:px-4 focus:py-2 focus:font-semibold">Skip to content</a>
      <DemoBanner />
      {tenantState === 'preview' && (
        <div className="bg-sky-100 text-sky-950">
          <div className="container-page flex items-center gap-2 py-2 text-[13px] font-medium"><Eye className="size-4 shrink-0" aria-hidden />Preview — this page is not public yet ({settings?.status === 'pending' ? 'awaiting approval' : settings?.status}). Only you can see it.</div>
        </div>
      )}
      <TenantHeader />
      <main id="main" className="flex-1">{body}</main>
      <TenantFooter />
    </div>
  )
}

/* ============================ platform site (primary domain) ============================ */
const OWNER_CHIPS = [
  ['/owner', 'Dashboard', true],
  ['/owner/bookings', 'Bookings'],
  ['/owner/courts', 'Courts'],
  ['/owner/calendar', 'Availability'],
  ['/owner/settings', 'Settings'],
]

/** Header Refresh for the owner dashboard: reloads stats, bookings and availability from the database. */
function RefreshButton() {
  const r = useOwnerRefresh()
  if (!r.handler) return null
  const at = r.at ? r.at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : null
  return (
    <button onClick={() => ownerRefresh.run()} disabled={r.busy} aria-busy={r.busy}
      title={r.error ? `Refresh failed: ${r.error}` : at ? `Last refreshed ${at}` : 'Reload dashboard data'}
      className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-sm font-medium hover:bg-white/10 disabled:opacity-60 ${r.error ? 'border-red-300 text-red-200' : 'border-white/15 text-white'}`}>
      <RefreshCw className={`size-4 ${r.busy ? 'animate-spin' : ''}`} aria-hidden />
      <span className="hidden sm:inline">{r.busy ? 'Refreshing…' : r.error ? 'Retry' : 'Refresh'}</span>
      {at && !r.busy && !r.error && <span className="hidden text-xs text-white/60 lg:inline">{at}</span>}
      <span className="sr-only" role="status">{r.busy ? 'Refreshing dashboard data' : r.error ? 'Refresh failed' : at ? `Last refreshed ${at}` : ''}</span>
    </button>
  )
}

export function PlatformLayout() {
  const { pathname } = useLocation()
  const { user, isOwner, ownedFacilities, rolesLoading } = useAuth()
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
  // Owner navigation only appears for a real facility owner, inside the owner area; everyone else sees the public navigation.
  const inOwnerArea = isOwner && /^\/owner(\/(bookings|courts|calendar|settings|payments|page|activity))?\/?$/.test(pathname)
  const brandName = inOwnerArea && ownedFacilities.length === 1 ? ownedFacilities[0].name : PLATFORM_NAME
  const chips = OWNER_CHIPS.map(([to, label, end]) => <NavLink key={to} to={to} end={end} className={navCls}>{label}</NavLink>)
  const publicLinks = (
    <>
      <NavLink to="/" end className={navCls}>Find courts</NavLink>
      {isOwner ? <NavLink to="/owner" className={navCls}>Dashboard</NavLink> : !user && <NavLink to="/owner/register" className={navCls}>List your facility</NavLink>}
    </>
  )
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-volt-400 focus:px-4 focus:py-2 focus:font-semibold">Skip to content</a>
      <DemoBanner />
      <header className="on-dark sticky top-0 z-30 bg-forest-900 text-white">
        <div className="container-page flex h-16 items-center gap-4">
          <Brand name={brandName} />
          <nav className="ml-2 hidden items-center gap-1 sm:flex" aria-label="Main">{inOwnerArea ? chips : publicLinks}</nav>
          <div className="ml-auto flex items-center gap-2">
            {inOwnerArea && <RefreshButton />}
            {!rolesLoading && <AccountMenu platform />}
          </div>
        </div>
        <nav className="container-page flex gap-1 overflow-x-auto pb-2 no-scrollbar sm:hidden" aria-label="Main">{inOwnerArea ? chips : publicLinks}</nav>
      </header>
      <main id="main" className="flex-1"><Outlet /></main>
      <footer className="on-dark bg-forest-950 py-8 text-sm text-white/70">
        <div className="container-page flex flex-wrap items-center justify-between gap-3">
          <p><strong className="text-white">{PLATFORM_NAME}</strong> — online court booking for badminton facilities.</p>
          <p className="flex gap-4">{!isOwner && <Link to="/owner/register" className="hover:underline">List your facility</Link>}<Link to="/owner/login" className="hover:underline">Owner login</Link></p>
        </div>
      </footer>
    </div>
  )
}
