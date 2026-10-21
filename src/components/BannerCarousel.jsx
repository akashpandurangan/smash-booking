import { useRef, useState } from 'react'
import { ArrowRight, ChevronLeft, ChevronRight, ImageOff } from 'lucide-react'

/**
 * Facility promotional banners (max 3). Text + CTA on the left, a large 16:9 image on the right (desktop);
 * image first on phones. Swipe, previous/next buttons, pagination dots and arrow keys. No autoplay.
 */
export default function BannerCarousel({ banners, facilityName, fallbackHeading, onCta, children }) {
  const [i, setI] = useState(0)
  const [broken, setBroken] = useState({})
  const touch = useRef(null)
  const n = banners.length
  const at = Math.min(i, n - 1)
  const b = banners[at]
  const go = (k) => setI((at + k + n) % n)

  const onTouchEnd = (e) => {
    if (touch.current == null) return
    const dx = e.changedTouches[0].clientX - touch.current
    touch.current = null
    if (Math.abs(dx) > 45 && n > 1) go(dx < 0 ? 1 : -1)
  }
  const onKey = (e) => {
    if (n < 2) return
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1) }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1) }
  }

  return (
    <section className="on-dark relative overflow-hidden bg-forest-900 text-white" aria-roledescription="carousel" aria-label={`${facilityName} offers`} onKeyDown={onKey}>
      <div className="container-page grid items-center gap-6 pb-24 pt-6 sm:pt-10 lg:grid-cols-[1fr_1.2fr] lg:gap-10 lg:pb-28">
        <div className="order-2 lg:order-1">
          <div key={at} className="rise" role="group" aria-roledescription="slide" aria-label={`${at + 1} of ${n}`}>
            <h1 className="text-[2.2rem] font-extrabold leading-[1.05] sm:text-5xl">{b.heading || fallbackHeading}</h1>
            {b.description && <p className="mt-3 max-w-lg text-base text-white/75 sm:text-lg">{b.description}</p>}
            <button onClick={onCta} className="mt-6 inline-flex min-h-12 items-center gap-2 rounded-xl bg-volt-400 px-6 text-base font-semibold text-forest-950 transition-colors hover:bg-volt-300">
              {b.ctaLabel || 'Book a court'} <ArrowRight className="size-4" aria-hidden />
            </button>
          </div>
          {children}
          {n > 1 && (
            <div className="mt-6 flex items-center gap-3">
              <button onClick={() => go(-1)} aria-label="Previous banner" className="grid size-10 place-items-center rounded-full border border-white/25 hover:bg-white/10"><ChevronLeft className="size-5" aria-hidden /></button>
              <div className="flex items-center gap-2" role="tablist" aria-label="Choose banner">
                {banners.map((_, k) => (
                  <button key={k} role="tab" aria-selected={k === at} aria-label={`Banner ${k + 1}`} onClick={() => setI(k)}
                    className={`h-2.5 rounded-full transition-all ${k === at ? 'w-7 bg-volt-400' : 'w-2.5 bg-white/35 hover:bg-white/60'}`} />
                ))}
              </div>
              <button onClick={() => go(1)} aria-label="Next banner" className="grid size-10 place-items-center rounded-full border border-white/25 hover:bg-white/10"><ChevronRight className="size-5" aria-hidden /></button>
            </div>
          )}
        </div>

        <div className="order-1 lg:order-2" onTouchStart={(e) => { touch.current = e.touches[0].clientX }} onTouchEnd={onTouchEnd}>
          {broken[b.imageUrl] ? (
            <div className="grid aspect-video w-full place-items-center rounded-2xl bg-forest-800 text-white/70"><span className="flex items-center gap-2 text-sm"><ImageOff className="size-5" aria-hidden />Image unavailable</span></div>
          ) : (
            <img key={b.imageUrl} src={b.imageUrl} alt={b.heading || `${facilityName} banner`} width="1280" height="720" decoding="async" fetchPriority={at === 0 ? 'high' : 'auto'}
              onError={() => setBroken((m) => ({ ...m, [b.imageUrl]: true }))}
              className="aspect-video w-full rounded-2xl bg-forest-800 object-cover shadow-lift" />
          )}
        </div>
      </div>
    </section>
  )
}
