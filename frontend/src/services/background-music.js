import bgmSrc from '../../地图相关素材/Mossy Barn Loop.mp3';

// Create the player only when playback is requested, keeping audio off the initial download.
let audio = null;

const listeners = new Set();

function emit() {
  const playing = !!audio && !audio.paused;
  listeners.forEach((listener) => listener(playing));
}

function startBackgroundMusic() {
  if (!audio) {
    audio = new Audio();
    audio.preload = 'none';
    audio.loop = true;
    audio.volume = 0.55;
    audio.src = bgmSrc;
    audio.addEventListener('play', emit);
    audio.addEventListener('pause', emit);
    audio.addEventListener('ended', emit);
  }
  const result = audio.play();
  if (result && typeof result.catch === 'function') result.catch(() => emit());
  return result;
}

function pauseBackgroundMusic() {
  audio?.pause();
}

function toggleBackgroundMusic() {
  return !audio || audio.paused ? startBackgroundMusic() : pauseBackgroundMusic();
}

function subscribeBackgroundMusic(listener) {
  listeners.add(listener);
  listener(!!audio && !audio.paused);
  return () => listeners.delete(listener);
}

function getBackgroundMusicState() {
  return {
    paused: audio?.paused ?? true,
    currentTime: audio?.currentTime ?? 0,
    duration: audio?.duration ?? NaN,
    loop: audio?.loop ?? true,
    volume: audio?.volume ?? 0.55,
    src: audio?.currentSrc || audio?.src || bgmSrc,
  };
}

export {
  startBackgroundMusic,
  pauseBackgroundMusic,
  toggleBackgroundMusic,
  subscribeBackgroundMusic,
  getBackgroundMusicState,
};
