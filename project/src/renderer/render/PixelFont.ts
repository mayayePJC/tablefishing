/**
 * 3×5 像素字体（大写字母/数字/符号）。
 * 中文字符自动回退到 canvas fillText。
 */
const GLYPHS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  A: ['111', '101', '111', '101', '101'],
  C: ['111', '100', '100', '100', '111'],
  D: ['110', '101', '101', '101', '110'],
  E: ['111', '100', '111', '100', '111'],
  F: ['111', '100', '111', '100', '100'],
  G: ['111', '100', '101', '101', '111'],
  H: ['101', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'],
  K: ['101', '101', '110', '101', '101'],
  L: ['100', '100', '100', '100', '111'],
  M: ['101', '111', '111', '101', '101'],
  N: ['101', '111', '111', '111', '101'],
  O: ['111', '101', '101', '101', '111'],
  P: ['111', '101', '111', '100', '100'],
  R: ['111', '101', '110', '101', '101'],
  S: ['111', '100', '111', '001', '111'],
  T: ['111', '010', '010', '010', '010'],
  U: ['101', '101', '101', '101', '111'],
  V: ['101', '101', '101', '101', '010'],
  W: ['101', '101', '111', '111', '101'],
  X: ['101', '101', '010', '101', '101'],
  Y: ['101', '101', '010', '010', '010'],
  Z: ['111', '001', '010', '100', '111'],
  '!': ['010', '010', '010', '000', '010'],
  '?': ['111', '001', '011', '000', '010'],
  '.': ['000', '000', '000', '000', '010'],
  '+': ['000', '010', '111', '010', '000'],
  '-': ['000', '000', '111', '000', '000'],
  '×': ['000', '101', '010', '101', '000'],
  ':': ['000', '010', '000', '010', '000'],
  '/': ['001', '001', '010', '100', '100'],
  '%': ['101', '001', '010', '100', '101'],
  '<': ['001', '010', '100', '010', '001'],
  '>': ['100', '010', '001', '010', '100']
}

const CHAR_W = 3
const CHAR_H = 5
const GAP = 1

function isCjk(code: number): boolean {
  return code > 0x2e7f
}

/** 测量文本宽度（逻辑像素） */
export function pixelTextWidth(text: string, scale = 1): number {
  let w = 0
  for (const ch of text) {
    if (isCjk(ch.codePointAt(0)!)) w += CHAR_H * scale
    else if (GLYPHS[ch]) w += (CHAR_W + GAP) * scale
    else w += 2 * scale // 空格等
  }
  return Math.max(0, w - GAP * scale)
}

/**
 * 绘制像素文本。像素字符用矩形硬绘（无抗锯齿），
 * 中文用 fillText 回退。带 1px 描边阴影保证可读性。
 */
export function drawPixelText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  scale = 2,
  shadow = true
): void {
  let cx = x
  for (const ch of text) {
    const glyph = GLYPHS[ch]
    if (glyph) {
      if (shadow) {
        ctx.fillStyle = 'rgba(6,13,20,0.5)'
        for (let r = 0; r < CHAR_H; r++) {
          for (let c = 0; c < CHAR_W; c++) {
            if (glyph[r][c] === '1') ctx.fillRect(cx + c * scale + scale, y + r * scale + scale, scale, scale)
          }
        }
      }
      ctx.fillStyle = color
      for (let r = 0; r < CHAR_H; r++) {
        for (let c = 0; c < CHAR_W; c++) {
          if (glyph[r][c] === '1') ctx.fillRect(cx + c * scale, y + r * scale, scale, scale)
        }
      }
      cx += (CHAR_W + GAP) * scale
    } else if (isCjk(ch.codePointAt(0)!)) {
      const size = CHAR_H * scale + 1
      ctx.font = `${size}px "Microsoft YaHei", "PingFang SC", sans-serif`
      ctx.textBaseline = 'top'
      ctx.textAlign = 'left'
      if (shadow) {
        ctx.fillStyle = 'rgba(6,13,20,0.5)'
        ctx.fillText(ch, cx + scale, y + scale)
      }
      ctx.fillStyle = color
      ctx.fillText(ch, cx, y)
      cx += size
    } else {
      cx += 2 * scale
    }
  }
}

/** 居中绘制 */
export function drawPixelTextCenter(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  y: number,
  color: string,
  scale = 2,
  shadow = true
): void {
  drawPixelText(ctx, text, Math.round(centerX - pixelTextWidth(text, scale) / 2), y, color, scale, shadow)
}
