/**
 * pages/map.js — 艺术化导览图（首页，web 版）
 * 纯浏览：仅地图展示 + 搜索/公告/气泡/新手指引（无定位/收藏）。
 */
import './map.css';
import { wx } from '../adapter/wx.js';
import { state } from '../state.js';
import * as boothSvc from '../services/booth.js';
import * as annSvc from '../services/announcement.js';
import * as canvasMap from '../utils/canvas-map.js';
import { buildMatch } from '../utils/search.js';
import { CustomMap } from '../components/custom-map.js';
import { RecordPlayer } from '../components/record-player.js';
import { startViewSession } from '../services/boothView.js';
import * as tut from './map/tutorial-steps.js';
import { refresh } from '../router.js';
import { isEnglish, localizeAnnouncement, localizeBooth, setLanguage, statusText, t } from '../i18n.js';
import { getCurrentBoothStatus } from '../utils/booth-status.js';

/** 聚焦某个摊位时的缩放：约 6 格可见 */
const FOCUS_SCALE = 1.9;

function h(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

class MapPage {
  mount(container) {
    this.el = container;
    container.innerHTML = `
      <div class="page map-page">
        <div class="search-bar">
          <div class="search-field">
            <span class="search-icon">⌕</span>
            <input class="search-input" placeholder="${t('searchClubs')}" />
            <span class="search-clear" style="display:none">×</span>
          </div>
        </div>
        <div class="search-overlay" style="display:none">
          <div class="search-mask"></div>
          <div class="search-panel"></div>
        </div>
        <div class="ann-list"></div>
        <div class="map-wrap">
          <div class="custom-map"><canvas class="map-canvas"></canvas></div>
          <div class="map-legend">
            <div class="legend-item"><span class="dot booth"></span>${t('clubBooths')}</div>
            <div class="legend-item"><span class="dot landscape"></span>${t('lawnPlaza')}</div>
            <div class="legend-item"><span class="dot activity"></span>${t('stonePath')}</div>
          </div>
          <div class="tutorial-replay-slot">
            <button class="lang-toggle" type="button" aria-label="${t('langSwitch')}" title="${t('langSwitch')}"></button>
            <button class="tutorial-replay" type="button" aria-label="${t('replayTutorial')}" title="${t('replayTutorial')}">
              <span aria-hidden="true">?</span>
            </button>
          </div>
          <div class="record-player-slot"></div>
          <div class="club-callout" id="clubCallout" style="display:none">
            <div class="cc-close">×</div>
            <div class="cc-head"><span class="cc-name"></span></div>
            <div class="cc-sub"></div>
            <div class="cc-developer-credit" aria-hidden="true">Developers of this page</div>
            <div class="cc-section"><span class="cc-label">${t('boothIntro')}</span><span class="cc-text cc-intro"></span></div>
            <div class="cc-section cc-email-section">
              <span class="cc-label">${t('boothEmail')}</span>
              <div class="cc-email-wrap">
                <a class="cc-text cc-email"></a>
                <button class="cc-email-copy" type="button" hidden>${t('copyEmail')}</button>
              </div>
            </div>
            <div class="cc-actions"><div class="cc-btn primary">${t('viewDetails')}</div></div>
          </div>
        </div>
      </div>`;

    this.searchInput = container.querySelector('.search-input');
    this.searchClear = container.querySelector('.search-clear');
    this.searchOverlay = container.querySelector('.search-overlay');
    this.searchMask = container.querySelector('.search-mask');
    this.searchPanel = container.querySelector('.search-panel');
    this.annList = container.querySelector('.ann-list');
    this.mapWrap = container.querySelector('.map-wrap');
    this.callout = container.querySelector('#clubCallout');
    this.recordPlayer = new RecordPlayer(
      container.querySelector('.record-player-slot'),
      container.querySelector('.map-legend'),
    );
    this.tutorialReplayButton = container.querySelector('.tutorial-replay');
    this.langToggle = container.querySelector('.lang-toggle');

    // 自定义地图
    this.map = new CustomMap(container.querySelector('.custom-map'), {
      onBoothTap: (d) => this.onBoothTap(d),
      onBoothCancel: () => this.onBoothCancel(),
      onUnionTap: (d) => this.onUnionTap(d),
    });
    this.ready = this.map.ready;

    // 事件绑定
    this.searchInput.addEventListener('input', (e) => this.onKeywordInput(e.target.value));
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.onSearchConfirm();
    });
    this.searchClear.addEventListener('click', () => this.onClearKeyword());
    this.searchMask.addEventListener('click', () => this.onSearchMaskTap());
    this.tutorialReplayButton.addEventListener('click', () => this.replayTutorial());
    this.langToggle.addEventListener('click', () => this.onToggleLanguage());
    this._updateLangToggle();
    container.querySelector('.cc-close').addEventListener('click', () => this.onCalloutClose());
    container.querySelector('.cc-btn.primary').addEventListener('click', () => this.onCalloutDetail());
    this._bindEmailCopy();

    this._pageVisible = false;
    this._destroyed = false;
    this._handoffReady = false;
    this._handoffSession = null;
    this._viewSession = null;
    // 教程运行时
    this._tutorialActive = false;
    this._tutorialSteps = tut.getSteps();
    this._exampleBoothId = tut.EXAMPLE_BOOTH_ID;
    this._exampleBooth = null;
    this._mapReadyTimer = null;
    this._plazaHlTimer = null;
    this._lastAdvance = 0;
    this._tutStepShown = false;
    this.allBooths = [];
    if (state.tutorial) {
      state.tutorial.setOnNext(() => this.onTutorialNext());
      state.tutorial.setOnPrevious(() => this.onTutorialPrevious());
      state.tutorial.setOnSkip(() => this.onSkipTutorial());
    }
    this._tutorialResizeTimer = null;
    this._onTutorialResize = () => {
      if (!this._tutorialActive) return;
      clearTimeout(this._tutorialResizeTimer);
      this._tutorialResizeTimer = setTimeout(() => this._refreshTutorialHighlight(), 120);
    };
    window.addEventListener('resize', this._onTutorialResize);

    // 占位符打字机（聚焦时暂停，减少动态时跳过）
    this._typeTimer = null;
    this._startPlaceholderTyping();

    this.loadData();
  }

  /* ---------- 占位符打字机 ---------- */
  _startPlaceholderTyping() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const PH = t('searchClubs');
    let i = 0;
    let phase = 0; // 0 打字 / 1 停顿 / 2 退格
    const tick = () => {
      if (document.activeElement === this.searchInput) {
        // 聚焦时暂停，失焦后恢复
        this._typeTimer = setTimeout(tick, 400);
        return;
      }
      if (phase === 0) {
        i += 1;
        this.searchInput.placeholder = PH.slice(0, i);
        if (i >= PH.length) {
          phase = 1;
          this._typeTimer = setTimeout(tick, 1400);
        } else {
          this._typeTimer = setTimeout(tick, 90);
        }
      } else if (phase === 1) {
        phase = 2;
        this._typeTimer = setTimeout(tick, 200);
      } else {
        i -= 1;
        this.searchInput.placeholder = PH.slice(0, i);
        if (i <= 0) {
          phase = 0;
          this._typeTimer = setTimeout(tick, 700);
        } else {
          this._typeTimer = setTimeout(tick, 60);
        }
      }
    };
    this._typeTimer = setTimeout(tick, 600);
  }

  async loadData() {
    this.refreshBooths();
    this.loadAnnouncement();
    this.applyHighlight();
    this.maybeStartTutorial();
  }

  async refreshBooths() {
    try {
      const { list } = await boothSvc.getBooths({ area: 'ALL' });
      this.allBooths = list.map(localizeBooth);
      this._exampleBooth = this.allBooths.find((b) => b.id === this._exampleBoothId) || null;
      this.map.setBooths(this.allBooths);
      this.highlightBoothId = state.highlightBoothId || '';
      state.highlightBoothId = '';
      const handoff = state.boothViewHandoff;
      const startViewBoothId = state.startBoothViewAfterMapFocus;
      state.startBoothViewAfterMapFocus = '';
      if (this.highlightBoothId) {
        const b = this.allBooths.find((x) => String(x.id) === String(this.highlightBoothId));
        if (handoff && (!b || String(b.id) !== String(handoff.boothId))) {
          handoff.session.cancel();
          state.boothViewHandoff = null;
        }
        if (b) {
          if (handoff && String(b.id) === String(handoff.boothId)) {
            this._handoffSession = handoff.session;
            state.boothViewHandoff = null;
            this.focusBooth(b, () => {
              this._handoffReady = true;
              this._resumeHandoffIfVisible();
            });
          } else if (String(b.id) === String(startViewBoothId)) {
            this.focusBooth(b, () => this._startViewSession(b.id));
          } else {
            this.focusBooth(b);
          }
        }
      } else if (handoff) {
        handoff.session.cancel();
        state.boothViewHandoff = null;
      }
    } catch (e) {
      if (state.boothViewHandoff) {
        state.boothViewHandoff.session.cancel();
        state.boothViewHandoff = null;
      }
      console.warn('refreshBooths', e);
    }
  }

  async loadAnnouncement() {
    try {
      const { list } = await annSvc.getAnnouncements();
      this.renderAnnouncements(list);
    } catch (e) {}
  }

  renderAnnouncements(list) {
    this.annList.innerHTML = '';
    list.map(localizeAnnouncement).forEach((a) => {
      const title = escapeHtml(a.title);
      const bar = h('div', 'ann-bar', `
        <span class="ann-tag">${t('announcement')}</span>
        <span class="ann-scroll"><span class="ann-track">
          <span class="ann-title">${title}</span>
          <span class="ann-title" aria-hidden="true">${title}</span>
        </span></span>
        <span class="ann-arrow">›</span>`);
      bar.addEventListener('click', () => {
        wx.showModal({ title: a.title, content: a.content, showCancel: false, confirmText: t('acknowledge') });
      });
      this.annList.appendChild(bar);
      // 长标题跑马灯：自然宽超出可视区才开启，按溢出比映射 4-12s 时长
      const titleEl = bar.querySelector('.ann-title');
      const boxW = bar.querySelector('.ann-scroll').clientWidth;
      if (titleEl && boxW > 0 && titleEl.scrollWidth > boxW + 1) {
        bar.classList.add('marquee');
        bar.style.setProperty('--dur', Math.min(12, Math.max(4, (titleEl.scrollWidth / boxW) * 2.5)).toFixed(1) + 's');
      }
    });
  }

  moveToMapPos(mapX, mapY) {
    const c = this.map;
    if (!c || !Number.isFinite(mapX) || !Number.isFinite(mapY)) return;
    const rect = c.getRect();
    const center = { x: rect.width / 2, y: rect.height / 2 };
    const scale = Math.max(c._viewport.scale, 1);
    c.moveTo(center.x - mapX * canvasMap.CELL_PX * scale, center.y - mapY * canvasMap.CELL_PX * scale, scale);
  }

  /* ---------- 摊位气泡 ---------- */
  _bindEmailCopy() {
    const emailLink = this.callout.querySelector('.cc-email');
    this.emailCopyAction = this.callout.querySelector('.cc-email-copy');

    const cancelHold = () => {
      clearTimeout(this._emailHoldTimer);
      this._emailHoldTimer = null;
    };

    emailLink.addEventListener('pointerdown', (event) => {
      if (!this._currentBooth?.email) return;
      this._emailHoldOrigin = { x: event.clientX, y: event.clientY };
      this._emailLongPressed = false;
      cancelHold();
      this._emailHoldTimer = setTimeout(() => {
        this._emailLongPressed = true;
        this._showEmailCopyAction();
      }, 550);
    });
    emailLink.addEventListener('pointermove', (event) => {
      if (!this._emailHoldOrigin) return;
      const dx = event.clientX - this._emailHoldOrigin.x;
      const dy = event.clientY - this._emailHoldOrigin.y;
      if (Math.hypot(dx, dy) > 8) cancelHold();
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((type) => {
      emailLink.addEventListener(type, () => {
        cancelHold();
        this._emailHoldOrigin = null;
        setTimeout(() => { this._emailLongPressed = false; }, 0);
      });
    });
    emailLink.addEventListener('click', (event) => {
      if (this._emailLongPressed) event.preventDefault();
    });
    emailLink.addEventListener('contextmenu', (event) => {
      if (!this._currentBooth?.email) return;
      event.preventDefault();
      this._showEmailCopyAction();
    });
    this.emailCopyAction.addEventListener('click', () => this._copyEmail());
  }

  _showEmailCopyAction() {
    if (!this._currentBooth?.email) return;
    clearTimeout(this._emailCopyHideTimer);
    this.emailCopyAction.textContent = t('copyEmail');
    this.emailCopyAction.hidden = false;
    this._emailCopyHideTimer = setTimeout(() => {
      this.emailCopyAction.hidden = true;
    }, 4000);
  }

  async _copyEmail() {
    const email = this._currentBooth?.email;
    if (!email) return;
    let copied = false;
    try {
      await navigator.clipboard.writeText(email);
      copied = true;
    } catch (_) {
      const input = document.createElement('textarea');
      input.value = email;
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      copied = document.execCommand('copy');
      input.remove();
    }
    this.emailCopyAction.textContent = t(copied ? 'emailCopied' : 'copyFailed');
    clearTimeout(this._emailCopyHideTimer);
    this._emailCopyHideTimer = setTimeout(() => {
      this.emailCopyAction.hidden = true;
    }, 1600);
  }

  onBoothTap(d) {
    const booth = this.allBooths.find((b) => b.id === d.id);
    if (!booth) return;
    this.map.setHighlightedId(d.id);
    this.showCallout(booth, d.x, d.y);
    this._startViewSession(d.id);
  }

  /* 点击地图「社联摊位 / SAUD」招牌 → 弹出同款介绍框，内容为 Game Overview */
  onUnionTap(d) {
    const en = isEnglish();
    const union = {
      id: 'SAUD',
      clubName: en ? 'SAUD' : '社联摊位',
      category: '学生组织', // 组织视作无邮箱
      status: getCurrentBoothStatus(),
      intro: t('gameOverview'),
      email: '',
      clubId: '',
      targetEventId: 'evt-reward', // 「查看详情」→ 活动页「社联兑奖」详情
    };
    this.showCallout(union, d.x, d.y, { union: true });
  }

  showCallout(booth, x, y, opts = {}) {
    this.callout.querySelector('.cc-name').textContent = booth.clubName;
    this.callout.querySelector('.cc-sub').textContent =
      t('boothStatus', { id: booth.id, status: statusText(booth.status) });
    const developerCredit = this.callout.querySelector('.cc-developer-credit');
    const isDeveloperBooth = booth.id === '8';
    developerCredit.classList.remove('is-active');
    developerCredit.setAttribute('aria-hidden', String(!isDeveloperBooth));
    if (isDeveloperBooth) {
      void developerCredit.offsetWidth;
      developerCredit.classList.add('is-active');
    }
    this.callout.querySelector('.cc-intro').textContent = booth.intro || '';
    const isStudentOrganization = booth.category === '学生组织' || booth.category === 'Student Organizations';
    this.callout.querySelector('.cc-email-section').hidden = isStudentOrganization;
    const emailLink = this.callout.querySelector('.cc-email');
    emailLink.textContent = booth.email || t('notProvided');
    emailLink.classList.toggle('is-missing', !booth.email);
    if (booth.email) emailLink.href = `mailto:${booth.email}`;
    else emailLink.removeAttribute('href');
    clearTimeout(this._emailCopyHideTimer);
    this.emailCopyAction.hidden = true;
    this.emailCopyAction.textContent = t('copyEmail');
    this.callout.querySelector('.cc-sub').hidden = !!opts.union;
    this.callout.style.display = '';
    this.callout.scrollTop = 0;

    const rect = this.map.getRect();
    const W = rect.width;
    const H = rect.height;
    const margin = 10;
    let left = x + 22;
    let top = y - this.callout.offsetHeight / 2;
    let tailSide = 'left';
    const w = this.callout.offsetWidth;
    const hgt = this.callout.offsetHeight;
    if (left + w > W - margin) {
      left = x - w - 22;
      tailSide = 'right';
    }
    if (left < margin) left = margin;
    if (top < margin) top = margin;
    if (top + hgt > H - margin) top = Math.max(margin, H - hgt - margin);
    this.callout.className = 'club-callout tail-' + tailSide + ' placed';
    this.callout.style.left = left + 'px';
    this.callout.style.top = top + 'px';
    this._currentBooth = booth;
    // 重触发弹出动画：摘下 pop 类强制重排再挂回（连续点击不同摊位也能重播）
    this.callout.classList.remove('pop');
    void this.callout.offsetWidth;
    this.callout.classList.add('pop');
  }

  onCalloutClose() {
    this._cancelViewSession();
    clearTimeout(this._emailCopyHideTimer);
    this.emailCopyAction.hidden = true;
    this.callout.style.display = 'none';
    this.map.setHighlightedId('');
  }

  onBoothCancel() {
    if (this.callout.style.display !== 'none') {
      this.callout.style.display = 'none';
      this.map.setHighlightedId('');
    }
    this._cancelViewSession();
  }

  onCalloutDetail() {
    this._cancelViewSession();
    this.callout.style.display = 'none';
    const b = this._currentBooth;
    if (!b) return;
    if (b.targetEventId) {
      wx.navigateTo({ url: `#/event-detail?id=${b.targetEventId}` });
    } else if (b.clubId) {
      wx.navigateTo({ url: `#/club-detail?clubId=${b.clubId}` });
    }
  }

  /* ---------- 搜索 ---------- */
  onKeywordInput(value) {
    this.searchClear.style.display = value ? '' : 'none';
    this._runSearch(value);
  }

  _runSearch(value) {
    const kw = (value || '').trim();
    if (!kw) {
      this.searchOverlay.style.display = 'none';
      this.searchPanel.innerHTML = '';
      return;
    }
    const results = [];
    for (const b of this.allBooths) {
      const m = buildMatch(kw, b.clubName);
      if (m.matched) results.push({ id: b.id, clubName: b.clubName, segs: m.segs, _score: m.score });
    }
    results.sort((a, b) => b._score - a._score);
    this._searchResults = results;
    this.searchOverlay.style.display = '';
    this.searchPanel.innerHTML = '';
    if (!results.length) {
      this.searchPanel.appendChild(h('div', 'sr-empty', t('noSearchResults')));
      return;
    }
    results.forEach((r) => {
      const nameHtml = r.segs.map((s) => (s.hl ? `<span class="sr-hl">${escapeHtml(s.text)}</span>` : escapeHtml(s.text))).join('');
      const item = h('div', 'sr-item', `<span class="sr-name">${nameHtml}</span><span class="sr-booth">${t('booth', { id: r.id })}</span>`);
      item.addEventListener('click', () => this.onSearchPick(r.id));
      this.searchPanel.appendChild(item);
    });
  }

  onSearchPick(id) {
    const booth = this.allBooths.find((b) => b.id === id);
    if (!booth) return;
    this.searchInput.value = '';
    this.searchClear.style.display = 'none';
    this.searchOverlay.style.display = 'none';
    this.searchPanel.innerHTML = '';
    this.map.setHighlightedId(id);
    const c = this.map;
    const point = c.getBoothMapPoint(id) || { x: booth.mapX, y: booth.mapY };
    c.focusMapPoint(point.x, point.y, FOCUS_SCALE).then(() => {
      const rect = c.getBoothLocalCenter(id);
      if (rect) this.showCallout(booth, rect.x, rect.y);
    });
  }

  onSearchMaskTap() {
    this.searchInput.value = '';
    this.searchClear.style.display = 'none';
    this.searchOverlay.style.display = 'none';
    this.searchPanel.innerHTML = '';
  }

  onSearchConfirm() {
    if (this.searchOverlay.style.display !== 'none' && this._searchResults && this._searchResults.length) {
      this.onSearchPick(this._searchResults[0].id);
    }
  }

  onClearKeyword() {
    this.searchInput.value = '';
    this.searchClear.style.display = 'none';
    this._runSearch('');
  }

  /* ---------- 跨页高亮 ---------- */
  applyHighlight() {
    const c = state.highlightCenter;
    if (c) {
      state.highlightCenter = null;
      if (c.resetView) {
        this.map.setHighlightRegion(null);
        this.map.fitView();
      } else {
        const region = c.plaza ? canvasMap.PLAZA_REGION : c.thanks ? canvasMap.THANKS_REGION : c.union ? canvasMap.UNION_REGION : null;
        if (region) {
          this.map.setHighlightRegion(region);
          this.moveToMapPos(c.mapX != null ? c.mapX : region.x + region.w / 2, c.mapY != null ? c.mapY : region.y + region.h / 2);
          clearTimeout(this._plazaHlTimer);
          this._plazaHlTimer = setTimeout(() => this.map.setHighlightRegion(null), 6000);
        } else {
          const pos = canvasMap.latLngToMap(c.latitude, c.longitude);
          if (pos) this.moveToMapPos(pos.x, pos.y);
        }
      }
    }
  }

  focusBooth(b, onCalloutShown) {
    this.map.setHighlightedId(b.id);
    const c = this.map;
    const point = c.getBoothMapPoint(b.id) || { x: b.mapX, y: b.mapY };
    c.focusMapPoint(point.x, point.y, FOCUS_SCALE).then(() => {
      if (this._destroyed) return;
      const rect = c.getBoothLocalCenter(b.id);
      if (rect) this.showCallout(b, rect.x, rect.y);
      if (onCalloutShown) onCalloutShown();
    });
    setTimeout(() => this.map.setHighlightedId(''), 3000);
  }

  onPageVisible() {
    this._pageVisible = true;
    this._resumeHandoffIfVisible();
  }

  _resumeHandoffIfVisible() {
    if (this._handoffSession && this._handoffReady && this._pageVisible) {
      this._handoffSession.resume();
    }
  }

  /* ---------- 浏览埋点计时 ---------- */
  _startViewSession(boothId) {
    this._cancelViewSession();
    if (state.boothViewHandoff) {
      state.boothViewHandoff.session.cancel();
      state.boothViewHandoff = null;
    }
    this._viewSession = startViewSession(boothId);
    this._viewSession.resume();
  }

  _cancelViewSession() {
    if (this._viewSession) {
      this._viewSession.cancel();
      this._viewSession = null;
    }
    if (this._handoffSession) {
      this._handoffSession.cancel();
      this._handoffSession = null;
    }
  }

  /* ---------- 新手指引 ---------- */
  replayTutorial() {
    state.pendingOnboarding = true;
    this.maybeStartTutorial();
  }

  /* ---------- 中英文切换 ---------- */
  onToggleLanguage() {
    setLanguage(isEnglish() ? 'zh' : 'en');
    refresh();
  }

  _updateLangToggle() {
    if (!this.langToggle) return;
    // 显示“点击后切换到”的目标语言：英文界面显示“中”，中文界面显示“EN”
    this.langToggle.textContent = isEnglish() ? '中' : 'EN';
  }

  maybeStartTutorial() {
    const forceStart = !!state.pendingOnboarding;
    if (state.tutorialLaunched && !forceStart) return;
    if (!state.entryReady) {
      this._mapReadyTimer = setTimeout(() => this.maybeStartTutorial(), 200);
      return;
    }
    if (!forceStart && wx.getStorageSync(tut.TUTORIAL_KEY)) {
      state.tutorialLaunched = true;
      return;
    }
    if (!this.allBooths || !this.allBooths.length) {
      this._mapReadyTimer = setTimeout(() => this.maybeStartTutorial(), 200);
      return;
    }
    if (!this.map || !this.map.getRect() || !this.map._viewport) {
      this._mapReadyTimer = setTimeout(() => this.maybeStartTutorial(), 150);
      return;
    }
    state.pendingOnboarding = false;
    state.tutorialLaunched = true;
    this.startOnboarding();
  }

  startOnboarding() {
    clearTimeout(this._mapReadyTimer);
    state.pendingOnboarding = false;
    state.tutorialLaunched = true;
    if (this._tutorialActive) state.tutorial?.hide({ animated: false });
    if (this.callout?.style.display !== 'none') this.onCalloutClose();
    this._tutorialSteps = tut.getSteps();
    this._tutStepShown = false;
    this._tutorialActive = true;
    this._applyStep(0);
  }

  _applyStep(index) {
    if (!this._tutorialActive) return;
    const step = this._tutorialSteps[index];
    if (!step) {
      this._completeTutorial();
      return;
    }
    this._curStepIndex = index;
    this._curStep = step;
    const content = {
      stepNumber: index + 1,
      totalSteps: this._tutorialSteps.length,
      title: step.title,
      message: step.message,
    };
    // 第一步先淡入遮罩，目标测量完成后再出现对话框；后续步骤复用同一节点平滑移动。
    if (!this._tutStepShown) {
      state.tutorial.showMask();
    } else {
      state.tutorial.updateContent(content);
    }
    // 异步计算高亮区域（过期结果丢弃）
    this._computeHighlight(step)
      .then((rects) => {
        if (!this._tutorialActive || this._curStepIndex !== index) return;
        if (!this._tutStepShown) {
          state.tutorial.show({ ...content, highlightRects: rects || [] });
          this._tutStepShown = true;
        } else {
          state.tutorial.updateRects(rects || []);
        }
      })
      .catch(() => {});
  }

  _computeHighlight(step) {
    const c = this.map;
    const tabIdx = { tabClub: 1, tabActivity: 2, tabReward: 3 }[step.target];
    if (tabIdx !== undefined) {
      const rects = state.tabbar ? state.tabbar.getButtonRects() : [];
      const r = rects[tabIdx];
      if (r) return Promise.resolve([{ left: r.left, top: r.top, width: r.width, height: r.height, shape: 'rect', rx: 0 }]);
      return Promise.resolve([]);
    }
    switch (step.target) {
      case 'clubMarker': {
        if (!c) return Promise.resolve([]);
        const booth = this._resolveExampleBooth();
        const r = booth ? c.getBoothScreenRect(booth.id) : null;
        return Promise.resolve(this._pack([this._toRect(r, 'rect')]));
      }
      case 'musicPlayer': {
        const el = this.el.querySelector('.record-player-slot');
        return Promise.resolve(this._pack([this._elementRect(el)]));
      }
      case 'searchField': {
        const el = this.el.querySelector('.search-field');
        return Promise.resolve(this._pack([this._elementRect(el)]));
      }
      default:
        return Promise.resolve([]);
    }
  }

  _toRect(r, shape) {
    if (!r) return null;
    const rx = shape === 'circle' ? Math.min(r.width, r.height) / 2 : 0;
    return { left: r.left, top: r.top, width: r.width, height: r.height, shape, rx };
  }

  _elementRect(element) {
    if (!element) return null;
    const r = element.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height, shape: 'rect', rx: 0 };
  }

  _pack(arr) {
    return (arr || []).filter(Boolean);
  }

  _resolveExampleBooth() {
    const list = this.allBooths || [];
    const c = this.map;
    const mapRect = c?.getRect();
    const isVisible = (booth) => {
      const r = c?.getBoothScreenRect(booth.id);
      if (!r || !mapRect) return false;
      return r.cx > mapRect.left + 12
        && r.cx < mapRect.right - 12
        && r.cy > mapRect.top + 12
        && r.cy < mapRect.bottom - 76;
    };
    let b = list.find((x) => x.id === this._exampleBoothId && isVisible(x));
    if (!b && mapRect) {
      const cx = mapRect.left + mapRect.width / 2;
      const cy = mapRect.top + mapRect.height * 0.45;
      b = list
        .filter(isVisible)
        .sort((a, d) => {
          const ar = c.getBoothScreenRect(a.id);
          const dr = c.getBoothScreenRect(d.id);
          return Math.hypot(ar.cx - cx, ar.cy - cy) - Math.hypot(dr.cx - cx, dr.cy - cy);
        })[0];
    }
    if (!b && list.length) b = list[0];
    if (b) this._exampleBoothId = b.id;
    this._exampleBooth = b || null;
    return b || null;
  }

  _refreshTutorialHighlight() {
    const step = this._curStep;
    const index = this._curStepIndex;
    if (!this._tutorialActive || !step) return;
    this._computeHighlight(step).then((rects) => {
      if (!this._tutorialActive || this._curStepIndex !== index) return;
      state.tutorial?.updateRects(rects || []);
    });
  }

  onTutorialNext() {
    if (!this._tutorialActive) return;
    const now = Date.now();
    if (now - (this._lastAdvance || 0) < 300) return; // 防连点跳步
    this._lastAdvance = now;
    const idx = this._curStepIndex;
    if (idx >= this._tutorialSteps.length - 1) {
      this._completeTutorial();
      return;
    }
    this._applyStep(idx + 1);
  }

  onTutorialPrevious() {
    if (!this._tutorialActive || this._curStepIndex <= 0) return;
    this._applyStep(this._curStepIndex - 1);
  }

  onSkipTutorial() {
    this._completeTutorial();
  }

  async _completeTutorial() {
    if (!this._tutorialActive) return;
    this._tutorialActive = false;
    clearTimeout(this._tutorialResizeTimer);
    if (state.tutorial) await state.tutorial.hide();
    this.map?.setHighlightedId('');
    wx.setStorageSync(tut.TUTORIAL_KEY, 'true');
  }

  _resetTutorialState() {
    this._tutorialActive = false;
    clearTimeout(this._mapReadyTimer);
    clearTimeout(this._tutorialResizeTimer);
    if (state.tutorial) state.tutorial.hide({ animated: false });
  }

  destroy() {
    this._destroyed = true;
    this._cancelViewSession();
    if (state.boothViewHandoff) {
      state.boothViewHandoff.session.cancel();
      state.boothViewHandoff = null;
    }
    clearTimeout(this._mapReadyTimer);
    clearTimeout(this._plazaHlTimer);
    clearTimeout(this._typeTimer);
    clearTimeout(this._emailHoldTimer);
    clearTimeout(this._emailCopyHideTimer);
    window.removeEventListener('resize', this._onTutorialResize);
    this._resetTutorialState();
    if (this.map) this.map.destroy();
    if (this.recordPlayer) this.recordPlayer.destroy();
    this.el.innerHTML = '';
  }
}

export default {
  title: () => t('appTitle'),
  mount(container) {
    const p = new MapPage();
    p.mount(container);
    return p;
  },
};
