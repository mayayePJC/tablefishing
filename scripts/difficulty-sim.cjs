"use strict";

// src/renderer/shared/constants.ts
var T = {
  // ---------- 桌宠窗口（透明、可拖拽） ----------
  VIEW_W: 340,
  VIEW_H: 390,
  /** 垂钓者精灵原生素材尺寸（像素）：星露谷默认农夫，站立人形，面朝左 */
  PLAYER_W: 24,
  PLAYER_H: 40,
  /** 垂钓者在桌面上的显示缩放（紧凑化下调） */
  PLAYER_SCALE: 2.6,
  // ---------- 桌宠布局：人在右侧、左侧抛竿，无池塘（透明桌面上直接垂钓） ----------
  /** 玩家（垂钓者）站位：窗口右侧 */
  PLAYER_X: 238,
  PLAYER_FOOT_Y: 342,
  /** 抛竿落点范围（左下，不必太远） */
  CAST_X_MIN: 95,
  CAST_X_MAX: 160,
  CAST_Y_MIN: 300,
  CAST_Y_MAX: 345,
  /** 右下角退出按钮（圆形 X，小巧） */
  QUIT_BTN: { x: 320, y: 370, r: 10 },
  // ---------- 小游戏轨道（官方锚点） ----------
  /** 官方：轨道总高 568px */
  TRACK_H: 568,
  /** 流传参考值：绿条底部静止边界 546（=568-22，底部判定更宽松） */
  BAR_BOTTOM: 546,
  BAR_ACCEL_UP: 720,
  BAR_GRAVITY: 288,
  BAR_SPEED_MAX: 96,
  BAR_BOUNCE: 30,
  /** 桌宠手感：0 级绿条放大到 124px（官方 96px），每级 +8px，更易命中 */
  BAR_SIZE_BASE: 124,
  BAR_SIZE_PER_LEVEL: 8,
  // ---------- 鱼 AI（桌宠：整体放缓，降低难度悬崖） ----------
  FISH_SPEED_BASE: 46,
  FISH_SPEED_PER_DIFF: 0.65,
  FISH_SPRING_K: 3,
  FISH_DAMPING: 4.5,
  DART_AMP_BASE: 52,
  DART_AMP_PER_DIFF: 0.55,
  /** 难度 110 的变向间隔（ms） */
  DART_INTERVAL_EASY: 380,
  /** 难度 15 的变向间隔（ms） */
  DART_INTERVAL_HARD: 2600,
  /** 官方：sinker 向下加速度更快 / floater 向上加速度更快（桌宠下调） */
  SINKER_ACCEL: 52,
  FLOATER_ACCEL: 52,
  // ---------- 进度条（桌宠：增益高于流失，开局不再瞬间掉） ----------
  PROGRESS_INITIAL: 0.35,
  PROGRESS_GAIN: 0.16,
  PROGRESS_DRAIN_BASE: 0.11,
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
  /** 桌宠节奏：咬钩 0.7~8s 随机（官方 0.6~30s 对桌宠太慢） */
  BITE_MIN_MS: 700,
  BITE_MAX_MS: 8e3,
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

// src/renderer/fishing/entities/Fish.ts
var HALF = 4;
var BEHAVIOR_INTERVAL = {
  mixed: 1,
  smooth: 1.35,
  sinker: 1.15,
  floater: 1.15,
  dart: 0.65
};
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
var Fish = class {
  constructor(def, rng) {
    this.def = def;
    this.rng = rng;
    this.pos = T.TRACK_H * rng.range(0.25, 0.75);
    this.diff = clamp(this.def.difficulty * rng.range(0.85, 1.15), 10, 110);
    this.pickTarget();
  }
  /** 鱼图标中心位置（轨道单位，0 = 顶端） */
  pos;
  vel = 0;
  target = 0;
  dartTimer = 0;
  /** 本局有效难度：基础难度 × 随机抖动(0.85~1.15)，让同一物种时难时易 */
  diff;
  update(dt) {
    const d = this.diff;
    let bias = 0;
    if (this.def.behavior === "sinker") bias = T.SINKER_ACCEL;
    if (this.def.behavior === "floater") bias = -T.FLOATER_ACCEL;
    this.dartTimer -= dt * 1e3;
    if (this.dartTimer <= 0) this.pickTarget();
    const accel = (this.target - this.pos) * T.FISH_SPRING_K;
    this.vel += (accel + bias - this.vel) * T.FISH_DAMPING * dt;
    const vmax = T.FISH_SPEED_BASE + T.FISH_SPEED_PER_DIFF * d;
    this.vel = clamp(this.vel, -vmax, vmax);
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
    const d = this.diff;
    const base = lerp(T.DART_INTERVAL_HARD, T.DART_INTERVAL_EASY, clamp((d - 15) / 95, 0, 1));
    this.dartTimer = base * BEHAVIOR_INTERVAL[this.def.behavior] * this.rng.range(0.7, 1.3);
    let amp = T.DART_AMP_BASE + T.DART_AMP_PER_DIFF * d;
    if (this.def.behavior === "dart") amp *= 1 + 2 * d / 100;
    if (this.def.behavior === "smooth") amp *= 0.7;
    const dir = this.rng.chance(0.5) ? -1 : 1;
    this.target = clamp(this.pos + dir * amp * this.rng.next(), HALF, T.TRACK_H - HALF);
  }
};

// src/renderer/fishing/entities/CatchBar.ts
function clamp2(v, lo, hi) {
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
    this.vel = clamp2(this.vel, -T.BAR_SPEED_MAX, T.BAR_SPEED_MAX);
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
function clamp3(v, lo, hi) {
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
    this.value = clamp3(this.value, 0, 1);
  }
  get full() {
    return this.value >= 1;
  }
  get empty() {
    return this.value <= 0;
  }
};

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

// scripts/difficulty-sim.ts
var DT = 1 / 60;
function clamp4(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
function makeBarCenteredOn(fish, level) {
  const size = T.BAR_SIZE_BASE + T.BAR_SIZE_PER_LEVEL * level;
  const bar = new CatchBar(size);
  const maxP = T.BAR_BOTTOM - size;
  bar.pos = clamp4(fish.pos - size / 2, 0, maxP);
  return bar;
}
function oneRun(def, align) {
  let s = def.difficulty * 2654435761 >>> 0;
  const rnd = () => {
    s = s * 1664525 + 1013904223 >>> 0;
    return s / 4294967295;
  };
  const rng = {
    range: (a, b) => a + (b - a) * rnd(),
    next: () => rnd(),
    chance: (p) => rnd() < p
  };
  const fish = new Fish(def, rng);
  const level = 0;
  const bar = align ? makeBarCenteredOn(fish, level) : new CatchBar(T.BAR_SIZE_BASE + T.BAR_SIZE_PER_LEVEL * level);
  const progress = new ProgressBar();
  let sec = 0;
  for (let i = 0; i < 60 * 60; i++) {
    sec += DT;
    fish.update(DT);
    const center = bar.pos + bar.size / 2;
    bar.update(DT, fish.pos < center);
    const inBar = fish.pos >= bar.pos - 4 && fish.pos <= bar.pos + bar.size + 4;
    progress.update(DT, inBar, def.difficulty);
    if (progress.full) return { caught: true, sec };
    if (progress.empty) return { caught: false, sec };
  }
  return { caught: false, sec };
}
function run(align) {
  const N = Number(process.argv[2] ?? 40);
  console.log(`
=== ${align ? "\u5F00\u5C40\u5BF9\u9F50(\u9C7C\u5728\u7EFF\u6761\u5185)" : "\u539F\u7248(\u7EFF\u6761\u5C45\u4E2D/\u9C7C\u968F\u673A)"} | \u6BCF\u6761\u9C7C ${N} \u6B21 ===`);
  console.log("\u9C7C\u540D        \u96BE\u5EA6  \u884C\u4E3A    \u6355\u83B7\u7387   \u5E73\u5747\u79D2\u6570");
  for (const f of FISH_TABLE) {
    let caught = 0;
    let tot = 0;
    for (let i = 0; i < N; i++) {
      const r = oneRun(f, align);
      if (r.caught) caught++;
      tot += r.sec;
    }
    const rate = (caught / N * 100).toFixed(0).padStart(3) + "%";
    const avg = (tot / N).toFixed(1);
    console.log(`${f.name.padEnd(8, "\u3000")} ${String(f.difficulty).padStart(3)}  ${f.behavior.padEnd(7)} ${rate}    ${avg}s`);
  }
}
run(false);
run(true);
