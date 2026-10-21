import { Copy, ExternalLink, Share2, TriangleAlert } from 'lucide-react'
import { useToast } from '../context/contexts.js'
import { Button } from './ui.jsx'
import { LINK_NOTE } from '../lib/links.js'
import { ROOT_DOMAIN, WILDCARD_READY, bookingLink } from '../lib/tenant.js'

/** Native share sheet when available, otherwise copies the text + link. */
export async function shareLink({ title, text, url }, toast) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url })
      return
    } catch (e) {
      if (e?.name === 'AbortError') return // the user closed the share sheet
    }
  }
  await copyText(`${text}\n${url}`, toast, 'Link copied — paste it anywhere to share')
}

export async function copyText(text, toast, message = 'Copied') {
  try {
    await navigator.clipboard.writeText(text)
    toast(message)
  } catch {
    toast('Couldn’t copy automatically — select the link and copy it manually.', 'error')
  }
}

/** Which kind of link this is, in words — shown wherever a booking link is displayed. */
export function LinkNote({ slug, className = '' }) {
  const link = bookingLink(slug)
  if (link.kind === 'local' || link.kind === 'demo') {
    return <p className={`flex items-start gap-2 text-sm ${className}`} role="note"><TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden /><span><strong>Local only.</strong> {LINK_NOTE[link.kind]}</span></p>
  }
  if (link.kind === 'public' && !WILDCARD_READY) {
    return <p className={`text-sm opacity-80 ${className}`}>Your branded address <strong>{slug}.{ROOT_DOMAIN}</strong> isn’t connected yet — this link works today.</p>
  }
  return null
}

/** Copy Link · Preview · Share for a facility's booking page, using the right URL for this environment. */
export default function LinkActions({ slug, name, className = '' }) {
  const toast = useToast()
  const link = bookingLink(slug)
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      <Button variant="dark" size="sm" onClick={() => copyText(link.url, toast, link.shareable ? 'Booking link copied' : 'Local test link copied (only works on this computer)')}><Copy className="size-4" aria-hidden />{link.shareable ? 'Copy link' : 'Copy local link'}</Button>
      <Button as="a" href={link.previewUrl} target="_blank" rel="noreferrer" variant="outline" size="sm"><ExternalLink className="size-4" aria-hidden />Preview booking page</Button>
      <Button variant="outline" size="sm" disabled={!link.shareable} title={link.shareable ? undefined : 'Sharing is available once the app is deployed'}
        onClick={() => shareLink({ title: `Book a court at ${name}`, text: `Book a badminton court at ${name} online:`, url: link.url }, toast)}><Share2 className="size-4" aria-hidden />Share</Button>
    </div>
  )
}
