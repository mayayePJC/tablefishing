/** BGM 文件夹及已有导入库的音乐，渲染层仅保存曲目 ID。 */
export interface LocalMusicTrack {
  id: string
  name: string
  mime: string
  /** 文件夹曲目直接读取原文件，不提供应用内删除。 */
  source?: 'folder'
}

export interface LocalMusicImportFile {
  name: string
  data: number[]
}

export interface LocalMusicBridge {
  musicFolderInfo?(): Promise<string>
  listLocalMusic(): Promise<LocalMusicTrack[]>
  /** 返回本批导入的曲目；重复内容可复用已有 ID。 */
  importLocalMusic(files: LocalMusicImportFile[]): Promise<LocalMusicTrack[]>
  readLocalMusic(id: string): Promise<number[]>
  removeLocalMusic(id: string): Promise<void>
}

export const MAX_LOCAL_MUSIC_FILE_BYTES = 50 * 1024 * 1024
export const MAX_LOCAL_MUSIC_BATCH_BYTES = 150 * 1024 * 1024
export type LocalMusicLoader = () => Promise<number[]>

/** 文件库操作与播放器分开，切换曲目不影响持久化文件。 */
export class LocalMusicLibrary {
  constructor(private bridge: Partial<LocalMusicBridge>) {}

  get available(): boolean {
    return ['listLocalMusic', 'importLocalMusic', 'readLocalMusic', 'removeLocalMusic']
      .every((key) => typeof this.bridge[key as keyof LocalMusicBridge] === 'function')
  }

  list(): Promise<LocalMusicTrack[]> {
    if (!this.bridge.listLocalMusic) return Promise.reject(this.unavailable())
    return this.bridge.listLocalMusic()
  }

  async folderPath(): Promise<string | null> {
    return this.bridge.musicFolderInfo ? this.bridge.musicFolderInfo() : null
  }

  async import(files: Iterable<File>): Promise<LocalMusicTrack[]> {
    if (!this.bridge.importLocalMusic) throw this.unavailable()
    const selected = Array.from(files)
    if (!selected.length) return []
    let total = 0
    for (const file of selected) {
      if (!/\.(mp3|ogg|wav|flac)$/i.test(file.name)) {
        throw new Error(`不支持的音乐格式：${file.name}。请选择 MP3、OGG、WAV 或 FLAC。`)
      }
      if (!file.size) throw new Error(`音乐文件为空：${file.name}`)
      if (file.size > MAX_LOCAL_MUSIC_FILE_BYTES) throw new Error(`单首音乐不能超过 50 MB：${file.name}`)
      total += file.size
    }
    if (total > MAX_LOCAL_MUSIC_BATCH_BYTES) throw new Error('一次导入的音乐总大小不能超过 150 MB。')
    const payload: LocalMusicImportFile[] = []
    for (const file of selected) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      payload.push({ name: file.name, data: Array.from(bytes) })
    }
    return this.bridge.importLocalMusic(payload)
  }

  read(id: string): Promise<number[]> {
    if (!this.bridge.readLocalMusic) return Promise.reject(this.unavailable())
    return this.bridge.readLocalMusic(id)
  }

  remove(id: string): Promise<void> {
    if (!this.bridge.removeLocalMusic) return Promise.reject(this.unavailable())
    return this.bridge.removeLocalMusic(id)
  }

  private unavailable(): Error {
    return new Error('当前环境不支持本地音乐库，请使用桌面版。')
  }
}

/**
 * 只解码当前曲目，循环节点直接接入音效使用的 master。
 * 选择可以发生在首次手势之前；attach 后才读取、解码和播放。
 */
export class LocalMusicPlayer {
  private ctx: AudioContext | null = null
  private master: AudioNode | null = null
  private gain: GainNode | null = null
  private current: string | null = null
  private loader: LocalMusicLoader | null = null
  private source: AudioBufferSourceNode | null = null
  private buffer: AudioBuffer | null = null
  private generation = 0
  private pendingGeneration: number | null = null
  private paused = false
  private offset = 0
  private startedAt = 0
  private volume = 0.5
  onError: ((message: string) => void) | null = null

  /** 当前选择的曲目；读取和暂停期间保留。 */
  get playing(): string | null { return this.current }
  get loading(): boolean { return this.pendingGeneration === this.generation }

  attach(ctx: AudioContext, master: AudioNode): void {
    if (this.ctx !== ctx) {
      this.generation++
      this.stopSource()
      this.gain?.disconnect()
      this.ctx = ctx
      this.buffer = null
      this.offset = 0
      this.pendingGeneration = null
      this.gain = ctx.createGain()
      this.gain.gain.value = this.volume
      this.master = null
    }
    if (this.gain && this.master !== master) {
      this.gain.disconnect()
      this.gain.connect(master)
      this.master = master
    }
    this.ensurePlayback()
  }

  /** 选择同一首不会重启；菜单的“再次点击关闭”由调用方显式传 null。 */
  play(id: string | null, load: LocalMusicLoader | null = null): void {
    if (id === this.current) return
    this.stop()
    if (!id || !load) return
    this.current = id
    this.loader = load
    this.ensurePlayback()
  }

  stop(): void {
    this.generation++
    this.stopSource()
    this.current = null
    this.loader = null
    this.buffer = null
    this.pendingGeneration = null
    this.offset = 0
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return
    this.paused = paused
    if (paused) {
      if (this.source && this.buffer && this.ctx) {
        this.offset = (this.offset + this.ctx.currentTime - this.startedAt) % this.buffer.duration
      }
      this.stopSource()
    } else this.ensurePlayback()
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0.5))
    if (this.gain && this.ctx) this.gain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05)
  }

  private ensurePlayback(): void {
    if (!this.ctx || !this.gain || !this.current || this.paused || this.source) return
    if (this.buffer) this.startSource()
    else if (this.loader && this.pendingGeneration !== this.generation) {
      void this.prepare(this.generation, this.loader)
    }
  }

  private async prepare(generation: number, load: LocalMusicLoader): Promise<void> {
    this.pendingGeneration = generation
    try {
      const bytes = await load()
      if (generation !== this.generation || !this.ctx) return
      const data = Uint8Array.from(bytes).buffer
      const buffer = await this.ctx.decodeAudioData(data)
      if (generation !== this.generation) return
      if (!Number.isFinite(buffer.duration) || buffer.duration <= 0) throw new Error('音乐文件没有可播放的音频。')
      this.buffer = buffer
      if (!this.paused) this.startSource()
    } catch (error) {
      if (generation === this.generation) this.fail(error)
    } finally {
      if (this.pendingGeneration === generation) this.pendingGeneration = null
    }
  }

  private startSource(): void {
    if (!this.ctx || !this.gain || !this.buffer || this.source || this.paused) return
    try {
      const source = this.ctx.createBufferSource()
      source.buffer = this.buffer
      source.loop = true
      source.connect(this.gain)
      this.source = source
      this.startedAt = this.ctx.currentTime
      source.start(0, this.offset % this.buffer.duration)
    } catch (error) {
      this.fail(error)
    }
  }

  private stopSource(): void {
    const source = this.source
    this.source = null
    if (source) {
      try { source.stop() } catch { /* 未成功启动的节点也需要释放。 */ }
      source.disconnect()
    }
  }

  private fail(error: unknown): void {
    const detail = typeof error === 'string' ? error : error instanceof Error ? error.message : ''
    this.stop()
    this.onError?.(`本地音乐播放失败${detail ? `：${detail}` : '，请检查文件是否损坏或格式是否受支持。'}`)
  }
}
