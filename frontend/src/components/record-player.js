import baseSrc from '../../地图相关素材/底座.webp';
import recordSrc from '../../地图相关素材/唱片.webp';
import { t } from '../i18n.js';
import { subscribeBackgroundMusic, toggleBackgroundMusic } from '../services/background-music.js';

/** Fixed map control whose vinyl keeps its exact angle while paused. */
export class RecordPlayer {
  constructor(root, sizeReference) {
    this.root = root;
    this.sizeReference = sizeReference;
    this.paused = true;
    this._syncSize = () => this.syncSize();

    root.innerHTML = `
      <button class="record-player" type="button" aria-pressed="false">
        <img class="record-player__base" src="${baseSrc}" alt="" draggable="false" />
        <img class="record-player__vinyl" src="${recordSrc}" alt="" draggable="false" />
        <img class="record-player__arm" src="${baseSrc}" alt="" draggable="false" />
      </button>`;

    this.button = root.querySelector('.record-player');
    this.button.addEventListener('click', () => toggleBackgroundMusic());
    this.unsubscribePlayback = subscribeBackgroundMusic((playing) => this.setPlaying(playing));

    if (typeof ResizeObserver === 'function' && sizeReference) {
      this.resizeObserver = new ResizeObserver(this._syncSize);
      this.resizeObserver.observe(sizeReference);
    }
    window.addEventListener('resize', this._syncSize);
    requestAnimationFrame(this._syncSize);
  }

  syncSize() {
    const height = this.sizeReference?.getBoundingClientRect().height || 0;
    if (height > 0) {
      const size = `${height}px`;
      this.root.style.setProperty('--record-player-size', size);
      this.root.parentElement?.style.setProperty('--map-control-size', size);
    }
  }

  setPlaying(playing) {
    this.paused = !playing;
    this.button.classList.toggle('is-paused', this.paused);
    this.button.setAttribute('aria-pressed', String(this.paused));
    this.updateLabel();
  }

  updateLabel() {
    const label = this.paused ? t('resumeRecord') : t('pauseRecord');
    this.button.setAttribute('aria-label', label);
    this.button.title = label;
  }

  destroy() {
    this.unsubscribePlayback?.();
    this.resizeObserver?.disconnect();
    window.removeEventListener('resize', this._syncSize);
    this.root.innerHTML = '';
  }
}
