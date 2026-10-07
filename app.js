/* ==========================================================
   Cozy Focus Timer – Uygulama mantığı
   Tema, Pomodoro sayacı ve localStorage'da tutulan istatistikler.
   ========================================================== */

'use strict';

const THEME_KEY = 'cozy-theme';
const STATS_KEY = 'cozy-stats';

// Bir günün "odaklanılan gün" sayılması için o gün en az bu kadar çalışılmalı.
// Yanlışlıkla basılıp hemen durdurulan sayaç gün sayısını artırmasın.
const MIN_FOCUS_SECONDS_PER_DAY = 60;

const SESSIONS_PER_CYCLE = 4;

const MODES = {
  focus: { minutes: 25, label: 'Odaklanma zamanı', title: 'Odak' },
  short: { minutes: 5, label: 'Kısa mola', title: 'Kısa mola' },
  long: { minutes: 15, label: 'Uzun mola', title: 'Uzun mola' },
};

const DEFAULT_TITLE = document.title;

// --- DOM referansları ---
const root = document.documentElement;
const themeToggle = document.getElementById('theme-toggle');
const timerDisplay = document.getElementById('timer-display');
const timerLabel = document.getElementById('timer-label');
const ringProgress = document.querySelector('.timer-ring-progress');
const sessionDots = document.getElementById('session-dots');
const startButton = document.getElementById('btn-start');
const startLabel = document.getElementById('btn-start-label');
const pauseButton = document.getElementById('btn-pause');
const resetButton = document.getElementById('btn-reset');
const modeInputs = document.querySelectorAll('input[name="mode"]');
const statHours = document.getElementById('stat-hours');
const statMinutes = document.getElementById('stat-minutes');
const statDays = document.getElementById('stat-days');

// ---------- localStorage yardımcıları ----------
// Gizli pencere veya engellenmiş depolamada hata fırlatabilir; uygulama yine çalışmalı.

function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* depolama kullanılamıyor; veriler yalnızca bu oturumda kalır */
  }
}

// ==========================================================
// Tema
// ==========================================================

const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

function currentTheme() {
  if (root.classList.contains('dark')) return 'dark';
  if (root.classList.contains('light')) return 'light';
  return systemDark.matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  root.classList.remove('dark', 'light');
  root.classList.add(theme);
  themeToggle.setAttribute('aria-label', theme === 'dark' ? 'Açık temaya geç' : 'Koyu temaya geç');
}

themeToggle.addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  writeStorage(THEME_KEY, next);
});

themeToggle.setAttribute('aria-label', currentTheme() === 'dark' ? 'Açık temaya geç' : 'Koyu temaya geç');

// ==========================================================
// İstatistikler
// ==========================================================

// Yerel saate göre gün anahtarı (toISOString UTC kullanır, gece yarısı kayar)
function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function loadStats() {
  const defaults = { totalSeconds: 0, focusDays: 0, todayKey: null, todaySeconds: 0, dayCounted: false };
  try {
    const saved = JSON.parse(readStorage(STATS_KEY));
    return saved && typeof saved === 'object' ? { ...defaults, ...saved } : defaults;
  } catch {
    return defaults;
  }
}

function saveStats(stats) {
  writeStorage(STATS_KEY, JSON.stringify(stats));
}

function renderStats(stats = loadStats()) {
  statHours.textContent = Math.floor(stats.totalSeconds / 3600);
  statMinutes.textContent = Math.floor((stats.totalSeconds % 3600) / 60);
  statDays.textContent = stats.focusDays;
}

function addFocusTime(ms) {
  const seconds = Math.round(ms / 1000);
  if (seconds <= 0) return;

  const stats = loadStats();
  const today = localDateKey();

  // Yeni bir güne geçildiyse bugünün sayaçlarını sıfırla
  if (stats.todayKey !== today) {
    stats.todayKey = today;
    stats.todaySeconds = 0;
    stats.dayCounted = false;
  }

  stats.totalSeconds += seconds;
  stats.todaySeconds += seconds;

  if (!stats.dayCounted && stats.todaySeconds >= MIN_FOCUS_SECONDS_PER_DAY) {
    stats.focusDays += 1;
    stats.dayCounted = true;
  }

  saveStats(stats);
  renderStats(stats);
}

// ==========================================================
// Sayaç
// ==========================================================

let mode = 'focus';
let durationMs = MODES.focus.minutes * 60 * 1000;
let remainingMs = durationMs;
let endTime = null;        // çalışıyorsa bitiş zamanı (ms), duruyorsa null
let segmentStart = null;   // kaydedilmemiş çalışma diliminin başlangıcı
let intervalId = null;
let session = 1;           // 1..SESSIONS_PER_CYCLE
let audioContext = null;

const isRunning = () => endTime !== null;

function formatTime(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function render() {
  const time = formatTime(remainingMs);
  timerDisplay.textContent = time;
  timerDisplay.setAttribute('datetime', `PT${Math.ceil(remainingMs / 1000)}S`);
  timerLabel.textContent = MODES[mode].label;
  ringProgress.style.setProperty('--progress', remainingMs / durationMs);
  document.title = isRunning() ? `${time} · ${MODES[mode].title}` : DEFAULT_TITLE;

  const started = remainingMs < durationMs;
  startButton.disabled = isRunning();
  startLabel.textContent = started && !isRunning() ? 'Devam Et' : 'Başla';
  pauseButton.disabled = !isRunning();
  resetButton.disabled = !isRunning() && !started;
}

function renderSessionDots() {
  const dots = sessionDots.children;
  for (let i = 0; i < dots.length; i++) {
    const index = i + 1;
    dots[i].classList.toggle('is-done', index < session || (index === session && mode !== 'focus'));
    dots[i].classList.toggle('is-current', index === session && mode === 'focus');
  }
  sessionDots.setAttribute('aria-label', `${SESSIONS_PER_CYCLE} seanstan ${session}. seans`);
}

// Başlangıçtan bu yana geçen odak süresini istatistiğe ekler.
// "until" verilirse süre o ana kadar sayılır (bitişten sonra geçen gecikme eklenmesin).
function recordSegment(until = Date.now()) {
  if (segmentStart !== null && mode === 'focus') {
    addFocusTime(until - segmentStart);
  }
  segmentStart = null;
}

function stopInterval() {
  clearInterval(intervalId);
  intervalId = null;
}

function tick() {
  remainingMs = Math.max(0, endTime - Date.now());
  if (remainingMs === 0) {
    complete();
  } else {
    render();
  }
}

function start() {
  if (isRunning()) return;
  unlockAudio();
  endTime = Date.now() + remainingMs;
  segmentStart = Date.now();
  // Süre zaman damgasından hesaplanır; sekme arka plandayken aralık yavaşlasa da kaymaz
  intervalId = setInterval(tick, 250);
  render();
}

function pause() {
  if (!isRunning()) return;
  remainingMs = Math.max(0, endTime - Date.now());
  stopInterval();
  endTime = null;
  recordSegment();
  render();
}

function reset() {
  if (isRunning()) {
    stopInterval();
    endTime = null;
    recordSegment();
  }
  remainingMs = durationMs;
  render();
}

function setMode(newMode) {
  if (isRunning()) {
    stopInterval();
    endTime = null;
    recordSegment();
  }
  mode = newMode;
  durationMs = MODES[mode].minutes * 60 * 1000;
  remainingMs = durationMs;
  document.querySelector(`input[name="mode"][value="${mode}"]`).checked = true;
  renderSessionDots();
  render();
}

function complete() {
  const finishedAt = endTime;
  stopInterval();
  endTime = null;
  remainingMs = 0;
  recordSegment(finishedAt);
  playChime();

  // Odak bittiyse molaya, mola bittiyse sıradaki odak seansına geç (otomatik başlatmadan)
  if (mode === 'focus') {
    setMode(session >= SESSIONS_PER_CYCLE ? 'long' : 'short');
  } else {
    session = mode === 'long' ? 1 : Math.min(session + 1, SESSIONS_PER_CYCLE);
    setMode('focus');
  }
  document.title = mode === 'focus' ? '☕ Mola bitti!' : '🎉 Süre doldu!';
}

// ---------- Bitiş sesi ----------
// Ses dosyası yerine Web Audio ile kısa, yumuşak bir zil üretilir.

// Zil ve ambiyans sesleri aynı ses bağlamını paylaşır.
// Tarayıcılar sesi yalnızca kullanıcı etkileşiminden sonra çalar; bu yüzden tıklamalarda çağrılır.
function getAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!audioContext && AudioContextClass) {
    audioContext = new AudioContextClass();
  }
  if (audioContext?.state === 'suspended') audioContext.resume();
  return audioContext;
}

const unlockAudio = getAudioContext;

function playChime() {
  if (!audioContext) return;
  const now = audioContext.currentTime;
  [659.25, 880].forEach((frequency, i) => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    const t = now + i * 0.22;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.18, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(t);
    oscillator.stop(t + 1.25);
  });
}

// ---------- Olaylar ----------

startButton.addEventListener('click', start);
pauseButton.addEventListener('click', pause);
resetButton.addEventListener('click', reset);

modeInputs.forEach((input) =>
  input.addEventListener('change', () => setMode(input.value))
);

// Sayfa kapanırken çalışan süre kaybolmasın
window.addEventListener('pagehide', () => {
  if (isRunning()) {
    recordSegment();
    segmentStart = Date.now(); // sayfa önbellekten geri gelirse sayım kaldığı yerden sürer
  }
});

// Başka sekmede istatistik değişirse (aynı tarayıcı) burayı da güncelle
window.addEventListener('storage', (event) => {
  if (event.key === STATS_KEY) renderStats();
});

// ==========================================================
// Ambiyans sesleri
// Wikimedia Commons'taki açık lisanslı kayıtlar döngüde çalınır.
// Her ses bir HTML5 Audio öğesidir; seviye Web Audio GainNode ile ayarlanır
// (iOS Safari audio.volume değişikliğini yok saydığı için).
// ==========================================================

const VOLUMES_KEY = 'cozy-volumes';
const FADE_SECONDS = 0.35;
const COMMONS = 'https://upload.wikimedia.org/wikipedia/commons/';

// Ogg Vorbis desteklenmezse (eski Safari) Wikimedia'nın MP3 dönüşümü kullanılır
const SOUND_SOURCES = {
  rain: {
    ogg: `${COMMONS}0/0e/Rain_%281%29.ogg`,
    mp3: `${COMMONS}transcoded/0/0e/Rain_%281%29.ogg/Rain_%281%29.ogg.mp3`,
  },
  fire: {
    ogg: `${COMMONS}b/b1/Campfire_sound_ambience.ogg`,
    mp3: `${COMMONS}transcoded/b/b1/Campfire_sound_ambience.ogg/Campfire_sound_ambience.ogg.mp3`,
  },
  cafe: {
    ogg: `${COMMONS}b/b5/Restaurant_ambience.ogg`,
    mp3: `${COMMONS}transcoded/b/b5/Restaurant_ambience.ogg/Restaurant_ambience.ogg.mp3`,
  },
  forest: {
    ogg: `${COMMONS}6/65/Waidachswald_Oberschefflenz_Abend_20250616_2005.ogg`,
    mp3: `${COMMONS}transcoded/6/65/Waidachswald_Oberschefflenz_Abend_20250616_2005.ogg/Waidachswald_Oberschefflenz_Abend_20250616_2005.ogg.mp3`,
  },
  noise: {
    ogg: `${COMMONS}a/aa/White_noise.ogg`,
    mp3: `${COMMONS}transcoded/a/aa/White_noise.ogg/White_noise.ogg.mp3`,
  },
};

const canPlayOgg = new Audio().canPlayType('audio/ogg; codecs="vorbis"') !== '';
const ambienceStatus = document.getElementById('ambience-status');
const muteAllButton = document.getElementById('mute-all');

function loadVolumes() {
  try {
    return JSON.parse(readStorage(VOLUMES_KEY)) || {};
  } catch {
    return {};
  }
}

const savedVolumes = loadVolumes();

// Ses nesneleri ilk tıklamaya kadar oluşturulmaz: sayfa açılışında hiçbir şey indirilmez/çalmaz
const sounds = [...document.querySelectorAll('.sound-row')].map((row) => {
  const id = row.dataset.sound;
  const range = row.querySelector('.cozy-range');
  if (Number.isFinite(savedVolumes[id])) range.value = savedVolumes[id];
  return {
    id,
    row,
    name: row.querySelector('.sound-name').textContent,
    toggle: row.querySelector('.sound-toggle'),
    state: row.querySelector('.sound-state'),
    output: row.querySelector('output'),
    range,
    audio: null,
    gain: null,
    playing: false,
    usingFallback: false,
    stopTimer: null,
  };
});

// Kaydırıcı 0–100 → kazanç 0–1. Kare eğri, kulağın algısına daha doğal gelir.
const sliderToGain = (value) => (value / 100) ** 2;

function setSoundState(sound, state) {
  const labels = { off: 'Kapalı', loading: 'Yükleniyor…', playing: 'Çalıyor', error: 'Yüklenemedi' };
  sound.row.classList.toggle('is-playing', state === 'playing' || state === 'loading');
  sound.row.classList.toggle('is-loading', state === 'loading');
  sound.row.classList.toggle('is-error', state === 'error');
  sound.toggle.setAttribute('aria-pressed', String(state === 'playing' || state === 'loading'));
  sound.state.textContent = labels[state];
  updateAmbienceStatus();
}

function updateAmbienceStatus() {
  const active = sounds.filter((s) => s.playing);
  muteAllButton.disabled = active.length === 0;
  ambienceStatus.textContent = active.length === 0
    ? 'Çalmak için bir sese dokun'
    : `${active.length} ses çalıyor · ${active.map((s) => `${s.name} %${s.range.value}`).join(' + ')}`;
}

function createAudio(sound) {
  const audio = new Audio();
  audio.crossOrigin = 'anonymous'; // Web Audio'ya bağlanabilmesi için (Wikimedia CORS izni veriyor)
  audio.loop = true;
  audio.preload = 'auto';
  audio.src = canPlayOgg ? SOUND_SOURCES[sound.id].ogg : SOUND_SOURCES[sound.id].mp3;
  sound.usingFallback = !canPlayOgg;

  audio.addEventListener('waiting', () => sound.playing && setSoundState(sound, 'loading'));
  audio.addEventListener('playing', () => sound.playing && setSoundState(sound, 'playing'));
  audio.addEventListener('error', () => {
    // Ogg açılamazsa bir kez MP3 dene
    if (!sound.usingFallback) {
      sound.usingFallback = true;
      audio.src = SOUND_SOURCES[sound.id].mp3;
      if (sound.playing) startPlayback(sound);
      return;
    }
    sound.playing = false;
    setSoundState(sound, 'error');
  });

  sound.audio = audio;

  const ctx = getAudioContext();
  if (ctx) {
    sound.gain = ctx.createGain();
    sound.gain.gain.value = 0;
    ctx.createMediaElementSource(audio).connect(sound.gain).connect(ctx.destination);
  }
}

function setSoundVolume(sound, value, fade = 0.08) {
  if (sound.gain) {
    const ctx = sound.gain.context;
    sound.gain.gain.cancelScheduledValues(ctx.currentTime);
    sound.gain.gain.setTargetAtTime(value, ctx.currentTime, fade / 3);
  } else if (sound.audio) {
    sound.audio.volume = value; // Web Audio yoksa yedek yol
  }
}

function playSound(sound) {
  getAudioContext(); // kullanıcı tıklamasıyla ses bağlamını hazırla/uyandır
  if (!sound.audio) createAudio(sound);

  // Ses seviyesi 0'dayken açılırsa duyulabilir bir seviyeye getir
  if (Number(sound.range.value) === 0) {
    sound.range.value = 50;
    syncRange(sound);
  }

  clearTimeout(sound.stopTimer);
  sound.playing = true;
  setSoundState(sound, 'loading');
  startPlayback(sound);
}

function startPlayback(sound) {
  sound.audio.play()
    .then(() => {
      if (!sound.playing) return;
      setSoundVolume(sound, sliderToGain(sound.range.value), FADE_SECONDS);
      setSoundState(sound, 'playing');
    })
    .catch((error) => {
      // AbortError: oynatma başlamadan kullanıcı sesi kapattı; hata değil
      if (error.name === 'AbortError' || !sound.playing) return;
      // Kaynak hatası 'error' olayında ele alınır (MP3 yedeği dahil)
      if (error.name !== 'NotSupportedError') {
        sound.playing = false;
        setSoundState(sound, 'error');
      }
    });
}

function stopSound(sound) {
  if (!sound.playing) return;
  sound.playing = false;
  setSoundState(sound, 'off');
  if (!sound.audio) return;

  // Ani kesilme yerine kısa bir sönümle dur
  setSoundVolume(sound, 0, FADE_SECONDS);
  clearTimeout(sound.stopTimer);
  sound.stopTimer = setTimeout(() => {
    if (!sound.playing) sound.audio.pause();
  }, sound.gain ? FADE_SECONDS * 1000 + 50 : 0);
}

function syncRange(sound) {
  sound.range.style.setProperty('--value', `${sound.range.value}%`);
  sound.output.textContent = `%${sound.range.value}`;
}

function saveVolumes() {
  const volumes = Object.fromEntries(sounds.map((s) => [s.id, Number(s.range.value)]));
  writeStorage(VOLUMES_KEY, JSON.stringify(volumes));
}

sounds.forEach((sound) => {
  sound.toggle.addEventListener('click', () => {
    if (sound.playing) stopSound(sound);
    else playSound(sound);
  });

  sound.range.addEventListener('input', () => {
    syncRange(sound);
    if (sound.playing) setSoundVolume(sound, sliderToGain(sound.range.value));
    updateAmbienceStatus();
  });
  sound.range.addEventListener('change', saveVolumes);

  syncRange(sound);
});

muteAllButton.addEventListener('click', () => sounds.forEach(stopSound));

updateAmbienceStatus();

// ---------- Başlangıç ----------
renderStats();
renderSessionDots();
render();
