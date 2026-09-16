/**
 * components/custom-map.js — 30×30 格栅化校园地图（web 版，由小程序 Component 重写为 class）
 *
 * 与原组件保持一致的坐标/手势/绘制逻辑：
 * - map-painter 绘制参考模板底图，historical-map-svg 作为加载失败时的回退。
 * - 缩放/平移只通过 canvas 元素的 CSS transform 实现，位图整体缩放。
 * - 手势：触摸事件（非 passive + preventDefault，从宿主 WebView 手里抢回手势）
 *   与鼠标事件分两路；滚轮平移，Ctrl/⌘+滚轮缩放。
 *   触摸点始终从事件重新读取（e.touches），绝不自己缓存触摸集合。
 */
import * as canvasMap from '../utils/canvas-map.js';
import SVG_BASE_FALLBACK from './historical-map-svg.js';
import renderSVG from './svg-canvas-renderer.js';
import { createMapPainter, MAP_IMAGE_WIDTH, MAP_IMAGE_HEIGHT } from './map-painter.js';
import { isEnglish } from '../i18n.js';
import booth8HighlightSrc from '../../地图相关素材/按钮8.webp';
import npcUpLeftSrc from '../../人物素材/透明背景/up_left_foot_forward.webp';
import npcUpRightSrc from '../../人物素材/透明背景/up_right_foot_forward.webp';
import npcDownLeftSrc from '../../人物素材/透明背景/down_left_foot_forward.webp';
import npcDownRightSrc from '../../人物素材/透明背景/down_right_foot_forward.webp';

const MAP_WIDTH = canvasMap.GRID_COLS * canvasMap.CELL_PX;
const MAP_HEIGHT = canvasMap.GRID_ROWS * canvasMap.CELL_PX;
const MIN_SCALE = 0.3;
const MAX_SCALE = 2.5;
const INITIAL_ZOOM = 1;
const CLAMP_MARGIN = 80;

const DEFAULT_VIEW_CELLS_X = 17;
const DEFAULT_FOCUS_CENTER = { x: 10, y: 14 };

/* 1–8 号与 15 号一列之间的石板路，x=105 为两列按钮净空区域的中心线。 */
const NPC_ROUTE = { x: 105, top: 168, bottom: 414 };
const NPC_SPEED = 24;
const NPC_STEP_MS = 180;
const NPC_FRAMES = {
  up: [npcUpLeftSrc, npcUpRightSrc],
  down: [npcDownLeftSrc, npcDownRightSrc],
};

/* 参考位图的摊位并非严格等距，按钮按实测中心绘制，避免越往下偏差越大。 */
const BOOTH_COLUMN_CENTERS = {
  0: 15, 1: 50, 2: 90, 3: 128, 4: 160, 5: 198, 6: 238, 7: 273, 8: 308, 9: 344,
  10: 379, 11: 414, 12: 450, 13: 485, 14: 521, 15: 563, 16: 600, 17: 635, 19: 697,
};

const BOOTH_ROW_CENTERS = {
  1: 57, 3: 126, 4: 168, 5: 203, 6: 238, 7: 274, 8: 308, 9: 344, 10: 380,
  11: 414, 13: 488, 14: 527, 15: 564, 16: 603, 17: 640, 18: 679, 19: 716,
  20: 755, 21: 788, 23: 864, 25: 932, 26: 968, 27: 1005,
};

function getBoothRenderPoint(booth) {
  const column = Math.floor(booth.mapX);
  const row = Math.floor(booth.mapY);
  return {
    x: BOOTH_COLUMN_CENTERS[column] ?? booth.mapX * canvasMap.CELL_PX,
    y: BOOTH_ROW_CENTERS[row] ?? booth.mapY * canvasMap.CELL_PX,
  };
}

function getDefaultFocus(width, height) {
  const cellsY = DEFAULT_VIEW_CELLS_X * (height / width);
  return {
    x0: DEFAULT_FOCUS_CENTER.x - DEFAULT_VIEW_CELLS_X / 2,
    y0: DEFAULT_FOCUS_CENTER.y - cellsY / 2,
    x1: DEFAULT_FOCUS_CENTER.x + DEFAULT_VIEW_CELLS_X / 2,
    y1: DEFAULT_FOCUS_CENTER.y + cellsY / 2,
  };
}

function parseSvgViewBox(svg) {
  const head = (svg || '').slice(0, 500);
  const match = /<svg[^>]*\bviewBox="[\d.-]+[ ,]+[\d.-]+[ ,]+([\d.]+)[ ,]+([\d.]+)"/i.exec(head);
  if (match) return { width: parseFloat(match[1]), height: parseFloat(match[2]) };
  return null;
}

export class CustomMap {
  constructor(root, { onBoothTap, onBoothCancel, onUnionTap } = {}) {
    this.root = root;
    this.canvas = root.querySelector('.map-canvas');
    this._onBoothTap = onBoothTap || (() => {});
    this._onBoothCancel = onBoothCancel || (() => {});
    this._onUnionTap = onUnionTap || (() => {});

    this._booths = [];
    this._highlightedId = '';
    this._highlightPhase = 0;
    this._highlightTimer = 0;
    this._highlightRegion = null;
    this._viewport = { scale: 1, x: 0, y: 0 };
    this._rect = null;
    this._dpr = 1;
    this._ctx = null;
    this._baseCanvas = null;
    this._baseCtx = null;
    this._baseDrawn = false;
    this._svgString = SVG_BASE_FALLBACK;
    this._painter = null;
    this._booth8Highlight = null;
    this._booth8Flash = false;
    this._booth8Timer = 0;
    this._npcLayer = null;
    this._npc = null;
    this._npcRaf = 0;
    this._npcStartedAt = 0;
    this._npcFrameKey = '';
    this._npcReady = false;
    this._destroyed = false;

    // 手势运行时
    this._gesture = null;
    this._mouseDown = false;
    this._touchStartTime = 0;
    this._touchMoved = 0;
    this._lastPoint = null;
    this._lastTouchTs = 0; // 触摸后短时间内忽略合成的鼠标事件
    this._moveTimer = 0;
    this._h = null;

    this._onResize = () => {
      this._rect = this.root.getBoundingClientRect();
      if (this.canvas) this._apply(this._viewport);
    };
    window.addEventListener('resize', this._onResize);

    // 尺寸/坐标/初始取景必须同步完成：页面在微任务里就会调 focusMapPoint，
    // 地图就绪后即可响应页面聚焦。
    this._initCanvasSync();
    this._initNpc();
    this._bindGestures();
    this._loadPainter();
    this._loadBooth8Highlight();
  }

  _initNpc() {
    const layer = document.createElement('div');
    layer.className = 'map-npc-layer';
    layer.style.width = `${MAP_WIDTH}px`;
    layer.style.height = `${MAP_HEIGHT}px`;
    const npc = document.createElement('img');
    npc.className = 'map-npc';
    npc.alt = '';
    npc.setAttribute('aria-hidden', 'true');
    npc.draggable = false;
    layer.appendChild(npc);
    this.root.appendChild(layer);
    this._npcLayer = layer;
    this._npc = npc;

    this._apply(this._viewport);
    const sources = Object.values(NPC_FRAMES).flat();
    npc.addEventListener('load', () => npc.classList.add('is-ready'), { once: true });
    npc.src = NPC_FRAMES.down[0];
    Promise.all(sources.map((src) => new Promise((resolve) => {
      const image = new Image();
      image.onload = resolve;
      image.onerror = resolve;
      image.src = src;
    }))).then(() => {
      if (this._destroyed || !this._npc) return;
      this._npcReady = true;
      this._npcStartedAt = performance.now();
      this._tickNpc(this._npcStartedAt);
    });
  }

  _tickNpc(now) {
    if (this._destroyed || !this._npc || !this._npcReady) return;
    const elapsed = Math.max(0, now - this._npcStartedAt);
    const routeLength = NPC_ROUTE.bottom - NPC_ROUTE.top;
    const roundTrip = routeLength * 2;
    const distance = ((elapsed / 1000) * NPC_SPEED) % roundTrip;
    const x = NPC_ROUTE.x;
    let y = NPC_ROUTE.top;
    let direction = 'down';

    if (distance <= routeLength) {
      y += distance;
    } else {
      y = NPC_ROUTE.bottom - (distance - routeLength);
      direction = 'up';
    }

    const frame = Math.floor(elapsed / NPC_STEP_MS) % 2;
    const frameKey = `${direction}-${frame}`;
    if (frameKey !== this._npcFrameKey) {
      this._npc.src = NPC_FRAMES[direction][frame];
      this._npcFrameKey = frameKey;
    }
    this._npc.style.left = `${x}px`;
    this._npc.style.top = `${y}px`;
    this._npcRaf = requestAnimationFrame((time) => this._tickNpc(time));
  }

  _loadBooth8Highlight() {
    const image = new Image();
    image.onload = () => {
      if (this._destroyed) return;
      this._booth8Highlight = image;
      this._booth8Flash = true;
      this._drawAll();
      this._booth8Timer = window.setInterval(() => {
        this._booth8Flash = !this._booth8Flash;
        this._drawAll();
      }, 650);
    };
    image.onerror = () => {};
    image.src = booth8HighlightSrc;
  }

  /** 更新摊位列表（数据变化时重绘，缩放/平移不重绘） */
  setBooths(list) {
    this._booths = list || [];
    this._drawAll();
  }

  setHighlightedId(id) {
    this._highlightedId = id || '';
    this._highlightPhase = 0;
    clearInterval(this._highlightTimer);
    this._highlightTimer = 0;
    if (this._highlightedId) {
      this._highlightTimer = window.setInterval(() => {
        this._highlightPhase = (this._highlightPhase + 1) % 4;
        this._drawAll();
      }, 280);
    }
    this._drawAll();
  }

  setHighlightRegion(r) {
    this._highlightRegion = r || null;
    this._drawAll();
  }

  _dprOf() {
    return window.devicePixelRatio || 1;
  }

  /** 同步部分：画布尺寸、坐标系、初始取景（不依赖贴图） */
  _initCanvasSync() {
    const canvas = this.canvas;
    if (!canvas) return;
    const dpr = this._dprOf();
    canvas.style.width = MAP_WIDTH + 'px';
    canvas.style.height = MAP_HEIGHT + 'px';
    canvas.width = MAP_WIDTH * dpr;
    canvas.height = MAP_HEIGHT * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = false;
    this._canvas = canvas;
    this._ctx = ctx;
    this._dpr = dpr;

    // 离屏 canvas 一次性渲染底图
    try {
      const off = document.createElement('canvas');
      off.width = MAP_IMAGE_WIDTH;
      off.height = MAP_IMAGE_HEIGHT;
      const offCtx = off.getContext('2d');
      offCtx.scale(MAP_IMAGE_WIDTH / MAP_WIDTH, MAP_IMAGE_HEIGHT / MAP_HEIGHT);
      this._baseCanvas = off;
      this._baseCtx = offCtx;
    } catch (err) {
      this._baseCanvas = null;
      this._baseCtx = null;
    }

    this._rect = this.root.getBoundingClientRect();
    this._fitInitial(this._rect);
    this._drawAll();
    this._refreshFont();
  }

  async _loadPainter() {
    try {
      this._painter = await createMapPainter();
      this._renderBaseToOffscreen();
      this._baseDrawn = true;
      this._drawAll();
    } catch (err) {
      console.warn('[custom-map] 地图参考模板加载失败，使用语义底图', err);
    }
  }

  /** 像素字体就绪后补一次重绘（canvas 不会自己重排已经画上去的文字） */
  _refreshFont() {
    const fonts = document.fonts;
    if (!fonts || typeof fonts.load !== 'function') return;
    fonts.load('18px "px-cjk"', '0123456789社联摊位一瓯茶草坪图书馆').then(
      () => {
        this._drawAll();
      },
      () => {}
    );
  }

  _bindGestures() {
    const root = this.root;
    const h = (this._h = {
      touchstart: (e) => this._onTouchStart(e),
      touchmove: (e) => this._onTouchMove(e),
      touchend: (e) => this._onTouchEnd(e),
      touchcancel: (e) => this._onTouchCancel(e),
      mousedown: (e) => this._onMouseDown(e),
      mousemove: (e) => this._onMouseMove(e),
      mouseup: (e) => this._onMouseUp(e),
      wheel: (e) => this._onWheel(e),
    });
    // 非 passive + preventDefault 是唯一能确实从 WebView 手里抢回手势的手段
    root.addEventListener('touchstart', h.touchstart, { passive: false });
    root.addEventListener('touchmove', h.touchmove, { passive: false });
    root.addEventListener('touchend', h.touchend);
    root.addEventListener('touchcancel', h.touchcancel);
    root.addEventListener('mousedown', h.mousedown);
    window.addEventListener('mousemove', h.mousemove);
    window.addEventListener('mouseup', h.mouseup);
    root.addEventListener('wheel', h.wheel, { passive: false });
  }

  /* ---------- 手势 ---------- */
  _toLocal(clientX, clientY) {
    const r = this._rect || { left: 0, top: 0 };
    return { x: clientX - r.left, y: clientY - r.top };
  }

  /** 触摸点始终从事件现读，避免 WebView 漏发 touchend 时留下幽灵手指 */
  _pointsOf(list) {
    const out = [];
    for (let i = 0; i < list.length; i++) {
      out.push({ x: list[i].clientX, y: list[i].clientY });
    }
    return out;
  }

  _midpoint(pts) {
    if (!pts.length) return null;
    if (pts.length === 1) return { x: pts[0].x, y: pts[0].y };
    let sx = 0;
    let sy = 0;
    for (const p of pts) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / pts.length, y: sy / pts.length };
  }

  /** 累计位移；超过 6px 即认定是拖动，通知父页面关闭气泡 */
  _noteMove(p) {
    if (!p) return;
    if (this._lastPoint) {
      this._touchMoved += Math.hypot(p.x - this._lastPoint.x, p.y - this._lastPoint.y);
    }
    this._lastPoint = p;
    if (this._touchMoved > 6) this._onBoothCancel();
  }

  _onTouchStart(e) {
    this._lastTouchTs = Date.now();
    e.preventDefault();
    const pts = this._pointsOf(e.touches);
    if (pts.length >= 2) {
      this._touchMoved = Infinity; // 多指绝不判定为点击
    } else {
      this._touchStartTime = Date.now();
      this._touchMoved = 0;
    }
    this._lastPoint = this._midpoint(pts);
    this.canvas.classList.remove('with-transition');
    this._initGesture(pts);
  }

  _onTouchMove(e) {
    e.preventDefault();
    const pts = this._pointsOf(e.touches);
    if (!pts.length) return;
    this._noteMove(this._midpoint(pts));
    this._moveGesture(pts);
  }

  _onTouchEnd(e) {
    const pts = this._pointsOf(e.touches);
    if (pts.length) {
      // 还有手指在屏上：立刻用剩下的手指重新锚定，否则悬停不动就永远不动
      this._touchMoved = Infinity;
      this._lastPoint = this._midpoint(pts);
      this._initGesture(pts);
      return;
    }
    const isTap =
      this._touchStartTime &&
      Date.now() - this._touchStartTime < 250 &&
      this._touchMoved < 8;
    const t = e.changedTouches && e.changedTouches[0];
    this._gesture = null;
    if (isTap && t) this._tapAt(t.clientX, t.clientY);
  }

  /** 被宿主抢走手势时到达：只重新锚定，绝不当作点击（否则会误弹气泡） */
  _onTouchCancel(e) {
    this._touchMoved = Infinity;
    const pts = this._pointsOf(e.touches);
    if (!pts.length) {
      this._gesture = null;
      return;
    }
    this._lastPoint = this._midpoint(pts);
    this._initGesture(pts);
  }

  _onMouseDown(e) {
    if (e.button !== 0) return;
    if (Date.now() - this._lastTouchTs < 700) return; // 触摸后补发的合成鼠标事件
    const p = { x: e.clientX, y: e.clientY };
    this._mouseDown = true;
    this._touchStartTime = Date.now();
    this._touchMoved = 0;
    this._lastPoint = p;
    this.canvas.classList.remove('with-transition');
    this._initGesture([p]);
  }

  _onMouseMove(e) {
    if (!this._mouseDown) return;
    this._noteMove({ x: e.clientX, y: e.clientY });
    this._moveGesture([{ x: e.clientX, y: e.clientY }]);
  }

  _onMouseUp(e) {
    if (!this._mouseDown) return;
    this._mouseDown = false;
    const isTap =
      this._touchStartTime &&
      Date.now() - this._touchStartTime < 250 &&
      this._touchMoved < 8;
    this._gesture = null;
    if (isTap) this._tapAt(e.clientX, e.clientY);
  }

  _onWheel(e) {
    e.preventDefault();
    if (!this._rect) return;
    // deltaMode: 0=像素 1=行 2=页
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this._rect.height || 800 : 1;
    const vp = this._viewport || { scale: 1, x: 0, y: 0 };
    if (e.ctrlKey || e.metaKey) {
      // 触控板双指捏合也走这条分支
      const local = this._toLocal(e.clientX, e.clientY);
      const mapX = (local.x - vp.x) / vp.scale;
      const mapY = (local.y - vp.y) / vp.scale;
      const d = Math.max(-120, Math.min(120, e.deltaY * k));
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, vp.scale * Math.pow(1.0015, -d)));
      this._apply({ scale, x: local.x - mapX * scale, y: local.y - mapY * scale });
      return;
    }
    this._apply({ scale: vp.scale, x: vp.x - e.deltaX * k, y: vp.y - e.deltaY * k });
  }

  _initGesture(pts) {
    this._rect = this.root.getBoundingClientRect(); // 地址栏收放后坐标会偏
    const vp = this._viewport || { scale: 1, x: 0, y: 0 };
    if (pts.length >= 2) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (!dist) {
        this._gesture = null;
        return;
      }
      const mid = this._toLocal((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
      this._gesture = {
        mode: 'scale',
        startDist: dist,
        startScale: vp.scale,
        midX: mid.x,
        midY: mid.y,
        mapX: (mid.x - vp.x) / vp.scale,
        mapY: (mid.y - vp.y) / vp.scale,
      };
    } else if (pts.length === 1) {
      this._gesture = {
        mode: 'pan',
        startX: pts[0].x,
        startY: pts[0].y,
        startVX: vp.x,
        startVY: vp.y,
      };
    } else {
      this._gesture = null;
    }
  }

  _moveGesture(pts) {
    const g = this._gesture;
    if (!g) return;
    const vp = this._viewport || { scale: 1, x: 0, y: 0 };
    if (g.mode === 'pan') {
      if (!pts.length) return;
      this._apply({
        scale: vp.scale,
        x: g.startVX + (pts[0].x - g.startX),
        y: g.startVY + (pts[0].y - g.startY),
      });
      return;
    }
    if (pts.length < 2) return;
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, g.startScale * (dist / g.startDist)));
    this._apply({ scale, x: g.midX - g.mapX * scale, y: g.midY - g.mapY * scale });
  }

  /** 点击命中：只处理"按下→抬起"这一件事，与输入通道无关 */
  _tapAt(clientX, clientY) {
    if (!this._rect) return;
    const local = this._toLocal(clientX, clientY);
    const vp = this._viewport || { scale: 1, x: 0, y: 0 };
    const mapX = (local.x - vp.x) / vp.scale / canvasMap.CELL_PX;
    const mapY = (local.y - vp.y) / vp.scale / canvasMap.CELL_PX;
    const hitId = this._hitTest(mapX, mapY);
    if (!hitId) {
      if (this._inUnionRegion(mapX, mapY)) {
        const sx = mapX * canvasMap.CELL_PX * vp.scale + vp.x;
        const sy = mapY * canvasMap.CELL_PX * vp.scale + vp.y;
        this._onUnionTap({ x: sx, y: sy, mapX, mapY });
      } else {
        this._onBoothCancel();
      }
      return;
    }
    const booth = this._booths.find((b) => b.id === hitId);
    const point = booth ? getBoothRenderPoint(booth) : null;
    const mx = point ? point.x / canvasMap.CELL_PX : mapX;
    const my = point ? point.y / canvasMap.CELL_PX : mapY;
    this._onBoothTap({
      id: hitId,
      x: mx * canvasMap.CELL_PX * vp.scale + vp.x,
      y: my * canvasMap.CELL_PX * vp.scale + vp.y,
    });
  }

  _hitTest(mapX, mapY) {
    const px = mapX * canvasMap.CELL_PX;
    const py = mapY * canvasMap.CELL_PX;
    const booth = this._booths.find((item) => {
      const point = getBoothRenderPoint(item);
      return Math.abs(point.x - px) <= 19 && Math.abs(point.y - py) <= 19;
    });
    return booth ? booth.id : null;
  }

  /** 是否点在地图「社联摊位 / SAUD」招牌区域（union）内 */
  _inUnionRegion(mapX, mapY) {
    const r = canvasMap.UNION_REGION;
    if (!r) return false;
    return mapX >= r.x && mapX <= r.x + r.w && mapY >= r.y && mapY <= r.y + r.h;
  }

  /* ---------- 视口 ---------- */
  _apply(v) {
    const r = this._rect;
    if (r) {
      const w = MAP_WIDTH * v.scale;
      const h = MAP_HEIGHT * v.scale;
      v.x = Math.min(CLAMP_MARGIN, Math.max(r.width - w - CLAMP_MARGIN, v.x));
      v.y = Math.min(CLAMP_MARGIN, Math.max(r.height - h - CLAMP_MARGIN, v.y));
    }
    this._viewport = v;
    this.canvas.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.scale})`;
    if (this._npcLayer) {
      this._npcLayer.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.scale})`;
    }
  }

  _fitInitial(rect) {
    if (!rect || !rect.width) return;
    const FOCUS = getDefaultFocus(rect.width, rect.height);
    const fw = (FOCUS.x1 - FOCUS.x0) * canvasMap.CELL_PX;
    const fh = (FOCUS.y1 - FOCUS.y0) * canvasMap.CELL_PX;
    const scale = Math.max(MIN_SCALE, Math.min(rect.width / fw, rect.height / fh) * INITIAL_ZOOM);
    const x = (rect.width - fw * scale) / 2 - FOCUS.x0 * canvasMap.CELL_PX * scale;
    const y = (rect.height - fh * scale) / 2 - FOCUS.y0 * canvasMap.CELL_PX * scale;
    this._apply({ scale, x, y });
  }

  moveTo(x, y, scale) {
    return new Promise((resolve) => {
      const v = this._viewport || { scale: 1, x: 0, y: 0 };
      const s = scale != null ? scale : v.scale;
      this._viewport = { scale: s, x, y };
      this.canvas.classList.add('with-transition');
      this._npcLayer?.classList.add('with-transition');
      this._apply({ scale: s, x, y });
      clearTimeout(this._moveTimer); // 连续两次聚焦时，别让上一个定时器提前摘掉过渡
      this._moveTimer = setTimeout(() => {
        this.canvas.classList.remove('with-transition');
        this._npcLayer?.classList.remove('with-transition');
        resolve();
      }, 360);
    });
  }

  focusMapPoint(mapX, mapY, scale) {
    const rect = this._rect || { width: MAP_WIDTH, height: MAP_HEIGHT };
    const center = { x: rect.width / 2, y: rect.height / 2 };
    const s = scale != null ? scale : Math.max((this._viewport || { scale: 1 }).scale, 1);
    return this.moveTo(
      center.x - mapX * canvasMap.CELL_PX * s,
      center.y - mapY * canvasMap.CELL_PX * s,
      s
    );
  }

  fitView() {
    if (this._rect) this._fitInitial(this._rect);
  }

  /* ---------- 绘制 ---------- */
  _drawAll() {
    const ctx = this._ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
    this._drawBaseMap(ctx);
    this._coverPrizePointLabel(ctx);
    this._drawTeaShopLabel(ctx);
    this._drawTeachingBuildingLabel(ctx);
    this._drawBooths(ctx);
    this._drawRegionHighlight(ctx);
    this._drawBoothNumbers(ctx);
  }

  _renderSvg(ctx, svg) {
    const dim = parseSvgViewBox(svg) || { width: MAP_WIDTH, height: MAP_HEIGHT };
    const scale = Math.min(MAP_WIDTH / dim.width, MAP_HEIGHT / dim.height);
    const tx = (MAP_WIDTH - dim.width * scale) / 2;
    const ty = (MAP_HEIGHT - dim.height * scale) / 2;
    ctx.save();
    ctx.translate(tx, ty);
    ctx.scale(scale, scale);
    if (this._painter) this._painter.paint(ctx);
    else renderSVG(ctx, svg);
    ctx.restore();
  }

  _renderBaseToOffscreen() {
    const ctx = this._baseCtx;
    if (!ctx) return;
    ctx.clearRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
    const svg = this._svgString;
    if (typeof svg === 'string' && svg.length) {
      try {
        this._renderSvg(ctx, svg);
        return;
      } catch (err) {
        console.warn('[custom-map] SVG 底图渲染失败', err);
      }
    }
    ctx.fillStyle = '#f0f2ec';
    ctx.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
  }

  _drawBaseMap(ctx) {
    // _baseDrawn 之前离屏画布还是空白，直接画上去会让地图整个空掉
    if (this._baseCanvas && this._baseDrawn) {
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this._baseCanvas, 0, 0, MAP_WIDTH, MAP_HEIGHT);
      // 底图左侧额外烘焙了一枚 9 号牌；以紧邻的林地纹理覆盖，保留数据中的正式 9 号。
      ctx.drawImage(this._baseCanvas, 0, 488, 44, 58, 32, 423, 38, 51);
      // 24 号上方残留的旧 25 号牌已不属于最新规划，用同一底图的草地纹理补齐。
      ctx.drawImage(this._baseCanvas, 399, 596, 44, 64, 109, 610, 40, 56);
      ctx.restore();
      return;
    }
    const svg = this._svgString;
    if (typeof svg === 'string' && svg.length) {
      try {
        this._renderSvg(ctx, svg);
        return;
      } catch (err) {
        console.warn('[custom-map] SVG 底图渲染失败', err);
      }
    }
    ctx.fillStyle = '#f0f2ec';
    ctx.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
  }

  /** 覆盖底图旧字；左上角服务地标按当前方案不显示文字。 */
  _coverPrizePointLabel(ctx) {
    ctx.save();
    ctx.fillStyle = '#39284c';
    ctx.fillRect(71, 43, 112, 30);
    ctx.fillStyle = '#6c4660';
    ctx.fillRect(68, 40, 112, 30);
    ctx.fillStyle = '#d99d83';
    ctx.fillRect(71, 43, 106, 24);
    ctx.fillStyle = '#f1c8ad';
    ctx.fillRect(74, 46, 100, 18);
    ctx.fillStyle = '#fff0cf';
    ctx.fillRect(75, 46, 98, 2);
    ctx.restore();
  }

  /** 覆盖参考图中的旧茶店名，保持原木牌造型；
 *  中文画整块木牌+一瓯茶盖住旧字；英文底图已含招牌板，只叠文字。 */
  _drawTeaShopLabel(ctx) {
    const en = isEnglish();
    ctx.save();
    if (en) {
      ctx.fillStyle = '#49314f';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('A Cup of Tea', 744, 968);
      ctx.restore();
      return;
    }
    ctx.fillStyle = '#f1c8ad';
    ctx.fillRect(708, 954, 72, 25);
    ctx.fillStyle = '#fff0cf';
    ctx.fillRect(710, 955, 68, 2);
    ctx.fillStyle = '#9e6a66';
    ctx.fillRect(712, 959, 2, 2);
    ctx.fillRect(775, 959, 2, 2);
    ctx.fillRect(712, 974, 2, 2);
    ctx.fillRect(775, 974, 2, 2);
    ctx.fillStyle = '#49314f';
    ctx.font = '16px "px-cjk", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('一瓯茶', 744, 968);
    ctx.restore();
  }

  /** 覆盖底图左下角旧 Teaching D 字样，并沿用建筑屋檐的紫色像素铭牌。 */
  _drawTeachingBuildingLabel(ctx) {
    const en = isEnglish();
    const label = en ? 'Zhang Ling Bin Building' : '张灵斌楼';
    const centerX = 214;
    const top = 966;
    const width = en ? 190 : 108;

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#39284c';
    ctx.fillRect(centerX - width / 2 + 2, top + 2, width, 24);
    ctx.fillStyle = '#60358c';
    ctx.fillRect(centerX - width / 2, top, width, 24);
    ctx.fillStyle = '#8f58b7';
    ctx.fillRect(centerX - width / 2 + 3, top + 2, width - 6, 3);
    ctx.fillStyle = '#4b276f';
    ctx.fillRect(centerX - width / 2 + 3, top + 20, width - 6, 2);

    ctx.font = `${en ? 14 : 16}px "px-cjk", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#39284c';
    ctx.fillText(label, centerX + 1, top + 13);
    ctx.fillStyle = '#fff0cf';
    ctx.fillText(label, centerX, top + 12);
    ctx.restore();
  }

  /** 用真实数据重绘像素号码牌，覆盖参考图中可能失真的图片文字。 */
  _drawBoothNumbers(ctx) {
    if (!this._booths.length) return;
    const cellPx = canvasMap.CELL_PX;
    ctx.save();
    // 状态会被上一个绘制函数残留，这里全部显式设定
    ctx.font = '16px "px-cjk", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const b of this._booths) {
      const point = getBoothRenderPoint(b);
      if (b.id === this._highlightedId) {
        this._drawHighlightedBoothNumber(ctx, b, point);
        continue;
      }
      if (b.id === '8' && this._booth8Flash && this._booth8Highlight) {
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(this._booth8Highlight, point.x - 29, point.y - 23, 58, 46);
        ctx.restore();
        continue;
      }
      const x = Math.round(point.x - 17);
      const y = Math.round(point.y - 17);
      // 右下硬阴影、木框、羊皮纸面与青绿色棚檐沿用参考图的摊位语言。
      ctx.fillStyle = '#39284c';
      ctx.fillRect(x + 4, y + 5, 33, 33);
      ctx.fillStyle = '#6c4660';
      ctx.fillRect(x + 1, y + 2, 34, 34);
      ctx.fillStyle = '#d99d83';
      ctx.fillRect(x + 3, y + 4, 30, 30);
      ctx.fillStyle = '#f1c8ad';
      ctx.fillRect(x + 5, y + 8, 26, 24);
      ctx.fillStyle = '#437f73';
      ctx.fillRect(x + 4, y + 3, 28, 6);
      ctx.fillStyle = '#78aaa0';
      ctx.fillRect(x + 7, y + 3, 22, 2);
      ctx.fillStyle = '#fff0cf';
      ctx.fillRect(x + 6, y + 10, 24, 2);
      ctx.fillStyle = '#49314f';
      ctx.fillText(b.id, point.x, point.y + 4);
    }
    ctx.restore();
  }

  /** 当前弹窗对应摊位：紫色明暗闪烁，并以固定像素颗粒模拟马赛克干扰。 */
  _drawHighlightedBoothNumber(ctx, booth, point) {
    const phase = this._highlightPhase;
    const bright = phase % 2 === 0;
    const x = Math.round(point.x - 17);
    const y = Math.round(point.y - 17);
    const seed = Number(booth.id) || 0;

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = bright ? '#2b173d' : '#3c2056';
    ctx.fillRect(x + 4, y + 5, 33, 33);
    ctx.fillStyle = bright ? '#6b36a0' : '#4d2873';
    ctx.fillRect(x + 1, y + 2, 34, 34);
    ctx.fillStyle = bright ? '#a86ee0' : '#7544aa';
    ctx.fillRect(x + 3, y + 4, 30, 30);
    ctx.fillStyle = bright ? '#c79af0' : '#9666c8';
    ctx.fillRect(x + 5, y + 8, 26, 24);
    ctx.fillStyle = bright ? '#5a2b82' : '#44205f';
    ctx.fillRect(x + 4, y + 3, 28, 6);
    ctx.fillStyle = bright ? '#ead7ff' : '#b88add';
    ctx.fillRect(x + 7, y + 3, 22, 2);

    const pixels = bright
      ? ['#e5c9ff', '#8e55c3', '#63308c']
      : ['#b985df', '#6e399b', '#4d236d'];
    for (let py = 0; py < 6; py += 1) {
      for (let px = 0; px < 6; px += 1) {
        if ((px * 7 + py * 3 + seed + phase * 2) % 5 !== 0) continue;
        ctx.fillStyle = pixels[(px + py + phase) % pixels.length];
        ctx.fillRect(x + 4 + px * 5, y + 4 + py * 5, 4, 4);
      }
    }

    const glitch = phase < 2 ? 1 : -1;
    ctx.fillStyle = bright ? '#f3e7ff' : '#dac2ef';
    ctx.fillRect(x + 5 + glitch, y + 11, 25, 2);
    ctx.fillRect(x + 7 - glitch, y + 29, 21, 2);
    ctx.fillStyle = '#321542';
    ctx.fillText(booth.id, point.x + 1, point.y + 5);
    ctx.fillStyle = '#fff3ff';
    ctx.fillText(booth.id, point.x, point.y + 4);
    ctx.restore();
  }

  _drawBooths(ctx) {
    const hl = this._highlightedId;
    if (!hl) return;
    const cellPx = canvasMap.CELL_PX;
    const booth = this._booths.find((item) => item.id === hl);
    if (!booth) return;
    const point = getBoothRenderPoint(booth);
    const x = point.x - cellPx / 2;
    const y = point.y - cellPx / 2;
    ctx.save();
    const bright = this._highlightPhase % 2 === 0;
    ctx.fillStyle = bright ? 'rgba(213, 175, 255, 0.34)' : 'rgba(127, 72, 179, 0.24)';
    ctx.fillRect(x + 2, y + 2, cellPx - 4, cellPx - 4);
    ctx.strokeStyle = bright ? '#d5a8ff' : '#7b42ad';
    ctx.lineWidth = bright ? 4 : 2;
    ctx.strokeRect(x + 2, y + 2, cellPx - 4, cellPx - 4);
    ctx.restore();
  }

  _drawRegionHighlight(ctx) {
    const r = this._highlightRegion;
    if (!r || !Number.isFinite(r.x) || !Number.isFinite(r.y)) return;
    const cellPx = canvasMap.CELL_PX;
    const x = r.x * cellPx;
    const y = r.y * cellPx;
    const w = (r.w || 1) * cellPx;
    const h = (r.h || 1) * cellPx;
    ctx.save();
    ctx.fillStyle = 'rgba(146, 92, 209, 0.2)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#925cd1';
    ctx.lineWidth = 4;
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  /* ---------- 供页面 / 教程测量定位 ---------- */
  getRect() {
    this._rect = this.root.getBoundingClientRect();
    return this._rect;
  }

  getPointScreenRect(mapX, mapY, radius) {
    const vp = this._viewport || { scale: 1, x: 0, y: 0 };
    const rect = this._rect || { left: 0, top: 0 };
    const lx = mapX * canvasMap.CELL_PX * vp.scale + vp.x;
    const ly = mapY * canvasMap.CELL_PX * vp.scale + vp.y;
    const sx = lx + rect.left;
    const sy = ly + rect.top;
    const R = (radius != null ? radius : 0.5) * canvasMap.CELL_PX * vp.scale;
    return {
      left: sx - R,
      top: sy - R,
      right: sx + R,
      bottom: sy + R,
      cx: sx,
      cy: sy,
      width: 2 * R,
      height: 2 * R,
    };
  }

  getBoothScreenRect(id) {
    const b = this._booths.find((x) => x.id === id);
    if (!b) return null;
    const point = getBoothRenderPoint(b);
    return this.getPointScreenRect(point.x / canvasMap.CELL_PX, point.y / canvasMap.CELL_PX, 0.55);
  }

  getBoothMapPoint(id) {
    const booth = this._booths.find((item) => item.id === id);
    if (!booth) return null;
    const point = getBoothRenderPoint(booth);
    return { x: point.x / canvasMap.CELL_PX, y: point.y / canvasMap.CELL_PX };
  }

  getBoothLocalCenter(id) {
    const b = this._booths.find((x) => x.id === id);
    if (!b) return null;
    const vp = this._viewport || { scale: 1, x: 0, y: 0 };
    const point = getBoothRenderPoint(b);
    return {
      x: point.x * vp.scale + vp.x,
      y: point.y * vp.scale + vp.y,
    };
  }

  getCenterMapPos() {
    const v = this._viewport || { scale: 1, x: 0, y: 0 };
    const rect = this._rect || { width: 0, height: 0 };
    const mapX = (rect.width / 2 - v.x) / v.scale / canvasMap.CELL_PX;
    const mapY = (rect.height / 2 - v.y) / v.scale / canvasMap.CELL_PX;
    return { mapX: Math.floor(mapX), mapY: Math.floor(mapY) };
  }

  destroy() {
    this._destroyed = true;
    const h = this._h;
    if (h) {
      const root = this.root;
      root.removeEventListener('touchstart', h.touchstart);
      root.removeEventListener('touchmove', h.touchmove);
      root.removeEventListener('touchend', h.touchend);
      root.removeEventListener('touchcancel', h.touchcancel);
      root.removeEventListener('mousedown', h.mousedown);
      window.removeEventListener('mousemove', h.mousemove);
      window.removeEventListener('mouseup', h.mouseup);
      root.removeEventListener('wheel', h.wheel);
      this._h = null;
    }
    window.removeEventListener('resize', this._onResize);
    clearTimeout(this._moveTimer);
    clearInterval(this._booth8Timer);
    clearInterval(this._highlightTimer);
    cancelAnimationFrame(this._npcRaf);
    this._gesture = null;
    this._mouseDown = false;
  }
}
