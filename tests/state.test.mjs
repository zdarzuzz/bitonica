// Небольшие проверки чистых функций (без звука и интерфейса).
// Запуск в терминале:   node tests/state.test.mjs
// Или в браузере:       tests/tests.html (через локальный сервер)

import {
  createDefaultState, encodeState, decodeState, readHash, sanitizeState,
  pairToGains, PAIR_DEAD_ZONE, DEFAULT_STATE, FORMAT_VERSION,
} from '../js/state.js';
import { DRUM_PRESETS, DRUM_INSTRUMENTS, hitsAtStep, densityToLevel } from '../js/patterns.js';

export function runTests() {
  const results = [];
  const check = (name, condition) => results.push({ name, ok: Boolean(condition) });

  /* --- Парные ползунки --- */
  check('центр — оба звука выключены', pairToGains(0).top === 0 && pairToGains(0).bottom === 0);
  check('зона тишины около центра', pairToGains(PAIR_DEAD_ZONE).top === 0 && pairToGains(-PAIR_DEAD_ZONE).bottom === 0);
  check('выше центра — только верхний', pairToGains(0.5).top > 0 && pairToGains(0.5).bottom === 0);
  check('ниже центра — только нижний', pairToGains(-0.5).bottom > 0 && pairToGains(-0.5).top === 0);
  check('край — полная громкость', pairToGains(1).top === 1 && pairToGains(-1).bottom === 1);
  check('громкость растёт с расстоянием от центра', pairToGains(0.3).top < pairToGains(0.6).top);
  let neverBoth = true;
  for (let v = -1; v <= 1.0001; v += 0.01) {
    const g = pairToGains(v);
    if (g.top > 0 && g.bottom > 0) neverBoth = false;
    if (g.top < 0 || g.bottom < 0 || g.top > 1 || g.bottom > 1) neverBoth = false;
  }
  check('на всём ходе пара никогда не звучит вместе', neverBoth);
  check('мусор вместо числа → тишина', pairToGains('abc').side === 0 && pairToGains(NaN).side === 0);

  /* --- Ссылка: кодирование и восстановление --- */
  const custom = createDefaultState();
  custom.tempo = 131;
  custom.timeOfDay = 'morning';
  custom.masterVolume = 0.42;
  custom.voices.city.wave = 'sawtooth';
  custom.voices.city.notes[1] = { on: true, len: 0.9 };
  custom.voices.nature.fx.glide = 0.77;
  custom.ambience = [1, -1, 0.5, -0.5, 0, 0.25, -0.25, 0.75, -0.75, 0.1];
  custom.drums = { preset: 3, density: 0.9, volume: 0.33 };
  const encoded = encodeState(custom);
  const decoded = decodeState(encoded);
  check('кодирование → декодирование без потерь', decoded.ok && JSON.stringify(decoded.state) === JSON.stringify(custom));
  check('строка безопасна для адреса', /^[A-Za-z0-9_-]+$/.test(encoded));
  check('readHash понимает #s=…', readHash(`#s=${encoded}`).ok);
  check('readHash без настроек → null', readHash('') === null && readHash('#other') === null);
  check('в ссылке есть версия формата', JSON.parse(JSON.stringify(sanitizeState(custom))).v === FORMAT_VERSION);

  const broken = decodeState('%%%не-base64');
  check('повреждённая ссылка → начальные настройки', !broken.ok && JSON.stringify(broken.state) === JSON.stringify(DEFAULT_STATE));
  const wrongVersion = decodeState(encodeObj({ ...custom, v: 99 }));
  check('чужая версия формата отклоняется', !wrongVersion.ok);
  const truncated = decodeState(encoded.slice(0, Math.floor(encoded.length / 2)));
  check('обрезанная ссылка не ломает сайт', !truncated.ok);

  const dirty = sanitizeState({
    v: 1, tempo: 9999, masterVolume: -5, timeOfDay: 'полночь',
    voices: { city: { wave: 'noise', volume: 'громко', notes: [{ on: 'да', len: 50 }] } },
    ambience: [5, -5, 'x'], drums: { preset: 42, density: 2 },
  });
  check('темп ограничен диапазоном', dirty.tempo === 150);
  check('громкость ограничена 0…1', dirty.masterVolume === 0);
  check('неизвестное время суток → по умолчанию', dirty.timeOfDay === DEFAULT_STATE.timeOfDay);
  check('неизвестная форма волны → по умолчанию', dirty.voices.city.wave === DEFAULT_STATE.voices.city.wave);
  check('длительность ноты ограничена', dirty.voices.city.notes[0].len === 1 && dirty.voices.city.notes[0].on === DEFAULT_STATE.voices.city.notes[0].on);
  check('положения ползунков ограничены -1…1', dirty.ambience[0] === 1 && dirty.ambience[1] === -1 && dirty.ambience[2] === 0);
  check('всегда 10 парных ползунков и 8 нот', dirty.ambience.length === 10 && dirty.voices.nature.notes.length === 8);
  check('номер пресета 1…5', dirty.drums.preset === 5 && dirty.drums.density === 1);

  const fresh = createDefaultState();
  fresh.voices.city.notes[0].on = false;
  check('изменение копии не портит DEFAULT_STATE', DEFAULT_STATE.voices.city.notes[0].on === true);
  check('по умолчанию все ползунки среды в центре', DEFAULT_STATE.ambience.every((v) => v === 0));

  /* --- Барабанные рисунки --- */
  let patternsOk = true;
  Object.values(DRUM_PRESETS).forEach((preset) => {
    DRUM_INSTRUMENTS.forEach((inst) => {
      if (!/^[.1-5]{16}$/.test(preset[inst])) patternsOk = false;
    });
  });
  check('у всех пресетов 16 шагов и правильные символы', patternsOk);
  check('плотность 0 → уровень 1, плотность 1 → уровень 5', densityToLevel(0) === 1 && densityToLevel(1) === 5);
  const count = (density) => {
    let n = 0;
    for (let s = 0; s < 16; s++) n += hitsAtStep(5, density, s).length;
    return n;
  };
  check('большая плотность даёт больше ударов', count(1) > count(0.5) && count(0.5) > count(0));

  return results;
}

function encodeObj(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Запуск из терминала: node tests/state.test.mjs
if (typeof process !== 'undefined' && process.argv && import.meta.url === `file://${process.argv[1]}`) {
  const results = runTests();
  results.forEach((r) => console.log(`${r.ok ? '✓' : '✗'} ${r.name}`));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} из ${results.length} проверок прошли`);
  process.exitCode = failed ? 1 : 0;
}
