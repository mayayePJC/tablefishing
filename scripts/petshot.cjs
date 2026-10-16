"use strict";

// scripts/petshot.ts
var import_canvas = require("@napi-rs/canvas");

// src/renderer/render/PixelCanvas.ts
var hexCache = /* @__PURE__ */ new Map();
function hexToRgb(hex) {
  const cached = hexCache.get(hex);
  if (cached) return cached;
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  const rgb = [n >> 16 & 255, n >> 8 & 255, n & 255];
  hexCache.set(hex, rgb);
  return rgb;
}
function mixHex(a, b, t) {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const bl = Math.round(b1 + (b2 - b1) * t);
  return `#${(1 << 24 | r << 16 | g << 8 | bl).toString(16).slice(1)}`;
}
var PixelCanvas = class _PixelCanvas {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.canvas = document.createElement("canvas");
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext("2d");
    this.data = this.ctx.createImageData(w, h).data;
  }
  canvas;
  ctx;
  data;
  px(x, y, color, alpha = 1) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const [r, g, b] = hexToRgb(color);
    const i = (y * this.w + x) * 4;
    this.data[i] = r;
    this.data[i + 1] = g;
    this.data[i + 2] = b;
    this.data[i + 3] = Math.round(255 * alpha);
  }
  /** 读取某像素颜色（未 bake 时读 data，bake 后仍可用） */
  getPx(x, y) {
    const i = (Math.round(y) * this.w + Math.round(x)) * 4;
    const [r, g, b] = [this.data[i], this.data[i + 1], this.data[i + 2]];
    return `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`;
  }
  fill(color, alpha = 1) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.px(x, y, color, alpha);
  }
  rect(x, y, w, h, color, alpha = 1) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, color, alpha);
  }
  /** 空心矩形描边 */
  strokeRect(x, y, w, h, color) {
    for (let i = 0; i < w; i++) {
      this.px(x + i, y, color);
      this.px(x + i, y + h - 1, color);
    }
    for (let j = 0; j < h; j++) {
      this.px(x, y + j, color);
      this.px(x + w - 1, y + j, color);
    }
  }
  /** 实心椭圆 */
  ellipse(cx, cy, rx, ry, color, alpha = 1) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.px(x, y, color, alpha);
      }
    }
  }
  /** 三角形（重心坐标法，实心） */
  triangle(x1, y1, x2, y2, x3, y3, color) {
    const minX = Math.floor(Math.min(x1, x2, x3));
    const maxX = Math.ceil(Math.max(x1, x2, x3));
    const minY = Math.floor(Math.min(y1, y2, y3));
    const maxY = Math.ceil(Math.max(y1, y2, y3));
    const d = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
    if (d === 0) return;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const l1 = ((y2 - y3) * (x - x3) + (x3 - x2) * (y - y3)) / d;
        const l2 = ((y3 - y1) * (x - x3) + (x1 - x3) * (y - y3)) / d;
        const l3 = 1 - l1 - l2;
        if (l1 >= 0 && l2 >= 0 && l3 >= 0) this.px(x, y, color);
      }
    }
  }
  /** 可播种噪点：以 prob 概率把像素换成 colors 中的随机一色 */
  noise(seed, prob, colors) {
    let s = seed >>> 0;
    const rand = () => {
      s = s * 1664525 + 1013904223 >>> 0;
      return s / 4294967296;
    };
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (rand() < prob) this.px(x, y, colors[Math.floor(rand() * colors.length)]);
      }
    }
  }
  /** 水平翻转（生成面向另一侧的精灵） */
  flipped() {
    const out = new _PixelCanvas(this.w, this.h);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        out.px(this.w - 1 - x, y, this.getPx(x, y));
      }
    }
    return out;
  }
  /** 冻结 ImageData 到 canvas，返回可绘制对象 */
  bake() {
    const img = this.ctx.createImageData(this.w, this.h);
    img.data.set(this.data);
    this.ctx.putImageData(img, 0, 0);
    return this.canvas;
  }
};

// src/renderer/render/Palette.ts
var PAL = {
  // 天空
  skyTop: "#5ea9d6",
  skyMid: "#8ecfe8",
  skyLow: "#c4e8f2",
  cloud: "#ffffff",
  cloudShade: "#d8ecf5",
  // 远岸
  sand: "#e3cf9e",
  sandShade: "#cbb37e",
  treeDark: "#2e6b34",
  treeMid: "#3f8a3f",
  treeLight: "#57a54b",
  // 水
  waterDeep: "#1d5c7a",
  waterMid: "#2a7fa3",
  waterLight: "#4aa8c4",
  waterFoam: "#e8f6f9",
  // 草地/泥土
  grass: "#5aa64b",
  grassDark: "#4c9440",
  grassLight: "#6fbf56",
  dirt: "#a8763e",
  dirtDark: "#8a5c2e",
  // 木头
  wood: "#7a5230",
  woodDark: "#5d3d22",
  woodLight: "#9c6d40",
  // 角色
  skin: "#f0c8a0",
  skinShade: "#d9a87c",
  hair: "#6b4226",
  hairLight: "#8a5a34",
  shirt: "#3f6fb5",
  shirtDark: "#2f5390",
  pants: "#4a4f63",
  boot: "#3a2e22",
  // 小游戏 UI
  uiBorder: "#0d2b3a",
  barFill: "#82e500",
  barFillDark: "#5aa800",
  barEdge: "#216501",
  barHighlight: "#c8ff7a",
  trackTop: "#9fd9e8",
  trackBottom: "#12506b",
  progressLow: "#d64545",
  progressMid: "#e8c53a",
  progressHigh: "#5fd45f",
  chest: "#8a5a2e",
  chestDark: "#5d3d22",
  chestGold: "#e8c53a",
  exclaim: "#ffd23f",
  exclaimDark: "#b8860b",
  crown: "#ffb830",
  // 文字
  textLight: "#e8f6f9",
  textDark: "#0d2b3a",
  textShadow: "rgba(6, 13, 20, 0.55)"
};
var QUALITY_COLOR = {
  normal: "#c8ccd4",
  silver: "#dfe8f0",
  gold: "#ffd23f",
  iridium: "#7ec8f0"
};
var QUALITY_LABEL = {
  normal: "\u666E\u901A",
  silver: "\u94F6\u661F",
  gold: "\u91D1\u661F",
  iridium: "\u94F1\u661F"
};

// src/renderer/render/SpriteFactory.ts
var INK = "#241a12";
var OUT = "#241a12";
var ROD_TIP = {
  idle0: [4, 4],
  idle1: [4, 4],
  cast0: [4, 10],
  cast1: [4, 6],
  cast2: [3, 3],
  reel: [4, 9],
  show: [20, 18]
};
var SKIN = PAL.skin;
var SKIN_D = PAL.skinShade;
var HAIR = PAL.hair;
var HAIR_L = PAL.hairLight;
var SHIRT = "#57a64b";
var SHIRT_D = "#3f7d38";
var SHIRT_L = "#6fbf56";
var PANTS = "#3a4a6b";
var PANTS_D = "#2c3852";
var BOOT = PAL.boot;
function blk(pc, x, y, w, h, fill) {
  pc.rect(x - 1, y - 1, w + 2, h + 2, OUT);
  pc.rect(x, y, w, h, fill);
}
function rodLine(pc, x1, y1, x2, y2) {
  let x = x1;
  let y = y1;
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  const sx = x1 < x2 ? 1 : -1;
  const sy = y1 < y2 ? 1 : -1;
  let err = dx - dy;
  for (let i = 0; i < 60; i++) {
    pc.px(x, y, PAL.woodDark);
    if (x === x2 && y === y2) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
  pc.px(x2, y2, PAL.woodLight);
}
function drawPlayer(pose) {
  const pc = new PixelCanvas(24, 40);
  const isShow = pose === "show";
  blk(pc, 7, 28, 4, 9, PANTS);
  blk(pc, 13, 28, 4, 9, PANTS);
  pc.rect(7, 36, 4, 1, PANTS_D);
  pc.rect(13, 36, 4, 1, PANTS_D);
  blk(pc, 7, 37, 4, 3, BOOT);
  blk(pc, 13, 37, 4, 3, BOOT);
  blk(pc, 7, 16, 10, 12, SHIRT);
  pc.rect(7, 16, 10, 1, SHIRT_L);
  pc.rect(7, 26, 10, 1, SHIRT_D);
  pc.rect(7, 27, 10, 1, PANTS_D);
  blk(pc, 8, 7, 8, 8, SKIN);
  pc.rect(8, 14, 8, 1, SKIN_D);
  if (pose === "idle1") {
    pc.rect(10, 10, 1, 1, SKIN_D);
    pc.rect(13, 10, 1, 1, SKIN_D);
  } else {
    pc.px(10, 10, OUT);
    pc.px(13, 10, OUT);
  }
  pc.rect(11, 12, 2, 1, OUT);
  blk(pc, 7, 3, 10, 5, HAIR);
  pc.rect(7, 3, 10, 1, HAIR_L);
  pc.rect(7, 7, 2, 4, HAIR);
  pc.rect(15, 7, 2, 4, HAIR);
  if (isShow) {
    blk(pc, 7, 9, 2, 8, SHIRT);
    pc.rect(7, 8, 2, 2, SKIN);
    blk(pc, 15, 9, 2, 8, SHIRT);
    pc.rect(15, 8, 2, 2, SKIN);
    pc.ellipse(11, 7, 3.4, 2, "#6fb0d0");
    pc.ellipse(11, 7, 2.2, 1.3, "#bfe6f2");
    pc.triangle(14, 7, 11, 5.5, 11, 8.5, "#4a93b0");
    pc.px(9, 6, INK);
    rodLine(pc, 18, 30, 20, 18);
  } else {
    blk(pc, 16, 17, 3, 9, SHIRT);
    pc.rect(16, 25, 3, 2, SKIN);
    blk(pc, 4, 12, 2, 6, SHIRT);
    pc.rect(4, 11, 2, 2, SKIN);
    const tip = ROD_TIP[pose];
    rodLine(pc, 5, 12, tip[0], tip[1]);
  }
  return pc.bake();
}
function drawBobber() {
  const pc = new PixelCanvas(6, 6);
  pc.px(3, 0, "#8a8f98");
  pc.rect(2, 1, 2, 2, "#d64545");
  pc.px(2, 1, "#f07b7b");
  pc.rect(2, 3, 2, 2, "#f2f5f7");
  pc.rect(2, 5, 2, 1, "#b9c2cb");
  return pc.bake();
}
function drawSplash() {
  const frames = [];
  const droplets = [
    [[6, 1], [4, 2], [8, 2]],
    [[6, 0], [3, 1], [9, 1], [5, 3], [7, 3]],
    [[5, 0], [8, 0], [2, 2], [10, 2], [4, 4], [7, 4]]
  ];
  for (let f = 0; f < 3; f++) {
    const pc = new PixelCanvas(14, 10);
    const rx = 2.2 + f * 1.6;
    const ry = 1 + f * 0.6;
    pc.ellipse(7, 6, rx + 1, ry + 1, OUT, 0.9);
    pc.ellipse(7, 6, rx, ry, PAL.waterLight, 0.95);
    pc.ellipse(7, 6, rx - 1, ry - 0.5, PAL.waterFoam, 0.75);
    for (const [x, y] of droplets[f]) {
      pc.rect(x - 1, y - 1, 2, 2, OUT);
      pc.px(x - 1, y - 1, PAL.waterFoam);
    }
    frames.push(pc.bake());
  }
  return frames;
}
function drawFishBody(body, c1, c2) {
  const pc = new PixelCanvas(12, 8);
  const belly = mixHex(c1, "#ffffff", 0.35);
  const dark = mixHex(c1, "#000000", 0.35);
  switch (body) {
    case "spindle":
      pc.ellipse(6, 4, 5, 2.6, c1);
      pc.rect(4, 6, 5, 1, belly);
      pc.triangle(1, 4, 4, 2, 4, 6, c2);
      pc.triangle(6, 1, 8, 1, 7, 0, c2);
      pc.px(9, 3, INK);
      pc.px(10, 3, INK);
      pc.rect(2, 3, 2, 1, dark, 0.5);
      break;
    case "long":
      pc.ellipse(6, 4, 4.5, 1.7, c1);
      pc.rect(4, 5, 5, 1, belly);
      pc.triangle(1, 4, 4, 2, 4, 6, c2);
      pc.triangle(11, 4, 10, 2, 10, 6, c2);
      pc.px(9, 3, INK);
      pc.rect(3, 3, 2, 1, dark, 0.4);
      break;
    case "round":
      pc.ellipse(6, 4, 3.5, 3, c1);
      pc.rect(4, 6, 4, 1, belly);
      pc.triangle(2, 4, 4, 3, 4, 5, c2);
      pc.px(9, 1, c2);
      pc.px(3, 1, c2);
      pc.px(9, 7, c2);
      pc.px(3, 7, c2);
      pc.px(9, 4, INK);
      pc.rect(4, 3, 2, 1, dark, 0.4);
      break;
    case "flat":
      pc.ellipse(6, 4, 3.2, 3.2, c1);
      pc.rect(4, 6, 4, 1, belly);
      pc.triangle(2, 4, 4, 2, 4, 6, c2);
      pc.px(8, 3, INK);
      pc.rect(4, 2, 2, 1, dark, 0.4);
      break;
  }
  return pc;
}
function rotate90(src, cw) {
  const out = new PixelCanvas(src.h, src.w);
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const nx = cw ? src.h - 1 - y : y;
      const ny = cw ? x : src.w - 1 - x;
      out.px(nx, ny, src.getPx(x, y));
    }
  }
  return out;
}
function drawTrash() {
  const paper = new PixelCanvas(12, 8);
  paper.rect(1, 1, 10, 6, "#d8dde2");
  paper.rect(1, 1, 10, 1, "#eef2f5");
  paper.rect(2, 3, 8, 1, "#9aa4ad");
  paper.rect(2, 5, 6, 1, "#9aa4ad");
  paper.rect(1, 7, 10, 1, "#8a939b");
  paper.px(0, 2, "#b9c2cb");
  paper.px(11, 5, "#b9c2cb");
  const weed = new PixelCanvas(12, 8);
  for (let i = 0; i < 3; i++) {
    const bx = 2 + i * 4;
    for (let y = 7; y >= 1; y--) {
      const wob = Math.round(Math.sin((7 - y) * 0.7 + i) * 1.6);
      weed.px(bx + wob, y, i === 1 ? "#3f8a3f" : "#2e6b34");
      if (y < 6) weed.px(bx + wob + 1, y, "#57a54b");
    }
  }
  const boot = new PixelCanvas(12, 8);
  boot.rect(2, 1, 4, 5, "#5d3d22");
  boot.rect(2, 1, 4, 1, "#7a5230");
  boot.rect(6, 4, 4, 2, "#5d3d22");
  boot.rect(2, 6, 8, 1, "#2a2118");
  boot.rect(3, 3, 1, 1, "#3a2e22");
  boot.rect(5, 2, 1, 1, "#3a2e22");
  return [paper.bake(), weed.bake(), boot.bake()];
}
function drawChest() {
  const pc = new PixelCanvas(14, 11);
  pc.rect(0, 3, 14, 8, PAL.chest);
  pc.rect(0, 0, 14, 4, PAL.chestDark);
  pc.rect(0, 3, 14, 1, "#3a2812");
  pc.rect(0, 0, 14, 1, "#9c6d40");
  pc.rect(5, 0, 2, 11, PAL.chestGold);
  pc.rect(0, 4, 14, 2, PAL.chestGold);
  pc.rect(6, 5, 2, 3, "#f0d060");
  pc.px(7, 6, "#8a6a10");
  pc.strokeRect(0, 0, 14, 11, "#2a1c0c");
  return pc.bake();
}
function drawCrown() {
  const pc = new PixelCanvas(11, 8);
  pc.rect(1, 4, 9, 3, PAL.crown);
  pc.rect(0, 2, 2, 2, PAL.crown);
  pc.rect(4, 1, 2, 3, PAL.crown);
  pc.rect(8, 2, 2, 2, PAL.crown);
  pc.rect(1, 4, 9, 1, "#ffd97a");
  pc.px(2, 5, "#d64545");
  pc.px(5, 5, "#d64545");
  pc.px(8, 5, "#d64545");
  pc.px(1, 3, "#d64545");
  pc.px(9, 3, "#d64545");
  return pc.bake();
}
function drawExclaim() {
  const pc = new PixelCanvas(7, 11);
  pc.rect(2, 0, 3, 7, PAL.exclaim);
  pc.rect(2, 0, 1, 7, "#ffe98a");
  pc.rect(2, 0, 3, 1, "#fff3b0");
  pc.rect(2, 8, 3, 3, PAL.exclaim);
  pc.rect(2, 8, 1, 3, "#ffe98a");
  pc.strokeRect(1, 0, 5, 11, PAL.exclaimDark);
  return pc.bake();
}
function drawStar() {
  const pc = new PixelCanvas(7, 7);
  pc.rect(3, 0, 1, 2, "#ffffff");
  pc.rect(1, 1, 5, 1, "#ffffff");
  pc.rect(0, 2, 7, 2, "#ffffff");
  pc.rect(1, 4, 5, 1, "#ffffff");
  pc.rect(2, 5, 3, 1, "#ffffff");
  pc.px(3, 6, "#ffffff");
  return pc.bake();
}
function drawCloud(seed) {
  const pc = new PixelCanvas(46, 15);
  let s = seed >>> 0;
  const rand = () => {
    s = s * 1664525 + 1013904223 >>> 0;
    return s / 4294967296;
  };
  const blobs = 3 + Math.floor(rand() * 3);
  let x = 4;
  for (let i = 0; i < blobs; i++) {
    const rx = 6 + rand() * 8;
    const ry = 3 + rand() * 3;
    const cy = 9 - ry + rand() * 2;
    pc.ellipse(x + rx, cy, rx, ry, PAL.cloud);
    x += rx * 1.3;
    if (x > 36) break;
  }
  const shaded = new PixelCanvas(46, 15);
  for (let y = 0; y < 15; y++) {
    for (let xi = 0; xi < 46; xi++) {
      const c = pc.getPx(xi, y);
      if (c !== "#000000") {
        shaded.px(xi, y, y > 8 && pc.getPx(xi, y - 1) !== "#000000" ? PAL.cloudShade : c);
      }
    }
  }
  return shaded.bake();
}
var SpriteFactory = class _SpriteFactory {
  /** fishId -> [朝上, 朝下] */
  static buildFish(defs) {
    const fish = {};
    for (const def of defs) {
      const horizontal = drawFishBody(def.body, def.color, def.color2);
      fish[def.id] = [rotate90(horizontal, false).bake(), rotate90(horizontal, true).bake()];
    }
    return fish;
  }
  static build(fishDefs) {
    return {
      playerIdle: [drawPlayer("idle0"), drawPlayer("idle1")],
      playerCast: [drawPlayer("cast0"), drawPlayer("cast1"), drawPlayer("cast2")],
      playerReel: drawPlayer("reel"),
      playerShow: drawPlayer("show"),
      bobber: drawBobber(),
      splash: drawSplash(),
      fish: _SpriteFactory.buildFish(fishDefs),
      trash: drawTrash(),
      chest: drawChest(),
      crown: drawCrown(),
      exclaim: drawExclaim(),
      star: drawStar(),
      clouds: [drawCloud(11), drawCloud(29), drawCloud(47)]
    };
  }
};

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
  /** 最大力度判定阈值：蓄力 >= 该值即算「MAX 抛竿」，抛得更远、好鱼概率更高 */
  MAX_CAST_THRESHOLD: 0.999,
  /** MAX 抛竿：鱼群权重按稀有度提升的斜率（权重 ×= 1 + 斜率 × 难度/110，鱼王约 ×3） */
  MAX_CAST_RARITY_BOOST: 2.2,
  /** MAX 抛竿：垃圾概率倍率（更少垃圾） */
  MAX_CAST_TRASH_MULT: 0.4,
  /** MAX 抛竿：宝箱概率加成（15% + 15% = 30%） */
  MAX_CAST_TREASURE_BONUS: 0.15,
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

// src/renderer/render/PixelFont.ts
var GLYPHS = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  A: ["111", "101", "111", "101", "101"],
  C: ["111", "100", "100", "100", "111"],
  D: ["110", "101", "101", "101", "110"],
  E: ["111", "100", "111", "100", "111"],
  F: ["111", "100", "111", "100", "100"],
  G: ["111", "100", "101", "101", "111"],
  H: ["101", "101", "111", "101", "101"],
  I: ["111", "010", "010", "010", "111"],
  K: ["101", "101", "110", "101", "101"],
  L: ["100", "100", "100", "100", "111"],
  M: ["101", "111", "111", "101", "101"],
  N: ["101", "111", "111", "111", "101"],
  O: ["111", "101", "101", "101", "111"],
  P: ["111", "101", "111", "100", "100"],
  R: ["111", "101", "110", "101", "101"],
  S: ["111", "100", "111", "001", "111"],
  T: ["111", "010", "010", "010", "010"],
  U: ["101", "101", "101", "101", "111"],
  V: ["101", "101", "101", "101", "010"],
  W: ["101", "101", "111", "111", "101"],
  X: ["101", "101", "010", "101", "101"],
  Y: ["101", "101", "010", "010", "010"],
  Z: ["111", "001", "010", "100", "111"],
  "!": ["010", "010", "010", "000", "010"],
  "?": ["111", "001", "011", "000", "010"],
  ".": ["000", "000", "000", "000", "010"],
  "+": ["000", "010", "111", "010", "000"],
  "-": ["000", "000", "111", "000", "000"],
  "\xD7": ["000", "101", "010", "101", "000"],
  ":": ["000", "010", "000", "010", "000"],
  "/": ["001", "001", "010", "100", "100"],
  "%": ["101", "001", "010", "100", "101"],
  "<": ["001", "010", "100", "010", "001"],
  ">": ["100", "010", "001", "010", "100"]
};
var CHAR_W = 3;
var CHAR_H = 5;
var GAP = 1;
function isCjk(code) {
  return code > 11903;
}
function pixelTextWidth(text, scale = 1) {
  let w = 0;
  for (const ch of text) {
    if (isCjk(ch.codePointAt(0))) w += CHAR_H * scale;
    else if (GLYPHS[ch]) w += (CHAR_W + GAP) * scale;
    else w += 2 * scale;
  }
  return Math.max(0, w - GAP * scale);
}
function drawPixelText(ctx, text, x, y, color, scale = 2, shadow = true) {
  let cx = x;
  for (const ch of text) {
    const glyph = GLYPHS[ch];
    if (glyph) {
      if (shadow) {
        ctx.fillStyle = "rgba(6,13,20,0.5)";
        for (let r = 0; r < CHAR_H; r++) {
          for (let c = 0; c < CHAR_W; c++) {
            if (glyph[r][c] === "1") ctx.fillRect(cx + c * scale + scale, y + r * scale + scale, scale, scale);
          }
        }
      }
      ctx.fillStyle = color;
      for (let r = 0; r < CHAR_H; r++) {
        for (let c = 0; c < CHAR_W; c++) {
          if (glyph[r][c] === "1") ctx.fillRect(cx + c * scale, y + r * scale, scale, scale);
        }
      }
      cx += (CHAR_W + GAP) * scale;
    } else if (isCjk(ch.codePointAt(0))) {
      const size = CHAR_H * scale + 1;
      ctx.font = `${size}px "Microsoft YaHei", "PingFang SC", sans-serif`;
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      if (shadow) {
        ctx.fillStyle = "rgba(6,13,20,0.5)";
        ctx.fillText(ch, cx + scale, y + scale);
      }
      ctx.fillStyle = color;
      ctx.fillText(ch, cx, y);
      cx += size;
    } else {
      cx += 2 * scale;
    }
  }
}
function drawPixelTextCenter(ctx, text, centerX, y, color, scale = 2, shadow = true) {
  drawPixelText(ctx, text, Math.round(centerX - pixelTextWidth(text, scale) / 2), y, color, scale, shadow);
}

// src/renderer/render/PetView.ts
var BAR_W = 58;
var BAR_H = 176;
var BAR_TOP = 42;
var BAR_X = T.PLAYER_X - BAR_W / 2;
var CAT_DW = T.PLAYER_W * T.PLAYER_SCALE;
var CAT_DH = T.PLAYER_H * T.PLAYER_SCALE;
function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round((pa >> 16 & 255) + ((pb >> 16 & 255) - (pa >> 16 & 255)) * t);
  const g = Math.round((pa >> 8 & 255) + ((pb >> 8 & 255) - (pa >> 8 & 255)) * t);
  const bl = Math.round((pa & 255) + ((pb & 255) - (pa & 255)) * t);
  return `#${(1 << 24 | r << 16 | g << 8 | bl).toString(16).slice(1)}`;
}
var PetView = class {
  constructor(sprites2) {
    this.sprites = sprites2;
  }
  /** 退出按钮悬停高亮（由 Game 每帧写入） */
  quitHover = false;
  toY(pos) {
    return BAR_TOP + pos / T.TRACK_H * BAR_H;
  }
  draw(ctx, state) {
    ctx.imageSmoothingEnabled = false;
    const px = state.playerX;
    const py = state.playerFootY;
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.beginPath();
    ctx.ellipse(px, py - 1, CAT_DW * 0.42, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    if (state.minigame) {
      this.drawMinigame(ctx, state.minigame);
    } else {
      if (state.bobber) this.drawBobberAndLine(ctx, state);
      if (state.hud.exclaim) {
        const by = state.hud.exclaimY - 18 + Math.sin(state.time * 9) * 1.5;
        ctx.drawImage(this.sprites.exclaim, Math.round(state.hud.exclaimX - 7), Math.round(by), 14, 22);
      }
    }
    if (state.hud.charge >= 0) {
      const cx = px - 23;
      const cy = py - CAT_DH - 12;
      const isMax = state.hud.charge >= T.MAX_CAST_THRESHOLD;
      const glow = isMax ? 0.5 + 0.5 * Math.sin(state.time * 12) : 0;
      ctx.fillStyle = isMax ? `rgba(96,66,12,${0.6 + glow * 0.25})` : "rgba(6,13,20,0.55)";
      ctx.fillRect(cx - 1, cy - 1, 48, 6);
      ctx.fillStyle = "#12384f";
      ctx.fillRect(cx, cy, 46, 4);
      ctx.fillStyle = isMax ? mix("#e8b23a", "#fff0b8", glow) : mix(PAL.progressMid, PAL.progressHigh, state.hud.charge);
      ctx.fillRect(cx, cy, Math.round(46 * state.hud.charge), 4);
      if (isMax) {
        drawPixelTextCenter(ctx, "MAX", cx + 23, cy - 13, mix("#e8b23a", "#fff0b8", glow), 2, true);
      }
    }
    this.drawCat(ctx, state);
    this.drawLevelBadge(ctx, state);
    if (state.hud.hint && !state.minigame) {
      drawPixelTextCenter(ctx, state.hud.hint, px - 24, T.VIEW_H - 12, "#e8f6f9", 1, true);
    }
    this.drawQuitButton(ctx);
    if (state.result) this.drawResult(ctx, state.result);
  }
  /** 右下角退出 X 按钮（暗底 + 亮描边，透明背景中清晰，悬停高亮） */
  drawQuitButton(ctx) {
    const { x, y, r } = T.QUIT_BTN;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = this.quitHover ? "rgba(150,40,40,0.92)" : "rgba(12,20,28,0.72)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = this.quitHover ? "#ffb3b3" : "rgba(232,246,249,0.85)";
    ctx.stroke();
    const a = r * 0.42;
    ctx.strokeStyle = this.quitHover ? "#ffffff" : "#e8f6f9";
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x - a, y - a);
    ctx.lineTo(x + a, y + a);
    ctx.moveTo(x + a, y - a);
    ctx.lineTo(x - a, y + a);
    ctx.stroke();
    ctx.restore();
  }
  drawCat(ctx, state) {
    const pose = state.playerPose;
    let img;
    if (pose === "idle") img = this.sprites.playerIdle[Math.floor(state.time * 1.6) % 2];
    else if (pose === "cast") img = this.sprites.playerCast[Math.min(2, state.playerFrame | 0)];
    else if (pose === "reel") img = this.sprites.playerReel;
    else img = this.sprites.playerShow;
    const dx = Math.round(state.playerX - CAT_DW / 2);
    const dy = Math.round(state.playerFootY - CAT_DH);
    ctx.drawImage(img, dx, dy, CAT_DW, CAT_DH);
  }
  rodTipWorld(state) {
    const pose = state.playerPose;
    const key = pose === "reel" ? "reel" : pose === "cast" ? "cast2" : "idle0";
    const [ox, oy] = ROD_TIP[key];
    const dx = state.playerX - CAT_DW / 2;
    const dy = state.playerFootY - CAT_DH;
    return [dx + ox * T.PLAYER_SCALE, dy + oy * T.PLAYER_SCALE];
  }
  drawBobberAndLine(ctx, state) {
    const b = state.bobber;
    const [rx, ry] = this.rodTipWorld(state);
    const bx = b.x + Math.sin(state.time * 40) * b.shake * 2;
    const by = b.y + Math.cos(state.time * 37) * b.shake * 1.5 + Math.sin(state.time * 2.4) * 1.2;
    const drawRing = (r, alpha) => {
      ctx.beginPath();
      ctx.ellipse(bx, by + 5, r, r * 0.38, 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(18,52,70,${alpha})`;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(bx, by + 5, r, r * 0.38, 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(150,228,242,${alpha})`;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    };
    drawRing(13, 0.55);
    if (b.shake < 0.05) drawRing(8, 0.45);
    const sag = Math.min(26, Math.hypot(bx - rx, by - ry) * 0.16);
    const linePath = (cx, cy) => {
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.quadraticCurveTo((rx + bx) / 2, (ry + by) / 2 + sag, cx, cy);
      ctx.stroke();
    };
    ctx.strokeStyle = "rgba(18,40,55,0.9)";
    ctx.lineWidth = 2.6;
    linePath(bx, by);
    ctx.strokeStyle = "rgba(236,246,250,0.95)";
    ctx.lineWidth = 1;
    linePath(bx, by);
    const bw = 14;
    const bh = 14;
    ctx.drawImage(this.sprites.bobber, Math.round(bx - bw / 2), Math.round(by - bh / 2), bw, bh);
    ctx.strokeStyle = "rgba(18,40,55,0.7)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(bx, by, bw / 2 + 1, 0, Math.PI * 2);
    ctx.stroke();
    if (state.splash) {
      const sp = this.sprites.splash[Math.min(2, state.splash.frame)];
      ctx.drawImage(sp, Math.round(b.x - 13), Math.round(b.y - 9), 26, 18);
    }
  }
  drawMinigame(ctx, s) {
    const scale = BAR_H / T.TRACK_H;
    ctx.fillStyle = "rgba(13,43,58,0.82)";
    ctx.fillRect(BAR_X - 5, BAR_TOP - 5, BAR_W + 10, BAR_H + 10);
    ctx.fillStyle = PAL.uiBorder;
    ctx.fillRect(BAR_X - 5, BAR_TOP - 5, BAR_W + 10, 2);
    ctx.fillRect(BAR_X - 5, BAR_TOP + BAR_H + 3, BAR_W + 10, 2);
    for (let y = 0; y < BAR_H; y++) {
      ctx.fillStyle = mix(PAL.trackTop, PAL.trackBottom, y / BAR_H);
      ctx.fillRect(BAR_X, BAR_TOP + y, BAR_W, 1);
    }
    ctx.fillStyle = "rgba(232,246,249,0.14)";
    for (let i = 0; i < 12; i++) {
      const px = BAR_X + 10 + i * 53 % (BAR_W - 20);
      const py = BAR_TOP + i * 97 % BAR_H;
      ctx.fillRect(px, py, 2, 2);
    }
    if (s.treasure) {
      const ty = this.toY(s.treasure.pos);
      ctx.drawImage(this.sprites.chest, BAR_X + BAR_W / 2 - 16, Math.round(ty - 12), 32, 25);
      const bw = 22;
      const bx = BAR_X + BAR_W / 2 - bw / 2;
      const by = ty + 13;
      ctx.fillStyle = "rgba(6,13,20,0.7)";
      ctx.fillRect(bx - 1, by - 1, bw + 2, 5);
      ctx.fillStyle = PAL.chestGold;
      ctx.fillRect(bx, by, Math.round(bw * s.treasure.progress), 3);
    }
    const fishY = this.toY(s.fishPos);
    const fw = 22;
    const fh = 33;
    ctx.drawImage(s.fishIcon, BAR_X + BAR_W / 2 - fw / 2, Math.round(fishY - fh / 2), fw, fh);
    if (s.legendary) ctx.drawImage(this.sprites.crown, BAR_X + BAR_W / 2 - 13, Math.round(fishY - 25), 26, 19);
    const barY = this.toY(s.barPos);
    const barH = s.barSize * scale;
    ctx.fillStyle = PAL.barEdge;
    ctx.fillRect(BAR_X + 6, Math.round(barY) - 2, BAR_W - 12, Math.round(barH) + 4);
    ctx.fillStyle = PAL.barFill;
    ctx.fillRect(BAR_X + 8, Math.round(barY), BAR_W - 16, Math.round(barH));
    ctx.fillStyle = PAL.barHighlight;
    ctx.fillRect(BAR_X + 8, Math.round(barY), BAR_W - 16, 2);
    ctx.fillStyle = PAL.barFillDark;
    ctx.fillRect(BAR_X + 8, Math.round(barY + barH) - 2, BAR_W - 16, 2);
    const pX = BAR_X + BAR_W + 8;
    const pW = 14;
    ctx.fillStyle = "rgba(13,43,58,0.82)";
    ctx.fillRect(pX - 2, BAR_TOP - 2, pW + 4, BAR_H + 4);
    ctx.fillStyle = "#0d2b3a";
    ctx.fillRect(pX, BAR_TOP, pW, BAR_H);
    const pH = Math.round(BAR_H * s.progress);
    const pColor = s.progress < 0.35 ? PAL.progressLow : s.progress < 0.7 ? PAL.progressMid : PAL.progressHigh;
    ctx.fillStyle = pColor;
    ctx.fillRect(pX + 1, BAR_TOP + BAR_H - pH - 1, pW - 2, pH);
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(pX + 1, BAR_TOP + BAR_H - pH - 1, pW - 2, 2);
  }
  drawLevelBadge(ctx, state) {
    const h = state.hud;
    const x = Math.round(state.playerX + CAT_DW / 2 + 4);
    const y = Math.round(state.playerFootY - CAT_DH + 4);
    ctx.fillStyle = "rgba(6,13,20,0.5)";
    ctx.fillRect(x - 1, y - 1, 68, 18);
    drawPixelText(ctx, `LV${h.level}`, x, y, PAL.textLight, 2);
    const bx = x + 26;
    const by = y + 3;
    const bw = 34;
    ctx.fillStyle = "#0d2b3a";
    ctx.fillRect(bx, by, bw, 9);
    ctx.fillStyle = PAL.barFill;
    ctx.fillRect(bx + 1, by + 1, Math.round((bw - 2) * h.xpPct), 7);
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(bx + 1, by + 1, Math.round((bw - 2) * h.xpPct), 2);
  }
  /** 带深色描边的中文/矢量文本，保证在米色面板与透明背景下都清晰 */
  text(ctx, str, x, y, size, color, align = "center") {
    ctx.font = `${size}px "Microsoft YaHei", "PingFang SC", sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = "top";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(3, size / 6);
    ctx.strokeStyle = "rgba(28,20,12,0.92)";
    ctx.strokeText(str, x, y);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }
  drawResult(ctx, r) {
    const w = Math.min(250, T.VIEW_W - 16);
    const h = 158;
    const x = Math.round((T.VIEW_W - w) / 2);
    const y = 70;
    ctx.fillStyle = "rgba(6,13,20,0.3)";
    ctx.fillRect(x + 3, y + 3, w, h);
    ctx.fillStyle = "#f0e6cc";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = PAL.dirt;
    ctx.fillRect(x, y, w, 3);
    ctx.fillRect(x, y + h - 3, w, 3);
    ctx.fillRect(x, y, 3, h);
    ctx.fillRect(x + w - 3, y, 3, h);
    ctx.fillStyle = PAL.woodLight;
    ctx.fillRect(x + 3, y + 3, w - 6, 1);
    const cx = x + w / 2;
    if (r.kind === "fish") {
      if (r.fishIcon) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(r.fishIcon, x + 16, y + 28, r.fishIcon.width * 3, r.fishIcon.height * 3);
      }
      this.text(ctx, `\u9493\u5230\u4E86${r.fishName ?? ""}\uFF01`, cx + 32, y + 12, 20, "#3a2e22");
      drawPixelTextCenter(ctx, `${r.size ?? 0} IN`, cx + 32, y + 40, "#3a2e22", 2);
      const stars = r.quality === "iridium" ? 3 : r.quality === "gold" ? 2 : r.quality === "silver" ? 1 : 0;
      const qc = QUALITY_COLOR[r.quality ?? "normal"];
      for (let i = 0; i < 3; i++) {
        const sx = Math.round(cx + 32 - 24 + i * 17);
        const sy = y + 58;
        if (i < stars) {
          ctx.drawImage(this.sprites.star, sx, sy);
          ctx.globalCompositeOperation = "source-atop";
          ctx.fillStyle = qc;
          ctx.fillRect(sx, sy, 7, 7);
          ctx.globalCompositeOperation = "source-over";
        } else {
          ctx.fillStyle = "rgba(58,46,34,0.18)";
          ctx.fillRect(sx, sy, 7, 7);
        }
      }
      this.text(ctx, QUALITY_LABEL[r.quality ?? "normal"], cx + 32, y + 69, 13, "#6a5a44");
      let tagY = y + 82;
      if (r.maxCast) {
        const chipW = 37;
        const chipX = Math.round(cx + 32 - chipW / 2);
        ctx.fillStyle = "#8a5c2e";
        ctx.fillRect(chipX, tagY - 2, chipW, 13);
        ctx.fillStyle = PAL.chestGold;
        ctx.fillRect(chipX + 1, tagY - 1, chipW - 2, 11);
        drawPixelTextCenter(ctx, "MAX CAST", cx + 32, tagY + 1, "#5d3d22", 1, false);
        tagY += 13;
      }
      if (r.perfect) {
        drawPixelTextCenter(ctx, "PERFECT!", cx + 32, tagY, PAL.progressHigh, 2);
        tagY += 15;
      }
      if (r.treasure) {
        ctx.drawImage(this.sprites.chest, Math.round(cx + 32 - 24), tagY - 1);
        drawPixelText(ctx, "TREASURE", cx + 32 - 4, tagY + 1, PAL.chest, 1);
        tagY += 15;
      }
      drawPixelTextCenter(ctx, `+${r.xp ?? 0} XP`, cx + 32, tagY + 4, "#3a2e22", 2);
      if (r.leveledUp && r.leveledUp > 0) {
        drawPixelTextCenter(ctx, `LEVEL UP \xD7${r.leveledUp}`, cx + 32, tagY + 20, PAL.progressHigh, 2);
      }
    } else if (r.kind === "trash") {
      if (r.trashIcon) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(r.trashIcon, cx - r.trashIcon.width * 2, y + 24, r.trashIcon.width * 4, r.trashIcon.height * 4);
      }
      this.text(ctx, "\u9493\u4E0A\u4E86\u5783\u573E\u2026", cx, y + 12, 20, "#3a2e22");
      drawPixelTextCenter(ctx, `+${r.xp ?? 3} XP`, cx, y + 104, "#6a5a44", 2);
    } else {
      this.text(ctx, "\u9C7C\u9003\u8D70\u4E86\u2026", cx, y + 26, 20, "#3a2e22");
      drawPixelTextCenter(ctx, "GOT AWAY", cx, y + 60, PAL.progressLow, 2);
      this.text(ctx, "\u70B9\u51FB\u91CD\u65B0\u629B\u7AFF", cx, y + 92, 13, "#6a5a44");
    }
    drawPixelTextCenter(ctx, "CLICK TO CONTINUE", cx, y + h - 16, "#8a7a64", 1);
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

// scripts/petshot.ts
var realCreate = import_canvas.createCanvas;
globalThis.document = {
  createElement(tag) {
    if (tag === "canvas") return realCreate(1, 1);
    return {};
  }
};
globalThis.ImageData = globalThis.ImageData;
var sprites = SpriteFactory.build(FISH_TABLE);
var view = new PetView(sprites);
function baseScene() {
  return {
    time: 1,
    playerPose: "idle",
    playerFrame: 0,
    playerX: T.PLAYER_X,
    playerFootY: T.PLAYER_FOOT_Y,
    bobber: null,
    splash: null,
    lineVisible: false,
    minigame: null,
    result: null,
    hud: {
      level: 3,
      xp: 40,
      xpNeeded: 100,
      xpPct: 0.4,
      hint: "\u6309\u4F4F\u5DE6\u952E / C \u84C4\u529B\uFF0C\u677E\u5F00\u629B\u7AFF",
      charge: -1,
      exclaim: false,
      exclaimX: T.PLAYER_X,
      exclaimY: T.PLAYER_FOOT_Y - 40,
      casts: 12,
      caught: 7
    }
  };
}
function render(name, scene) {
  const cv = realCreate(T.VIEW_W, T.VIEW_H);
  const ctx = cv.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const check = 8;
  for (let y = 0; y < T.VIEW_H; y += check) {
    for (let x = 0; x < T.VIEW_W; x += check) {
      const on = (x / check | 0) % 2 === (y / check | 0) % 2;
      ctx.fillStyle = on ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.02)";
      ctx.fillRect(x, y, check, check);
    }
  }
  view.draw(ctx, scene);
  const out = `scripts/shot_${name}.png`;
  require("fs").writeFileSync(out, cv.toBuffer("image/png"));
  console.log("wrote", out, `(${T.VIEW_W}x${T.VIEW_H})`);
}
render("idle", baseScene());
{
  const s = baseScene();
  s.playerPose = "reel";
  const fish = FISH_TABLE.find((f) => f.id === "sardine") ?? FISH_TABLE[0];
  s.minigame = {
    fishPos: 300,
    fishVel: 40,
    fishIcon: sprites.fish[fish.id][1],
    barPos: 238,
    barSize: 124,
    progress: 0.55,
    treasure: { pos: 120, progress: 0.4 },
    legendary: false
  };
  s.hud.hint = "";
  render("minigame", s);
}
{
  const s = baseScene();
  s.result = { kind: "escaped", perfect: false, treasure: false, xp: 0, leveledUp: 0 };
  render("escaped", s);
}
{
  const s = baseScene();
  s.playerPose = "reel";
  s.bobber = { x: 128, y: 322, shake: 0.1 };
  s.splash = { x: 128, y: 322, frame: 1 };
  render("fishing", s);
}
{
  const s = baseScene();
  s.playerPose = "reel";
  s.bobber = { x: 128, y: 322, shake: 0.95 };
  s.splash = { x: 128, y: 322, frame: 1 };
  s.hud.exclaim = true;
  s.hud.exclaimX = 128;
  s.hud.exclaimY = 396 - 14;
  render("bite", s);
}
{
  const s = baseScene();
  s.playerPose = "show";
  const fish = FISH_TABLE.find((f) => f.id === "sardine") ?? FISH_TABLE[0];
  s.result = {
    kind: "fish",
    perfect: true,
    treasure: false,
    xp: 26,
    leveledUp: 0,
    fishName: fish.name,
    fishIcon: sprites.fish[fish.id][1],
    size: 18,
    quality: "gold"
  };
  render("catch", s);
}
{
  const s = baseScene();
  s.playerPose = "cast";
  s.playerFrame = 2;
  s.hud.charge = 1;
  s.hud.hint = "\u677E\u5F00\u629B\u51FA\uFF01";
  render("chargemax", s);
}
{
  const s = baseScene();
  s.playerPose = "show";
  const fish = FISH_TABLE.find((f) => f.id === "pike") ?? FISH_TABLE[0];
  s.result = {
    kind: "fish",
    perfect: true,
    treasure: false,
    maxCast: true,
    xp: 26,
    leveledUp: 0,
    fishName: fish.name,
    fishIcon: sprites.fish[fish.id][1],
    size: 18,
    quality: "gold"
  };
  render("catchmax", s);
}
{
  view.quitHover = true;
  render("quithover", baseScene());
  view.quitHover = false;
}
