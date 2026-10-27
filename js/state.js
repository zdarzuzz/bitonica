// state.js — единый объект настроек «Битоники».
// Здесь нет ни звука, ни интерфейса: только данные и чистые функции.
// Поэтому этот файл легко проверить тестами (tests/state.test.mjs).

export const FORMAT_VERSION = 2; // v2: синглы — 3 положения, эффекты общие, барабаны можно выключить

// Ноты двух голосов. Обозначения одинаковые: C D E F G A B C↑ (C↑ — следующая октава).
export const NOTE_LABELS = ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C↑'];
export const VOICE_NOTES = {
  city:   ['C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3', 'C4'],
  nature: ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'],
};
export const WAVES = ['sine', 'triangle', 'square', 'sawtooth'];
export const TIMES_OF_DAY = ['morning', 'day', 'evening'];
export const VOICE_IDS = ['city', 'nature'];

// Диапазоны чисел. Одни и те же границы использует интерфейс, звук и проверка ссылки.
export const RANGES = {
  tempo: [70, 150],      // удары в минуту
  noteLength: [0.1, 1],  // доля шага последовательности
};

// При входе на сайт все ноты выключены.
function defaultNotes() {
  return Array.from({ length: 8 }, () => ({ on: false, len: 0.35 }));
}

// Начальное состояние описано ОДИН раз. Его используют загрузка страницы и сброс.
// Всё выключено: ноты, синглы, барабаны. Звук появится только у того, что включит пользователь.
export const DEFAULT_STATE = Object.freeze({
  v: FORMAT_VERSION,
  timeOfDay: 'evening',
  masterVolume: 0.8,
  tempo: 108,
  voices: {
    city: {
      volume: 0.75,
      wave: 'triangle',
      notes: defaultNotes(),
      order: [0, 1, 2, 3, 4, 5, 6, 7],
    },
    nature: {
      volume: 0.7,
      wave: 'triangle',
      notes: defaultNotes(),
      order: [0, 1, 2, 3, 4, 5, 6, 7],
    },
  },
  // Общие эффекты на всю композицию (0…1).
  fx: { echo: 0.25, depth: 0.35, drive: 0, glide: 0.15 },
  // Десять синглов: 1 — верхний звук, 0 — оба выключены, -1 — нижний звук.
  ambience: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  // preset 0 — барабаны выключены, 1…5 — ритмический пресет.
  drums: { preset: 0, density: 0.5, volume: 0.7 },
});

// Глубокая копия, чтобы случайно не изменить DEFAULT_STATE.
export function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

export function createDefaultState() {
  return cloneState(DEFAULT_STATE);
}

/* ---------- Синглы: трёхпозиционные переключатели ---------- */

// Любое число → одно из трёх положений: 1 (верх), 0 (центр), -1 (низ).
export function toPairPosition(value) {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  if (n >= 0.5) return 1;
  if (n <= -0.5) return -1;
  return 0;
}

// Положение → громкости двух звуков пары. Хотя бы одна всегда равна 0.
export function pairToGains(value) {
  const side = toPairPosition(value);
  return { top: side === 1 ? 1 : 0, bottom: side === -1 ? 1 : 0, side };
}

/* ---------- Ссылка с настройками ---------- */

// Состояние → строка для адреса (#s=...). JSON кодируется в base64url.
export function encodeState(state) {
  const json = JSON.stringify(sanitizeState(state));
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Строка из адреса → { state, ok }. Повреждённая строка не ломает сайт:
// возвращаются начальные настройки и ok: false.
export function decodeState(text) {
  try {
    if (typeof text !== 'string' || text.length === 0 || text.length > 20000) throw new Error('empty');
    let b64 = text.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (!data || typeof data !== 'object' || data.v !== FORMAT_VERSION) throw new Error('version');
    return { state: sanitizeState(data), ok: true };
  } catch (error) {
    return { state: createDefaultState(), ok: false };
  }
}

// Читает настройки из hash вида "#s=...". Нет настроек → null.
export function readHash(hash) {
  const match = /^#?s=(.+)$/.exec(hash || '');
  return match ? decodeState(match[1]) : null;
}

/* ---------- Проверка входных данных ---------- */

function clampNumber(value, min, max, fallback) {
  const n = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

// Берёт любые данные и возвращает правильное состояние:
// неизвестные поля отбрасываются, числа ограничиваются диапазоном,
// отсутствующие значения берутся из DEFAULT_STATE.
export function sanitizeState(input) {
  const src = input && typeof input === 'object' ? input : {};
  const def = DEFAULT_STATE;
  const out = createDefaultState();

  out.timeOfDay = pick(src.timeOfDay, TIMES_OF_DAY, def.timeOfDay);
  out.masterVolume = clampNumber(src.masterVolume, 0, 1, def.masterVolume);
  out.tempo = Math.round(clampNumber(src.tempo, RANGES.tempo[0], RANGES.tempo[1], def.tempo));

  VOICE_IDS.forEach((id) => {
    const s = src.voices && src.voices[id] ? src.voices[id] : {};
    const d = def.voices[id];
    const o = out.voices[id];
    o.volume = clampNumber(s.volume, 0, 1, d.volume);
    o.wave = pick(s.wave, WAVES, d.wave);
    // Старые ссылки без order сохраняют исходный порядок; принимаем только перестановку.
    o.order = Array.isArray(s.order) && s.order.length === 8 &&
      new Set(s.order).size === 8 && s.order.every((n) => Number.isInteger(n) && n >= 0 && n < 8)
      ? [...s.order] : [...d.order];
    o.notes = d.notes.map((dn, i) => {
      const sn = Array.isArray(s.notes) && s.notes[i] ? s.notes[i] : {};
      return {
        on: typeof sn.on === 'boolean' ? sn.on : dn.on,
        len: clampNumber(sn.len, RANGES.noteLength[0], RANGES.noteLength[1], dn.len),
      };
    });
  });

  const sf = src.fx || {};
  Object.keys(def.fx).forEach((key) => {
    out.fx[key] = clampNumber(sf[key], 0, 1, def.fx[key]);
  });

  out.ambience = def.ambience.map((dv, i) =>
    toPairPosition(Array.isArray(src.ambience) ? src.ambience[i] : dv));

  const sd = src.drums || {};
  out.drums.preset = Math.round(clampNumber(sd.preset, 0, 5, def.drums.preset));
  out.drums.density = clampNumber(sd.density, 0, 1, def.drums.density);
  out.drums.volume = clampNumber(sd.volume, 0, 1, def.drums.volume);

  out.v = FORMAT_VERSION;
  return out;
}
