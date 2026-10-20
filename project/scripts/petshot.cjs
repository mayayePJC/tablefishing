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
var ROD_TIP_FARMER = {
  idle0: [1, 10],
  idle1: [1, 10],
  cast0: [20, 4],
  cast1: [6, 2],
  cast2: [0, 26],
  reel: [0, 28],
  show: [20, 18]
};
var ROD_TIP_CAT = {
  idle0: [2, 10],
  idle1: [2, 10],
  cast0: [20, 4],
  cast1: [5, 3],
  cast2: [0, 26],
  reel: [0, 28],
  show: [21, 20]
};
var ROD_TIP_FROG = {
  idle0: [1, 7],
  idle1: [1, 7],
  cast0: [22, 5],
  cast1: [11, 2],
  cast2: [0, 26],
  reel: [0, 28],
  show: [22, 22]
};
var ROD_TIP_PENGUIN = {
  idle0: [1, 5],
  idle1: [1, 5],
  cast0: [22, 5],
  cast1: [5, 2],
  cast2: [0, 26],
  reel: [0, 28],
  show: [22, 21]
};
var ROD_TIP_WIZARD = {
  idle0: [1, 4],
  idle1: [1, 4],
  cast0: [21, 5],
  cast1: [4, 1],
  cast2: [0, 26],
  reel: [0, 28],
  show: [21, 20]
};
var ROD_TIPS = {
  farmer: ROD_TIP_FARMER,
  cat: ROD_TIP_CAT,
  frog: ROD_TIP_FROG,
  penguin: ROD_TIP_PENGUIN,
  wizard: ROD_TIP_WIZARD
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
function strokeLine(pc, x1, y1, x2, y2, c) {
  let x = x1;
  let y = y1;
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  const sx = x1 < x2 ? 1 : -1;
  const sy = y1 < y2 ? 1 : -1;
  let err = dx - dy;
  for (let i = 0; i < 64; i++) {
    pc.px(x, y, c);
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
}
function rodLine(pc, x1, y1, x2, y2, color) {
  const c = color ?? PAL.woodDark;
  const hi = color ? mixHex(color, "#ffffff", 0.4) : PAL.woodLight;
  const ring = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1]
  ];
  for (const [ox, oy] of ring) strokeLine(pc, x1 + ox, y1 + oy, x2 + ox, y2 + oy, OUT);
  strokeLine(pc, x1, y1, x2, y2, c);
  pc.px(x2, y2, hi);
}
function drawPlayer(pose) {
  const pc = new PixelCanvas(24, 40);
  const isShow = pose === "show";
  const ox = pose === "cast0" ? 1 : pose === "cast2" || pose === "reel" ? -1 : 0;
  const spread = pose === "cast0" || pose === "reel" ? 2 : pose === "cast1" || pose === "cast2" ? 1 : 0;
  const lx = 7 - spread;
  const rx = 13 + spread;
  blk(pc, lx, 28, 4, 9, PANTS);
  blk(pc, rx, 28, 4, 9, PANTS);
  pc.rect(lx, 36, 4, 1, PANTS_D);
  pc.rect(rx, 36, 4, 1, PANTS_D);
  blk(pc, lx, 37, 4, 3, BOOT);
  blk(pc, rx, 37, 4, 3, BOOT);
  blk(pc, 7 + ox, 16, 10, 12, SHIRT);
  pc.rect(7 + ox, 16, 10, 1, SHIRT_L);
  pc.rect(7 + ox, 26, 10, 1, SHIRT_D);
  pc.rect(7 + ox, 27, 10, 1, PANTS_D);
  blk(pc, 8 + ox, 7, 8, 8, SKIN);
  pc.rect(8 + ox, 14, 8, 1, SKIN_D);
  if (pose === "idle1") {
    pc.rect(10 + ox, 10, 1, 1, SKIN_D);
    pc.rect(13 + ox, 10, 1, 1, SKIN_D);
  } else {
    pc.px(10 + ox, 10, OUT);
    pc.px(13 + ox, 10, OUT);
  }
  pc.rect(11 + ox, 12, 2, 1, OUT);
  blk(pc, 7 + ox, 3, 10, 5, HAIR);
  pc.rect(7 + ox, 3, 10, 1, HAIR_L);
  pc.rect(7 + ox, 7, 2, 4, HAIR);
  pc.rect(15 + ox, 7, 2, 4, HAIR);
  const tip = ROD_TIP_FARMER[pose];
  if (isShow) {
    blk(pc, 7, 9, 2, 8, SHIRT);
    pc.rect(7, 8, 2, 2, SKIN);
    blk(pc, 15, 9, 2, 8, SHIRT);
    pc.rect(15, 8, 2, 2, SKIN);
    pc.ellipse(9, 5, 3.4, 2, "#6fb0d0");
    pc.ellipse(9, 5, 2.2, 1.3, "#bfe6f2");
    pc.triangle(12, 5, 9, 3.5, 9, 6.5, "#4a93b0");
    pc.px(7, 4, INK);
    rodLine(pc, 18, 30, tip[0], tip[1]);
  } else if (pose === "idle0" || pose === "idle1") {
    blk(pc, 4 + ox, 13, 2, 5, SHIRT);
    pc.rect(4 + ox, 12, 2, 3, SKIN);
    blk(pc, 9 + ox, 16, 4, 3, SHIRT);
    pc.rect(8 + ox, 17, 2, 2, SKIN);
    rodLine(pc, 9 + ox, 18, tip[0], tip[1]);
  } else if (pose === "cast0") {
    blk(pc, 10 + ox, 16, 5, 3, SHIRT);
    blk(pc, 13 + ox, 15, 3, 6, SHIRT);
    pc.rect(12 + ox, 16, 3, 3, SKIN);
    rodLine(pc, 13 + ox, 16, tip[0], tip[1]);
  } else if (pose === "cast1") {
    blk(pc, 4 + ox, 13, 3, 4, SHIRT);
    pc.rect(5 + ox, 14, 2, 2, SKIN);
    blk(pc, 8 + ox, 16, 7, 3, SHIRT);
    pc.rect(7 + ox, 17, 2, 2, SKIN);
    rodLine(pc, 7 + ox, 17, tip[0], tip[1]);
  } else if (pose === "cast2") {
    blk(pc, 3 + ox, 17, 3, 4, SHIRT);
    pc.rect(3 + ox, 19, 2, 2, SKIN);
    blk(pc, 16 + ox, 17, 3, 9, SHIRT);
    pc.rect(16 + ox, 25, 3, 2, SKIN);
    rodLine(pc, 4 + ox, 20, tip[0], tip[1]);
  } else {
    blk(pc, 5 + ox, 15, 2, 5, SHIRT);
    blk(pc, 3 + ox, 18, 4, 2, SHIRT);
    pc.rect(5 + ox, 18, 2, 2, SKIN);
    blk(pc, 16 + ox, 17, 3, 9, SHIRT);
    pc.rect(16 + ox, 25, 3, 2, SKIN);
    rodLine(pc, 6 + ox, 18, tip[0], tip[1]);
  }
  return pc.bake();
}
var FUR = "#e8963c";
var FUR_D = "#b86a20";
var FUR_L = "#f4b860";
var BELLY = "#f8e4b8";
var CAT_EYE = "#2a1a10";
var CAT_NOSE = "#c96a6a";
function drawCatCharacter(pose) {
  const pc = new PixelCanvas(24, 40);
  const isShow = pose === "show";
  const blink = pose === "idle1";
  const tail = [
    [18, 32, 3],
    [19, 30, 3],
    [19, 28, 3],
    [20, 26, 3],
    [20, 24, 3],
    [21, 22, 3],
    [21, 20, 3],
    [22, 18, 2],
    [22, 17, 2]
  ];
  tail.forEach(([tx, ty, tw], i) => {
    pc.rect(tx, ty, tw, 2, i % 2 === 1 ? FUR_D : FUR);
  });
  pc.px(22, 16, FUR_L);
  pc.px(23, 31, OUT);
  pc.px(23, 27, OUT);
  pc.px(23, 23, OUT);
  pc.px(24, 19, OUT);
  blk(pc, 6, 33, 5, 5, FUR);
  blk(pc, 13, 33, 5, 5, FUR);
  pc.rect(6, 37, 5, 1, FUR_D);
  pc.rect(13, 37, 5, 1, FUR_D);
  pc.rect(7, 36, 3, 2, BELLY);
  pc.rect(14, 36, 3, 2, BELLY);
  blk(pc, 5, 16, 13, 17, FUR);
  pc.rect(6, 16, 11, 1, FUR_L);
  pc.rect(5, 32, 13, 1, FUR_D);
  pc.rect(9, 22, 6, 10, BELLY);
  pc.rect(6, 18, 2, 1, FUR_D);
  pc.rect(15, 18, 2, 1, FUR_D);
  pc.rect(6, 21, 2, 1, FUR_D);
  pc.rect(15, 21, 2, 1, FUR_D);
  pc.rect(6, 25, 2, 1, FUR_D);
  pc.rect(15, 25, 2, 1, FUR_D);
  pc.rect(6, 29, 2, 1, FUR_D);
  pc.rect(15, 29, 2, 1, FUR_D);
  blk(pc, 6, 5, 11, 10, FUR);
  pc.triangle(6, 6, 7, 1, 9, 6, FUR);
  pc.triangle(7, 6, 7, 2, 8, 6, FUR_D);
  pc.triangle(14, 6, 15, 1, 17, 6, FUR);
  pc.triangle(14, 6, 15, 2, 16, 6, FUR_D);
  pc.px(6, 1, OUT);
  pc.px(17, 1, OUT);
  pc.px(9, 6, FUR_D);
  pc.px(10, 6, FUR_D);
  pc.px(13, 6, FUR_D);
  pc.px(14, 6, FUR_D);
  pc.px(10, 7, FUR_D);
  pc.px(13, 7, FUR_D);
  if (blink) {
    pc.rect(8, 10, 2, 1, CAT_EYE);
    pc.rect(13, 10, 2, 1, CAT_EYE);
  } else {
    pc.rect(8, 9, 2, 2, CAT_EYE);
    pc.rect(13, 9, 2, 2, CAT_EYE);
    pc.px(8, 9, "#ffffff");
    pc.px(13, 9, "#ffffff");
  }
  pc.rect(9, 12, 5, 2, BELLY);
  pc.px(11, 12, CAT_NOSE);
  pc.px(11, 13, OUT);
  pc.rect(10, 14, 3, 1, FUR_D);
  pc.px(6, 12, OUT);
  pc.px(5, 12, OUT);
  pc.px(17, 12, OUT);
  pc.px(18, 12, OUT);
  if (isShow) {
    blk(pc, 3, 12, 2, 7, FUR);
    pc.rect(3, 12, 2, 2, BELLY);
    blk(pc, 18, 12, 2, 7, FUR);
    pc.rect(18, 12, 2, 2, BELLY);
    pc.ellipse(11, 6, 3.4, 2, "#6fb0d0");
    pc.ellipse(11, 6, 2.2, 1.3, "#bfe6f2");
    pc.triangle(14, 6, 11, 4.5, 11, 7.5, "#4a93b0");
    pc.px(9, 5, INK);
    rodLine(pc, 19, 32, 21, 20);
  } else {
    const g = pose === "cast0" ? [14, 19] : pose === "cast1" ? [9, 19] : pose === "cast2" || pose === "reel" ? [10, 20] : [11, 19];
    blk(pc, 3, 16, 2, 6, FUR);
    blk(pc, 18, 16, 2, 6, FUR);
    pc.rect(g[0] - 2, g[1] - 2, 6, 3, BELLY);
    pc.rect(g[0] - 2, g[1] - 2, 6, 1, FUR_D);
    const tip = ROD_TIP_CAT[pose];
    rodLine(pc, g[0], g[1], tip[0], tip[1]);
  }
  return pc.bake();
}
var FROG = "#57a64b";
var FROG_D = "#3f7d38";
var FROG_L = "#6fbf56";
var FROG_BELLY = "#f2e4b8";
var EYE_WHITE = "#f8f8f0";
function drawFrogCharacter(pose) {
  const pc = new PixelCanvas(24, 40);
  const isShow = pose === "show";
  const blink = pose === "idle1";
  blk(pc, 4, 34, 6, 5, FROG);
  blk(pc, 14, 34, 6, 5, FROG);
  pc.rect(4, 38, 6, 1, FROG_D);
  pc.rect(14, 38, 6, 1, FROG_D);
  pc.rect(6, 36, 1, 2, FROG_D);
  pc.rect(8, 36, 1, 2, FROG_D);
  pc.rect(16, 36, 1, 2, FROG_D);
  pc.rect(18, 36, 1, 2, FROG_D);
  blk(pc, 4, 17, 16, 16, FROG);
  pc.rect(5, 17, 14, 1, FROG_L);
  pc.rect(4, 32, 16, 1, FROG_D);
  pc.rect(8, 21, 8, 9, FROG_BELLY);
  pc.rect(8, 21, 8, 1, "#f8ecd0");
  blk(pc, 3, 8, 18, 10, FROG);
  pc.rect(4, 8, 16, 1, FROG_L);
  const eye = (ex) => {
    pc.ellipse(ex, 7, 2.9, 2.9, OUT);
    pc.ellipse(ex, 7, 2.2, 2.2, EYE_WHITE);
    if (blink) {
      pc.rect(ex - 2, 7, 4, 1, OUT);
    } else {
      pc.ellipse(ex - 0.9, 7, 1.1, 1.4, CAT_EYE);
      pc.px(ex - 1, 6, "#ffffff");
    }
  };
  eye(7);
  eye(16);
  pc.px(10, 12, FROG_D);
  pc.px(13, 12, FROG_D);
  pc.rect(8, 14, 8, 1, FROG_D);
  pc.px(7, 13, FROG_D);
  pc.px(16, 13, FROG_D);
  if (isShow) {
    blk(pc, 2, 8, 2, 7, FROG);
    blk(pc, 19, 8, 2, 7, FROG);
    pc.rect(2, 14, 2, 2, FROG_L);
    pc.rect(19, 14, 2, 2, FROG_L);
    pc.ellipse(11, 4, 3.4, 2, "#6fb0d0");
    pc.ellipse(11, 4, 2.2, 1.3, "#bfe6f2");
    pc.triangle(14, 4, 11, 2.5, 11, 5.5, "#4a93b0");
    pc.px(9, 3, INK);
    rodLine(pc, 21, 33, 22, 22);
  } else {
    blk(pc, 20, 22, 2, 6, FROG);
    pc.rect(20, 27, 2, 2, FROG_L);
    const g = pose === "cast0" ? [12, 16] : pose === "cast1" ? [11, 16] : pose === "cast2" || pose === "reel" ? [9, 19] : [7, 16];
    blk(pc, g[0] - 1, g[1] - 1, 2, 5, FROG);
    pc.rect(g[0] - 1, g[1] - 1, 2, 2, FROG_L);
    const tip = ROD_TIP_FROG[pose];
    rodLine(pc, g[0], g[1], tip[0], tip[1]);
  }
  return pc.bake();
}
var PENG_B = "#2b2f3a";
var PENG_BL = "#3d4250";
var PENG_W = "#f5f5f0";
var PENG_WD = "#d8d8d0";
var BEAK = "#e8a04a";
var BEAK_D = "#c07828";
var SCARF = "#c0453a";
var SCARF_D = "#8f2e26";
function drawPenguinCharacter(pose) {
  const pc = new PixelCanvas(24, 40);
  const isShow = pose === "show";
  const blink = pose === "idle1";
  blk(pc, 6, 36, 5, 3, BEAK);
  blk(pc, 13, 36, 5, 3, BEAK);
  pc.rect(6, 38, 5, 1, BEAK_D);
  pc.rect(13, 38, 5, 1, BEAK_D);
  pc.rect(8, 33, 3, 3, PENG_B);
  pc.rect(13, 33, 3, 3, PENG_B);
  blk(pc, 6, 15, 12, 19, PENG_B);
  pc.rect(7, 15, 10, 1, PENG_BL);
  pc.rect(6, 32, 12, 2, "#1c1f26");
  pc.ellipse(12, 24, 4.2, 5.6, PENG_W);
  pc.rect(9, 30, 6, 1, PENG_WD);
  blk(pc, 7, 5, 10, 11, PENG_B);
  pc.rect(8, 5, 8, 1, PENG_BL);
  pc.ellipse(12, 10, 4, 4.6, PENG_W);
  if (blink) {
    pc.rect(9, 10, 2, 1, OUT);
    pc.rect(13, 10, 2, 1, OUT);
  } else {
    pc.px(10, 10, OUT);
    pc.px(13, 10, OUT);
  }
  pc.triangle(10, 11, 14, 11, 12, 14, BEAK);
  pc.px(12, 13, BEAK_D);
  pc.rect(6, 15, 12, 2, SCARF);
  pc.rect(6, 15, 12, 1, "#d65a4a");
  pc.px(5, 16, SCARF_D);
  if (isShow) {
    blk(pc, 3, 7, 2, 7, PENG_B);
    blk(pc, 19, 7, 2, 7, PENG_B);
    pc.rect(3, 13, 2, 2, PENG_BL);
    pc.rect(19, 13, 2, 2, PENG_BL);
    pc.rect(1, 13, 4, 2, SCARF);
    pc.rect(1, 14, 2, 1, SCARF_D);
    pc.ellipse(12, 3, 3.4, 2, "#6fb0d0");
    pc.ellipse(12, 3, 2.2, 1.3, "#bfe6f2");
    pc.triangle(15, 3, 12, 1.5, 12, 4.5, "#4a93b0");
    pc.px(10, 2, INK);
    rodLine(pc, 21, 33, 22, 21);
  } else {
    blk(pc, 19, 18, 2, 8, PENG_B);
    pc.rect(19, 24, 2, 2, PENG_BL);
    const g = pose === "cast0" ? [12, 16] : pose === "cast1" ? [8, 16] : pose === "cast2" || pose === "reel" ? [8, 19] : [5, 14];
    blk(pc, g[0] - 1, g[1] - 2, 2, 6, PENG_B);
    pc.rect(g[0] - 1, g[1] - 3, 2, 2, PENG_BL);
    pc.rect(1, 13, 4, 2, SCARF);
    pc.rect(1, 14, 2, 1, SCARF_D);
    const tip = ROD_TIP_PENGUIN[pose];
    rodLine(pc, g[0], g[1], tip[0], tip[1]);
  }
  return pc.bake();
}
var ROBE = "#5a4a8a";
var ROBE_D = "#453a6e";
var ROBE_L = "#6f5aa3";
var HAT = "#3d3a6e";
var HAT_L = "#524a8a";
var STAR_C = "#f4e4b8";
var WBOOT = "#5d3d22";
var WBOOT_D = "#3f2a18";
var GOLD = "#e8c53a";
function drawWizardCharacter(pose) {
  const pc = new PixelCanvas(24, 40);
  const isShow = pose === "show";
  const blink = pose === "idle1";
  blk(pc, 7, 35, 4, 4, WBOOT);
  blk(pc, 13, 35, 4, 4, WBOOT);
  pc.rect(7, 38, 4, 1, WBOOT_D);
  pc.rect(13, 38, 4, 1, WBOOT_D);
  pc.px(6, 38, WBOOT);
  pc.px(17, 38, WBOOT);
  blk(pc, 5, 26, 14, 8, ROBE);
  pc.rect(6, 26, 12, 1, ROBE_L);
  pc.rect(5, 33, 14, 1, ROBE_D);
  blk(pc, 6, 21, 12, 6, ROBE);
  pc.rect(7, 26, 10, 1, ROBE_D);
  blk(pc, 8, 16, 8, 6, ROBE);
  pc.rect(9, 16, 6, 1, ROBE_L);
  pc.rect(11, 16, 2, 18, GOLD);
  const robeStar = (sx, sy) => {
    pc.px(sx, sy, STAR_C);
    pc.px(sx, sy - 1, STAR_C);
    pc.px(sx, sy + 1, STAR_C);
    pc.px(sx - 1, sy, STAR_C);
    pc.px(sx + 1, sy, STAR_C);
  };
  robeStar(7, 23);
  robeStar(16, 29);
  blk(pc, 8, 7, 8, 8, PAL.skin);
  pc.rect(8, 7, 8, 1, PAL.skinShade);
  const lens = (lx) => {
    pc.rect(lx, 10, 3, 1, GOLD);
    pc.rect(lx, 12, 3, 1, GOLD);
    pc.px(lx, 11, GOLD);
    pc.px(lx + 2, 11, GOLD);
  };
  lens(8);
  lens(13);
  pc.rect(11, 11, 2, 1, GOLD);
  if (blink) {
    pc.rect(8, 11, 3, 1, GOLD);
    pc.rect(13, 11, 3, 1, GOLD);
  } else {
    pc.px(9, 11, "#dff0f6");
    pc.px(14, 11, "#dff0f6");
    pc.px(9, 11, OUT);
    pc.px(14, 11, OUT);
  }
  pc.rect(9, 13, 6, 2, "#e8e8e8");
  pc.rect(9, 14, 6, 1, "#c8c8c8");
  pc.rect(9, 15, 6, 2, GOLD);
  blk(pc, 5, 7, 14, 3, HAT);
  pc.rect(5, 7, 14, 1, HAT_L);
  pc.triangle(11, 0, 6, 9, 17, 9, OUT);
  pc.triangle(11, 1, 7, 9, 16, 9, HAT);
  pc.px(11, 0, STAR_C);
  pc.px(10, 0, STAR_C);
  pc.px(10, 4, STAR_C);
  pc.px(12, 6, STAR_C);
  pc.rect(7, 8, 10, 1, GOLD);
  if (isShow) {
    blk(pc, 6, 7, 2, 6, ROBE);
    blk(pc, 16, 7, 2, 6, ROBE);
    pc.rect(6, 5, 2, 2, PAL.skin);
    pc.rect(16, 5, 2, 2, PAL.skin);
    pc.ellipse(11, 3, 4.2, 2.1, "#6fb0d0");
    pc.ellipse(11, 3, 2.8, 1.3, "#bfe6f2");
    pc.triangle(15, 3, 11, 1.4, 11, 4.6, "#4a93b0");
    pc.px(9, 2, INK);
    rodLine(pc, 20, 33, 21, 20);
  } else {
    blk(pc, 17, 14, 2, 7, ROBE);
    pc.rect(17, 18, 2, 2, GOLD);
    pc.rect(17, 20, 2, 2, PAL.skin);
    const g = pose === "cast0" ? [13, 15] : pose === "cast1" ? [8, 15] : pose === "cast2" || pose === "reel" ? [8, 18] : [6, 13];
    blk(pc, g[0] - 1, g[1] - 1, 2, 6, ROBE);
    pc.rect(g[0] - 1, g[1] - 1, 2, 2, PAL.skin);
    pc.rect(g[0] - 1, g[1] + 3, 2, 2, GOLD);
    const tip = ROD_TIP_WIZARD[pose];
    rodLine(pc, g[0], g[1], tip[0], tip[1]);
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
function drawFishBody(body, c1, c2, feat = "none", legendary = false) {
  const wide = feat === "whiskers" || feat === "duckBill";
  const pc = new PixelCanvas(wide ? 14 : 12, 8);
  const belly = mixHex(c1, "#ffffff", 0.35);
  const dark = mixHex(c1, "#000000", 0.35);
  const fin = legendary ? "#4ea8b8" : c2;
  const cx = wide ? 7 : 6;
  const hx = wide ? 11 : 9;
  const tail = () => {
    if (feat === "forkTail") {
      pc.triangle(1, 1, 4, 1, 1, 4, fin);
      pc.triangle(1, 7, 4, 7, 1, 4, fin);
    } else {
      pc.triangle(1, 4, 4, 2, 4, 6, fin);
    }
  };
  switch (body) {
    case "spindle":
      pc.ellipse(cx, 4, 5, 2.6, c1);
      pc.rect(cx - 2, 6, 5, 1, belly);
      tail();
      pc.triangle(cx - 1, 1, cx + 1, 1, cx, 0, fin);
      pc.px(hx, 3, INK);
      pc.px(hx + 1, 3, INK);
      pc.rect(2, 3, 2, 1, dark, 0.5);
      break;
    case "long":
      pc.ellipse(cx, 4, 4.5, 1.7, c1);
      pc.rect(cx - 2, 5, 5, 1, belly);
      tail();
      pc.triangle(hx + 1, 4, hx, 2, hx, 6, fin);
      pc.px(hx, 3, INK);
      pc.rect(3, 3, 2, 1, dark, 0.4);
      break;
    case "round":
      pc.ellipse(cx, 4, 3.5, 3, c1);
      pc.rect(cx - 2, 6, 4, 1, belly);
      tail();
      pc.px(hx - 1, 3, INK);
      pc.rect(cx - 2, 3, 2, 1, dark, 0.4);
      break;
    case "flat":
      pc.ellipse(cx, 4, 3.2, 3.2, c1);
      pc.rect(cx - 2, 6, 4, 1, belly);
      tail();
      pc.px(hx - 1, 3, INK);
      pc.rect(cx - 2, 2, 2, 1, dark, 0.4);
      break;
  }
  switch (feat) {
    case "whiskers":
      pc.px(hx + 1, 5, INK);
      pc.px(hx + 2, 6, INK);
      pc.px(hx + 1, 6, INK);
      break;
    case "duckBill":
      pc.rect(hx - 1, 3, 3, 1, c2);
      pc.rect(hx - 1, 4, 2, 1, dark);
      pc.px(hx + 1, 4, INK);
      break;
    case "bigEye":
      pc.ellipse(hx, 3, 1.8, 1.8, OUT);
      pc.ellipse(hx, 3, 1.2, 1.2, "#f8f8f0");
      pc.px(hx, 3, INK);
      pc.px(hx - 1, 2, "#ffffff");
      break;
    case "bigMouth":
      pc.rect(hx - 2, 4, 3, 1, INK, 0.9);
      break;
    case "tentacles":
      pc.px(3, 7, c2);
      pc.px(4, 7, c2);
      pc.px(5, 7, c2);
      pc.px(8, 7, c2);
      pc.px(9, 7, c2);
      pc.px(10, 7, c2);
      if (body === "round") {
        pc.px(hx - 2, 3, INK);
        pc.px(hx, 3, INK);
      }
      break;
    case "spikes":
      pc.px(cx, 0, c2);
      pc.px(cx - 3, 1, c2);
      pc.px(cx + 3, 1, c2);
      pc.px(cx - 4, 4, c2);
      pc.px(cx + 4, 4, c2);
      break;
    case "segments":
      pc.rect(2, 2, 8, 1, dark, 0.55);
      pc.rect(2, 4, 8, 1, dark, 0.55);
      pc.rect(2, 6, 8, 1, dark, 0.55);
      break;
  }
  if (legendary) {
    pc.rect(cx - 3, 5, 6, 1, "#f0a030");
    pc.triangle(cx - 2, 1, cx, 1, cx - 1, 0, "#f0a030");
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
function drawOpenChest() {
  const pc = new PixelCanvas(14, 11);
  pc.rect(0, 6, 14, 5, PAL.chest);
  pc.rect(0, 6, 14, 1, PAL.chestDark);
  pc.rect(1, 3, 12, 3, PAL.chestDark);
  pc.rect(1, 3, 12, 1, "#9c6d40");
  pc.rect(2, 5, 10, 2, "#f4d85a");
  pc.px(3, 5, "#fff0b8");
  pc.px(9, 5, "#fff0b8");
  pc.rect(5, 3, 2, 8, PAL.chestGold);
  pc.rect(6, 7, 2, 3, "#f0d060");
  pc.px(7, 8, "#8a6a10");
  pc.strokeRect(0, 3, 14, 8, "#2a1c0c");
  return pc.bake();
}
function drawCoin() {
  const pc = new PixelCanvas(9, 9);
  pc.ellipse(4, 4, 4.2, 4.2, "#8a6a10");
  pc.ellipse(4, 4, 3.4, 3.4, "#e8c53a");
  pc.ellipse(4, 4, 2.4, 2.4, "#f4d85a");
  pc.px(3, 3, "#fff0b8");
  pc.rect(3, 6, 3, 1, "#c89a20");
  return pc.bake();
}
function drawFishQuest() {
  const pc = new PixelCanvas(12, 8);
  pc.ellipse(6, 4, 4.6, 2.4, "#3a4a55");
  pc.triangle(1, 4, 4, 2, 4, 6, "#3a4a55");
  pc.px(10, 3, "#dfe8f0");
  const q = [
    [1, 1, 1],
    [0, 0, 1],
    [0, 1, 0],
    [0, 0, 0],
    [0, 1, 0]
  ];
  q.forEach((row, j) => row.forEach((v, i) => {
    if (v) pc.px(5 + i, 2 + j, "#e8f6f9");
  }));
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
function drawRod() {
  const pc = new PixelCanvas(12, 12);
  rodLine(pc, 1, 11, 10, 2);
  pc.rect(2, 8, 3, 3, "#9aa3ad");
  pc.rect(3, 9, 1, 1, "#cfd6dd");
  pc.rect(0, 10, 3, 2, PAL.woodDark);
  pc.px(10, 2, "#ffe9b0");
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
      const horizontal = drawFishBody(def.body, def.color, def.color2, def.feat ?? "none", !!def.legendary);
      fish[def.id] = [rotate90(horizontal, false).bake(), rotate90(horizontal, true).bake()];
    }
    return fish;
  }
  static build(fishDefs, skin = "farmer") {
    const drawChar = skin === "cat" ? drawCatCharacter : skin === "frog" ? drawFrogCharacter : skin === "penguin" ? drawPenguinCharacter : skin === "wizard" ? drawWizardCharacter : drawPlayer;
    return {
      playerIdle: [drawChar("idle0"), drawChar("idle1")],
      playerCast: [drawChar("cast0"), drawChar("cast1"), drawChar("cast2")],
      playerReel: drawChar("reel"),
      playerShow: drawChar("show"),
      bobber: drawBobber(),
      splash: drawSplash(),
      fish: _SpriteFactory.buildFish(fishDefs),
      trash: drawTrash(),
      chest: drawChest(),
      chestOpen: drawOpenChest(),
      crown: drawCrown(),
      exclaim: drawExclaim(),
      star: drawStar(),
      coin: drawCoin(),
      fishQuest: drawFishQuest(),
      rod: drawRod(),
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
  /** 抛竿落点范围（左下；蓄力越满越往左/越高 = 越远，靠 X 跨度体现远近） */
  CAST_X_MIN: 72,
  CAST_X_MAX: 165,
  CAST_Y_MIN: 312,
  CAST_Y_MAX: 332,
  /** 右下角工具按钮（汉堡菜单，点击弹出 设置/音效/退出） */
  TOOLS_BTN: { x: 318, y: 368, r: 12 },
  // ---------- 小游戏轨道（官方锚点） ----------
  /** 官方：轨道总高 568px */
  TRACK_H: 568,
  /** 绿条底部边界 = 轨道总高（与鱼的活动范围一致，确保沉到底也能覆盖鱼） */
  BAR_BOTTOM: 568,
  /** 星露谷手感：绿条很灵活——按住快速上升、松开很快沉底，考验鼠标操控 */
  BAR_ACCEL_UP: 1300,
  BAR_GRAVITY: 900,
  BAR_SPEED_MAX: 300,
  BAR_BOUNCE: 30,
  /**
   * 绿条"逻辑尺寸"（轨道单位，0~568）。渲染时再乘 scale(=BAR_H/TRACK_H≈0.194)。
   * v2026-10-19 重调（plan/数值重调方案.md）：旧值 200 → 渲染 ~39px 远大于鱼图标，
   * 导致"打不输"（无头模拟全表 100%）。降到 120 → 渲染 ~23px，
   * 与缩小后的鱼图标(24px, PetView fishW/fishH)匹配：居中可盖住、移动时鱼会探出
   * 上下沿 = 产生真实挑战。等级/竿加成同步压缩，不再反杀难度缩放。
   */
  BAR_SIZE_BASE: 120,
  /** 每级绿条增量（轨道单位），Lv10 仅 +10（旧 2.5 会反向放大简单度） */
  BAR_SIZE_PER_LEVEL: 1,
  /** 绿条尺寸上限（轨道单位），任何情况下都不超过此值（含鱼竿加成） */
  BAR_SIZE_MAX: 165,
  // ---------- 鱼 AI（桌宠：绿条已调灵活，难度交给鱼——低难鱼慢而稳、高难鱼快而狂） ----------
  /** 难度归一化锚点（鱼表难度带约 10~110；上限 160 = 抬高天花板，让 Lv10 鱼王仍比 Lv0 难） */
  DIFF_MIN: 10,
  DIFF_MAX: 160,
  /** 鱼速范围（px/s）：归一化到难度带，低难鱼慢、高难鱼快，再乘心情浮动。
   * v2026-10-19 重调：DIFF_MAX 115→160 后高难鱼在 Lv0 偏慢（模拟人类可 100% 跟踪鱼王），
   * 按 plan/数值重调方案.md 第 5 节兜底把 MAX 158→215——低难鱼受 normT 保护几乎无感，高难鱼真正能跑出绿条。 */
  FISH_SPEED_MIN: 46,
  FISH_SPEED_MAX: 240,
  FISH_SPRING_K: 5.5,
  FISH_DAMPING: 5.5,
  /** 变向幅度范围（轨道单位）：低难鱼小幅、高难鱼大幅，再乘心情浮动 */
  DART_AMP_MIN: 70,
  DART_AMP_MAX: 185,
  /** 变向间隔锚点（ms）：低难鱼懒得动(CALM 长)、高难鱼不停变向(FRANTIC 短) */
  DART_INTERVAL_CALM: 720,
  DART_INTERVAL_FRANTIC: 150,
  /** 每局"心情"：游速与活跃度的随机浮动（±），让同种鱼时易时难，不再一成不变 */
  FISH_MOOD_MIN: 0.85,
  FISH_MOOD_MAX: 1.18,
  /** 官方：sinker 向下加速度更快 / floater 向上加速度更快（v2026-10-19 重调 52→30，压平贴墙） */
  SINKER_ACCEL: 30,
  FLOATER_ACCEL: 30,
  // ---------- 进度条（涨更快、流失更狠：单局 8-22s，普通鱼也不再稳钓） ----------
  PROGRESS_INITIAL: 0.28,
  PROGRESS_GAIN: 0.11,
  /** v2026-10-19 重调 0.18→0.20：抬高覆盖率门槛（鱼王需 ~72% 在条内才能净涨），
   * 按难度等比收紧——高难鱼流失系数最高、承受最多，低难鱼几乎无感（plan/数值重调方案.md 第 5 节方向） */
  PROGRESS_DRAIN_BASE: 0.2,
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
  /** 桌宠节奏：咬钩 0.6~4s 随机（v2026-10-19 重调 0.7~8s→0.6~4s，压缩空等） */
  BITE_MIN_MS: 600,
  BITE_MAX_MS: 4e3,
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
  TRASH_MIN: 0.05,
  // ---------- 等级 → 难度（方向 A：绿条不变，鱼变难 + 高难鱼更易出现） ----------
  /** 鱼的难度随等级缩放斜率：effectiveDiff = 物种难度 × 抖动 × (1 + 等级 × 该值)，上限 DIFF_MAX。
   * v2026-10-19 重调 0.12→0.045：旧值下鱼王 Lv4 即撞 DIFF_MAX(160) 顶，Lv5+ 鱼王 AI 完全不变
   * （等级轴对鱼王失效）；0.045 使鱼王 Lv10 = 110×1.45 ≈ 159.5 恰好不封顶，全等级单调变难。 */
  LEVEL_DIFF_K: 0.045,
  /** 鱼池权重随等级向高难鱼倾斜的斜率：权重 ×= 1 + 等级 × 该值 × (难度/110) */
  LEVEL_POOL_K: 0.08
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
var BAR_W = 34;
var BAR_H = 110;
var BAR_TOP = 236;
var BAR_X = 16;
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
  /** 工具按钮悬停高亮（由 Game 每帧写入） */
  toolsHover = false;
  /** 隐身模式：隐藏人物与 lev 徽章，仅保留工具按钮（由 Game 写入） */
  stealth = false;
  /** 点击区域可视化：开启后把"钓鱼区 / 拖拽区 / 菜单 / 无效区"用彩色边框+标签画出来，
   *  让使用者一眼看清"点哪里生效哪里不生效"。纯画布叠加层，不拦截任何点击。 */
  showClickMap = false;
  skin;
  rodTip;
  sprites;
  /** 自然眨眼调度（设计规范 §2.2 idle1 眨眼帧）：下次眨眼时刻 / 本轮闭眼截止时刻（秒，游戏时间轴） */
  blinkNextAt = 2.2;
  blinkUntil = 0;
  /** 最近一次绘制时的游戏时间（供 blinkActive 断言当前是否闭眼） */
  blinkNow = -1;
  /** 当前是否处于眨眼闭眼帧（调试 / E2E 观测用） */
  get blinkActive() {
    return this.blinkNow >= 0 && this.blinkNow < this.blinkUntil;
  }
  constructor(sprites, skin = "farmer") {
    this.sprites = sprites;
    this.skin = skin;
    this.rodTip = ROD_TIPS[skin];
  }
  /** 切换人物形象并刷新精灵与竿尖偏移 */
  setSprites(sprites, skin = this.skin) {
    this.sprites = sprites;
    this.skin = skin;
    this.rodTip = ROD_TIPS[skin];
  }
  toY(pos) {
    return BAR_TOP + pos / T.TRACK_H * BAR_H;
  }
  /** 把绘制 y 夹在轨道框内，避免鱼/绿条超出边界（即使物理上已到极值） */
  clampTrack(y, half) {
    return Math.max(BAR_TOP + half, Math.min(BAR_TOP + BAR_H - half, y));
  }
  draw(ctx, state) {
    ctx.imageSmoothingEnabled = false;
    const px = state.playerX;
    const py = state.playerFootY;
    if (this.showClickMap) this.drawClickMapBack(ctx);
    if (!this.stealth) {
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.beginPath();
      ctx.ellipse(px, py - 1, CAT_DW * 0.42, 5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
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
    if (!this.stealth) {
      this.drawCat(ctx, state);
      this.drawLevelBadge(ctx, state);
    }
    this.drawToolsButton(ctx);
    if (this.showClickMap) this.drawClickMapTags(ctx);
    if (state.result) this.drawResult(ctx, state.result, state.time);
  }
  /**
   * 点击区域可视化（底层）：用半透明填充 + 彩色边框标出四大区域。
   *  - 顶部红色带：无效区（窗口上缘，避免误触）
   *  - 黄色圈：工具菜单命中范围
   *  - 蓝色框：人物交互区（既「点一下=钓鱼」又「按住拖动=移窗」，覆盖 Game 的 #pet-handle）
   */
  drawClickMapBack(ctx) {
    const W = T.VIEW_W;
    const H = T.VIEW_H;
    const dead = 30;
    ctx.save();
    ctx.fillStyle = "rgba(186,54,54,0.20)";
    ctx.fillRect(0, 0, W, dead);
    ctx.strokeStyle = "rgba(255,120,120,0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, dead);
    ctx.lineTo(W, dead);
    ctx.stroke();
    const catL = T.PLAYER_X - CAT_DW / 2;
    const catR = T.PLAYER_X + CAT_DW / 2;
    const badgeR = Math.min(T.VIEW_W - 1, T.PLAYER_X + CAT_DW / 2 + 4 + 68);
    const hitL = catL - 6;
    const hitT = T.PLAYER_FOOT_Y - CAT_DH - 6;
    const hitR = badgeR + 2;
    const hitB = Math.min(T.TOOLS_BTN.y - T.TOOLS_BTN.r - 4, T.PLAYER_FOOT_Y + 10);
    ctx.fillStyle = "rgba(80,150,230,0.16)";
    ctx.fillRect(hitL, hitT, hitR - hitL, hitB - hitT);
    ctx.strokeStyle = "rgba(120,180,255,0.95)";
    ctx.lineWidth = 2;
    ctx.strokeRect(hitL, hitT, hitR - hitL, hitB - hitT);
    const t = T.TOOLS_BTN;
    ctx.strokeStyle = "rgba(240,210,80,0.95)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.r + 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  /** 点击区域可视化（标签层）：在对应区域上方画可读的中文小标签 */
  drawClickMapTags(ctx) {
    this.tag(ctx, T.VIEW_W / 2, 15, "\u9876\u90E8 30px\uFF1A\u65E0\u6548\u533A", "rgba(120,30,30,0.92)", "#ffd9d9");
    this.tag(
      ctx,
      T.PLAYER_X,
      T.PLAYER_FOOT_Y - CAT_DH - 22,
      "\u62D6\u62FD\u79FB\u52A8 / \u8F7B\u70B9\u9493\u9C7C",
      "rgba(24,60,110,0.92)",
      "#cfe6ff"
    );
    this.tag(
      ctx,
      T.VIEW_W / 2,
      T.VIEW_H - 15,
      "\u70B9\u6309\u4EFB\u610F\u5904 = \u9493\u9C7C\uFF08\u84C4\u529B / \u6536\u7EBF\uFF09",
      "rgba(20,70,40,0.92)",
      "#c8ffd8"
    );
    const t = T.TOOLS_BTN;
    this.tag(ctx, t.x, t.y - t.r - 12, "\u2261 \u83DC\u5355\uFF08\u70B9\u51FB\uFF09", "rgba(96,78,12,0.92)", "#fff0b8");
  }
  /** 画一个小标签：半透明底框 + 描边 + 居中中文，保证在任意壁纸上都清晰 */
  tag(ctx, cx, cy, text, bg, fg) {
    ctx.save();
    ctx.font = '11px "Microsoft YaHei", "PingFang SC", sans-serif';
    const w = Math.ceil(ctx.measureText(text).width) + 10;
    const h = 17;
    const x = Math.round(cx - w / 2);
    const y = Math.round(cy - h / 2);
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, cx, cy + 0.5);
    ctx.restore();
  }
  /** 右下角工具按钮（汉堡菜单图标，暗底 + 亮描边，透明背景中清晰，悬停高亮） */
  drawToolsButton(ctx) {
    const { x, y, r } = T.TOOLS_BTN;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = this.toolsHover ? "rgba(42,107,143,0.96)" : "rgba(12,20,28,0.78)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = this.toolsHover ? "#bfe6f5" : "rgba(232,246,249,0.85)";
    ctx.stroke();
    ctx.strokeStyle = this.toolsHover ? "#ffffff" : "#e8f6f9";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    const w = r * 0.52;
    for (let i = -1; i <= 1; i++) {
      const yy = y + i * 5;
      ctx.beginPath();
      ctx.moveTo(x - w, yy);
      ctx.lineTo(x + w, yy);
      ctx.stroke();
    }
    ctx.restore();
  }
  drawCat(ctx, state) {
    const pose = state.playerPose;
    let img;
    if (pose === "idle") {
      const t = state.time;
      this.blinkNow = t;
      if (t >= this.blinkNextAt) {
        this.blinkUntil = t + 0.11;
        this.blinkNextAt = t + 2.6 + Math.random() * 1.6;
      }
      img = t < this.blinkUntil ? this.sprites.playerIdle[1] : this.sprites.playerIdle[0];
    } else if (pose === "cast") {
      img = this.sprites.playerCast[Math.min(2, Math.max(0, state.playerFrame | 0))];
    } else if (pose === "reel") img = this.sprites.playerReel;
    else img = this.sprites.playerShow;
    const dx = Math.round(state.playerX - CAT_DW / 2);
    const dy = Math.round(state.playerFootY - CAT_DH);
    ctx.drawImage(img, dx, dy, CAT_DW, CAT_DH);
  }
  rodTipWorld(state) {
    const pose = state.playerPose;
    const key = pose === "reel" ? "reel" : pose === "cast" ? `cast${Math.min(2, Math.max(0, state.playerFrame | 0))}` : "idle0";
    const [ox, oy] = this.rodTip[key];
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
    const fx = BAR_X - 5, fy = BAR_TOP - 5, fw = BAR_W + 10, fh = BAR_H + 10;
    ctx.save();
    ctx.shadowColor = "rgba(111,195,223,0.55)";
    ctx.shadowBlur = 10;
    ctx.fillStyle = "rgba(13,43,58,0.82)";
    ctx.beginPath();
    ctx.roundRect(fx, fy, fw, fh, 6);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = "rgba(111,195,223,0.85)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(fx + 0.75, fy + 0.75, fw - 1.5, fh - 1.5, 6);
    ctx.stroke();
    ctx.fillStyle = PAL.uiBorder;
    ctx.fillRect(fx, fy, fw, 2);
    ctx.fillRect(fx, fy + fh - 2, fw, 2);
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
      const ty = this.clampTrack(this.toY(s.treasure.pos), 12);
      ctx.drawImage(this.sprites.chest, BAR_X + BAR_W / 2 - 16, Math.round(ty - 12), 32, 25);
      const bw = 22;
      const bx = BAR_X + BAR_W / 2 - bw / 2;
      const by = ty + 13;
      ctx.fillStyle = "rgba(6,13,20,0.7)";
      ctx.fillRect(bx - 1, by - 1, bw + 2, 5);
      ctx.fillStyle = PAL.chestGold;
      ctx.fillRect(bx, by, Math.round(bw * s.treasure.progress), 3);
    }
    const fishY = this.clampTrack(this.toY(s.fishPos), 16);
    const fishW = 16;
    const fishH = 24;
    ctx.drawImage(s.fishIcon, BAR_X + BAR_W / 2 - fishW / 2, Math.round(fishY - fishH / 2), fishW, fishH);
    if (s.legendary) ctx.drawImage(this.sprites.crown, BAR_X + BAR_W / 2 - 10, Math.round(fishY - 20), 20, 15);
    const barH = s.barSize * scale;
    const barY = Math.max(BAR_TOP, Math.min(BAR_TOP + BAR_H - barH, this.toY(s.barPos)));
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
  /**
   * 干净的中文/矢量文本：米色面板上用深棕细描边（1px 级），整数对齐、行高一致。
   * 描边仅作对比衬底，绝不抢字——字粗由 fill 决定，故描边压到最细，避免「字太粗看不清」。
   */
  rtext(ctx, str, x, y, size, color, align = "center") {
    ctx.save();
    ctx.font = `${size}px "Microsoft YaHei", "PingFang SC", sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const lw = Math.max(1, size / 16);
    ctx.lineWidth = lw;
    ctx.strokeStyle = "rgba(40,28,16,0.5)";
    const rx = Math.round(x);
    const ry = Math.round(y);
    if (lw > 1) ctx.strokeText(str, rx, ry);
    ctx.fillStyle = color;
    ctx.fillText(str, rx, ry);
    ctx.restore();
  }
  /** 结算弹窗：对齐 design/result-ui.png 三态（Common 绿C / Perfect 蓝P+印章 / Legendary 金L+王冠NEW+星光） */
  drawResult(ctx, r, time) {
    const w = 232;
    const x = Math.round((T.VIEW_W - w) / 2);
    const y = 42;
    const dark = "#3a2e22";
    const sub = "#6a5a44";
    const cx = x + w / 2;
    let h = 152;
    if (r.kind === "fish") {
      if (r.maxCast) h += 18;
      if (r.perfect) h += 2;
      if (r.treasure) h += 18;
      if (r.leveledUp) h += 18;
      if (r.unlockedRod) h += 18;
    } else if (r.kind === "trash") {
      h = 150;
    } else {
      h = 136;
    }
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
    if (r.kind === "fish") {
      const legendary = !!r.legendary;
      const letter = legendary ? "L" : r.perfect ? "P" : "C";
      const badgeBg = legendary ? "#e8c53a" : r.perfect ? "#4ea0c9" : "#5fd45f";
      this.resultBadge(ctx, x + 21, y + 21, 10, letter, badgeBg, "#ffffff");
      this.resultCloseX(ctx, x + w - 21, y + 19);
      if (r.fishIcon) {
        ctx.imageSmoothingEnabled = false;
        const iw = r.fishIcon.width * 4;
        const ih = r.fishIcon.height * 4;
        const ix = x + 12;
        const iy = y + 32;
        if (legendary) {
          ctx.drawImage(this.sprites.crown, Math.round(cx - 15), y - 14, 30, 22);
          const tw = 0.6 + 0.4 * Math.sin(time * 6);
          this.sparkle(ctx, ix + 2, iy + 4, 2 * tw, "#fff0b8");
          this.sparkle(ctx, ix + iw - 1, iy + 10, 1.6 * tw, "#ffe98a");
          this.sparkle(ctx, ix + iw / 2, iy + ih + 4, 1.8 * tw, "#fff0b8");
          this.sparkle(ctx, ix - 2, iy + ih - 6, 1.4 * tw, "#ffe98a");
        }
        ctx.drawImage(r.fishIcon, ix, iy, iw, ih);
      }
      if (r.isNew) this.newRibbon(ctx, x + w - 34, y + 30);
      const tx = x + 68;
      let ty = y + 36;
      this.rtext(ctx, r.fishName ?? "", tx, ty, 15, dark, "left");
      ty += 19;
      this.rtext(ctx, `Size ${r.size ?? 0}`, tx, ty, 12, sub, "left");
      ty += 18;
      const stars = r.quality === "iridium" ? 3 : r.quality === "gold" ? 2 : r.quality === "silver" ? 1 : 0;
      const qc = QUALITY_COLOR[r.quality ?? "normal"];
      for (let i = 0; i < 3; i++) {
        const sx = Math.round(tx + i * 14);
        const sy = ty - 4;
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
      ty += 18;
      if (r.price != null) {
        ctx.drawImage(this.sprites.coin, Math.round(tx - 1), ty - 8, 14, 14);
        this.rtext(ctx, `${r.price}`, tx + 18, ty - 1, 13, dark, "left");
        this.rtext(ctx, QUALITY_LABEL[r.quality ?? "normal"], tx + 18 + Math.max(14, `${r.price}`.length * 8) + 8, ty - 1, 11, sub, "left");
        ty += 20;
      }
      if (r.perfect && !legendary) this.perfectStamp(ctx, x + w - 56, y + 66);
      if (r.perfect && legendary) this.perfectStamp(ctx, x + w - 56, y + 66);
      if (r.maxCast) {
        const chipW = 62;
        const chipX = tx - 2;
        ctx.fillStyle = "#8a5c2e";
        ctx.fillRect(chipX, ty - 9, chipW, 15);
        ctx.fillStyle = PAL.chestGold;
        ctx.fillRect(chipX + 1, ty - 8, chipW - 2, 13);
        this.rtext(ctx, "MAX CAST", tx + chipW / 2 - 1, ty - 1, 10, "#5d3d22", "center");
        ty += 18;
      }
      if (r.treasure) {
        ctx.drawImage(this.sprites.chestOpen, Math.round(tx - 2), ty - 10, 20, 16);
        this.rtext(ctx, "TREASURE", tx + 24, ty - 2, 11, PAL.chest, "left");
        ty += 18;
      }
      this.rtext(ctx, `+${r.xp ?? 0} XP`, tx, ty, 13, dark, "left");
      ty += 18;
      if (r.leveledUp && r.leveledUp > 0) {
        this.rtext(ctx, `\u5347\u7EA7 \xD7${r.leveledUp}`, tx, ty, 13, PAL.progressHigh, "left");
        ty += 18;
      }
      if (r.unlockedRod) {
        ctx.drawImage(this.sprites.rod, Math.round(tx - 2), ty - 9);
        this.rtext(ctx, `\u89E3\u9501 ${r.unlockedRod}`, tx + 22, ty - 2, 11, PAL.chestGold, "left");
      }
    } else if (r.kind === "trash") {
      if (r.trashIcon) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(r.trashIcon, cx - r.trashIcon.width * 2, y + 22, r.trashIcon.width * 4, r.trashIcon.height * 4);
      }
      this.rtext(ctx, "\u9493\u4E0A\u4E86\u5783\u573E\u2026", cx, y + 62, 17, dark, "center");
      this.rtext(ctx, "\uFF08\u6CA1\u7528\u7684\u4E1C\u897F\uFF09", cx, y + 88, 11, sub, "center");
      this.rtext(ctx, `+${r.xp ?? 3} XP`, cx, y + 110, 13, dark, "center");
    } else {
      this.rtext(ctx, "\u9C7C\u9003\u8D70\u4E86\u2026", cx, y + 40, 17, dark, "center");
      this.rtext(ctx, "GOT AWAY", cx, y + 64, 12, PAL.progressLow, "center");
      this.rtext(ctx, "\u70B9\u51FB\u91CD\u65B0\u629B\u7AFF", cx, y + 94, 12, sub, "center");
    }
    this.rtext(ctx, "\u70B9\u51FB\u7EE7\u7EED", cx, y + h - 14, 11, "#8a7a64", "center");
  }
  /** 结算窗圆形徽章（字母 + 暗描边） */
  resultBadge(ctx, cx, cy, r, letter, bg, fg) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(58,46,34,0.85)";
    ctx.stroke();
    ctx.font = `bold ${Math.round(r * 1.25)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = fg;
    ctx.fillText(letter, cx, cy + 1);
    ctx.restore();
  }
  /** 结算窗右上角 X 关闭钮（纯视觉；点击任意处继续由状态机处理） */
  resultCloseX(ctx, cx, cy) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(58,46,34,0.12)";
    ctx.fill();
    ctx.strokeStyle = "rgba(58,46,34,0.55)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx - 3, cy - 3);
    ctx.lineTo(cx + 3, cy + 3);
    ctx.moveTo(cx + 3, cy - 3);
    ctx.lineTo(cx - 3, cy + 3);
    ctx.stroke();
    ctx.restore();
  }
  /** PERFECT! 红印章（斜盖章） */
  perfectStamp(ctx, cx, cy) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.16);
    ctx.strokeStyle = "#c0453a";
    ctx.lineWidth = 2;
    ctx.strokeRect(-40, -10, 80, 20);
    ctx.font = 'bold 13px "Microsoft YaHei", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#c0453a";
    ctx.fillText("PERFECT!", 0, 1);
    ctx.restore();
  }
  /** NEW 金色飘带（首次钓到传说鱼） */
  newRibbon(ctx, cx, cy) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(0.12);
    ctx.fillStyle = "#e8c53a";
    ctx.fillRect(-22, -8, 44, 16);
    ctx.fillStyle = "#c89a20";
    ctx.fillRect(-22, 4, 44, 4);
    ctx.strokeStyle = "rgba(58,46,34,0.7)";
    ctx.lineWidth = 1;
    ctx.strokeRect(-22, -8, 44, 16);
    ctx.font = 'bold 10px "Microsoft YaHei", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#5d3d22";
    ctx.fillText("NEW", 0, -1);
    ctx.restore();
  }
  /** 四角星闪光（传说鱼结算） */
  sparkle(ctx, cx, cy, s, color) {
    ctx.fillStyle = color;
    ctx.fillRect(cx - s / 2, cy - s * 1.5, s, s * 3);
    ctx.fillRect(cx - s * 1.5, cy - s / 2, s * 3, s);
  }
};

// src/renderer/fishing/data/fishTable.ts
var FISH_TABLE = [
  { id: "carp", name: "\u9CA4\u9C7C", nameEn: "Carp", difficulty: 15, behavior: "mixed", minSize: 15, maxSize: 51, color: "#8a9a4e", color2: "#c8b86e", body: "spindle", price: 11, feat: "whiskers", weight: 14 },
  { id: "herring", name: "\u9CB1\u9C7C", nameEn: "Herring", difficulty: 25, behavior: "dart", minSize: 8, maxSize: 21, color: "#9fb8cc", color2: "#dfe8f0", body: "long", price: 10, feat: "forkTail", weight: 10 },
  { id: "anchovy", name: "\u51E4\u5C3E\u9C7C", nameEn: "Anchovy", difficulty: 30, behavior: "dart", minSize: 1, maxSize: 17, color: "#7fa8c8", color2: "#c4dcec", body: "long", price: 20, feat: "forkTail", weight: 10 },
  { id: "sunfish", name: "\u592A\u9633\u9C7C", nameEn: "Sunfish", difficulty: 30, behavior: "mixed", minSize: 5, maxSize: 16, color: "#e8a83a", color2: "#f0d060", body: "spindle", price: 12, weight: 12 },
  { id: "bream", name: "\u9CB7\u9C7C", nameEn: "Bream", difficulty: 35, behavior: "smooth", minSize: 12, maxSize: 31, color: "#a8b8a0", color2: "#d8e0d0", body: "flat", price: 20, weight: 10 },
  { id: "sea_cucumber", name: "\u6D77\u53C2", nameEn: "Sea Cucumber", difficulty: 40, behavior: "sinker", minSize: 3, maxSize: 21, color: "#7a5a6e", color2: "#a88498", body: "long", price: 15, feat: "segments", weight: 8 },
  { id: "walleye", name: "\u5927\u773C\u68AD\u9C88", nameEn: "Walleye", difficulty: 45, behavior: "smooth", minSize: 10, maxSize: 41, color: "#8a7a4e", color2: "#c8b86e", body: "spindle", price: 11, feat: "bigEye", weight: 8 },
  { id: "largemouth_bass", name: "\u5927\u53E3\u9C88", nameEn: "Largemouth Bass", difficulty: 50, behavior: "mixed", minSize: 11, maxSize: 31, color: "#5a8a4e", color2: "#a8c86e", body: "spindle", price: 20, feat: "bigMouth", weight: 9 },
  { id: "pike", name: "\u72D7\u9C7C", nameEn: "Pike", difficulty: 60, behavior: "dart", minSize: 15, maxSize: 61, color: "#6a8a3a", color2: "#c8d86e", body: "long", price: 18, feat: "duckBill", weight: 6 },
  { id: "tuna", name: "\u91D1\u67AA\u9C7C", nameEn: "Tuna", difficulty: 70, behavior: "smooth", minSize: 12, maxSize: 61, color: "#3a6a9a", color2: "#9fc8e8", body: "spindle", price: 20, feat: "forkTail", weight: 5 },
  { id: "catfish", name: "\u9CB6\u9C7C", nameEn: "Catfish", difficulty: 75, behavior: "mixed", minSize: 12, maxSize: 73, color: "#7a6a52", color2: "#a89878", body: "long", price: 20, feat: "whiskers", weight: 5 },
  { id: "squid", name: "\u9C7F\u9C7C", nameEn: "Squid", difficulty: 75, behavior: "sinker", minSize: 12, maxSize: 49, color: "#d8a8b8", color2: "#f0d0dc", body: "long", price: 20, feat: "tentacles", weight: 5 },
  { id: "pufferfish", name: "\u6CB3\u8C5A", nameEn: "Pufferfish", difficulty: 80, behavior: "floater", minSize: 1, maxSize: 37, color: "#e8c53a", color2: "#f8e890", body: "round", price: 20, feat: "spikes", weight: 4 },
  { id: "octopus", name: "\u7AE0\u9C7C", nameEn: "Octopus", difficulty: 95, behavior: "sinker", minSize: 12, maxSize: 49, color: "#a85a6e", color2: "#d88a9e", body: "round", price: 20, feat: "tentacles", weight: 3 },
  { id: "legend", name: "\u9C7C\u738B", nameEn: "Legend", difficulty: 110, behavior: "mixed", minSize: 49, maxSize: 51, color: "#d6452e", color2: "#f0a030", body: "spindle", price: 5e3, legendary: true, weight: 0.4 }
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
function render(name, scene, view, sprites) {
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
function renderAll(skin) {
  const sprites = SpriteFactory.build(FISH_TABLE, skin);
  const view = new PetView(sprites, skin);
  const suffix = skin;
  render(`idle_${suffix}`, baseScene(), view, sprites);
  {
    const s = baseScene();
    s.playerPose = "reel";
    const fish = FISH_TABLE.find((f) => f.id === "sardine") ?? FISH_TABLE[0];
    s.minigame = {
      fishPos: 300,
      fishVel: 40,
      fishIcon: sprites.fish[fish.id][1],
      barPos: 238,
      barSize: T.BAR_SIZE_BASE,
      progress: 0.55,
      treasure: { pos: 120, progress: 0.4 },
      legendary: false
    };
    s.hud.hint = "";
    render(`minigame_${suffix}`, s, view, sprites);
  }
  {
    const s = baseScene();
    s.result = { kind: "escaped", perfect: false, treasure: false, xp: 0, leveledUp: 0 };
    render(`escaped_${suffix}`, s, view, sprites);
  }
  {
    const s = baseScene();
    s.playerPose = "cast";
    s.playerFrame = 2;
    s.bobber = { x: 128, y: 322, shake: 0.1 };
    s.splash = { x: 128, y: 322, frame: 1 };
    render(`fishing_${suffix}`, s, view, sprites);
  }
  {
    const s = baseScene();
    s.playerPose = "cast";
    s.playerFrame = 2;
    s.bobber = { x: T.CAST_X_MAX, y: T.CAST_Y_MAX, shake: 0 };
    s.lineVisible = true;
    s.splash = { x: T.CAST_X_MAX, y: T.CAST_Y_MAX, frame: 1 };
    render(`cast_near_${suffix}`, s, view, sprites);
  }
  {
    const s = baseScene();
    s.playerPose = "cast";
    s.playerFrame = 2;
    s.bobber = { x: T.CAST_X_MIN, y: T.CAST_Y_MIN, shake: 0 };
    s.lineVisible = true;
    s.splash = { x: T.CAST_X_MIN, y: T.CAST_Y_MIN, frame: 1 };
    render(`cast_far_${suffix}`, s, view, sprites);
  }
  {
    const s = baseScene();
    s.playerPose = "cast";
    s.playerFrame = 2;
    s.bobber = { x: 128, y: 322, shake: 0.95 };
    s.splash = { x: 128, y: 322, frame: 1 };
    s.hud.exclaim = true;
    s.hud.exclaimX = 128;
    s.hud.exclaimY = 396 - 14;
    render(`bite_${suffix}`, s, view, sprites);
  }
  {
    const s = baseScene();
    s.playerPose = "show";
    const fish = FISH_TABLE.find((f) => f.id === "sardine") ?? FISH_TABLE[0];
    s.result = {
      kind: "fish",
      perfect: true,
      treasure: true,
      maxCast: true,
      xp: 26,
      leveledUp: 1,
      fishName: fish.name,
      fishIcon: sprites.fish[fish.id][1],
      size: 18,
      quality: "gold"
    };
    render(`catch_${suffix}`, s, view, sprites);
  }
  {
    const s = baseScene();
    s.playerPose = "cast";
    s.playerFrame = 2;
    s.hud.charge = 1;
    s.hud.hint = "\u677E\u5F00\u629B\u51FA\uFF01";
    render(`chargemax_${suffix}`, s, view, sprites);
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
    render(`catchmax_${suffix}`, s, view, sprites);
  }
  {
    view.toolsHover = true;
    render(`toolshover_${suffix}`, baseScene(), view, sprites);
    view.toolsHover = false;
  }
  {
    view.stealth = true;
    render(`stealth_${suffix}`, baseScene(), view, sprites);
    view.stealth = false;
  }
  {
    view.showClickMap = true;
    render(`clickmap_${suffix}`, baseScene(), view, sprites);
    view.showClickMap = false;
  }
}
function renderPoseSheet(skin) {
  const sprites = SpriteFactory.build(FISH_TABLE, skin);
  const scale = 4;
  const cellW = 24 * scale;
  const cellH = 40 * scale;
  const cols = 4;
  const rows = 2;
  const pad = 10;
  const titleH = 30;
  const labelH = 20;
  const cv = realCreate(cols * cellW + pad * 2, titleH + pad + rows * cellH + labelH + pad);
  const ctx = cv.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#10181f";
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = "#8fc4d4";
  ctx.font = "bold 18px sans-serif";
  ctx.fillText(`poses \xB7 ${skin}`, pad, 22);
  const poses = [
    ["idle0", sprites.playerIdle[0]],
    ["idle1", sprites.playerIdle[1]],
    ["cast0", sprites.playerCast[0]],
    ["cast1", sprites.playerCast[1]],
    ["cast2", sprites.playerCast[2]],
    ["reel", sprites.playerReel],
    ["show", sprites.playerShow]
  ];
  poses.forEach(([label, img], i) => {
    const cx = pad + i % cols * cellW;
    const cy = titleH + pad + Math.floor(i / cols) * cellH;
    const check = 8;
    for (let y = 0; y < cellH; y += check) {
      for (let x = 0; x < cellW; x += check) {
        const on = (x / check | 0) % 2 === (y / check | 0) % 2;
        ctx.fillStyle = on ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)";
        ctx.fillRect(cx + x, cy + y, check, check);
      }
    }
    ctx.drawImage(img, cx, cy, cellW, cellH);
    ctx.fillStyle = "#9fc4d6";
    ctx.font = "12px monospace";
    ctx.fillText(label, cx + 2, cy + cellH + 14);
  });
  const out = `scripts/poses_${skin}.png`;
  require("fs").writeFileSync(out, cv.toBuffer("image/png"));
  console.log("wrote", out, `(${cv.width}x${cv.height})`);
}
renderAll("farmer");
renderAll("cat");
renderPoseSheet("farmer");
renderPoseSheet("cat");
renderPoseSheet("frog");
renderPoseSheet("penguin");
renderPoseSheet("wizard");
function renderKeyScenes(skin) {
  const sprites = SpriteFactory.build(FISH_TABLE, skin);
  const view = new PetView(sprites, skin);
  render(`key_idle_${skin}`, baseScene(), view, sprites);
  {
    const s = baseScene();
    s.playerPose = "cast";
    s.playerFrame = 2;
    s.bobber = { x: T.CAST_X_MIN, y: T.CAST_Y_MIN, shake: 0 };
    s.lineVisible = true;
    s.splash = { x: T.CAST_X_MIN, y: T.CAST_Y_MIN, frame: 1 };
    render(`key_castfar_${skin}`, s, view, sprites);
  }
  {
    const s = baseScene();
    s.playerPose = "cast";
    s.playerFrame = 2;
    s.bobber = { x: 128, y: 322, shake: 0.95 };
    s.splash = { x: 128, y: 322, frame: 1 };
    s.hud.exclaim = true;
    s.hud.exclaimX = 128;
    s.hud.exclaimY = 396 - 14;
    render(`key_bite_${skin}`, s, view, sprites);
  }
  {
    const s = baseScene();
    s.playerPose = "show";
    const fish = FISH_TABLE.find((f) => f.id === "sardine") ?? FISH_TABLE[0];
    s.result = {
      kind: "fish",
      perfect: true,
      treasure: true,
      maxCast: false,
      xp: 26,
      leveledUp: 0,
      fishName: fish.name,
      fishIcon: sprites.fish[fish.id][1],
      size: 18,
      quality: "gold"
    };
    render(`key_catch_${skin}`, s, view, sprites);
  }
}
renderKeyScenes("frog");
renderKeyScenes("penguin");
renderKeyScenes("wizard");
