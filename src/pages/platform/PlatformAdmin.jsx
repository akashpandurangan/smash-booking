import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, NavLink, Outlet, useLocation, useOutletContext } from 'react-router-dom'
import { BarChart3, Building2, ExternalLink, Pencil, PlayCircle, ShieldAlert, ShieldCheck, ShieldOff, Users, Settings as Cog, PauseCircle } from 'lucide-react'
import { useAuth, useToast } from '../../context/contexts.js'
import { api } from '../../lib/api/index.js'
import { friendlyError } from '../../lib/errors.js'
import { FACILITY_STATUS } from '../../lib/status.js'
import { cleanSlugInput, isValidSlug } from '../../lib/slug.js'
import { ROOT_DOMAIN, workingUrl } from '../../lib/tenant.js'
import { fmtDate, money } from '../../lib/time.js'
import { Alert, Badge, Button, ConfirmDialog, EmptyState, Field, Modal, Skeleton, Stat } from '../../components/ui.jsx'

const useP = () => useOutletContext()
const LINKS = [['/platform', 'Overview', BarChart3, true], ['/platform/facilities', 'Facilities', Building2], ['/platform/owners', 'Owners', Users], ['/platform/settings', 'Settings', Cog]]

/** Platform administration. Access = a row in platform_admins (checked by the database on every call). */
export function PlatformAdminLayout() {
  const { user, loading } = useAuth()
  const loc = useLocation()
  const [facilities, setFacilities] = useState(null)
  const [error, setError] = useState('')
  const [denied, setDenied] = useState(false)

  const reload = useCallback(async () => {
    setError('')
    try { setFacilities(await api.platform.listFacilities()) } catch (e) { if (/forbidden/.test(e.message)) setDenied(true); else setError(friendlyError(e)) }
  }, [])
  useEffect(() => { if (user) reload() }, [user, reload])

  if (loading) return <div className="container-page py-10"><Skeleton className="h-64" /></div>
  if (!user) return <Navigate to="/owner/login" state={{ from: loc.pathname }} replace />
  if (denied || (!user.isPlatformAdmin && !facilities)) {
    return <div className="container-page max-w-xl py-12"><EmptyState icon={ShieldOff} title="Platform administrators only" action={<Button to="/owner" variant="dark">Back to my dashboard</Button>}>Your account isn’t on the platform administrator list. Administrators are added explicitly — registering never grants this access.</EmptyState></div>
  }
  return (
    <div className="container-page py-6 sm:py-10 lg:grid lg:grid-cols-[220px_1fr] lg:gap-8">
      <nav aria-label="Platform admin" className="-mx-4 mb-6 flex gap-1.5 overflow-x-auto px-4 no-scrollbar lg:mx-0 lg:mb-0 lg:flex-col lg:px-0">
        <p className="mb-2 hidden px-3 text-xs font-bold uppercase tracking-wider text-muted lg:block">Platform admin</p>
        {LINKS.map(([to, label, Icon, end]) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `flex min-h-11 shrink-0 items-center gap-2.5 rounded-xl px-3.5 text-sm font-semibold ${isActive ? 'bg-forest-900 text-white' : 'text-ink hover:bg-forest-900/5'}`}><Icon className="size-4" aria-hidden />{label}</NavLink>
        ))}
      </nav>
      <div className="min-w-0">
        {error && <Alert tone="error" className="mb-4">{error} <button className="font-semibold underline" onClick={reload}>Retry</button></Alert>}
        {!facilities ? <Skeleton className="h-64" /> : <Outlet context={{ facilities, reload }} />}
      </div>
    </div>
  )
}

export function AdminOverview() {
  const { facilities, reload } = useP()
  const toast = useToast()
  const [m, setM] = useState(null)
  useEffect(() => { api.platform.metrics().then(setM).catch(() => setM({})) }, [facilities])
  const pending = facilities.filter((f) => f.status === 'pending')
  const approve = async (f) => { await api.platform.setStatus(f.id, 'active'); toast(`${f.name} approved`); reload() }
  return (
    <div className="space-y-8">
      <div><h1 className="text-3xl font-extrabold">Platform overview</h1><p className="text-muted">Usage across every facility.</p></div>
      {!m ? <Skeleton className="h-40" /> : (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Stat icon={Building2} label="Facilities" value={m.facilities ?? 0} hint={`${m.facilitiesActive ?? 0} live · ${m.facilitiesPending ?? 0} pending · ${m.facilitiesSuspended ?? 0} suspended`} />
          <Stat icon={Users} label="Owners" value={m.owners ?? 0} hint={`${m.players ?? 0} players have booked`} />
          <Stat icon={BarChart3} label="Bookings" value={m.ordersTotal ?? 0} hint={`${m.ordersConfirmed ?? 0} confirmed · ${m.ordersLast30d ?? 0} in 30 days`} />
          <Stat icon={ShieldCheck} label="Verified revenue" value={money(m.verifiedRevenue ?? 0)} hint="Online, server-verified" />
        </div>
      )}
      <section>
        <h2 className="mb-3 text-xl font-bold">Awaiting approval</h2>
        {!pending.length ? <EmptyState icon={ShieldCheck} title="Nothing to approve">New facilities appear here when approval is required (Settings).</EmptyState> : (
          <ul className="space-y-2">{pending.map((f) => (
            <li key={f.id} className="card flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1"><p className="font-semibold">{f.name} <span className="font-mono text-xs font-normal text-muted">{f.slug}.{ROOT_DOMAIN}</span></p><p className="text-sm text-muted">{f.city} · {f.ownerEmail}</p></div>
              <Button size="sm" onClick={() => approve(f)}><PlayCircle className="size-4" aria-hidden />Approve</Button>
            </li>))}</ul>
        )}
      </section>
    </div>
  )
}

export function AdminFacilities() {
  const { facilities, reload } = useP()
  const toast = useToast()
  const [q, setQ] = useState('')
  const [suspend, setSuspend] = useState(null)
  const [slugFor, setSlugFor] = useState(null)
  const [limitFor, setLimitFor] = useState(null)
  const rows = useMemo(() => facilities.filter((f) => !q || `${f.name} ${f.slug} ${f.ownerEmail} ${f.city}`.toLowerCase().includes(q.toLowerCase())), [facilities, q])
  const setStatus = async (f, status, reason) => { await api.platform.setStatus(f.id, status, reason); toast(`${f.name}: ${FACILITY_STATUS[status].label.toLowerCase()}`); reload() }

  return (
    <div className="space-y-5">
      <div><h1 className="text-3xl font-extrabold">Facilities</h1><p className="text-muted">Approve, suspend or reactivate facilities and resolve address requests.</p></div>
      <div className="card p-4"><Field label="Search"><input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, address, city or owner email" /></Field></div>
      {!rows.length ? <EmptyState icon={Building2} title="No facilities match">Try a different search.</EmptyState> : (
        <ul className="space-y-3">
          {rows.map((f) => {
            const st = FACILITY_STATUS[f.status]
            return (
              <li key={f.id} className="card p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-display text-lg font-bold">{f.name} <Badge tone={st.tone} className="ml-1 align-middle">{st.label}</Badge></p>
                    <p className="font-mono text-xs text-forest-600">{f.slug}.{ROOT_DOMAIN}</p>
                    <p className="mt-1 text-sm text-muted">{f.city} · {f.ownerName || 'owner'} ({f.ownerEmail}) · created {fmtDate(f.createdAt.slice(0, 10))}</p>
                    <p className="text-sm text-muted">{f.courts}/{f.maxCourts} courts · {f.orders} bookings · {money(f.verifiedRevenue)} verified</p>
                    {f.suspendedReason && <p className="mt-1 text-sm text-red-700">Suspended: {f.suspendedReason}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {f.status === 'pending' && <Button size="sm" onClick={() => setStatus(f, 'active')}><PlayCircle className="size-4" aria-hidden />Approve</Button>}
                    {f.status === 'suspended' && <Button size="sm" onClick={() => setStatus(f, 'active')}><PlayCircle className="size-4" aria-hidden />Reactivate</Button>}
                    {f.status !== 'suspended' && <Button size="sm" variant="dangerOutline" onClick={() => setSuspend(f)}><PauseCircle className="size-4" aria-hidden />Suspend</Button>}
                    <Button size="sm" variant="outline" onClick={() => setSlugFor(f)}><Pencil className="size-4" aria-hidden />Address</Button>
                    <Button size="sm" variant="outline" onClick={() => setLimitFor(f)}>Limits</Button>
                    <Button as="a" size="sm" variant="ghost" href={workingUrl(f.slug)} target="_blank" rel="noreferrer" aria-label={`Open ${f.name}`}><ExternalLink className="size-4" aria-hidden /></Button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <ConfirmDialog open={!!suspend} onClose={() => setSuspend(null)} title={`Suspend ${suspend?.name}?`} tone="danger" confirmLabel="Suspend facility" requireReason reasonLabel="Reason (shown to the owner)"
        message="Its booking page stops accepting bookings immediately and leaves the public directory. Existing bookings are kept."
        onConfirm={async (reason) => { await setStatus(suspend, 'suspended', reason); setSuspend(null) }} />
      {slugFor && <SlugDialog facility={slugFor} onClose={() => setSlugFor(null)} onDone={() => { setSlugFor(null); reload() }} />}
      {limitFor && <LimitDialog facility={limitFor} onClose={() => setLimitFor(null)} onDone={() => { setLimitFor(null); reload() }} />}
    </div>
  )
}

function SlugDialog({ facility, onClose, onDone }) {
  const toast = useToast()
  const [slug, setSlug] = useState(facility.slug)
  const [info, setInfo] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (slug === facility.slug || !isValidSlug(slug)) return undefined
    const t = setTimeout(() => api.owner.checkSlugs([slug]).then((r) => setInfo(r[0])).catch(() => setInfo(null)), 300)
    return () => clearTimeout(t)
  }, [slug, facility.slug])
  const same = slug === facility.slug
  const ok = !same && isValidSlug(slug) && info?.slug === slug && info.available
  const save = async () => { setBusy(true); setErr(''); try { await api.platform.setSlug(facility.id, slug); toast('Address updated'); onDone() } catch (e) { setErr(friendlyError(e)) } finally { setBusy(false) } }
  return (
    <Modal open onClose={onClose} title={`Change address — ${facility.name}`} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!ok} loading={busy}>Change address</Button></>}>
      <div className="space-y-3">
        <Alert tone="warn">Old links to <code>{facility.slug}.{ROOT_DOMAIN}</code> will stop working. Only change an address to resolve a conflict or an inappropriate name.</Alert>
        {err && <Alert tone="error">{err}</Alert>}
        <Field label="New address" error={!same && slug && !isValidSlug(slug) ? '3–40 letters, numbers or single hyphens.' : info && info.slug === slug && !info.available ? `Not available (${info.reason}).` : undefined} hint={ok ? 'Available.' : undefined}>
          <div className="flex items-stretch overflow-hidden rounded-xl border border-line"><input aria-label="New address" className="min-w-0 flex-1 px-3.5 py-3 outline-none" value={slug} onChange={(e) => { setSlug(cleanSlugInput(e.target.value)); setInfo(null) }} /><span className="flex items-center bg-paper px-3 text-sm text-muted">.{ROOT_DOMAIN}</span></div>
        </Field>
      </div>
    </Modal>
  )
}

function LimitDialog({ facility, onClose, onDone }) {
  const toast = useToast()
  const [n, setN] = useState(facility.maxCourts)
  const [err, setErr] = useState('')
  const save = async () => { try { await api.platform.setLimits(facility.id, Number(n)); toast('Limit updated'); onDone() } catch (e) { setErr(friendlyError(e)) } }
  return (
    <Modal open onClose={onClose} title={`Plan limits — ${facility.name}`} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      {err && <Alert tone="error" className="mb-3">{err}</Alert>}
      <Field label="Maximum courts"><input className="input" type="number" min="1" max="50" value={n} onChange={(e) => setN(e.target.value)} /></Field>
    </Modal>
  )
}

export function AdminOwners() {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { api.platform.listOwners().then(setRows).catch((e) => setErr(friendlyError(e))) }, [])
  return (
    <div className="space-y-5">
      <div><h1 className="text-3xl font-extrabold">Owners</h1><p className="text-muted">Accounts that manage at least one facility.</p></div>
      {err && <Alert tone="error">{err}</Alert>}
      {!rows && !err ? <Skeleton className="h-40" /> : rows && !rows.length ? <EmptyState icon={Users} title="No owners yet">Owners appear after they create a facility.</EmptyState> : rows && (
        <div className="card overflow-x-auto"><table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-paper text-xs uppercase tracking-wider text-muted"><tr>{['Name', 'Email', 'Mobile', 'Facilities'].map((h) => <th key={h} scope="col" className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">{rows.map((o) => <tr key={o.userId}><td className="px-4 py-3 font-medium">{o.fullName || '—'}</td><td className="px-4 py-3">{o.email}</td><td className="px-4 py-3">{o.phone || '—'}</td><td className="px-4 py-3">{o.facilities}</td></tr>)}</tbody>
        </table></div>
      )}
    </div>
  )
}

export function AdminSettings() {
  const toast = useToast()
  const [s, setS] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { api.platform.getSettings().then(setS).catch((e) => setErr(friendlyError(e))) }, [])
  const save = async (key, value) => {
    const prev = s[key]
    setS((x) => ({ ...x, [key]: value })) // optimistic; rolled back if the server refuses
    try { await api.platform.setSetting(key, value); toast('Setting saved') } catch (e) { setS((x) => ({ ...x, [key]: prev })); setErr(friendlyError(e)) }
  }
  return (
    <div className="space-y-5">
      <div><h1 className="text-3xl font-extrabold">Platform settings</h1><p className="text-muted">Rules applied to every new facility.</p></div>
      {err && <Alert tone="error">{err}</Alert>}
      {!s ? <Skeleton className="h-40" /> : (
        <section className="card divide-y divide-line">
          <label className="flex items-start gap-3 p-5 text-sm"><input type="checkbox" className="mt-0.5 size-5 accent-forest-900" checked={!!s.require_facility_approval} onChange={(e) => save('require_facility_approval', e.target.checked)} />
            <span><strong className="flex items-center gap-2"><ShieldAlert className="size-4" aria-hidden />Require approval for new facilities</strong><span className="text-muted">New facilities start as “awaiting approval” and can’t take bookings until you approve them.</span></span></label>
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Facilities per owner"><input className="input" type="number" min="1" max="50" defaultValue={s.max_facilities_per_owner} onBlur={(e) => Number(e.target.value) !== s.max_facilities_per_owner && save('max_facilities_per_owner', Number(e.target.value))} /></Field>
            <Field label="Courts per facility (default plan)" hint="Applies to facilities created from now on."><input className="input" type="number" min="1" max="50" defaultValue={s.max_courts_per_facility} onBlur={(e) => Number(e.target.value) !== s.max_courts_per_facility && save('max_courts_per_facility', Number(e.target.value))} /></Field>
          </div>
        </section>
      )}
    </div>
  )
}
