// Client-side image preparation for cover photos and banners: validates type/size, then downsizes
// and re-encodes so uploads stay small. The server (Storage bucket limits + RLS) enforces the rules again.

export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export function checkImageFile(file) {
  if (!file) return 'Choose an image.'
  if (!ACCEPTED_TYPES.includes(file.type)) return 'Use a JPG, PNG or WebP image.'
  if (file.size > MAX_UPLOAD_BYTES * 3) return 'That image is too large. Choose one under 9 MB.'
  return ''
}

const loadBitmap = (file) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('invalid_image')) }
    img.src = url
  })

/** → { blob, type, width, height }. Longest side ≤ maxSide, JPEG ≤ ~3 MB. */
export async function prepareImage(file, { maxSide = 1600, quality = 0.85 } = {}) {
  const problem = checkImageFile(file)
  if (problem) throw new Error('invalid_image')
  const img = await loadBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
  const width = Math.max(1, Math.round(img.naturalWidth * scale))
  const height = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff' // PNG transparency → white instead of black when saved as JPEG
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(img, 0, 0, width, height)
  let q = quality
  let blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', q))
  while (blob && blob.size > MAX_UPLOAD_BYTES && q > 0.4) {
    q -= 0.15
    blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', q))
  }
  if (!blob || blob.size > MAX_UPLOAD_BYTES) throw new Error('image_too_large')
  return { blob, type: 'image/jpeg', width, height }
}

export const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(new Error('invalid_image'))
    r.readAsDataURL(blob)
  })
