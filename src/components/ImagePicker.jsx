import { useEffect, useId, useRef, useState } from 'react'
import { ImagePlus, Loader2, Replace, Trash2 } from 'lucide-react'
import { friendlyError } from '../lib/errors.js'
import { ACCEPTED_TYPES, checkImageFile } from '../lib/images.js'
import { Button } from './ui.jsx'

/**
 * Pick / replace / remove one image (16:9 preview).
 *  - `upload(file) → url`: uploads immediately (used once the facility exists);
 *  - `onFile(file|null)` + `file`: just hands the chosen file to the parent (used in the setup wizard, before the facility exists).
 * The file is validated here, resized in the browser, and validated again by the server.
 */
export default function ImagePicker({ label, value, upload, onUploaded, file, onFile, onRemove, hint, disabled }) {
  const id = useId()
  const input = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState('')

  useEffect(() => {
    if (!file) { setPreview(''); return undefined }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const shown = preview || value
  const choose = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = '' // allow choosing the same file again
    if (!f) return
    const problem = checkImageFile(f)
    if (problem) { setError(problem); return }
    setError('')
    if (!upload) { onFile?.(f); return }
    setBusy(true)
    try {
      onUploaded(await upload(f))
    } catch (x) {
      setError(friendlyError(x))
    } finally {
      setBusy(false)
    }
  }
  const remove = () => { setError(''); if (file) onFile?.(null); else onRemove?.() }

  return (
    <div>
      <p className="label" id={`${id}-l`}>{label}</p>
      <div className="overflow-hidden rounded-2xl border border-dashed border-line bg-paper">
        {shown ? (
          <img src={shown} alt="" className="aspect-video w-full object-cover" width="640" height="360" />
        ) : (
          <div className="grid aspect-video w-full place-items-center text-sm text-muted"><span className="flex items-center gap-2"><ImagePlus className="size-5" aria-hidden />No image yet</span></div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input ref={input} id={id} type="file" accept={ACCEPTED_TYPES.join(',')} className="sr-only" onChange={choose} disabled={disabled || busy} aria-labelledby={`${id}-l`} />
        <Button type="button" size="sm" variant="outline" disabled={disabled || busy} onClick={() => input.current?.click()}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : shown ? <Replace className="size-4" aria-hidden /> : <ImagePlus className="size-4" aria-hidden />}
          {busy ? 'Uploading…' : shown ? 'Replace image' : 'Choose image'}
        </Button>
        {shown && !busy && <Button type="button" size="sm" variant="ghost" onClick={remove} disabled={disabled}><Trash2 className="size-4" aria-hidden />Remove</Button>}
      </div>
      {error ? <p className="mt-1.5 text-sm text-red-700" role="alert">{error}</p> : <p className="mt-1.5 text-xs text-muted">{hint || 'JPG, PNG or WebP. 16:9 works best; we resize large photos for you.'}</p>}
    </div>
  )
}
