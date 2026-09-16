/**
 * pages/staff-redeem.js — 扫码核销页（web 版，仅工作人员）
 *
 * - 路由：#/staff/redeem
 * - 只有 localStorage.user_role === 'staff' 可访问；否则提示无权并跳回主页
 * - 显示名以 /api/auth/me 为准，不读 localStorage.auth_user（该值可能已过期：
 *   工作人员被移出白名单后，本地缓存仍留着旧姓名）
 * - 用 html5-qrcode 扫码，扫到 claimToken 自动调 redeemClaimToken
 * - 核销成功后 3 秒自动恢复扫码状态；页面销毁时停止摄像头
 */
import './staff.css';
import { redeemClaimToken, getMe, clearAuthToken } from '../services/api.js';
import { t } from '../i18n.js';

const USER_ROLE_KEY = 'user_role';
const USER_KEY = 'auth_user';
const RESTART_MS = 3000;

function lsGet(key) {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function lsRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {}
}

function isStaffRole() {
  return lsGet(USER_ROLE_KEY) === 'staff';
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

class StaffRedeemPage {
  mount(container) {
    this.el = container;
    this.destroyed = false;
    this.scanner = null;
    this.busy = false;
    this.timer = null;
    this.identityInvalid = false;

    if (!isStaffRole()) {
      container.innerHTML = `<div class="page staff-page"><div class="staff-msg">${t('noAccess')}</div></div>`;
      this.timer = setTimeout(() => {
        if (!this.destroyed) location.hash = '#/map';
      }, 1200);
      return this;
    }

    container.innerHTML = `
      <div class="page staff-redeem">
        <div class="redeem-staff">${t('staffLabel')}<span class="redeem-staff-name">…</span></div>
        <div class="redeem-scan"><div id="qr-reader"></div></div>
        <div class="redeem-result"></div>
      </div>`;

    this.nameEl = container.querySelector('.redeem-staff-name');
    this.result = container.querySelector('.redeem-result');
    this.loadIdentity();
    return this;
  }

  /** 显示名取后端权威值（GET /api/auth/me，返回 { id, role }，id 即工作人员姓名）。 */
  async loadIdentity() {
    try {
      const me = await getMe();
      if (this.destroyed) return;
      if (me?.role !== 'staff') {
        this.handleIdentityInvalid();
        return;
      }
      if (this.nameEl) this.nameEl.textContent = (me && me.id) || '—';
      this.showResult('');
      await this.startScanner();
    } catch (e) {
      if (this.destroyed) return;
      if (['AUTH_REQUIRED', 'INVALID_TOKEN', 'STAFF_REQUIRED'].includes(e?.code)) {
        this.handleIdentityInvalid();
        return;
      }
      // A temporary network failure is not evidence that the staff session expired.
      this.showResult(e?.message || t('networkError'), false);
      const retry = document.createElement('button');
      retry.className = 'btn-primary';
      retry.textContent = t('retry');
      retry.addEventListener('click', () => {
        retry.disabled = true;
        this.loadIdentity();
      });
      this.result.appendChild(retry);
    }
  }

  /**
   * token 已失效（如工作人员被移出白名单，getCurrentUser 实时复查会返回 null）。
   * 清掉本地过期身份，停止扫码并回主页，避免继续用旧姓名做核销。
   */
  handleIdentityInvalid() {
    this.identityInvalid = true;
    clearAuthToken();
    lsRemove(USER_KEY);
    lsRemove(USER_ROLE_KEY);
    this.showResult(t('loginExpired'), false);
    this.stopScanner();
    this.timer = setTimeout(() => {
      if (!this.destroyed) location.hash = '#/map';
    }, 2500);
  }

  async startScanner() {
    if (this.destroyed || this.identityInvalid) return;
    try {
      if (!this.scanner) {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (this.destroyed || this.identityInvalid || !this.el.querySelector('#qr-reader')) return;
        this.scanner = new Html5Qrcode('qr-reader');
      }
      await this.scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        (text) => this.onScan(text),
        () => {}
      );
    } catch (e) {
      if (this.destroyed) return;
      this.showResult(t('cameraError'), false);
      return;
    }
    // start() 期间身份可能已被判定失效
    if (this.identityInvalid || this.destroyed) this.stopScanner();
  }

  /** 停止并释放摄像头（幂等）。 */
  stopScanner() {
    if (!this.scanner) return;
    const sc = this.scanner;
    this.scanner = null;
    Promise.resolve(sc.stop())
      .then(() => {
        try {
          sc.clear();
        } catch {}
      })
      .catch(() => {});
  }

  /** 扫到 claimToken → 停止解码 → 核销 → 3 秒后恢复 */
  async onScan(token) {
    if (this.destroyed || this.busy || this.identityInvalid) return;
    this.busy = true;
    try {
      if (this.scanner) this.scanner.pause();
    } catch {}
    this.showResult(t('redeeming'));
    try {
      await redeemClaimToken(String(token).trim());
      if (this.destroyed) return;
      this.showResult(t('redeemSuccess'), true);
    } catch (e) {
      if (this.destroyed) return;
      if (e && (e.code === 'AUTH_REQUIRED' || e.code === 'INVALID_TOKEN' || e.code === 'STAFF_REQUIRED')) {
        this.busy = false;
        this.handleIdentityInvalid();
        return;
      }
      this.showResult((e && e.message) || t('redeemFail'), false);
    }
    this.busy = false;
    this.timer = setTimeout(() => {
      if (this.destroyed) return;
      this.showResult('');
      try {
        if (this.scanner) this.scanner.resume();
        else this.startScanner();
      } catch {
        this.startScanner();
      }
    }, RESTART_MS);
  }

  showResult(text, ok) {
    if (this.destroyed || !this.result) return;
    this.result.textContent = text;
    this.result.classList.toggle('ok', ok === true);
    this.result.classList.toggle('err', ok === false);
  }

  destroy() {
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    this.stopScanner();
    this.el.innerHTML = '';
  }
}

export default { title: () => t('scanRedeem'), mount: (c) => new StaffRedeemPage().mount(c) };
