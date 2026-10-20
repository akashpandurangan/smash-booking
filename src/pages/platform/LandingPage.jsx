import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CalendarCheck, CreditCard, Globe, LayoutDashboard, MapPin, ShieldCheck } from 'lucide-react'
import { api } from '../../lib/api/index.js'
import { LOGO_URL, PLATFORM_NAME } from '../../lib/config.js'
import { ROOT_DOMAIN, workingUrl } from '../../lib/tenant.js'
import { Button, EmptyState, Skeleton } from '../../components/ui.jsx'
import { CourtIllustration } from '../../components/Bits.jsx'

export default function LandingPage() {
  const [list, setList] = useState(null)
  useEffect(() => { api.publicFacilities().then(setList).catch(() => setList([])) }, [])

  return (
    <>
      <section className="on-dark relative overflow-hidden bg-forest-900 text-white">
        <div className="container-page grid items-center gap-8 pb-16 pt-10 sm:pt-16 lg:grid-cols-[1.4fr_1fr] lg:pb-24">
          <div className="rise">
            <h1 className="text-[2.6rem] font-extrabold leading-[1.02] sm:text-6xl">Your badminton facility. <span className="text-volt-400">Your own booking website.</span></h1>
            <p className="mt-4 max-w-xl text-base text-white/75 sm:text-lg">Register, add your courts and get a ready-made booking page at <strong className="text-white">yourname.{ROOT_DOMAIN}</strong> — with online payments, a live calendar and no double bookings.</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button to="/owner/register" size="lg">List your facility <ArrowRight className="size-4" aria-hidden /></Button>
              <Button to="/owner/login" size="lg" variant="outline" className="!border-white/25 !bg-transparent !text-white hover:!bg-white/10">Owner login</Button>
            </div>
          </div>
          <CourtIllustration className="mx-auto hidden h-72 rotate-90 opacity-95 lg:block" />
        </div>
      </section>

      <section className="container-page py-12">
        <h2 className="text-2xl font-extrabold sm:text-3xl">How it works</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {[
            { icon: LayoutDashboard, t: '1 · Register & set up', d: 'Create an owner account, then a short wizard collects your courts, hours and pricing.' },
            { icon: Globe, t: '2 · Get your link', d: `We turn your name into a web address — e.g. smasharena.${ROOT_DOMAIN} — and reserve it for you.` },
            { icon: CreditCard, t: '3 · Take bookings', d: 'Players pick a slot and pay online into your own Razorpay account. Bookings confirm only after the payment is verified.' },
          ].map(({ icon: Icon, t, d }) => (
            <div key={t} className="card p-5">
              <span className="grid size-10 place-items-center rounded-xl bg-forest-900 text-volt-400"><Icon className="size-5" aria-hidden /></span>
              <h3 className="mt-4 text-lg font-bold">{t}</h3>
              <p className="mt-1 text-sm text-muted">{d}</p>
            </div>
          ))}
        </div>
        <ul className="mt-6 grid gap-3 text-sm text-muted sm:grid-cols-3">
          <li className="flex items-start gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-forest-600" aria-hidden />Every facility’s data and money are kept completely separate.</li>
          <li className="flex items-start gap-2"><CalendarCheck className="mt-0.5 size-4 shrink-0 text-forest-600" aria-hidden />Double bookings are blocked by the database itself.</li>
          <li className="flex items-start gap-2"><Globe className="mt-0.5 size-4 shrink-0 text-forest-600" aria-hidden />Works on phones — share your link on WhatsApp.</li>
        </ul>
      </section>

      <section className="container-page pb-16" aria-labelledby="dir-h">
        <h2 id="dir-h" className="text-2xl font-extrabold sm:text-3xl">Book a court</h2>
        <p className="mt-1 text-muted">Facilities on {PLATFORM_NAME}.</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {!list ? Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-28" />)
            : !list.length ? <div className="sm:col-span-2 lg:col-span-3"><EmptyState icon={MapPin} title="No facilities yet" action={<Button to="/owner/register">Be the first</Button>}>Facilities appear here once they go live.</EmptyState></div>
            : list.map((f) => (
              <a key={f.slug} href={workingUrl(f.slug)} className="card group flex items-center gap-4 p-4 transition-all hover:-translate-y-0.5 hover:shadow-lift">
                <img src={f.logoUrl || LOGO_URL} alt="" className="size-14 shrink-0 rounded-2xl bg-white object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-lg font-bold">{f.name}</p>
                  <p className="flex items-center gap-1 truncate text-sm text-muted"><MapPin className="size-3.5 shrink-0" aria-hidden />{f.city || 'Location not set'}</p>
                  <p className="truncate text-xs text-forest-600">{f.slug}.{ROOT_DOMAIN}</p>
                </div>
                <ArrowRight className="size-5 shrink-0 text-muted transition-transform group-hover:translate-x-1" aria-hidden />
              </a>
            ))}
        </div>
        <p className="mt-6 text-sm text-muted">Already a player? Open your facility’s link and log in there. Facility owner? <Link to="/owner/login" className="font-semibold text-forest-600 hover:underline">Log in</Link>.</p>
      </section>
    </>
  )
}
