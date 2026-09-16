import consoleSrc from '../../地图相关素材/游戏机模板.webp';
import mapZhPreview from '../../地图相关素材/地图参考模板.webp';
import mapEnPreview from '../../地图相关素材/地图参考模板2.webp';
import { isEnglish } from '../i18n.js';

const mapPreviewSrc = () => (isEnglish() ? mapEnPreview : mapZhPreview);

const SCREEN = {
  left: 17.5,
  top: 15.25,
  width: 57.4,
  height: 55.85,
};

function waitForImage(image) {
  if (image.complete) return Promise.resolve();
  return new Promise((resolve) => {
    image.addEventListener('load', resolve, { once: true });
    image.addEventListener('error', resolve, { once: true });
  });
}

export function mountStartupIntro() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return { play: () => Promise.resolve() };
  }

  const app = document.querySelector('#app');
  const intro = document.createElement('div');
  intro.className = 'startup-intro';
  intro.setAttribute('aria-hidden', 'true');
  intro.innerHTML = `
    <div class="startup-intro__viewport">
      <div class="startup-intro__anchor">
        <div class="startup-intro__device">
          <img class="startup-intro__console" src="${consoleSrc}" alt="" />
          <div class="startup-intro__screen">
            <div class="startup-intro__preview-head">
              <span>百团大战</span><i></i>
            </div>
            <img class="startup-intro__map" src="${mapPreviewSrc()}" alt="" />
            <div class="startup-intro__preview-nav">
              <span>首页</span><span class="is-current">地图</span><span>社团</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.append(intro);
  app?.setAttribute('inert', '');

  let finished = false;
  let fallbackTimer;
  let resolveFinished;
  const finishedPromise = new Promise((resolve) => {
    resolveFinished = resolve;
  });

  const finish = () => {
    if (finished) return;
    finished = true;
    window.clearTimeout(fallbackTimer);
    intro.classList.add('is-leaving');
    window.setTimeout(() => {
      intro.remove();
      app?.removeAttribute('inert');
      resolveFinished();
    }, 190);
  };

  return {
    play() {
      const device = intro.querySelector('.startup-intro__device');
      const images = [...intro.querySelectorAll('img')];

      Promise.race([
        Promise.all(images.map(waitForImage)),
        new Promise((resolve) => window.setTimeout(resolve, 450)),
      ]).then(() => {
        const deviceRect = device.getBoundingClientRect();
        const appRect = app?.getBoundingClientRect() ?? document.body.getBoundingClientRect();
        const screenWidth = deviceRect.width * (SCREEN.width / 100);
        const screenHeight = deviceRect.height * (SCREEN.height / 100);
        const visibleAppHeight = Math.min(window.innerHeight, appRect.height);
        const targetScale = Math.min(
          2.75,
          Math.max(1.85, appRect.width / screenWidth, visibleAppHeight / screenHeight) * 1.04,
        );

        device.style.setProperty('--startup-zoom', targetScale.toFixed(3));
        requestAnimationFrame(() => intro.classList.add('is-playing'));
      });

      device.addEventListener('animationend', finish, { once: true });
      fallbackTimer = window.setTimeout(finish, 3300);
      return finishedPromise;
    },
  };
}
