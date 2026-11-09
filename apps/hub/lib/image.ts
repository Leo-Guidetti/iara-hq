'use client'
/** Reduz a imagem para `maxSide` px no lado maior e devolve um Blob no formato pedido. */
export async function resizeImage(file: Blob, maxSide: number, type: 'image/webp' | 'image/jpeg', quality = 0.82): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const w = Math.round(bmp.width * scale)
  const h = Math.round(bmp.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, quality))
  if (!blob) throw new Error('Não consegui converter a imagem.')
  // Safari antigo devolve PNG quando não suporta WebP: aceita, o bucket também aceita PNG
  return blob
}
