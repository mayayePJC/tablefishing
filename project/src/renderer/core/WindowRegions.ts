export interface InputRect { x: number; y: number; width: number; height: number }

/** Union all visible pixels with deliberate DOM hit targets. Merge equal runs
 * vertically so the native region stays small without cropping a visible pixel. */
export function canvasInputRegions(
  pixels: Pick<ImageData, 'data' | 'width' | 'height'>,
  targets: InputRect[]
): InputRect[] {
  const { width, height, data } = pixels
  const mask = new Uint8Array(width * height)
  for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] ? 1 : 0
  for (const rect of targets) {
    const left = Math.max(0, Math.floor(rect.x))
    const right = Math.min(width, Math.ceil(rect.x + rect.width))
    const top = Math.max(0, Math.floor(rect.y))
    const bottom = Math.min(height, Math.ceil(rect.y + rect.height))
    if (left >= right || top >= bottom) continue
    for (let y = top; y < bottom; y++) mask.fill(1, y * width + left, y * width + right)
  }
  const result: InputRect[] = []
  let previous = new Map<string, InputRect>()
  for (let y = 0; y < height; y++) {
    const current = new Map<string, InputRect>()
    for (let x = 0; x < width;) {
      if (!mask[y * width + x]) { x++; continue }
      const start = x
      while (x < width && mask[y * width + x]) x++
      const key = `${start}:${x}`
      const prior = previous.get(key)
      if (prior) { prior.height++; current.set(key, prior) }
      else {
        const rect = { x: start, y, width: x - start, height: 1 }
        result.push(rect)
        current.set(key, rect)
      }
    }
    previous = current
  }
  return result
}
