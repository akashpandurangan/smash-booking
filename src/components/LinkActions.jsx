import { Copy, ExternalLink, Share2 } from 'lucide-react'
import { useToast } from '../context/contexts.js'
import { Button } from './ui.jsx'

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

/** Copy Link · Preview · Share for a facility's booking URL. */
export default function LinkActions({ url, previewUrl, name, className = '' }) {
  const toast = useToast()
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      <Button variant="dark" size="sm" onClick={() => copyText(url, toast, 'Booking link copied')}><Copy className="size-4" aria-hidden />Copy link</Button>
      <Button as="a" href={previewUrl || url} target="_blank" rel="noreferrer" variant="outline" size="sm"><ExternalLink className="size-4" aria-hidden />Preview booking page</Button>
      <Button variant="outline" size="sm" onClick={() => shareLink({ title: `Book a court at ${name}`, text: `Book a badminton court at ${name} online:`, url }, toast)}><Share2 className="size-4" aria-hidden />Share</Button>
    </div>
  )
}
