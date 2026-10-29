import {
  createDefaultState, readHash, encodeState, NOTE_LABELS, VOICE_IDS, WAVES,
  RANGES, pairToGains,
} from './state.js';
import { DRUM_PRESETS, densityToLevel } from './patterns.js';
import * as audio from './audio.js';
import { setupNoteReorder } from './note-reorder.js';
import { MAX_SECONDS } from './recorder.js';
import { createFader, createPairToggle, createKnob, createSegmented, icon, maskIcon } from './controls.js';

const AMBIENCE = [
  { name: 'Транспорт', top: ['Машины', 'car'], bottom: ['Гудки', 'car-horn'] },
  { name: 'Люди', top: ['Шаги', 'person'], bottom: ['Разговоры', 'people'] },
  { name: 'Метро', top: ['Гул вагона', 'metro'], bottom: ['Стук колёс', 'train'] },
  { name: 'Стройка', top: ['Молоток', 'hammer'], bottom: ['Механизм', 'gear'] },
  { name: 'Сигналы', top: ['Громкоговоритель', 'megaphone'], bottom: ['Сирена', 'siren'] },
  { name: 'Птицы', top: ['Щебетание', 'bird'], bottom: ['Крики птиц', 'gull'] },
  { name: 'Дождь', top: ['Капли', 'droplet'], bottom: ['Ливень', 'rain'] },
  { name: 'Ветер', top: ['Ветер в деревьях', 'wind'], bottom: ['Порывы', 'cloud-wind'] },
  { name: 'Растительность', top: ['Шелест листвы', 'leaf'], bottom: ['Хруст веток', 'leaves'] },
  { name: 'Вода', top: ['Ручей', 'stream'], bottom: ['Плеск', 'splash'] },
];

const WAVE_INFO = {
  sine: ['Синус', 'wave-sine'],
  triangle: ['Треугольник', 'wave-triangle'],
  square: ['Квадрат', 'wave-square'],
  sawtooth: ['Пила', 'wave-saw'],
};

const FX_INFO = [
  ['echo', 'эхо', (v) => pct(v), 'Эхо: повторы всего микса'],
  ['depth', 'глубина', (v) => pct(v), 'Глубина: реверберация всего микса'],
  ['drive', 'искажение', (v) => pct(v), 'Искажение: перегрузка всего микса'],
  ['glide', 'плавность', (v) => `${pct(v)} · атака нот +${Math.round(v * 250)} мс, затухания длиннее`,
    'Плавность: мягче атаки и длиннее затухания у всех слоёв (ноты, синглы, барабаны)'],
];

const VOICE_NAMES = { city: 'Город', nature: 'Природа' };
const pct = (v) => `${Math.round(v * 100)}%`;

let state = createDefaultState();
let busy = false;
const refreshers = [];
const noteRows = { city: [], nature: [] };
const pairIcons = [];

const $ = (id) => document.getElementById(id);
const playBtn = $('playBtn');
const downloadBtn = $('downloadBtn');
const shareBtn = $('shareBtn');
const resetBtn = $('resetBtn');

function buildVoice(id) {
  const panel = document.querySelector(`[data-voice="${id}"]`);
  const name = VOICE_NAMES[id];

  const volume = createFader({
    label: `Громкость: ${name}`, length: 236, value: state.voices[id].volume, defaultValue: 0.75,
    format: pct,
    onInput: (v) => { state.voices[id].volume = v; audio.updateVoice(id); },
  });
  panel.querySelector('[data-slot="volume"]').append(volume.el);
  refreshers.push(() => volume.set(state.voices[id].volume));

  const notesBox = panel.querySelector('[data-slot="notes"]');
  NOTE_LABELS.forEach((label, i) => {
    const row = document.createElement('div');
    row.className = 'note';
    row.dataset.note = String(i);
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'note__handle';
    handle.textContent = '⠿';
    handle.setAttribute('aria-label', `${name}: переместить ноту ${label}`);
    handle.title = 'Перетащите ноту или используйте стрелки вверх / вниз';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'note__toggle';
    toggle.setAttribute('aria-label', `${name}: нота ${label}`);
    toggle.title = `Включить или выключить ноту ${label}`;
    const text = document.createElement('span');
    text.className = 'note__label';
    text.textContent = label;
    text.setAttribute('aria-hidden', 'true');

    const length = createFader({
      orientation: 'horizontal',
      label: `${name}: длительность ${label}`,
      min: RANGES.noteLength[0], max: RANGES.noteLength[1], step: 0.01,
      value: state.voices[id].notes[i].len, defaultValue: 0.35,
      format: (v) => `${pct(v)} шага · ${Math.round(v * 30000 / state.tempo)} мс`,
      onInput: (v) => { state.voices[id].notes[i].len = v; },
    });

    toggle.addEventListener('click', () => {
      const note = state.voices[id].notes[i];
      note.on = !note.on;
      paint();
    });

    const paint = () => {
      const on = state.voices[id].notes[i].on;
      row.classList.toggle('is-on', on);
      toggle.setAttribute('aria-pressed', String(on));
      length.set(state.voices[id].notes[i].len);
    };
    paint();
    refreshers.push(paint);

    row.append(handle, toggle, text, length.el);
    notesBox.append(row);
    noteRows[id].push(row);
  });

  setupNoteReorder(notesBox, {
    getOrder: () => state.voices[id].order,
    onChange: (order) => {
      state.voices[id].order = order;
      renderOrder();
    },
    announce: (label, position) => showToast(`${name}: ${label}, позиция ${position} из 8`),
  });
  function renderOrder() {
    state.voices[id].order.forEach((noteIndex) => notesBox.append(noteRows[id][noteIndex]));
    highlightStep(currentStep);
  }
  refreshers.push(renderOrder);

  const waves = createSegmented(
    panel.querySelector('[data-slot="waves"]'),
    WAVES.map((w) => ({ value: w, label: `${name}: ${WAVE_INFO[w][0]}`, html: icon(WAVE_INFO[w][1]) })),
    state.voices[id].wave,
    (w) => { state.voices[id].wave = w; audio.updateVoice(id); },
    'round-btn wave-btn',
  );
  refreshers.push(() => waves.set(state.voices[id].wave));

  const pairsBox = panel.querySelector('[data-slot="pairs"]');
  const first = id === 'city' ? 0 : 5;
  for (let index = first; index < first + 5; index++) {
    pairsBox.append(buildPair(index));
  }
}

function buildPair(index) {
  const info = AMBIENCE[index];
  const column = document.createElement('div');
  column.className = 'pair';
  column.innerHTML = `
    <span title="${info.top[0]} (вверх)">${icon(info.top[1], 'pair__icon')}</span>
    <span title="${info.bottom[0]} (вниз)">${icon(info.bottom[1], 'pair__icon')}</span>`;
  const [topIcon, bottomIcon] = column.querySelectorAll('.pair__icon');

  const describe = (v) => {
    const g = pairToGains(v);
    if (g.side === 0) return `${info.name}: выключено`;
    return `${info.name}: ${g.side > 0 ? info.top[0] : info.bottom[0]}`;
  };

  const markActive = () => {
    const g = pairToGains(state.ambience[index]);
    topIcon.classList.toggle('is-active', g.side > 0);
    bottomIcon.classList.toggle('is-active', g.side < 0);
  };

  const slider = createPairToggle({
    label: `${info.name}: вверх — ${info.top[0].toLowerCase()}, центр — выключено, вниз — ${info.bottom[0].toLowerCase()}`,
    value: state.ambience[index],
    describe,
    onInput: (v) => {
      state.ambience[index] = v;
      audio.updateAmbience(index);
      markActive();
    },
  });

  column.insertBefore(slider.el, column.children[1]);
  refreshers.push(() => { slider.set(state.ambience[index]); markActive(); });
  markActive();
  return column;
}

function buildCenter() {
  const times = [
    { value: 'morning', label: 'Утро', html: icon('sunrise') },
    { value: 'day', label: 'День', html: maskIcon('sun') },
    { value: 'evening', label: 'Вечер', html: maskIcon('cloud-moon') },
  ];
  const control = createSegmented($('timeOfDay'), times, state.timeOfDay, (t) => {
    state.timeOfDay = t;
    document.body.dataset.time = t;
  });
  refreshers.push(() => { control.set(state.timeOfDay); document.body.dataset.time = state.timeOfDay; });
}

function buildDrums() {
  const density = createKnob({
    label: 'Плотность ритма',
    big: true,
    value: state.drums.density,
    defaultValue: 0.5,
    marks: [
      { angle: -135, icon: 'circle-dot' },
      { angle: -67.5, icon: 'slashes' },
      { angle: 0, icon: 'dots' },
      { angle: 67.5, icon: 'bars' },
      { angle: 135, icon: 'star' },
    ],
    format: (v) => `уровень ${densityToLevel(v)} из 5`,
    onInput: (v) => { state.drums.density = v; },
  });
  $('densitySlot').append(density.el);
  refreshers.push(() => density.set(state.drums.density));

  const presets = createSegmented(
    $('presets'),
    [1, 2, 3, 4, 5].map((n) => ({
      value: n,
      label: `Пресет ${n}: «${DRUM_PRESETS[n].name}» (повторное нажатие — выключить барабаны)`,
      html: String(n),
    })),
    state.drums.preset,
    (n) => { state.drums.preset = n; },
    'segmented__btn',
    0,
  );
  refreshers.push(() => presets.set(state.drums.preset));

  const volume = createFader({
    label: 'Громкость барабанов', length: 300, value: state.drums.volume, defaultValue: 0.7, format: pct,
    onInput: (v) => { state.drums.volume = v; audio.updateDrums(); },
  });
  $('drumVolumeSlot').append(volume.el);
  refreshers.push(() => volume.set(state.drums.volume));

  const tempo = createFader({
    label: 'Темп', length: 300, min: RANGES.tempo[0], max: RANGES.tempo[1], step: 1,
    value: state.tempo, defaultValue: 108, format: (v) => `${v} уд/мин`,
    onInput: (v) => { state.tempo = v; audio.updateTempo(); },
  });
  $('tempoSlot').append(tempo.el);
  refreshers.push(() => tempo.set(state.tempo));
}

function buildEffects() {

  const knobs = FX_INFO.map(([key, label, format, hint]) => {
    const knob = createKnob({
      label,
      hint,
      value: state.fx[key],
      defaultValue: 0,
      format,
      onInput: (v) => { state.fx[key] = v; audio.updateEffects(); },
    });
    $('fxKnobs').append(knob.el);
    return { key, knob };
  });
  refreshers.push(() => knobs.forEach(({ key, knob }) => knob.set(state.fx[key])));

  const master = createFader({
    label: 'Общая громкость', length: 290, value: state.masterVolume, defaultValue: 0.8, format: pct,
    onInput: (v) => { state.masterVolume = v; audio.updateMaster(); },
  });
  $('masterSlot').append(master.el);
  refreshers.push(() => master.set(state.masterVolume));
}

function renderAll() {
  refreshers.forEach((refresh) => refresh());
}

async function togglePlay() {
  if (busy) return;
  busy = true;
  try {
    if (!audio.isReady()) {
      playBtn.classList.add('is-busy');
      playBtn.setAttribute('aria-label', 'Загрузка звука…');
      showToast('Загрузка звука…');
      await audio.initAudio();
      if (audio.getRecorder().unavailable) {
        downloadBtn.title = 'Запись звука недоступна в этом браузере';
        setTimeout(() => showToast('Звук работает, но запись в этом браузере недоступна', 4000), 2700);
      }
      audio.getRecorder().onLimit(() => {
        audio.pause().then(renderTransport);
        showToast('Достигнут предел записи — 10 минут. Запись можно скачать.');
      });
      hideToast();
    }

    if (audio.isPlaying()) audio.pause().then(renderTransport);
    else audio.play();
  } catch (error) {
    console.error(error);
    showToast('Не удалось запустить звук. Проверьте, что сайт открыт через http(s).');
  } finally {
    playBtn.classList.remove('is-busy');
    busy = false;
    renderTransport();
  }
}

function renderTransport() {
  const on = audio.isPlaying();
  playBtn.classList.toggle('is-playing', on);
  playBtn.setAttribute('aria-label', on ? 'Пауза' : 'Старт');
  playBtn.title = on ? 'Пауза: плавно приглушить звук и приостановить запись' : 'Старт: запустить звук и запись';
}

async function downloadRecording() {
  const recorder = audio.getRecorder();
  if (busy || !recorder || !recorder.hasAudio) return;
  busy = true;
  downloadBtn.classList.add('is-busy');
  downloadBtn.setAttribute('aria-label', 'Подготовка…');
  showToast('Подготовка…', 0);
  try {

    if (audio.isPlaying()) await audio.pause();
    renderTransport();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const blob = recorder.toWavBlob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `bitonika-${timestamp()}.wav`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    showToast(`Файл WAV сохранён (${formatTime(recorder.seconds)})`);
  } catch (error) {
    console.error(error);
    showToast('Не удалось подготовить файл.');
  } finally {
    downloadBtn.classList.remove('is-busy');
    downloadBtn.setAttribute('aria-label', 'Скачать запись (WAV)');
    busy = false;
  }
}

function shareLink() {
  const url = `${location.origin}${location.pathname}#s=${encodeState(state)}`;
  history.replaceState(null, '', url);
  const fallback = () => {
    $('shareInput').value = url;
    $('shareDialog').showModal();
    $('shareInput').select();
  };
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(url)
      .then(() => showToast('Ссылка скопирована'))
      .catch(fallback);
  } else {
    fallback();
  }
}

async function resetAll() {
  if (busy) return;
  busy = true;
  try {
    await audio.stopAndClear();
    state = createDefaultState();
    audio.setState(state);
    renderAll();
    audio.updateAll();
    highlightStep(-1);
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    showToast('Настройки сброшены');
  } finally {
    busy = false;
    renderTransport();
  }
}

function applyHash() {
  const loaded = readHash(location.hash);
  if (!loaded) return;
  if (!loaded.ok) {
    showToast('Ссылка повреждена — оставлены текущие настройки');
    return;
  }
  state = loaded.state;
  audio.setState(state);
  renderAll();
  audio.updateAll();
  showToast('Настройки из ссылки загружены');
}

let currentStep = -1;
function highlightStep(step) {
  currentStep = step;
  VOICE_IDS.forEach((id) => {
    noteRows[id].forEach((row, i) => row.classList.toggle('is-current', i === state.voices[id].order[step]));
  });
}

const timeText = $('timeText');
const timeFill = $('timeFill');
const canvas = $('dots');
const ctx = canvas.getContext('2d');
const COLS = 6;
const shown = new Array(COLS).fill(0);

function frame() {

  const recorder = audio.getRecorder();
  const secs = recorder ? recorder.seconds : 0;
  timeText.textContent = formatTime(secs);
  timeFill.style.width = `${Math.min(100, (secs / MAX_SECONDS) * 100)}%`;
  downloadBtn.disabled = !(recorder && recorder.hasAudio) && !downloadBtn.classList.contains('is-busy');

  drawDots(audio.getBandLevels());
  requestAnimationFrame(frame);
}

function drawDots(levels) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const gapX = w / COLS;
  const radius = Math.max(1.5, Math.min(gapX * 0.17, 4.2));
  const rows = Math.max(4, Math.floor(h / (radius * 5.6)));
  const gapY = h / rows;
  const lime = getComputedStyle(document.documentElement).getPropertyValue('--lime').trim() || '#bbfc9f';

  for (let c = 0; c < COLS; c++) {

    shown[c] = Math.max(levels[c], shown[c] * 0.9);
    const lit = Math.round(shown[c] * rows);
    for (let r = 0; r < rows; r++) {
      const fromBottom = rows - 1 - r;
      ctx.beginPath();
      ctx.arc(gapX * (c + 0.5), gapY * (r + 0.5), radius, 0, Math.PI * 2);
      ctx.fillStyle = fromBottom < lit ? lime : 'rgba(255, 255, 255, 0.2)';
      ctx.fill();
    }
  }
}

const toast = $('toast');
let toastTimer = null;
function showToast(text, duration = 2600) {
  toast.textContent = text;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  if (duration) toastTimer = setTimeout(hideToast, duration);
}
function hideToast() { toast.classList.remove('is-visible'); }

function formatTime(secs) {
  const total = Math.floor(secs);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function start() {

  const loaded = readHash(location.hash);
  if (loaded) {
    state = loaded.state;
    if (loaded.ok) showToast('Настройки из ссылки загружены. Нажмите ▶, чтобы услышать', 4000);
    else {
      showToast('Ссылка повреждена — загружены начальные настройки', 4000);
      history.replaceState(null, '', `${location.pathname}${location.search}`);
    }
  }
  audio.setState(state);
  audio.onStep(highlightStep);

  VOICE_IDS.forEach(buildVoice);
  buildCenter();
  buildDrums();
  buildEffects();
  renderAll();
  renderTransport();

  playBtn.addEventListener('click', togglePlay);
  downloadBtn.addEventListener('click', downloadRecording);
  shareBtn.addEventListener('click', shareLink);
  resetBtn.addEventListener('click', resetAll);
  window.addEventListener('hashchange', applyHash);

  requestAnimationFrame(frame);
}

start();
