/** Original offline soundscapes. Packaged Ogg files include every sound and announcement;
 * playback never depends on the network, system voices or speechSynthesis. */
export type { BgmTrackId } from '../shared/types'
import type { BgmTrackId } from '../shared/types'

export interface BgmTrackMeta {
  id: BgmTrackId
  name: string
  cn: string
}

export const BGM_TRACKS: BgmTrackMeta[] = [
  { id: 'forest-rain', name: '森林雨声', cn: '柔和林间细雨与绵密叶面雨声 · 120秒平稳循环' },
  { id: 'airport', name: '机场候机', cn: '候机大厅与中文航班播报 · 开场播报，每60秒一次' }
]

export function bgmTrackById(id: BgmTrackId | null | undefined): BgmTrackMeta | null {
  return BGM_TRACKS.find((track) => track.id === id) ?? null
}

export type BgmLoader = (id: BgmTrackId) => Promise<ArrayBuffer>

async function loadPackagedAudio(id: BgmTrackId): Promise<ArrayBuffer> {
  const response = await fetch(`./audio/${id}.ogg`)
  if (!response.ok) throw new Error(`内置音频读取失败（${response.status}）`)
  return response.arrayBuffer()
}

/** One cached decoded buffer per soundscape, one live loop, all routed through AudioBus.master. */
export class BgmPlayer {
  private ctx: AudioContext | null = null
  private master: AudioNode | null = null
  private gain: GainNode | null = null
  private source: AudioBufferSourceNode | null = null
  private current: BgmTrackId | null = null
  private active = false
  private generation = 0
  private offset = 0
  private startedAt = 0
  private buffers = new Map<BgmTrackId, AudioBuffer>()
  private pending: { id: BgmTrackId; generation: number } | null = null
  onError: ((message: string) => void) | null = null
  volume = 0.5

  constructor(private readonly loader: BgmLoader = loadPackagedAudio) {}

  get playing(): BgmTrackId | null { return this.current }

  /** Only AudioBus.unlock/unmute attaches a context. Selecting before that performs no I/O. */
  attach(ctx: AudioContext, master: AudioNode): void {
    if (ctx !== this.ctx || master !== this.master) {
      this.silence()
      this.gain?.disconnect()
      this.generation++
      this.pending = null
      if (ctx !== this.ctx) this.buffers.clear()
      this.ctx = ctx
      this.master = master
      this.gain = ctx.createGain()
      this.gain.gain.value = this.volume
      this.gain.connect(master)
    }
    this.active = true
    this.ensurePlaying()
  }

  setVolume(value: number): void {
    this.volume = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
    if (this.gain && this.ctx) this.gain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05)
  }

  /** Same selection toggles off; a different selection replaces the previous soundscape. */
  play(id: BgmTrackId | null): void {
    const valid = bgmTrackById(id)?.id ?? null
    if (valid === this.current) {
      if (valid) this.stop()
      return
    }
    this.silence()
    this.generation++
    this.pending = null
    this.offset = 0
    this.current = valid
    this.ensurePlaying()
  }

  /** clearCurrent=false is AudioBus's mute path: retain selection and playhead, resume on attach. */
  stop(clearCurrent = true): void {
    this.silence()
    if (clearCurrent) {
      this.generation++
      this.pending = null
      this.current = null
      this.offset = 0
    } else this.active = false
  }

  private silence(): void {
    const source = this.source
    if (!source) return
    this.source = null
    const duration = source.buffer?.duration ?? 0
    if (this.ctx && duration > 0) this.offset = (this.offset + Math.max(0, this.ctx.currentTime - this.startedAt)) % duration
    source.onended = null
    try { source.stop() } catch { /* A naturally completed node can already be stopped. */ }
    source.disconnect()
  }

  private ensurePlaying(): void {
    const id = this.current
    const ctx = this.ctx
    if (!id || !ctx || !this.gain || !this.active || this.source) return
    const cached = this.buffers.get(id)
    if (cached) { this.start(cached); return }
    const generation = this.generation
    if (this.pending?.id === id && this.pending.generation === generation) return
    this.pending = { id, generation }
    void Promise.resolve().then(() => this.loader(id))
      .then((bytes) => {
        if (ctx !== this.ctx || generation !== this.generation || id !== this.current) return null
        return ctx.decodeAudioData(bytes)
      })
      .then((buffer) => {
        if (!buffer || ctx !== this.ctx || generation !== this.generation || id !== this.current) return
        if (!Number.isFinite(buffer.duration) || buffer.duration <= 0) throw new Error('音频为空或时长无效')
        this.buffers.set(id, buffer)
        this.pending = null
        if (this.active) this.start(buffer)
      })
      .catch((error: unknown) => {
        if (ctx !== this.ctx || generation !== this.generation || id !== this.current) return
        this.pending = null
        this.silence()
        this.current = null
        this.offset = 0
        const detail = error instanceof Error ? error.message : String(error)
        this.onError?.(`${bgmTrackById(id)?.name ?? '环境音'}播放失败：${detail}`)
      })
  }

  private start(buffer: AudioBuffer): void {
    if (!this.ctx || !this.gain || !this.active || !this.current || this.source) return
    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    source.loop = true
    source.connect(this.gain)
    this.source = source
    this.offset %= buffer.duration
    this.startedAt = this.ctx.currentTime
    source.start(0, this.offset)
  }
}
