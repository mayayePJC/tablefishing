"use strict";

// src/renderer/core/Rng.ts
var Rng = class {
  state;
  constructor(seed = 2654435769) {
    this.state = seed >>> 0;
  }
  /** [0,1) */
  next() {
    this.state = this.state + 1831565813 >>> 0;
    let t = this.state;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  /** [min,max] 浮点 */
  range(min, max) {
    return min + this.next() * (max - min);
  }
  /** [min,max] 整数（含端点） */
  int(min, max) {
    return Math.floor(this.range(min, max + 1));
  }
  /** 以 p 概率返回 true */
  chance(p) {
    return this.next() < p;
  }
  /** 按权重随机取一项 */
  pick(items, weightOf) {
    let total = 0;
    for (const it of items) total += Math.max(0, weightOf(it));
    if (total <= 0) return items[Math.floor(this.next() * items.length)];
    let roll = this.next() * total;
    for (const it of items) {
      roll -= Math.max(0, weightOf(it));
      if (roll <= 0) return it;
    }
    return items[items.length - 1];
  }
};

// src/renderer/core/AudioBus.ts
var AudioBus = class {
  ctx = null;
  master = null;
  noiseBuf = null;
  reelNodes = null;
  lastPlayed = /* @__PURE__ */ new Map();
  _muted = false;
  get muted() {
    return this._muted;
  }
  setMuted(m) {
    this._muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 1e-4 : 0.6, this.ctx.currentTime, 0.02);
    }
  }
  /** 首次用户手势时调用 */
  unlock() {
    if (typeof window === "undefined") return;
    if (!this.ctx) {
      const AC = window.AudioContext ?? window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this._muted ? 1e-4 : 0.6;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }
  get t() {
    return this.ctx.currentTime;
  }
  /** 同一音效 60ms 内防重入 */
  throttle(key) {
    const now = performance.now();
    const last = this.lastPlayed.get(key) ?? -1e9;
    if (now - last < 60) return false;
    this.lastPlayed.set(key, now);
    return true;
  }
  noise() {
    if (!this.noiseBuf) {
      const len = this.ctx.sampleRate * 0.5;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    }
    return this.noiseBuf;
  }
  /** attack-decay 指数包络，避免爆音 */
  env(g, t0, peak, attack, decay) {
    g.gain.setValueAtTime(1e-4, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(2e-4, peak), t0 + attack);
    g.gain.exponentialRampToValueAtTime(1e-4, t0 + attack + decay);
  }
  tone(type, freq, dur, peak = 0.5, delay = 0, endFreq) {
    if (!this.ctx || !this.master) return;
    const t0 = this.t + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (endFreq !== void 0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t0 + dur);
    this.env(g, t0, peak, Math.min(0.02, dur * 0.3), dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }
  noiseBurst(dur, peak = 0.4, filter = "lowpass", freq = 800, delay = 0, sweepTo) {
    if (!this.ctx || !this.master) return;
    const t0 = this.t + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise();
    const bq = this.ctx.createBiquadFilter();
    bq.type = filter;
    bq.frequency.setValueAtTime(freq, t0);
    if (sweepTo !== void 0) bq.frequency.linearRampToValueAtTime(sweepTo, t0 + dur);
    const g = this.ctx.createGain();
    this.env(g, t0, peak, 0.01, dur);
    src.connect(bq).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }
  // ---------- 具体音效 ----------
  /** 抛竿：线绳飞出（噪声 + 带通上扫） */
  castWhoosh() {
    if (!this.throttle("cast")) return;
    this.unlock();
    this.noiseBurst(0.25, 0.25, "bandpass", 400, 0, 2400);
  }
  /** 浮标落水：短噪声 burst + 低通 */
  splash() {
    if (!this.throttle("splash")) return;
    this.unlock();
    this.noiseBurst(0.18, 0.5, "lowpass", 900);
    this.tone("sine", 220, 0.12, 0.3, 0.02, 90);
  }
  /** 咬钩提示：星露谷「叮咚」双音（三角波 C5→G5） */
  plop() {
    if (!this.throttle("plop")) return;
    this.unlock();
    this.tone("triangle", 523.25, 0.09, 0.6);
    this.tone("triangle", 783.99, 0.12, 0.6, 0.09);
  }
  /** 收杆（空手/取消）：轻柔线绳声 */
  reelIn() {
    if (!this.throttle("reelIn")) return;
    this.unlock();
    this.noiseBurst(0.15, 0.15, "bandpass", 1200, 0, 400);
  }
  /** 收线 loop 开始（小游戏中持续，音高随进度上升） */
  reelStart() {
    if (!this.ctx || !this.master || this.reelNodes) return;
    const t0 = this.t;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.value = 110;
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 14;
    lfoGain.gain.value = 8;
    lfo.connect(lfoGain).connect(osc.frequency);
    gain.gain.value = 1e-4;
    gain.gain.setTargetAtTime(0.08, t0, 0.05);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    lfo.start(t0);
    this.reelNodes = { osc, gain };
  }
  /** 收线 loop 的音高随进度条上涨（progress 0~1） */
  reelUpdate(progress) {
    if (!this.reelNodes || !this.ctx) return;
    this.reelNodes.osc.frequency.setTargetAtTime(110 + progress * 130, this.ctx.currentTime, 0.08);
  }
  reelStop() {
    if (!this.reelNodes || !this.ctx) return;
    const { osc, gain } = this.reelNodes;
    this.reelNodes = null;
    const t0 = this.t;
    gain.gain.setTargetAtTime(1e-4, t0, 0.04);
    osc.stop(t0 + 0.25);
  }
  /** 捕获：大三和弦琶音 C-E-G-C */
  fanfare() {
    this.unlock();
    this.reelStop();
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => this.tone("square", f, 0.14, 0.35, i * 0.11));
    this.tone("sine", 1318.5, 0.4, 0.3, 0.46);
  }
  /** 逃脱：正弦下滑 + 噪声「噗」 */
  escape() {
    this.unlock();
    this.reelStop();
    this.tone("sine", 392, 0.35, 0.4, 0, 110);
    this.noiseBurst(0.2, 0.25, "lowpass", 500);
  }
  /** 宝箱入手：木琴感双音 */
  treasure() {
    this.unlock();
    this.tone("sine", 1318.5, 0.12, 0.5);
    this.tone("sine", 1760, 0.22, 0.5, 0.1);
  }
  /** 升级：上行三连音 */
  levelUp() {
    this.unlock();
    this.tone("square", 440, 0.1, 0.3);
    this.tone("square", 554.37, 0.1, 0.3, 0.1);
    this.tone("square", 659.25, 0.25, 0.35, 0.2);
  }
};

// src/renderer/shared/constants.ts
var T = {
  // ---------- 桌宠窗口（透明、可拖拽） ----------
  VIEW_W: 460,
  VIEW_H: 560,
  /** 垂钓猫精灵原生素材尺寸（像素） */
  CAT_W: 26,
  CAT_H: 30,
  /** 猫在桌面上的显示缩放 */
  CAT_SCALE: 3.4,
  // ---------- 桌宠布局：猫坐在底部中央，钓线向头顶上方抛 ----------
  /** 玩家（猫）站位：窗口底部中央 */
  PLAYER_X: 230,
  PLAYER_FOOT_Y: 520,
  /** 抛竿落点范围（猫头顶上方的"空中水域"） */
  CAST_X_MIN: 150,
  CAST_X_MAX: 310,
  CAST_Y_MIN: 120,
  CAST_Y_MAX: 320,
  // ---------- 小游戏轨道（官方锚点） ----------
  /** 官方：轨道总高 568px */
  TRACK_H: 568,
  /** 流传参考值：绿条底部静止边界 546（=568-22，底部判定更宽松） */
  BAR_BOTTOM: 546,
  BAR_ACCEL_UP: 720,
  BAR_GRAVITY: 288,
  BAR_SPEED_MAX: 96,
  BAR_BOUNCE: 30,
  /** 官方：0 级绿条 96px，每级 +8px */
  BAR_SIZE_BASE: 96,
  BAR_SIZE_PER_LEVEL: 8,
  // ---------- 鱼 AI ----------
  FISH_SPEED_BASE: 60,
  FISH_SPEED_PER_DIFF: 1.1,
  FISH_SPRING_K: 3.5,
  FISH_DAMPING: 5,
  DART_AMP_BASE: 60,
  DART_AMP_PER_DIFF: 1,
  /** 难度 110 的变向间隔（ms） */
  DART_INTERVAL_EASY: 380,
  /** 难度 15 的变向间隔（ms） */
  DART_INTERVAL_HARD: 2200,
  /** 官方：sinker 向下加速度更快 / floater 向上加速度更快 */
  SINKER_ACCEL: 70,
  FLOATER_ACCEL: 70,
  // ---------- 进度条 ----------
  PROGRESS_INITIAL: 0.3,
  PROGRESS_GAIN: 0.12,
  PROGRESS_DRAIN_BASE: 0.18,
  // ---------- 宝箱（官方） ----------
  TREASURE_CHANCE: 0.15,
  TREASURE_DELAY_MIN: 1e3,
  TREASURE_DELAY_MAX: 3e3,
  TREASURE_GAIN: 0.8,
  TREASURE_DRAIN: 0.6,
  // ---------- 抛竿 / 咬钩 ----------
  /** 蓄力满所需秒数 */
  CHARGE_TIME: 1,
  /** 最大抛掷距离（格），换算 distanceFromLand 上限 5 */
  CAST_MAX_TILES: 5,
  /** 官方：咬钩 0.6~30s 随机 */
  BITE_MIN_MS: 600,
  BITE_MAX_MS: 3e4,
  /** 官方论坛：感叹号反应窗口约半秒 */
  REACTION_WINDOW_MS: 600,
  /** 首次咬钩时间 -25%（官方） */
  FIRST_BITE_FACTOR: 0.75,
  /** 每级最大咬钩时间 -0.25s（官方） */
  BITE_LEVEL_FACTOR: 0.25,
  // ---------- 成长 ----------
  /** 垃圾概率 v1 近似：基础 20%，每级 -1.5%，下限 5% */
  TRASH_BASE: 0.2,
  TRASH_LEVEL_FACTOR: 0.015,
  TRASH_MIN: 0.05
};

// src/renderer/render/SpriteFactory.ts
var ROD_TIP = {
  idle0: [22, 10],
  idle1: [23, 11],
  cast0: [18, 3],
  cast1: [25, 6],
  cast2: [25, 9],
  reel: [24, 13],
  show: [22, 13]
};

// src/renderer/fishing/entities/Bobber.ts
function lerp(a, b, t) {
  return a + (b - a) * t;
}
var Bobber = class {
  x = 0;
  y = 0;
  startX = 0;
  startY = 0;
  targetX = 0;
  targetY = 0;
  t = 0;
  duration = 0.5;
  flying = false;
  /** 咬钩抖动剩余时间（s） */
  shake = 0;
  launch(sx, sy, tx, ty) {
    this.startX = sx;
    this.startY = sy;
    this.targetX = tx;
    this.targetY = ty;
    this.x = sx;
    this.y = sy;
    this.t = 0;
    this.flying = true;
  }
  update(dt, time) {
    if (this.flying) {
      this.t += dt;
      const k = Math.min(1, this.t / this.duration);
      this.x = lerp(this.startX, this.targetX, k);
      this.y = lerp(this.startY, this.targetY, k) - Math.sin(k * Math.PI) * 70;
      if (k >= 1) {
        this.flying = false;
        this.x = this.targetX;
        this.y = this.targetY;
      }
    }
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt);
    void time;
  }
  /** 落水后浮动（渲染层叠加正弦，这里只标记 landed） */
  get landed() {
    return !this.flying;
  }
};

// src/renderer/fishing/entities/Player.ts
var Player = class {
  constructor(x, footY) {
    this.x = x;
    this.footY = footY;
  }
  pose = "idle";
  /** cast 姿态帧 0..2 */
  frame = 0;
  setPose(pose, frame = 0) {
    this.pose = pose;
    this.frame = frame;
  }
};

// src/renderer/fishing/entities/CatchBar.ts
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
var CatchBar = class {
  constructor(size) {
    this.size = size;
    this.pos = (T.BAR_BOTTOM - this.size) / 2;
  }
  /** 条顶端位置（轨道单位） */
  pos = 0;
  vel = 0;
  update(dt, held) {
    if (held) this.vel -= T.BAR_ACCEL_UP * dt;
    else this.vel += T.BAR_GRAVITY * dt;
    this.vel = clamp(this.vel, -T.BAR_SPEED_MAX, T.BAR_SPEED_MAX);
    this.pos += this.vel * dt;
    const maxPos = T.BAR_BOTTOM - this.size;
    if (this.pos > maxPos) {
      this.pos = maxPos;
      this.vel = -T.BAR_BOUNCE;
    }
    if (this.pos < 0) {
      this.pos = 0;
      this.vel = 0;
    }
  }
  /** 鱼中心是否在条内（含鱼半高容差） */
  contains(fishCenter, fishHalf) {
    return fishCenter >= this.pos - fishHalf && fishCenter <= this.pos + this.size + fishHalf;
  }
};

// src/renderer/fishing/entities/ProgressBar.ts
function clamp2(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
var ProgressBar = class {
  value = T.PROGRESS_INITIAL;
  reset() {
    this.value = T.PROGRESS_INITIAL;
  }
  update(dt, inBar, difficulty) {
    if (inBar) {
      this.value += T.PROGRESS_GAIN * dt;
    } else {
      this.value -= T.PROGRESS_DRAIN_BASE * (0.55 + 0.85 * difficulty / 110) * dt;
    }
    this.value = clamp2(this.value, 0, 1);
  }
  get full() {
    return this.value >= 1;
  }
  get empty() {
    return this.value <= 0;
  }
};

// src/renderer/fishing/entities/Treasure.ts
function clamp3(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
var Treasure = class {
  active = false;
  /** 出现倒计时（ms），<=0 且已激活表示可见 */
  delayMs = 0;
  pos = 0;
  progress = 0;
  caught = false;
  rng;
  constructor(rng) {
    this.rng = rng;
  }
  /** 小游戏开始时抽签 */
  maybeSpawn() {
    this.active = false;
    this.caught = false;
    this.progress = 0;
    this.delayMs = 0;
    if (this.rng.chance(T.TREASURE_CHANCE)) {
      this.active = true;
      this.delayMs = this.rng.range(T.TREASURE_DELAY_MIN, T.TREASURE_DELAY_MAX);
    }
  }
  /** 是否已出现在轨道中 */
  get visible() {
    return this.active && !this.caught && this.delayMs <= 0;
  }
  update(dt, barCovers) {
    if (!this.active || this.caught) return;
    if (this.delayMs > 0) {
      this.delayMs -= dt * 1e3;
      if (this.delayMs <= 0) {
        this.pos = this.rng.range(T.TRACK_H * 0.2, T.TRACK_H * 0.8);
      }
      return;
    }
    this.progress += (barCovers ? T.TREASURE_GAIN : -T.TREASURE_DRAIN) * dt;
    this.progress = clamp3(this.progress, 0, 1);
    if (this.progress >= 1) this.caught = true;
  }
};

// src/renderer/fishing/FishingMachine.ts
var FishingMachine = class {
  constructor(ctx, states) {
    this.ctx = ctx;
    this.states = states;
    this.current = states.idle;
    this.current.enter?.(ctx);
  }
  states;
  current;
  get name() {
    return this.current.name;
  }
  transition(name) {
    if (this.current.name === name) return;
    this.current.exit?.(this.ctx);
    this.current = this.states[name];
    this.current.enter?.(this.ctx);
  }
  update(dt) {
    this.current.update?.(this.ctx, dt);
  }
  onPress() {
    this.current.onPress?.(this.ctx);
  }
  onRelease() {
    this.current.onRelease?.(this.ctx);
  }
};

// src/renderer/fishing/states/IdleState.ts
var IdleState = class {
  constructor(transition) {
    this.transition = transition;
  }
  name = "idle";
  enter(ctx) {
    ctx.result = null;
    ctx.castPower = 0;
  }
  onPress() {
    this.transition("charge");
  }
};

// src/renderer/fishing/states/ChargeState.ts
var ChargeState = class {
  constructor(transition) {
    this.transition = transition;
  }
  name = "charge";
  enter(ctx) {
    ctx.castPower = 0;
  }
  update(ctx, dt) {
    ctx.castPower = Math.min(1, ctx.castPower + dt / T.CHARGE_TIME);
  }
  onRelease(ctx) {
    const p = ctx.castPower;
    ctx.targetX = T.CAST_X_MIN + (T.CAST_X_MAX - T.CAST_X_MIN) * p;
    ctx.targetY = T.CAST_Y_MAX + (T.CAST_Y_MIN - T.CAST_Y_MAX) * p;
    ctx.distanceTiles = p * T.CAST_MAX_TILES;
    this.transition("cast");
  }
};

// src/renderer/fishing/states/CastState.ts
var CastState = class {
  constructor(transition) {
    this.transition = transition;
  }
  name = "cast";
  fired = false;
  enter() {
    this.fired = false;
  }
  /** 由控制器在浮标落水时调用 */
  onLanded(ctx) {
    if (this.fired) return;
    this.fired = true;
    this.rollBite(ctx);
    this.transition("wait");
  }
  /** 生成本次咬钩对象：先判垃圾，再按权重选鱼 */
  rollBite(ctx) {
    const trashChance = Math.max(T.TRASH_MIN, T.TRASH_BASE - ctx.level * T.TRASH_LEVEL_FACTOR);
    if (ctx.forcedFishId) {
      const forced = ctx.fishPool.find((f) => f.id === ctx.forcedFishId);
      ctx.forcedFishId = null;
      if (forced) {
        ctx.roll = { kind: "fish", def: forced };
        ctx.biteTimerMs = ctx.rng.range(400, 900);
        return;
      }
    }
    if (ctx.rng.chance(trashChance)) {
      ctx.roll = { kind: "trash" };
    } else {
      const def = ctx.rng.pick(ctx.fishPool, (f) => f.weight);
      ctx.roll = { kind: "fish", def };
    }
    this.rollBiteTime(ctx);
  }
  /** 咬钩时间 0.6~30s（官方）；每级最大 -0.25s；持竿首次 -25% */
  rollBiteTime(ctx) {
    let min = T.BITE_MIN_MS;
    let max = T.BITE_MAX_MS - ctx.level * T.BITE_LEVEL_FACTOR * 1e3;
    if (ctx.isFirstCast) {
      min *= T.FIRST_BITE_FACTOR;
      max *= T.FIRST_BITE_FACTOR;
    }
    ctx.isFirstCast = false;
    max = Math.max(min + 200, max);
    ctx.biteTimerMs = ctx.rng.range(min, max);
  }
};

// src/renderer/fishing/states/WaitState.ts
var WaitState = class {
  constructor(transition) {
    this.transition = transition;
  }
  name = "wait";
  update(ctx, dt) {
    ctx.biteTimerMs -= dt * 1e3;
    if (ctx.biteTimerMs <= 0) {
      ctx.reactionLeftMs = T.REACTION_WINDOW_MS;
      this.transition("hook");
    }
  }
  /** 过早点击 = 收竿，本次作废 */
  onPress(ctx) {
    ctx.audio.reelIn();
    ctx.roll = null;
    ctx.result = null;
    this.transition("idle");
  }
};

// src/renderer/fishing/entities/Fish.ts
var HALF = 4;
var BEHAVIOR_INTERVAL = {
  mixed: 1,
  smooth: 1.35,
  sinker: 1.15,
  floater: 1.15,
  dart: 0.65
};
function lerp2(a, b, t) {
  return a + (b - a) * t;
}
function clamp4(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
var Fish = class {
  constructor(def, rng) {
    this.def = def;
    this.rng = rng;
    this.pos = T.TRACK_H * rng.range(0.25, 0.75);
    this.pickTarget();
  }
  /** 鱼图标中心位置（轨道单位，0 = 顶端） */
  pos;
  vel = 0;
  target = 0;
  dartTimer = 0;
  update(dt) {
    const d = this.def.difficulty;
    let bias = 0;
    if (this.def.behavior === "sinker") bias = T.SINKER_ACCEL;
    if (this.def.behavior === "floater") bias = -T.FLOATER_ACCEL;
    this.dartTimer -= dt * 1e3;
    if (this.dartTimer <= 0) this.pickTarget();
    const accel = (this.target - this.pos) * T.FISH_SPRING_K;
    this.vel += (accel + bias - this.vel) * T.FISH_DAMPING * dt;
    const vmax = T.FISH_SPEED_BASE + T.FISH_SPEED_PER_DIFF * d;
    this.vel = clamp4(this.vel, -vmax, vmax);
    this.pos += this.vel * dt;
    if (this.pos > T.TRACK_H - HALF) {
      this.pos = T.TRACK_H - HALF;
      this.vel *= -0.3;
    }
    if (this.pos < HALF) {
      this.pos = HALF;
      this.vel *= -0.3;
    }
  }
  pickTarget() {
    const d = this.def.difficulty;
    const base = lerp2(T.DART_INTERVAL_HARD, T.DART_INTERVAL_EASY, clamp4((d - 15) / 95, 0, 1));
    this.dartTimer = base * BEHAVIOR_INTERVAL[this.def.behavior] * this.rng.range(0.7, 1.3);
    let amp = T.DART_AMP_BASE + T.DART_AMP_PER_DIFF * d;
    if (this.def.behavior === "dart") amp *= 1 + 2 * d / 100;
    if (this.def.behavior === "smooth") amp *= 0.7;
    const dir = this.rng.chance(0.5) ? -1 : 1;
    this.target = clamp4(this.pos + dir * amp * this.rng.next(), HALF, T.TRACK_H - HALF);
  }
};

// src/renderer/fishing/states/HookState.ts
var HookState = class {
  constructor(transition) {
    this.transition = transition;
  }
  name = "hook";
  enter(ctx) {
    ctx.audio.plop();
  }
  update(ctx, dt) {
    ctx.reactionLeftMs -= dt * 1e3;
    if (ctx.reactionLeftMs <= 0) {
      ctx.audio.escape();
      ctx.result = { kind: "escaped" };
      this.transition("result");
    }
  }
  onPress(ctx) {
    const roll = ctx.roll;
    if (!roll) {
      this.transition("idle");
      return;
    }
    if (roll.kind === "trash") {
      ctx.result = { kind: "trash", xp: 3 };
      ctx.audio.reelIn();
      this.transition("result");
      return;
    }
    const barSize = T.BAR_SIZE_BASE + T.BAR_SIZE_PER_LEVEL * ctx.level;
    ctx.fish = new Fish(roll.def, ctx.rng);
    ctx.bar = new CatchBar(barSize);
    ctx.progress.reset();
    ctx.outMs = 0;
    ctx.perfect = true;
    ctx.treasure.maybeSpawn();
    ctx.audio.reelStart();
    this.transition("minigame");
  }
};

// src/renderer/fishing/data/xpTable.ts
var XP_LEVELS = [100, 380, 750, 1280, 1750, 2250, 2750, 3250, 3750, 4750];
var MAX_LEVEL = 10;
var QUALITY_XP_INDEX = {
  normal: 0,
  silver: 1,
  gold: 2,
  iridium: 4
};
function levelFromXp(totalXp) {
  let level = 0;
  for (let i = 0; i < XP_LEVELS.length; i++) {
    if (totalXp >= XP_LEVELS[i]) level = i + 1;
  }
  return level;
}
function xpProgress(totalXp, level) {
  const base = level <= 0 ? 0 : XP_LEVELS[level - 1];
  const next = level >= MAX_LEVEL ? XP_LEVELS[MAX_LEVEL - 1] : XP_LEVELS[level];
  const span = next - base;
  const cur = totalXp - base;
  const pct = span <= 0 ? 1 : Math.min(1, Math.max(0, cur / span));
  return [cur, span, pct];
}

// src/renderer/fishing/catchMath.ts
function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function upgrade(q) {
  switch (q) {
    case "normal":
      return "silver";
    case "silver":
      return "gold";
    default:
      return "iridium";
  }
}
function computeCatchResult(ctx) {
  const roll = ctx.roll;
  if (!roll || roll.kind !== "fish") {
    return { kind: "escaped" };
  }
  const def = roll.def;
  const distance = clamp01(ctx.distanceTiles / 5);
  const sizeFactor = clamp01(distance * ((ctx.level + 2) / 10) * (ctx.rng.range(90, 110) / 100));
  let quality = sizeFactor < 0.33 ? "normal" : sizeFactor < 0.66 ? "silver" : "gold";
  let sizeIn = Math.floor(def.minSize + (def.maxSize - def.minSize) * sizeFactor + 1);
  sizeIn = Math.max(def.minSize, sizeIn - Math.floor(ctx.outMs / 800));
  if (!ctx.perfect && sizeIn === def.maxSize) sizeIn -= 1;
  if (ctx.perfect && quality !== "normal") quality = upgrade(quality);
  let xp = (QUALITY_XP_INDEX[quality] + 1) * 3 + Math.floor(def.difficulty / 3);
  if (ctx.treasure.caught) xp = Math.floor(xp * 2.2);
  if (ctx.perfect) xp = Math.floor(xp * 2.4);
  if (def.legendary) xp = Math.floor(xp * 5);
  return {
    kind: "fish",
    def,
    size: sizeIn,
    quality,
    perfect: ctx.perfect,
    treasure: ctx.treasure.caught,
    xp
  };
}

// src/renderer/fishing/states/MinigameState.ts
var MinigameState = class {
  constructor(transition) {
    this.transition = transition;
  }
  name = "minigame";
  update(ctx, dt) {
    const fish = ctx.fish;
    if (!fish) {
      this.transition("idle");
      return;
    }
    fish.update(dt);
    ctx.bar.update(dt, ctx.held);
    const inBar = ctx.bar.contains(fish.pos, 4);
    const treasureCovers = ctx.treasure.visible && ctx.bar.contains(ctx.treasure.pos, 6);
    ctx.treasure.update(dt, treasureCovers);
    if (!inBar) {
      ctx.outMs += dt * 1e3;
      ctx.perfect = false;
    }
    ctx.progress.update(dt, inBar, fish.def.difficulty);
    ctx.audio.reelUpdate(ctx.progress.value);
    if (ctx.progress.full) {
      ctx.result = computeCatchResult(ctx);
      ctx.audio.fanfare();
      if (ctx.result.treasure) ctx.audio.treasure();
      this.transition("result");
    } else if (ctx.progress.empty) {
      ctx.result = { kind: "escaped" };
      ctx.audio.escape();
      this.transition("result");
    }
  }
};

// src/renderer/fishing/states/ResultState.ts
var ResultState = class {
  constructor(transition) {
    this.transition = transition;
  }
  name = "result";
  timer = 0;
  ready = false;
  enter(ctx) {
    this.timer = 0.9;
    this.ready = false;
    if (ctx.result) ctx.onResult(ctx.result);
  }
  update(_ctx, dt) {
    this.timer -= dt;
    if (this.timer <= 0) this.ready = true;
  }
  onPress(ctx) {
    if (!this.ready) return;
    ctx.result = null;
    ctx.fish = null;
    this.transition("idle");
  }
};

// src/renderer/fishing/FishingController.ts
var HINTS = {
  idle: "\u6309\u4F4F\u5DE6\u952E / C \u84C4\u529B\uFF0C\u677E\u5F00\u629B\u7AFF",
  charge: "\u677E\u5F00\u629B\u51FA\uFF01",
  cast: "",
  wait: "\u7B49\u5F85\u54AC\u94A9\u2026\uFF08\u70B9\u51FB\u53EF\u6536\u7AFF\uFF09",
  hook: "\u54AC\u94A9\u4E86\uFF01\u5FEB\u70B9\u51FB\uFF01",
  minigame: "\u6309\u4F4F\u4E0A\u5347 \xB7 \u677E\u5F00\u4E0B\u843D \xB7 \u8BA9\u9C7C\u5F85\u5728\u7EFF\u6761\u5185",
  result: "\u70B9\u51FB\u7EE7\u7EED"
};
var FishingController = class {
  constructor(deps) {
    this.deps = deps;
    this.player = new Player(T.PLAYER_X, T.PLAYER_FOOT_Y);
    this.ctx = {
      rng: deps.rng,
      audio: deps.audio,
      level: deps.save.level,
      held: false,
      rodTip: [T.PLAYER_X - T.CAT_W * T.CAT_SCALE / 2 + ROD_TIP.idle0[0] * T.CAT_SCALE, T.PLAYER_FOOT_Y - T.CAT_H * T.CAT_SCALE + ROD_TIP.idle0[1] * T.CAT_SCALE],
      castPower: 0,
      targetX: 0,
      targetY: 0,
      distanceTiles: 0,
      roll: null,
      biteTimerMs: 0,
      reactionLeftMs: 0,
      isFirstCast: true,
      fish: null,
      bar: new CatchBar(T.BAR_SIZE_BASE),
      progress: new ProgressBar(),
      treasure: new Treasure(deps.rng),
      outMs: 0,
      perfect: false,
      result: null,
      forcedFishId: null,
      onResult: (r) => this.handleResult(r),
      fishPool: deps.fishPool
    };
    const transition = (name) => this.machine.transition(name);
    this.castState = new CastState(transition);
    this.machine = new FishingMachine(this.ctx, {
      idle: new IdleState(transition),
      charge: new ChargeState(transition),
      cast: this.castState,
      wait: new WaitState(transition),
      hook: new HookState(transition),
      minigame: new MinigameState(transition),
      result: new ResultState(transition)
    });
  }
  machine;
  ctx;
  bobber = new Bobber();
  player;
  castState;
  splash = null;
  pressQueued = false;
  releaseQueued = false;
  heldFlag = false;
  prevName = "idle";
  handleResult(r) {
    const gained = this.deps.save.applyResult(r);
    if (gained > 0) {
      r.leveledUp = gained;
      this.deps.audio.levelUp();
    }
    this.ctx.level = this.deps.save.level;
  }
  /** Game 每逻辑步调用：注入输入 */
  setInput(held, press, release) {
    this.heldFlag = held;
    if (press) this.pressQueued = true;
    if (release) this.releaseQueued = true;
  }
  /** 沙盒：强制下一条鱼 */
  forceFish(id) {
    this.ctx.forcedFishId = id;
  }
  get stateName() {
    return this.machine.name;
  }
  update(dt, time) {
    this.ctx.held = this.heldFlag;
    this.ctx.level = this.deps.save.level;
    if (this.pressQueued) {
      this.pressQueued = false;
      this.machine.onPress();
    }
    if (this.releaseQueued) {
      this.releaseQueued = false;
      this.machine.onRelease();
    }
    this.machine.update(dt);
    const name = this.machine.name;
    if (name === "hook" && this.prevName !== "hook") {
      this.bobber.shake = 0.9;
    }
    if (name === "charge") {
      const p = this.ctx.castPower;
      this.player.setPose("cast", p < 0.34 ? 0 : p < 0.67 ? 1 : 2);
    } else if (name === "cast") {
      this.player.setPose("cast", 2);
    } else if (name === "hook" || name === "minigame") {
      this.player.setPose("reel");
    } else if (name === "result") {
      this.player.setPose(this.ctx.result?.kind === "fish" ? "show" : "idle");
    } else {
      this.player.setPose("idle");
    }
    if (name === "cast" && this.prevName !== "cast") {
      this.deps.save.noteCast();
      const [rx, ry] = this.rodTipWorld();
      this.bobber.launch(rx, ry, this.ctx.targetX, this.ctx.targetY);
    }
    const wasFlying = this.bobber.flying;
    this.bobber.update(dt, time);
    if (wasFlying && !this.bobber.flying) {
      this.splash = { x: this.bobber.x, y: this.bobber.y, frame: 0, t: 0 };
      this.deps.audio.splash();
      this.castState.onLanded(this.ctx);
    }
    if (this.splash) {
      this.splash.t += dt;
      this.splash.frame = Math.floor(this.splash.t / 0.09);
      if (this.splash.t > 0.28) this.splash = null;
    }
    this.prevName = name;
  }
  /** 竿尖世界坐标 */
  rodTipWorld() {
    const pose = this.player.pose === "cast" ? "cast2" : this.player.pose === "reel" ? "reel" : "idle0";
    const [dx, dy] = ROD_TIP[pose];
    const dw = T.CAT_W * T.CAT_SCALE;
    const dh = T.CAT_H * T.CAT_SCALE;
    return [this.player.x - dw / 2 + dx * T.CAT_SCALE, this.player.footY - dh + dy * T.CAT_SCALE];
  }
  buildResultView(r) {
    const view = {
      kind: r.kind,
      perfect: r.perfect,
      treasure: r.treasure,
      xp: r.xp,
      leveledUp: r.leveledUp
    };
    if (r.kind === "fish" && r.def) {
      view.fishName = r.def.name;
      view.fishIcon = this.deps.sprites.fish[r.def.id]?.[1];
      view.size = r.size;
      view.quality = r.quality;
    } else if (r.kind === "trash") {
      const idx = Math.floor(this.deps.rng.next() * this.deps.sprites.trash.length);
      view.trashIcon = this.deps.sprites.trash[idx];
    }
    return view;
  }
  getSceneState(time) {
    const name = this.machine.name;
    const showBobber = name === "cast" || name === "wait" || name === "hook" || name === "minigame";
    const [cur, span, pct] = xpProgress(this.deps.save.data.totalXp, this.deps.save.level);
    const minigame = name === "minigame" && this.ctx.fish ? {
      fishPos: this.ctx.fish.pos,
      fishVel: this.ctx.fish.vel,
      fishIcon: this.deps.sprites.fish[this.ctx.fish.def.id][this.ctx.fish.vel >= 0 ? 1 : 0],
      barPos: this.ctx.bar.pos,
      barSize: this.ctx.bar.size,
      progress: this.ctx.progress.value,
      treasure: this.ctx.treasure.visible ? { pos: this.ctx.treasure.pos, progress: this.ctx.treasure.progress } : null,
      legendary: !!this.ctx.fish.def.legendary
    } : null;
    return {
      time,
      playerPose: this.player.pose,
      playerFrame: this.player.frame,
      playerX: this.player.x,
      playerFootY: this.player.footY,
      bobber: showBobber ? { x: this.bobber.x, y: this.bobber.y, shake: this.bobber.shake } : null,
      splash: this.splash,
      lineVisible: showBobber && this.bobber.landed,
      minigame,
      result: name === "result" && this.ctx.result ? this.buildResultView(this.ctx.result) : null,
      hud: {
        level: this.deps.save.level,
        xp: cur,
        xpNeeded: span,
        xpPct: pct,
        hint: HINTS[name] ?? "",
        charge: name === "charge" ? this.ctx.castPower : -1,
        exclaim: name === "hook",
        exclaimX: name === "hook" ? this.bobber.x : this.player.x,
        exclaimY: name === "hook" ? this.bobber.y - 14 : this.player.footY - 40,
        casts: this.deps.save.data.stats.casts,
        caught: this.deps.save.data.stats.caught
      }
    };
  }
};

// src/renderer/fishing/data/SaveStore.ts
var KEY = "fishing-codex-save-v1";
function defaultSave() {
  return {
    version: 1,
    totalXp: 0,
    collection: {},
    stats: { casts: 0, caught: 0, escaped: 0, trash: 0, perfect: 0, treasure: 0 }
  };
}
var SaveStore = class {
  data;
  constructor() {
    this.data = this.load();
  }
  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaultSave();
      const parsed = JSON.parse(raw);
      if (parsed.version !== 1) return defaultSave();
      return { ...defaultSave(), ...parsed, stats: { ...defaultSave().stats, ...parsed.stats } };
    } catch {
      return defaultSave();
    }
  }
  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
    }
  }
  get level() {
    return levelFromXp(this.data.totalXp);
  }
  noteCast() {
    this.data.stats.casts++;
    this.save();
  }
  /** 应用一次钓鱼结果，返回升级数 */
  applyResult(r) {
    const before = this.level;
    const stats = this.data.stats;
    if (r.kind === "fish" && r.def) {
      stats.caught++;
      if (r.perfect) stats.perfect++;
      if (r.treasure) stats.treasure++;
      this.data.totalXp += r.xp ?? 0;
      const entry = this.data.collection[r.def.id] ?? { count: 0, bestSize: 0, bestQuality: "normal" };
      entry.count++;
      if ((r.size ?? 0) > entry.bestSize) entry.bestSize = r.size ?? 0;
      if (qualityRank(r.quality ?? "normal") > qualityRank(entry.bestQuality)) entry.bestQuality = r.quality ?? "normal";
      this.data.collection[r.def.id] = entry;
    } else if (r.kind === "trash") {
      stats.trash++;
      this.data.totalXp += r.xp ?? 3;
    } else {
      stats.escaped++;
    }
    this.save();
    return Math.max(0, this.level - before);
  }
};
function qualityRank(q) {
  return q === "iridium" ? 3 : q === "gold" ? 2 : q === "silver" ? 1 : 0;
}

// src/renderer/fishing/data/fishTable.ts
var FISH_TABLE = [
  { id: "carp", name: "\u9CA4\u9C7C", nameEn: "Carp", difficulty: 15, behavior: "mixed", minSize: 15, maxSize: 51, color: "#8a9a4e", color2: "#c8b86e", body: "spindle", weight: 14 },
  { id: "herring", name: "\u9CB1\u9C7C", nameEn: "Herring", difficulty: 25, behavior: "dart", minSize: 8, maxSize: 21, color: "#9fb8cc", color2: "#dfe8f0", body: "long", weight: 10 },
  { id: "anchovy", name: "\u51E4\u5C3E\u9C7C", nameEn: "Anchovy", difficulty: 30, behavior: "dart", minSize: 1, maxSize: 17, color: "#7fa8c8", color2: "#c4dcec", body: "long", weight: 10 },
  { id: "sunfish", name: "\u592A\u9633\u9C7C", nameEn: "Sunfish", difficulty: 30, behavior: "mixed", minSize: 5, maxSize: 16, color: "#e8a83a", color2: "#f0d060", body: "spindle", weight: 12 },
  { id: "bream", name: "\u9CB7\u9C7C", nameEn: "Bream", difficulty: 35, behavior: "smooth", minSize: 12, maxSize: 31, color: "#a8b8a0", color2: "#d8e0d0", body: "flat", weight: 10 },
  { id: "sea_cucumber", name: "\u6D77\u53C2", nameEn: "Sea Cucumber", difficulty: 40, behavior: "sinker", minSize: 3, maxSize: 21, color: "#7a5a6e", color2: "#a88498", body: "long", weight: 8 },
  { id: "walleye", name: "\u5927\u773C\u68AD\u9C88", nameEn: "Walleye", difficulty: 45, behavior: "smooth", minSize: 10, maxSize: 41, color: "#8a7a4e", color2: "#c8b86e", body: "spindle", weight: 8 },
  { id: "largemouth_bass", name: "\u5927\u53E3\u9C88", nameEn: "Largemouth Bass", difficulty: 50, behavior: "mixed", minSize: 11, maxSize: 31, color: "#5a8a4e", color2: "#a8c86e", body: "spindle", weight: 9 },
  { id: "pike", name: "\u72D7\u9C7C", nameEn: "Pike", difficulty: 60, behavior: "dart", minSize: 15, maxSize: 61, color: "#6a8a3a", color2: "#c8d86e", body: "long", weight: 6 },
  { id: "tuna", name: "\u91D1\u67AA\u9C7C", nameEn: "Tuna", difficulty: 70, behavior: "smooth", minSize: 12, maxSize: 61, color: "#3a6a9a", color2: "#9fc8e8", body: "spindle", weight: 5 },
  { id: "catfish", name: "\u9CB6\u9C7C", nameEn: "Catfish", difficulty: 75, behavior: "mixed", minSize: 12, maxSize: 73, color: "#7a6a52", color2: "#a89878", body: "long", weight: 5 },
  { id: "squid", name: "\u9C7F\u9C7C", nameEn: "Squid", difficulty: 75, behavior: "sinker", minSize: 12, maxSize: 49, color: "#d8a8b8", color2: "#f0d0dc", body: "long", weight: 5 },
  { id: "pufferfish", name: "\u6CB3\u8C5A", nameEn: "Pufferfish", difficulty: 80, behavior: "floater", minSize: 1, maxSize: 37, color: "#e8c53a", color2: "#f8e890", body: "round", weight: 4 },
  { id: "octopus", name: "\u7AE0\u9C7C", nameEn: "Octopus", difficulty: 95, behavior: "sinker", minSize: 12, maxSize: 49, color: "#a85a6e", color2: "#d88a9e", body: "round", weight: 3 },
  { id: "legend", name: "\u9C7C\u738B", nameEn: "Legend", difficulty: 110, behavior: "mixed", minSize: 49, maxSize: 51, color: "#d6452e", color2: "#f0a030", body: "spindle", legendary: true, weight: 0.4 }
];
var FISH_BY_ID = Object.fromEntries(FISH_TABLE.map((f) => [f.id, f]));

// scripts/smoke.ts
var memStore = /* @__PURE__ */ new Map();
globalThis.localStorage = {
  getItem: (k) => memStore.get(k) ?? null,
  setItem: (k, v) => void memStore.set(k, v),
  removeItem: (k) => void memStore.delete(k),
  clear: () => memStore.clear()
};
var fakeCanvas = { width: 8, height: 12 };
var fakeSprites = {
  fish: Object.fromEntries(FISH_TABLE.map((f) => [f.id, [fakeCanvas, fakeCanvas]])),
  trash: [fakeCanvas, fakeCanvas, fakeCanvas]
};
var DT = 1 / 60;
function makeController(seed, totalXp = 0) {
  const rng = new Rng(seed);
  const audio = new AudioBus();
  const save = new SaveStore();
  save.data = {
    version: 1,
    totalXp,
    collection: {},
    stats: { casts: 0, caught: 0, escaped: 0, trash: 0, perfect: 0, treasure: 0 }
  };
  const ctrl = new FishingController({ rng, audio, sprites: fakeSprites, fishPool: FISH_TABLE, save });
  return { ctrl, save, rng };
}
function simulate(seed, opts = {}) {
  const { smart = true, reactInHook = true } = opts;
  const { ctrl, save } = makeController(seed, opts.totalXp ?? 0);
  if (opts.forceId) ctrl.forceFish(opts.forceId);
  let steps = 0;
  let phase = "idle";
  let chargeSteps = 0;
  let resultSteps = 0;
  const maxSteps = 2e4;
  while (steps < maxSteps) {
    steps++;
    const name = ctrl.stateName;
    if (name === "idle") {
      if (phase === "result") break;
      phase = "charge";
      chargeSteps = 0;
      ctrl.setInput(true, true, false);
    } else if (name === "charge") {
      chargeSteps++;
      ctrl.setInput(true, false, false);
      if (chargeSteps >= 60) ctrl.setInput(false, false, true);
    } else if (name === "cast") {
      ctrl.setInput(false, false, false);
    } else if (name === "wait") {
      ctrl.setInput(false, false, false);
    } else if (name === "hook") {
      if (phase !== "waitHook") {
        phase = "waitHook";
        if (reactInHook) ctrl.setInput(true, true, false);
        else ctrl.setInput(false, false, false);
      } else {
        ctrl.setInput(false, false, false);
      }
    } else if (name === "minigame") {
      const st = ctrl.getSceneState(steps * DT).minigame;
      if (!st) {
        throw new Error("minigame state without view state");
      }
      const center = st.barPos + st.barSize / 2;
      const hold = smart ? st.fishPos < center : steps % 7 < 4;
      ctrl.setInput(hold, false, false);
    } else if (name === "result") {
      if (phase !== "result") {
        phase = "result";
        resultSteps = 0;
      }
      resultSteps++;
      ctrl.setInput(true, true, false);
    }
    ctrl.update(DT, steps * DT);
  }
  if (steps >= maxSteps) throw new Error(`simulation timeout (seed=${seed})`);
  return {
    casts: save.data.stats.casts,
    caught: save.data.stats.caught,
    escaped: save.data.stats.escaped,
    trash: save.data.stats.trash,
    totalXp: save.data.totalXp,
    level: save.level,
    steps
  };
}
var failures = 0;
function check(label, cond, detail = "") {
  if (cond) {
    console.log(`  \u2713 ${label}${detail ? " \u2014 " + detail : ""}`);
  } else {
    failures++;
    console.error(`  \u2717 ${label}${detail ? " \u2014 " + detail : ""}`);
  }
}
console.log("1. \u667A\u80FD\u7B56\u7565\u9493\u9CA4\u9C7C\uFF08\u96BE\u5EA615\uFF09x10");
{
  let caught = 0;
  let escaped = 0;
  let xp = 0;
  for (let i = 0; i < 10; i++) {
    const o = simulate(1e3 + i, { forceId: "carp", smart: true });
    caught += o.caught;
    escaped += o.escaped;
    xp += o.totalXp;
    if (o.casts !== 1) throw new Error(`casts should be 1, got ${o.casts}`);
  }
  check("10 \u6B21\u629B\u7AFF\u5168\u90E8\u5B8C\u6210", true, `caught=${caught} escaped=${escaped}`);
  check("\u667A\u80FD\u7B56\u7565\u81F3\u5C11\u9493\u4E0A 5 \u6761", caught >= 5, `caught=${caught}/10`);
  check("\u7ECF\u9A8C\u6B63\u5E38\u7D2F\u79EF", xp > 0, `xp=${xp}`);
}
console.log("2. \u968F\u673A\u4E71\u6309\uFF08\u4E0D\u667A\u80FD\uFF09x10 \u2014 \u7A33\u5B9A\u6027");
{
  let caught = 0;
  for (let i = 0; i < 10; i++) {
    const o = simulate(2e3 + i, { forceId: "anchovy", smart: false });
    caught += o.caught;
  }
  check("\u4E71\u6309\u4E5F\u80FD\u5076\u5C14\u9493\u5230", caught >= 0, `caught=${caught}/10`);
}
console.log("3. \u9519\u8FC7\u611F\u53F9\u53F7 -> \u9003\u8131");
{
  const o = simulate(3001, { forceId: "carp", reactInHook: false });
  check("\u8FC7\u665A\u70B9\u51FB\u9C7C\u9003\u8D70", o.escaped === 1 && o.caught === 0, `escaped=${o.escaped} caught=${o.caught}`);
}
console.log("4. \u9AD8\u96BE\u5EA6\u9C7C\u738B\uFF08110\uFF09x3 \u2014 \u4E0D\u5D29\u6E83");
{
  for (let i = 0; i < 3; i++) {
    const o = simulate(4e3 + i, { forceId: "legend", smart: true });
    check(`\u9C7C\u738B\u6A21\u62DF ${i + 1} \u5B8C\u6210`, o.casts === 1, `caught=${o.caught} escaped=${o.escaped} xp=${o.totalXp}`);
  }
}
console.log("5. \u5347\u7EA7\u8DEF\u5F84\uFF08\u9884\u7F6E 95 XP\uFF0C\u9493\u9CA4\u9C7C\u5E94\u5347 1 \u7EA7\uFF09");
{
  const o = simulate(5001, { forceId: "carp", smart: true, totalXp: 95 });
  check("\u6355\u83B7\u540E\u8FBE\u5230 1 \u7EA7", o.level >= 1, `level=${o.level} totalXp=${o.totalXp}`);
}
console.log("6. \u5783\u573E\u5206\u652F\uFF08\u65E0\u5F3A\u5236\u9C7C\uFF0C20 \u6B21\u62BD\u6837\u81F3\u5C11\u51FA\u73B0\u5783\u573E\u6216\u9C7C\uFF09");
{
  let trash = 0;
  let caught = 0;
  for (let i = 0; i < 20; i++) {
    const o = simulate(6e3 + i, { smart: true });
    trash += o.trash;
    caught += o.caught;
  }
  check("20 \u6B21\u62BD\u6837\u6709\u4EA7\u51FA", trash + caught > 0, `trash=${trash} caught=${caught}`);
}
console.log("7. \u5B9D\u7BB1\u4E0E\u5B8C\u7F8E\u7EDF\u8BA1\u5B57\u6BB5\u5B58\u5728");
{
  const { ctrl, save } = makeController(7001);
  ctrl.forceFish("carp");
  check("\u63A7\u5236\u5668\u53EF\u6784\u9020", ctrl.stateName === "idle" && save.level === 0);
}
console.log(failures === 0 ? "\n\u5168\u90E8\u901A\u8FC7 \u2705" : `
${failures} \u9879\u5931\u8D25 \u274C`);
process.exit(failures === 0 ? 0 : 1);
