// Graphics & gameplay settings, persisted separately from the save game.
const KEY = 'wanderer-settings-v1';

export const QUALITY = {
  low: { dpr: 1, shadow: 1024, ao: false, bloom: false, msaa: 0, lights: 3, grassDist: 45, viewDist: 115 },
  medium: { dpr: 1.5, shadow: 2048, ao: true, bloom: true, msaa: 0, lights: 6, grassDist: 65, viewDist: 135 },
  high: { dpr: 2, shadow: 4096, ao: true, bloom: true, msaa: 4, lights: 8, grassDist: 80, viewDist: 150 },
};

const defaults = {
  quality: matchMedia('(pointer: coarse)').matches ? 'low' : 'medium',
  style: 'realistic', // realistic | storybook (needs reload)
  outlines: false,
  autoQuality: true,
  music: true,
};

export const settings = { ...defaults };
try {
  const raw = localStorage.getItem(KEY);
  if (raw) Object.assign(settings, JSON.parse(raw));
} catch (e) { /* storage unavailable */ }
if (!QUALITY[settings.quality]) settings.quality = defaults.quality;

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
}

export const REALISTIC = settings.style !== 'storybook';
export const q = () => QUALITY[settings.quality];
