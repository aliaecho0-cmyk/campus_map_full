/**
 * pages/reward.js — 奖励页（web 版，只读 + 首签领取）
 *
 * 徽章进度：GET /api/me/reward
 * 活动倒计时：getEventEndAt()
 * 实时进度：订阅 boothView.setOnProgressChanged
 */
import './reward.css';
import { getRewardStatus, getClaimToken } from '../services/api.js';
import { localizeBadge, t } from '../i18n.js';
import { getEventEndAt, requireLogin } from '../services/auth.js';
import { setOnProgressChanged, setOnViewStatus, getPendingReported } from '../services/boothView.js';

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function formatCountdown(endAtIso) {
  const end = Date.parse(endAtIso);
  if (!Number.isFinite(end)) return '';

  const SIX_HOURS = 6 * 60 * 60 * 1000;
  let ms = end - SIX_HOURS - Date.now();

  if (ms <= 0) return t('eventEnded');
  const days = Math.floor(ms / 86400000);
  ms -= days * 86400000;
  const hours = Math.floor(ms / 3600000);
  ms -= hours * 3600000;
  const mins = Math.floor(ms / 60000);
  return t('countdown', { days, hours, mins });
}

/** claimStatus → i18n key */
const CLAIM_LABEL_KEY = { none: 'claimable', active: 'claimed', redeemed: 'redeemed', expired: 'eventEnded' };

class RewardPage {
  mount(container) {
    this.el = container;
    this.destroyed = false;
    this.badge = null;
    this.reward = null;
    this.eventEndAt = getEventEndAt();
    container.innerHTML = `
      <div class="page reward-page">
        <div class="countdown-box"></div>
        <section class="card reward-card badge-progress-card">
          <div class="card-title">${t('badgeProgress')}</div>
          <div class="badge-body"></div>
        </section>
        <section class="card reward-card">
          <div class="card-title">${t('claimReward')}</div>
          <div class="claim-body"></div>
        </section>
      </div>`;

    setOnProgressChanged(() => this.refresh());
    this.pendingCount = getPendingReported();
    setOnViewStatus(({ pending }) => {
      this.pendingCount = pending;
      this.renderBadge();
    });
    this.updateCountdown();
    // The event deadline may arrive after background login completes.
    this.timer = setInterval(() => this.updateCountdown(), 30000);
    this.refresh();
    return this;
  }

  updateCountdown() {
    if (this.destroyed) return;
    const box = this.el.querySelector('.countdown-box');
    if (!box) return;
    box.textContent = formatCountdown(this.eventEndAt) || t('eventTimePending');
  }

  async refresh() {
    let err = null;
    let data = null;
    try {
      await requireLogin();
      if (this.destroyed) return;
      data = await getRewardStatus();
    } catch (e) {
      err = e;
    }
    if (this.destroyed) return;
    if (data) {
      this.badge = data.badge || null;
      this.reward = data.reward || null;
      this.eventEndAt = data.eventEndAt || this.eventEndAt;
    } else {
      this.badge = null;
      this.reward = null;
    }
    this.renderBadge(err);
    this.renderClaim(err);
    this.updateCountdown();
  }

  renderBadge(err) {
    if (this.destroyed) return;
    const body = this.el.querySelector('.badge-body');
    if (!body) return;
    const b = localizeBadge(this.badge);
    if (err || !b) {
      const msg = err ? (err && err.message) || t('networkError') : t('loading');
      body.innerHTML = `<div class="reward-empty">${escapeHtml(msg)}</div>`;
      if (err) {
        const retry = document.createElement('button');
        retry.className = 'btn-primary';
        retry.textContent = t('retry');
        retry.addEventListener('click', () => {
          retry.disabled = true;
          this.refresh();
        });
        body.appendChild(retry);
      }
      return;
    }
    const required = b.requiredUniqueBooths || 0;
    const count = b.uniqueBoothCount || 0;
    const pct = required > 0 ? Math.min(100, Math.round((count / required) * 100)) : 0;
    const name = b.name || t('badgeFallback');
    const status = b.unlocked
      ? `<span class="badge-status ok">${t('badgeUnlocked')}</span>`
      : `<span class="badge-status">${escapeHtml(name)}</span>`;
    const countLabel = this.pendingCount > 0 ? `${count}+` : `${count}`;
    const syncHint = this.pendingCount > 0 ? `<div class="badge-syncing">${t('syncingBadge')}</div>` : '';
    body.innerHTML = `
      <div class="badge-name">${escapeHtml(name)} ${status}</div>
      <div class="badge-rule">${t('badgeRule')}</div>
      <div class="badge-count">${t('viewedBooths', { count: countLabel, required })}</div>
      <div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>
      ${syncHint}`;
  }

  renderClaim(err) {
    if (this.destroyed) return;
    const body = this.el.querySelector('.claim-body');
    if (!body) return;
    if (err) {
      body.innerHTML = `<div class="reward-empty">${escapeHtml((err && err.message) || t('networkError'))}</div>`;
      const retry = document.createElement('button');
      retry.className = 'btn-primary';
      retry.textContent = t('retry');
      retry.addEventListener('click', () => {
        retry.disabled = true;
        this.refresh();
      });
      body.appendChild(retry);
      return;
    }
    const b = this.badge;
    if (!b) {
      body.innerHTML = `<div class="reward-empty">${t('loading')}</div>`;
      return;
    }
    if (!b.unlocked) {
      body.innerHTML = `<div class="reward-empty">${t('keepBrowsing')}</div>`;
      return;
    }
    const r = this.reward;
    const status = r ? r.claimStatus : 'none';
    if (status === 'none') {
      body.innerHTML = `
        <button class="btn-primary claim-btn" type="button">${t('claimable')}</button>
        <div class="claim-hint">${t('claimHint')}</div>`;
      body.querySelector('.claim-btn').addEventListener('click', () => this.onClaim());
    } else if (status === 'active') {
      const token = (r && r.claimToken) || '';
      body.innerHTML = `
        <div class="voucher">
          <div class="voucher-label">${t('voucher')}</div>
          <div class="voucher-qr"><img class="qr-img" alt="${t('qrAlt')}" /></div>
          <div class="voucher-code">${escapeHtml(token)}</div>
          <div class="voucher-note">${t('voucherNote')}</div>
        </div>`;
      this.renderQr(body.querySelector('.qr-img'), token);
    } else {
      const label = CLAIM_LABEL_KEY[status] ? t(CLAIM_LABEL_KEY[status]) : status;
      body.innerHTML = `<div class="claim-state">${label}</div>`;
    }
  }

  async onClaim() {
    const btn = this.el.querySelector('.claim-btn');
    if (btn) btn.disabled = true;
    let err = null;
    let data = null;
    try {
      data = await getClaimToken();
    } catch (e) {
      err = e;
    }
    if (this.destroyed) return;
    if (data) {
      this.reward = {
        ...(this.reward || {}),
        claimStatus: data.claimStatus,
        claimToken: data.claimToken,
      };
      this.badge = { ...(this.badge || {}), unlocked: true };
    }
    this.renderClaim(err);
  }

  async renderQr(imgEl, token) {
    if (!imgEl || !token) return;
    try {
      const { default: QRCode } = await import('qrcode');
      if (this.destroyed || !imgEl.isConnected) return;
      const url = await QRCode.toDataURL(token, { width: 200, margin: 2 });
      if (!this.destroyed && imgEl.isConnected) imgEl.src = url;
    } catch (e) {
      console.warn('[reward] 二维码生成失败', e);
    }
  }

  destroy() {
    this.destroyed = true;
    if (this.timer) clearInterval(this.timer);
    setOnProgressChanged(null);
    setOnViewStatus(null);
    this.el.innerHTML = '';
  }
}

export default { title: () => t('reward'), mount: (c) => new RewardPage().mount(c) };
