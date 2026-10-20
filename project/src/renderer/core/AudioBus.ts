/**
 * WebAudio 音效和背景音乐。音效实时合成，本地音乐及环境音解码后循环播放；
 * 受浏览器自动播放策略限制，须在首次用户手势后 unlock()。
 */
import { BgmPlayer, type BgmTrackId } from './Bgm'
import { LocalMusicPlayer, type LocalMusicLoader } from './LocalMusic'

export class AudioBus {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuf: AudioBuffer | null = null
  /** 内置环境音，与音效和本地音乐共用 master。 */
  readonly bgm = new BgmPlayer()
  readonly localMusic = new LocalMusicPlayer()
  onMusicError: ((message: string) => void) | null = null
  private reelNodes: {
    osc: OscillatorNode
    gain: GainNode
    vib: OscillatorNode
    vibGain: GainNode
    amp: GainNode
    trem: OscillatorNode
    tremGain: GainNode
    noise: AudioBufferSourceNode
    bp: BiquadFilterNode
    nGain: GainNode
    click: ReturnType<typeof setInterval> | null
  } | null = null
  private lastPlayed = new Map<string, number>()
  private _muted = false
  private reminderVoice: HTMLAudioElement | null = null

  constructor() {
    this.bgm.onError = (message) => this.onMusicError?.(message)
    this.localMusic.onError = (message) => this.onMusicError?.(message)
  }

  get muted(): boolean {
    return this._muted
  }

  setMuted(m: boolean): void {
    this._muted = m
    if (m) this.reminderVoice?.pause()
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0.0001 : 0.6, this.ctx.currentTime, 0.02)
    }
    // 保留选择；恢复不能调用 play(同一首)，否则合成播放器会将它切成关闭。
    if (m) this.bgm.stop(false)
    else if (this.ctx && this.master) this.bgm.attach(this.ctx, this.master)
    this.localMusic.setPaused(m)
  }

  /** 首次用户手势时调用 */
  unlock(): void {
    if (typeof window === 'undefined') return
    if (!this.ctx) {
      const AC: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new AC()
      this.master = this.ctx.createGain()
      this.master.gain.value = this._muted ? 0.0001 : 0.6
      this.master.connect(this.ctx.destination)
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    if (this.master) {
      if (!this._muted) this.bgm.attach(this.ctx, this.master)
      this.localMusic.setPaused(this._muted)
      this.localMusic.attach(this.ctx, this.master)
    }
  }

  /** 选择背景音乐曲目（null = 关闭，回到纯钓鱼音效）；持久化由调用方负责 */
  setBgm(id: BgmTrackId | null): void {
    this.localMusic.stop()
    if (id) this.unlock()
    this.bgm.play(id)
    if (this._muted) this.bgm.stop(false)
  }

  /** 恢复存档时传 deferUntilGesture=true，首次真实用户操作前不创建音频上下文。 */
  setLocalMusic(id: string | null, load: LocalMusicLoader | null, deferUntilGesture = false): void {
    this.bgm.stop()
    if (id && !deferUntilGesture) this.unlock()
    this.localMusic.setPaused(this._muted)
    this.localMusic.play(id, load)
  }

  /**
   * 播放可选的小新提醒语音。语音文件由发行包提供时才会加载，
   * 不在源码中内嵌或联网下载未授权原声；缺少文件时安静失败。
   */
  playReminderVoice(kind: 'water' | 'sedentary', character: string): void {
    if (character !== 'shinchan' || this._muted || typeof Audio === 'undefined') return
    this.reminderVoice?.pause()
    const file = kind === 'water' ? 'shinchan-water.ogg' : 'shinchan-break.ogg'
    const audio = new Audio(`./audio/${file}`)
    audio.preload = 'auto'
    audio.volume = 0.8
    audio.addEventListener('error', () => {
      if (this.reminderVoice === audio) this.reminderVoice = null
    }, { once: true })
    this.reminderVoice = audio
    try {
      const playback = audio.play()
      void playback?.catch(() => {
        if (this.reminderVoice === audio) this.reminderVoice = null
      })
    } catch {
      if (this.reminderVoice === audio) this.reminderVoice = null
    }
  }

  private get t(): number {
    return this.ctx!.currentTime
  }

  /** 同一音效 60ms 内防重入 */
  private throttle(key: string): boolean {
    const now = performance.now()
    const last = this.lastPlayed.get(key) ?? -1e9
    if (now - last < 60) return false
    this.lastPlayed.set(key, now)
    return true
  }

  private noise(): AudioBuffer {
    if (!this.noiseBuf) {
      const len = this.ctx!.sampleRate * 0.5
      const buf = this.ctx!.createBuffer(1, len, this.ctx!.sampleRate)
      const data = buf.getChannelData(0)
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
      this.noiseBuf = buf
    }
    return this.noiseBuf
  }

  /** attack-decay 指数包络，避免爆音 */
  private env(g: GainNode, t0: number, peak: number, attack: number, decay: number): void {
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay)
  }

  private tone(
    type: OscillatorType,
    freq: number,
    dur: number,
    peak = 0.5,
    delay = 0,
    endFreq?: number
  ): void {
    if (!this.ctx || !this.master) return
    const t0 = this.t + delay
    const osc = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t0)
    if (endFreq !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t0 + dur)
    this.env(g, t0, peak, Math.min(0.02, dur * 0.3), dur)
    osc.connect(g).connect(this.master)
    osc.start(t0)
    osc.stop(t0 + dur + 0.05)
  }

  private noiseBurst(
    dur: number,
    peak = 0.4,
    filter: BiquadFilterType = 'lowpass',
    freq = 800,
    delay = 0,
    sweepTo?: number
  ): void {
    if (!this.ctx || !this.master) return
    const t0 = this.t + delay
    const src = this.ctx.createBufferSource()
    src.buffer = this.noise()
    const bq = this.ctx.createBiquadFilter()
    bq.type = filter
    bq.frequency.setValueAtTime(freq, t0)
    if (sweepTo !== undefined) bq.frequency.linearRampToValueAtTime(sweepTo, t0 + dur)
    const g = this.ctx.createGain()
    this.env(g, t0, peak, 0.01, dur)
    src.connect(bq).connect(g).connect(this.master)
    src.start(t0)
    src.stop(t0 + dur + 0.05)
  }

  // ---------- 具体音效 ----------

  /** 蓄力提示音：随力度升高的短促方波「嘀嗒」（星露谷工具蓄力的手感） */
  chargeTick(power: number): void {
    if (!this.throttle('chargeTick')) return
    this.unlock()
    this.tone('square', 300 + power * 520, 0.05, 0.15)
  }

  /** MAX 力度达成：明亮双音 + 高频闪光（宝可梦/星露谷式「叮！」） */
  maxCast(): void {
    this.unlock()
    this.tone('square', 987.77, 0.09, 0.38) // B5
    this.tone('square', 1318.5, 0.16, 0.38, 0.09) // E6
    this.tone('sine', 2093, 0.3, 0.2, 0.18) // C7 闪光
  }

  /** UI 点击（结算窗继续等）：轻短方波 */
  uiClick(): void {
    if (!this.throttle('uiClick')) return
    this.unlock()
    this.tone('square', 660, 0.045, 0.13)
  }

  /** 抛竿：线绳飞出（噪声上扫 + 轻微下坠音，星露谷甩竿手感） */
  castWhoosh(): void {
    if (!this.throttle('cast')) return
    this.unlock()
    this.noiseBurst(0.22, 0.3, 'bandpass', 500, 0, 2600)
    this.tone('sine', 900, 0.14, 0.1, 0, 260)
  }

  /** 浮标落水：短噪声 burst + 低通 */
  splash(): void {
    if (!this.throttle('splash')) return
    this.unlock()
    this.noiseBurst(0.18, 0.5, 'lowpass', 900)
    this.tone('sine', 220, 0.12, 0.3, 0.02, 90)
  }

  /** 咬钩提示：星露谷「啵+叮咚」——入水轻啵后接两音提示 */
  plop(): void {
    if (!this.throttle('plop')) return
    this.unlock()
    this.tone('sine', 320, 0.07, 0.32, 0, 170) // 入水「啵」
    this.tone('triangle', 783.99, 0.09, 0.55, 0.02) // G5「叮」
    this.tone('triangle', 1046.5, 0.13, 0.55, 0.1) // C6「咚」
  }

  /** 收杆（空手/取消）：轻柔线绳声 */
  reelIn(): void {
    if (!this.throttle('reelIn')) return
    this.unlock()
    this.noiseBurst(0.15, 0.15, 'bandpass', 1200, 0, 400)
  }

  /**
   * 收线 loop 开始（小游戏中持续）：模拟「拉鱼竿的拉扯感」，而非刺耳嗡嗡。
   * - 锯齿主音(弦/线感，基频低) + 慢速抖动 LFO = 线被绷紧挣扎的颤抖；
   * - 振幅颤音(发力脉冲) = 一下一下地拉；
   * - 低带通缆绳噪声(低增益) = 线被绷紧的低沉「咝」，而非高频嗡嗡；
   * - 卷线器「咔哒」棘轮(定时间隔) = 收线机械感，强化拉扯手感。
   */
  reelStart(): void {
    if (!this.ctx || !this.master || this.reelNodes) return
    this.unlock()
    const t0 = this.t

    const out = this.ctx.createGain()
    out.gain.value = 0.0001
    out.gain.setTargetAtTime(0.06, t0, 0.05)
    out.connect(this.master)

    // 1) 拉扯主音：锯齿(弦/线感)，基频低；慢速抖动 LFO = 挣扎/绷紧颤抖
    const osc = this.ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.value = 98
    const vib = this.ctx.createOscillator()
    const vibGain = this.ctx.createGain()
    vib.frequency.value = 4.2
    vibGain.gain.value = 9
    vib.connect(vibGain).connect(osc.frequency)

    // 2) 发力脉冲(振幅颤音)：让人感到"一下一下"地拉
    const amp = this.ctx.createGain()
    amp.gain.value = 0.05
    const trem = this.ctx.createOscillator()
    const tremGain = this.ctx.createGain()
    trem.frequency.value = 2.6
    tremGain.gain.value = 0.022
    trem.connect(tremGain).connect(amp.gain)

    // 3) 缆绳张力噪声：低带通、低增益，像线被绷紧的「咝」，而非嗡嗡
    const noise = this.ctx.createBufferSource()
    noise.buffer = this.noise()
    noise.loop = true
    const bp = this.ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 320
    bp.Q.value = 0.7
    const nGain = this.ctx.createGain()
    nGain.gain.value = 0.015

    osc.connect(amp).connect(out)
    noise.connect(bp).connect(nGain).connect(out)

    osc.start(t0)
    vib.start(t0)
    trem.start(t0)
    noise.start(t0)

    // 4) 卷线器"咔哒"棘轮：固定间隔，强化"收线拉扯"机械感
    const self = this
    const click = () => {
      if (!self.reelNodes) return
      self.tone('square', 1500, 0.018, 0.045)
    }
    const clickInterval = setInterval(click, 165)

    this.reelNodes = { osc, gain: out, vib, vibGain, amp, trem, tremGain, noise, bp, nGain, click: clickInterval }
  }

  /** 收线 loop 随进度条上涨（progress 0~1）：越接近钓起，线越绷紧、越高越亮、脉冲越密 */
  reelUpdate(progress: number): void {
    if (!this.reelNodes || !this.ctx) return
    const t = this.ctx.currentTime
    this.reelNodes.osc.frequency.setTargetAtTime(98 + progress * 70, t, 0.08)
    this.reelNodes.amp.gain.setTargetAtTime(0.04 + progress * 0.03, t, 0.08)
    this.reelNodes.bp.frequency.setTargetAtTime(320 + progress * 600, t, 0.08)
    this.reelNodes.nGain.gain.setTargetAtTime(0.012 + progress * 0.02, t, 0.08)
    this.reelNodes.vib.frequency.setTargetAtTime(4.2 + progress * 3, t, 0.08)
  }

  reelStop(): void {
    if (!this.reelNodes || !this.ctx) return
    const { osc, gain, vib, trem, noise, click } = this.reelNodes
    this.reelNodes = null
    if (click) clearInterval(click)
    const t0 = this.t
    gain.gain.cancelScheduledValues(t0)
    gain.gain.setTargetAtTime(0.0001, t0, 0.04)
    const stopAt = t0 + 0.25
    osc.stop(stopAt)
    vib.stop(stopAt)
    trem.stop(stopAt)
    noise.stop(stopAt)
  }

  /** 捕获：大三和弦琶音 C-E-G-C（传说鱼追加八度与收尾闪光） */
  fanfare(legendary = false): void {
    this.unlock()
    this.reelStop()
    const notes = legendary
      ? [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98]
      : [523.25, 659.25, 783.99, 1046.5, 1318.5]
    notes.forEach((f, i) => this.tone('square', f, 0.13, 0.32, i * 0.1))
    this.tone('sine', legendary ? 2093 : 1567.98, 0.45, 0.26, legendary ? 0.62 : 0.52)
  }

  /** 逃脱：正弦下滑 + 噪声「噗」 */
  escape(): void {
    this.unlock()
    this.reelStop()
    this.tone('sine', 392, 0.35, 0.4, 0, 110)
    this.noiseBurst(0.2, 0.25, 'lowpass', 500)
  }

  /** 宝箱入手：木琴感双音 */
  treasure(): void {
    this.unlock()
    this.tone('sine', 1318.5, 0.12, 0.5)
    this.tone('sine', 1760, 0.22, 0.5, 0.1)
  }

  /** 升级：独立于捕获小调的明亮琶音和双音收尾；统一经过 master，遵守静音。 */
  levelUp(delay = 0): void {
    this.unlock()
    const start = Math.max(0, delay)
    ;[523.25, 659.25, 783.99, 1046.5].forEach((frequency, i) => {
      this.tone('triangle', frequency, 0.22, 0.36, start + i * 0.105)
      this.tone('square', frequency * 2, 0.09, 0.075, start + i * 0.105)
    })
    this.tone('triangle', 1318.5, 0.42, 0.34, start + 0.46)
    this.tone('sine', 1046.5, 0.46, 0.3, start + 0.46)
    this.tone('sine', 2093, 0.32, 0.12, start + 0.53)
  }
}
