// Автоматическая проверка аудиосистемы (без интерфейса).
// Открывается через tests/audio-check.html; результат пишется в window.audioReport.
// Измеряет пиковый уровень каждого из 20 звуков среды, голосов и барабанов.

import { createDefaultState } from '../js/state.js';
import * as audio from '../js/audio.js';

const Tone = window.Tone;
const log = (text) => {
  document.getElementById('log').textContent += text + '\n';
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function meterOn(node, smoothing = 0) {
  const meter = new Tone.Meter({ smoothing });
  node.connect(meter);
  return meter;
}

// Максимальный уровень (дБ) нескольких измерителей за durationMs.
async function peaks(meters, durationMs) {
  const max = meters.map(() => -Infinity);
  const end = performance.now() + durationMs;
  while (performance.now() < end) {
    meters.forEach((m, i) => { max[i] = Math.max(max[i], m.getValue()); });
    await wait(15);
  }
  return max.map((v) => Math.round(v * 10) / 10);
}

export async function runAudioCheck() {
  const report = { errors: [], ambience: [], ok: true };
  const state = createDefaultState();
  state.tempo = 150;
  VOICE_OFF(state);
  state.drums.volume = 0;
  audio.setState(state);
  await audio.initAudio();
  audio.updateAll();
  const nodes = audio.debugNodes();

  const topMeters = nodes.ambience.map((p) => meterOn(p.top.out));
  const bottomMeters = nodes.ambience.map((p) => meterOn(p.bottom.out));
  const masterMeter = meterOn(nodes.limiter);
  // «Средний» уровень (сильно сглаженный измеритель) — показывает громкость на слух
  const topAvg = nodes.ambience.map((p) => meterOn(p.top.out, 0.97));
  const bottomAvg = nodes.ambience.map((p) => meterOn(p.bottom.out, 0.97));
  audio.play();

  // 1. Все ползунки в центре: тишина
  await wait(600);
  let [t, b] = await Promise.all([peaks(topMeters, 1500), peaks(bottomMeters, 1500)]);
  report.centerSilent = t.concat(b).every((v) => v === -Infinity || v < -90);
  log('Центр — тишина: ' + report.centerSilent);

  // 2. Все вверх, затем все вниз: звучит только выбранная сторона
  for (const side of [1, -1]) {
    state.ambience = state.ambience.map(() => side);
    state.ambience.forEach((_, i) => audio.updateAmbience(i));
    await wait(300);
    const avg = side === 1 ? topAvg : bottomAvg;
    const sums = avg.map(() => 0);
    let n = 0;
    const sampler = setInterval(() => { avg.forEach((m, i) => { sums[i] += Math.pow(10, m.getValue() / 20); }); n++; }, 30);
    [t, b] = await Promise.all([peaks(topMeters, 9000), peaks(bottomMeters, 9000)]);
    clearInterval(sampler);
    const means = sums.map((x) => Math.round(200 * Math.log10(x / n)) / 10);
    nodes.ambience.forEach((_, i) => {
      report.ambience[i] = report.ambience[i] || {};
      if (side === 1) { report.ambience[i].top = t[i]; report.ambience[i].topAvg = means[i]; report.ambience[i].bottomWhileTop = b[i]; }
      else { report.ambience[i].bottom = b[i]; report.ambience[i].bottomAvg = means[i]; report.ambience[i].topWhileBottom = t[i]; }
    });
    log((side === 1 ? 'Верх: ' : 'Низ: ') + JSON.stringify(side === 1 ? t : b));
  }

  // 3. Резкое переключение верх → низ: в каждый момент звучит не больше одного звука пары
  state.ambience = state.ambience.map(() => 1);
  state.ambience.forEach((_, i) => audio.updateAmbience(i));
  await wait(200);
  state.ambience = state.ambience.map(() => -1);
  const t0 = Tone.now();
  state.ambience.forEach((_, i) => audio.updateAmbience(i));
  report.overlap = nodes.ambience.map((p) => {
    let worst = 0;
    for (let dt = 0; dt <= 0.12; dt += 0.002) {
      const a = p.top.out.gain.getValueAtTime(t0 + dt);
      const c = p.bottom.out.gain.getValueAtTime(t0 + dt);
      worst = Math.max(worst, Math.min(a, c));
    }
    return worst;
  });
  log('Перекрытие пар при переключении (должно быть 0): ' + JSON.stringify(report.overlap));

  // 4. Всё включено на максимум: выход не превышает 0 дБ
  state.ambience = state.ambience.map((_, i) => (i % 2 ? 1 : -1));
  state.masterVolume = 1;
  state.drums.volume = 1;
  state.voices.city.volume = 1; state.voices.nature.volume = 1;
  state.voices.city.notes.forEach((n) => { n.on = true; n.len = 1; });
  state.voices.nature.notes.forEach((n) => { n.on = true; n.len = 1; });
  state.fx.drive = 1; state.fx.echo = 1; state.drums.preset = 5;
  audio.updateAll();
  [report.masterPeakAllOn] = await peaks([masterMeter], 5000);
  log('Пик общего выхода при всех слоях: ' + report.masterPeakAllOn + ' дБ');

  await audio.pause();
  await wait(200);
  [report.masterAfterPause] = await peaks([masterMeter], 800);
  log('После паузы: ' + report.masterAfterPause);
  window.audioReport = report;
  return report;
}

function VOICE_OFF(state) {
  state.voices.city.volume = 0;
  state.voices.nature.volume = 0;
}
