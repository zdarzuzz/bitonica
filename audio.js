import { VOICE_NOTES, VOICE_IDS, pairToGains } from './state.js';
import { hitsAtStep } from './patterns.js';
import { createRecorder } from './recorder.js';

const Tone = window.Tone;

let state = null;
let ready = false;
let initPromise = null;
let playing = false;
let pauseTimer = null;
let pauseResolvers = [];

let transport;
let master, fader, mixBus, voicesBus, ambienceBus, drumsBus, limiter, fft;
const fx = {};
let recorder = null;
const voices = {};
let ambience = [];
let drums = null;
let stepListener = () => {};

const rand = (min, max) => min + Math.random() * (max - min);
const pickOne = (list) => list[Math.floor(Math.random() * list.length)];
const seconds = (time) => Tone.Time(time).toSeconds();
const SMOOTH = 0.05;

export function setState(newState) { state = newState; }
export function onStep(callback) { stepListener = callback; }
export function isReady() { return ready; }
export function isPlaying() { return playing; }
export function getRecorder() { return recorder; }

export function initAudio() {
  if (!initPromise) initPromise = buildGraph();
  return initPromise;
}

async function buildGraph() {

  if (navigator.audioSession) navigator.audioSession.type = 'playback';
  await Tone.start();
  transport = Tone.getTransport();
  transport.bpm.value = state.tempo;

  limiter = new Tone.Limiter(-1).toDestination();
  const compressor = new Tone.Compressor({ threshold: -18, ratio: 3, attack: 0.01, release: 0.2 });
  fader = new Tone.Gain(0);
  master = new Tone.Gain(0.8);
  master.chain(fader, compressor, limiter);

  mixBus = new Tone.Gain(1);
  fx.drive = new Tone.Distortion({ distortion: 0.1, wet: 0, oversample: '2x' });
  fx.driveTrim = new Tone.Gain(1);
  fx.echo = new Tone.FeedbackDelay({ delayTime: '8n.', feedback: 0.3, wet: 0 });
  fx.space = new Tone.Reverb({ decay: 3.2, preDelay: 0.02, wet: 0 });
  mixBus.chain(fx.drive, fx.driveTrim, fx.echo, fx.space, master);

  voicesBus = new Tone.Gain(1).connect(mixBus);
  drumsBus = new Tone.Gain(0.6).connect(mixBus);

  const ambienceSpace = new Tone.Reverb({ decay: 3, wet: 0.18 });
  ambienceBus = new Tone.Gain(0.9).connect(ambienceSpace);
  ambienceSpace.connect(mixBus);

  fft = new Tone.FFT({ size: 256, smoothing: 0.75 });
  limiter.connect(fft);

  VOICE_IDS.forEach((id) => { voices[id] = createVoice(id); });
  ambience = createAmbience();
  drums = createDrums();

  await Promise.all([
    ambienceSpace.ready,
    fx.space.ready,
  ]);

  try {
    recorder = await createRecorder(Tone, limiter);
  } catch (error) {
    console.warn('Запись недоступна в этом браузере:', error);
    recorder = createTimerOnlyRecorder();
  }

  scheduleMelody();
  scheduleDrums();
  ambience.forEach((pair) => {
    [pair.top, pair.bottom].forEach((sound) => {
      sound.sources.forEach((source) => source.start());
      if (sound.loop) sound.loop.start(0);
    });
  });

  ready = true;
  updateAll();
}

function createTimerOnlyRecorder() {
  let total = 0;
  let startedAt = null;
  return {
    unavailable: true,
    start() { if (startedAt === null) startedAt = performance.now(); },
    stop() {
      if (startedAt !== null) total += (performance.now() - startedAt) / 1000;
      startedAt = null;
      return Promise.resolve();
    },
    clear() { total = 0; startedAt = null; },
    onLimit() {},
    get seconds() { return total + (startedAt === null ? 0 : (performance.now() - startedAt) / 1000); },
    get hasAudio() { return false; },
    get isCapturing() { return startedAt !== null; },
    toWavBlob() { return null; },
  };
}

function createVoice(id) {
  const isCity = id === 'city';
  let synth;
  let colour;
  if (isCity) {

    synth = new Tone.MonoSynth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.004, decay: 0.2, sustain: 0.35, release: 0.25 },
      filter: { type: 'lowpass', Q: 7, rolloff: -24 },
      filterEnvelope: { attack: 0.002, decay: 0.2, sustain: 0.3, release: 0.3, baseFrequency: 180, octaves: 3.8 },
    });
    colour = new Tone.Filter(5000, 'lowpass');
  } else {

    synth = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.05, decay: 0.3, sustain: 0.6, release: 0.9 },
    });
    colour = new Tone.Vibrato({ frequency: 5, depth: 0.08 });
  }
  const softener = new Tone.Filter(isCity ? 6000 : 3000, 'lowpass');
  const channel = new Tone.Gain(0);
  synth.chain(colour, softener, channel, voicesBus);
  registerEnvelope(synth, 'melody');
  return { synth, channel, level: isCity ? 0.8 : 0.65 };
}

function stepAt(time, subdivision, count) {
  const ticks = transport.getTicksAtTime(time);
  return Math.round(ticks / Tone.Time(subdivision).toTicks()) % count;
}

function scheduleMelody() {

  transport.scheduleRepeat((time) => {
    const step = stepAt(time, '8n', 8);
    const stepLength = seconds('8n');
    VOICE_IDS.forEach((id) => {
      const noteIndex = state.voices[id].order[step];
      const note = state.voices[id].notes[noteIndex];
      if (note.on) {

        voices[id].synth.triggerAttackRelease(VOICE_NOTES[id][noteIndex], note.len * stepLength, time, 0.9);
      }
    });

    Tone.getDraw().schedule(() => stepListener(step), time);
  }, '8n', 0);
}

export function updateVoice(id) {
  if (!ready) return;
  const s = state.voices[id];
  const v = voices[id];

  v.synth.oscillator.type = s.wave;
  v.channel.gain.rampTo(s.volume * s.volume * v.level, SMOOTH);
}

export function effectParams(f) {
  return {
    echoWet: f.echo * 0.5,
    echoFeedback: 0.1 + f.echo * 0.5,
    reverbWet: f.depth * 0.7,
    distortion: 0.1 + f.drive * 0.9,
    distortionWet: f.drive === 0 ? 0 : Math.min(1, 0.2 + f.drive),
    driveTrim: 1 - f.drive * 0.45,
    pairFade: 0.04 + f.glide * 0.8,
  };
}

export function updateEffects() {
  if (!ready) return;
  const p = effectParams(state.fx);
  fx.echo.wet.rampTo(p.echoWet, SMOOTH);
  fx.echo.feedback.rampTo(p.echoFeedback, SMOOTH);
  fx.space.wet.rampTo(p.reverbWet, SMOOTH);
  fx.drive.distortion = p.distortion;
  fx.drive.wet.rampTo(p.distortionWet, SMOOTH);
  fx.driveTrim.gain.rampTo(p.driveTrim, SMOOTH);
  applyGlide(state.fx.glide);
}

const envelopeTargets = [];
const GLIDE_AMOUNT = {
  melody: { attack: 0.25, decay: 1.0, release: 2.5 },
  event: { attack: 0.04, decay: 1.2, release: 2.0 },
  drum: { attack: 0.012, decay: 1.0, release: 2.0 },
};

function registerEnvelope(synth, kind) {
  const env = synth.get().envelope;
  envelopeTargets.push({
    synth, kind,
    base: { attack: Number(env.attack), decay: Number(env.decay), release: Number(env.release) },
  });
}

function applyGlide(g) {
  envelopeTargets.forEach(({ synth, kind, base }) => {
    const k = GLIDE_AMOUNT[kind];
    synth.set({
      envelope: {
        attack: base.attack + g * k.attack,
        decay: base.decay * (1 + g * k.decay),
        release: base.release * (1 + g * k.release),
      },
    });
  });
}

function makeSound(level, build) {
  const out = new Tone.Gain(0).connect(ambienceBus);
  const recipe = build(out);
  const sound = { out, level, sources: recipe.sources || [], synths: recipe.synths || [], active: false };
  sound.synths.forEach((synth) => registerEnvelope(synth, 'event'));
  if (recipe.every) {
    sound.loop = new Tone.Loop((time) => {

      if (sound.active) recipe.play(time);
    }, recipe.every);
  }
  return sound;
}

const lfo = (frequency, min, max, type = 'sine') => new Tone.LFO({ frequency, min, max, type });

function createAmbience() {
  return [

    {

      top: makeSound(0.9, (out) => {
        const noise = new Tone.Noise('pink');
        const filter = new Tone.Filter(600, 'lowpass', -24);
        const amp = new Tone.Gain(0);
        const pan = new Tone.Panner(0);
        noise.chain(filter, amp, pan, out);
        const swell = lfo(0.1, 0.15, 1);
        const bright = lfo(0.1, 250, 1500);
        const move = lfo(0.05, -0.7, 0.7);
        swell.connect(amp.gain); bright.connect(filter.frequency); move.connect(pan.pan);
        const rumble = new Tone.Noise('brown');
        const rumbleFilter = new Tone.Filter(220, 'lowpass');
        const rumbleGain = new Tone.Gain(0.35);
        rumble.chain(rumbleFilter, rumbleGain, out);
        return { sources: [noise, swell, bright, move, rumble] };
      }),

      bottom: makeSound(0.32, (out) => {
        const horn = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'sawtooth' },
          envelope: { attack: 0.01, decay: 0.05, sustain: 0.9, release: 0.06 },
        });
        const filter = new Tone.Filter(1800, 'lowpass');
        horn.chain(filter, out);
        const chords = [['E4', 'G#4'], ['F4', 'A4'], ['D4', 'F#4'], ['G4', 'B4']];
        return {
          synths: [horn],
          every: '1m',
          play(time) {
            if (Math.random() > 0.8) return;
            const chord = pickOne(chords);
            const start = time + pickOne([0, seconds('4n'), seconds('2n')]);
            if (Math.random() < 0.5) {
              horn.triggerAttackRelease(chord, 0.4, start);
            } else {
              horn.triggerAttackRelease(chord, 0.13, start);
              horn.triggerAttackRelease(chord, 0.16, start + 0.22);
            }
          },
        };
      }),
    },

    {

      top: makeSound(0.45, (out) => {
        const heel = new Tone.MembraneSynth({
          pitchDecay: 0.015, octaves: 2.5,
          envelope: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.02 },
        });
        const sole = new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.002, decay: 0.06, sustain: 0 } });
        const soleFilter = new Tone.Filter({ type: 'bandpass', frequency: 1400, Q: 1.2 });
        const soleGain = new Tone.Gain(0.5);
        heel.connect(out);
        sole.chain(soleFilter, soleGain, out);
        let left = true;
        return {
          synths: [heel, sole],
          every: '4n',
          play(time) {
            const t = time + rand(0, 0.02);
            heel.triggerAttackRelease(left ? 'A1' : 'G1', 0.05, t, left ? 0.9 : 0.7);
            sole.triggerAttackRelease(0.04, t + 0.012, rand(0.5, 0.9));
            left = !left;
          },
        };
      }),

      bottom: makeSound(2.1, (out) => {
        const mix = new Tone.Gain(0.5);
        const f1 = new Tone.Filter({ type: 'bandpass', frequency: 600, Q: 4 });
        const f2 = new Tone.Filter({ type: 'bandpass', frequency: 1500, Q: 5 });
        const f2Gain = new Tone.Gain(0.6);
        const soft = new Tone.Filter(2200, 'lowpass');
        mix.connect(f1); mix.connect(f2);
        f1.connect(soft); f2.chain(f2Gain, soft);
        soft.connect(out);
        const sources = [];
        [[118, 3.3, 0.21], [165, 4.4, 0.17], [212, 5.1, 0.26]].forEach(([pitch, syllables, phrases], i) => {
          const osc = new Tone.Oscillator(pitch, 'sawtooth');
          const intonation = lfo(rand(0.25, 0.5), pitch * 0.88, pitch * 1.15);
          const syllable = new Tone.Gain(0);
          const phrase = new Tone.Gain(0);
          const pan = new Tone.Panner((i - 1) * 0.5);
          osc.chain(syllable, phrase, pan, mix);
          const syllableLfo = lfo(syllables, 0, 1);
          const phraseLfo = lfo(phrases, 0, 1);
          const phraseShape = new Tone.Pow(3);
          intonation.connect(osc.frequency);
          syllableLfo.connect(syllable.gain);
          phraseLfo.chain(phraseShape, phrase.gain);
          sources.push(osc, intonation, syllableLfo, phraseLfo);
        });
        const vowels = [[730, 1090], [530, 1840], [300, 2200], [570, 840], [440, 1020]];
        return {
          sources,
          every: '8n',
          play(time) {
            const [a, b] = pickOne(vowels);
            f1.frequency.rampTo(a, 0.08, time);
            f2.frequency.rampTo(b, 0.08, time);
          },
        };
      }),
    },

    {

      top: makeSound(0.36, (out) => {
        const amp = new Tone.Gain(0).connect(out);
        const noise = new Tone.Noise('brown');
        const low = new Tone.Filter({ type: 'lowpass', frequency: 170, Q: 1 });
        noise.chain(low, amp);
        const hum = new Tone.Oscillator(48, 'sine');
        const hum2 = new Tone.Oscillator(96, 'triangle');
        const humGain = new Tone.Gain(0.18);
        hum.connect(humGain); hum2.connect(humGain); humGain.connect(amp);
        const whine = new Tone.Oscillator(430, 'triangle');
        const whineGain = new Tone.Gain(0.025);
        whine.chain(whineGain, amp);
        const whineLfo = lfo(0.12, 405, 465);
        whineLfo.connect(whine.frequency);
        const sway = lfo(0.17, 0.55, 1);
        sway.connect(amp.gain);
        return { sources: [noise, hum, hum2, whine, whineLfo, sway] };
      }),

      bottom: makeSound(0.45, (out) => {
        const knock = new Tone.MembraneSynth({
          pitchDecay: 0.01, octaves: 3,
          envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.02 },
        });
        const clank = new Tone.MetalSynth({
          envelope: { attack: 0.001, decay: 0.08, release: 0.02 },
          harmonicity: 3.1, modulationIndex: 12, resonance: 2500, octaves: 1, volume: -20,
        });
        knock.connect(out); clank.connect(out);
        return {
          synths: [knock, clank],
          every: '2n',
          play(time) {
            [0, seconds('16n')].forEach((offset, k) => {
              knock.triggerAttackRelease('E1', 0.08, time + offset, k ? 0.75 : 1);
              clank.triggerAttackRelease(160, 0.05, time + offset, 0.5);
            });
          },
        };
      }),
    },

    {

      top: makeSound(0.56, (out) => {
        const ring = new Tone.MetalSynth({
          envelope: { attack: 0.001, decay: 0.22, release: 0.05 },
          harmonicity: 5.1, modulationIndex: 24, resonance: 3600, octaves: 1.2, volume: -12,
        });
        const knock = new Tone.MembraneSynth({ pitchDecay: 0.008, octaves: 4, envelope: { decay: 0.07, sustain: 0 } });
        ring.connect(out); knock.connect(out);
        return {
          synths: [ring, knock],
          every: '1m',
          play(time) {
            if (Math.random() > 0.65) return;
            const strikes = 2 + Math.floor(Math.random() * 2);
            for (let k = 0; k < strikes; k++) {
              const t = time + k * seconds('4n');
              ring.triggerAttackRelease(220, 0.1, t, rand(0.7, 1));
              knock.triggerAttackRelease('A2', 0.05, t, 0.8);
            }
          },
        };
      }),

      bottom: makeSound(0.3, (out) => {
        const chug = new Tone.Gain(0).connect(out);
        const filter = new Tone.Filter({ type: 'lowpass', frequency: 420, Q: 3 });
        filter.connect(chug);
        const engine1 = new Tone.Oscillator(55, 'sawtooth');
        const engine2 = new Tone.Oscillator(82.5, 'square');
        const eGain = new Tone.Gain(0.25);
        engine1.connect(eGain); engine2.connect(eGain); eGain.connect(filter);
        const grind = new Tone.Noise('brown');
        const grindFilter = new Tone.Filter({ type: 'bandpass', frequency: 300, Q: 1 });
        grind.chain(grindFilter, filter);
        const chugLfo = lfo(7, 0.45, 1);
        const filterLfo = lfo(0.15, 260, 620);
        chugLfo.connect(chug.gain);
        filterLfo.connect(filter.frequency);
        return { sources: [engine1, engine2, grind, chugLfo, filterLfo] };
      }),
    },

    {

      top: makeSound(1.26, (out) => {
        const chime = new Tone.FMSynth({
          harmonicity: 3, modulationIndex: 2,
          envelope: { attack: 0.005, decay: 0.6, sustain: 0.1, release: 0.8 },
          modulationEnvelope: { attack: 0.005, decay: 0.3, sustain: 0, release: 0.4 },
        });
        const speaker = new Tone.Filter({ type: 'bandpass', frequency: 1100, Q: 0.9 });
        const crunch = new Tone.Distortion({ distortion: 0.3, wet: 0.4 });
        const distance = new Tone.FeedbackDelay({ delayTime: 0.27, feedback: 0.45, wet: 0.4 });
        chime.chain(speaker, crunch, distance, out);
        const melodies = [['E5', 'C5', 'G4'], ['G4', 'C5', 'E5'], ['C5', 'E5', 'G5']];
        return {
          synths: [chime],
          every: '2m',
          play(time) {
            pickOne(melodies).forEach((note, k) => {
              chime.triggerAttackRelease(note, 0.35, time + k * seconds('4n'), 0.8);
            });
          },
        };
      }),

      bottom: makeSound(0.09, (out) => {
        const osc = new Tone.Oscillator(800, 'square');
        const filter = new Tone.Filter(1800, 'lowpass');
        osc.chain(filter, out);
        const wail = lfo(0.45, 620, 1250);
        wail.connect(osc.frequency);
        return { sources: [osc, wail] };
      }),
    },

    {

      top: makeSound(0.5, (out) => {
        const bird = new Tone.Synth({
          oscillator: { type: 'sine' },
          envelope: { attack: 0.004, decay: 0.04, sustain: 0.5, release: 0.03 },
        });
        const pan = new Tone.Panner(0.3);
        bird.chain(pan, out);
        return {
          synths: [bird],
          every: '2n',
          play(time) {
            if (Math.random() > 0.75) return;
            pan.pan.setValueAtTime(rand(-0.6, 0.6), time);
            const base = rand(2800, 4200);
            const count = 3 + Math.floor(Math.random() * 4);
            for (let k = 0; k < count; k++) {
              const t = time + k * 0.075;
              const f = base * rand(0.85, 1.15);
              bird.triggerAttack(f, t, rand(0.5, 1));
              bird.frequency.exponentialRampToValueAtTime(f * 1.35, t + 0.045);
              bird.triggerRelease(t + 0.05);
            }
          },
        };
      }),

      bottom: makeSound(0.67, (out) => {
        const gull = new Tone.Synth({
          oscillator: { type: 'sawtooth' },
          envelope: { attack: 0.05, decay: 0.1, sustain: 0.8, release: 0.25 },
        });
        const vibrato = new Tone.Vibrato({ frequency: 7, depth: 0.12 });
        const beak = new Tone.Filter({ type: 'bandpass', frequency: 1500, Q: 1.5 });
        const far = new Tone.FeedbackDelay({ delayTime: 0.31, feedback: 0.25, wet: 0.25 });
        gull.chain(vibrato, beak, far, out);
        return {
          synths: [gull],
          every: '2m',
          play(time) {
            if (Math.random() > 0.85) return;
            const calls = 2 + Math.floor(Math.random() * 2);
            for (let k = 0; k < calls; k++) {
              const t = time + k * 0.75;
              const f = rand(1400, 1700);
              gull.triggerAttack(f * 0.8, t, 0.9);
              gull.frequency.exponentialRampToValueAtTime(f, t + 0.12);
              gull.frequency.exponentialRampToValueAtTime(f * 0.62, t + 0.55);
              gull.triggerRelease(t + 0.5);
            }
          },
        };
      }),
    },

    {

      top: makeSound(0.46, (out) => {
        const drop = new Tone.Synth({
          oscillator: { type: 'sine' },
          envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.02 },
        });
        const tick = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.012, sustain: 0 } });
        const tickFilter = new Tone.Filter(3500, 'highpass');
        const tickGain = new Tone.Gain(0.25);
        drop.connect(out);
        tick.chain(tickFilter, tickGain, out);
        return {
          synths: [drop, tick],
          every: '16n',
          play(time) {
            if (Math.random() > 0.35) return;
            const t = time + rand(0, seconds('16n') * 0.6);
            const f = rand(900, 2500);
            drop.triggerAttackRelease(f, 0.05, t, rand(0.4, 1));
            drop.frequency.exponentialRampToValueAtTime(f * 1.9, t + 0.03);
            tick.triggerAttackRelease(0.01, t, 0.7);
          },
        };
      }),

      bottom: makeSound(0.33, (out) => {
        const hiss = new Tone.Noise('white');
        const band = new Tone.Filter(500, 'highpass');
        const top = new Tone.Filter(7000, 'lowpass');
        const hissGain = new Tone.Gain(0.55);
        hiss.chain(band, top, hissGain, out);
        const body = new Tone.Noise('pink');
        const bodyFilter = new Tone.Filter(1200, 'lowpass');
        const bodyGain = new Tone.Gain(0.6);
        body.chain(bodyFilter, bodyGain, out);
        return { sources: [hiss, body] };
      }),
    },

    {

      top: makeSound(1.5, (out) => {
        const noise = new Tone.Noise('pink');
        const band = new Tone.Filter({ type: 'bandpass', frequency: 500, Q: 0.8 });
        const amp = new Tone.Gain(0);
        const soft = new Tone.Filter(1500, 'lowpass');
        noise.chain(band, amp, soft, out);
        const drift = lfo(0.06, 300, 900);
        const breath = lfo(0.11, 0.25, 1);
        drift.connect(band.frequency); breath.connect(amp.gain);
        return { sources: [noise, drift, breath] };
      }),

      bottom: makeSound(1.5, (out) => {
        const gust = new Tone.Gain(0).connect(out);
        const whistleNoise = new Tone.Noise('white');
        const whistle = new Tone.Filter({ type: 'bandpass', frequency: 1200, Q: 14 });
        const whistleGain = new Tone.Gain(1.6);
        whistleNoise.chain(whistle, whistleGain, gust);
        const roarNoise = new Tone.Noise('pink');
        const roar = new Tone.Filter({ type: 'bandpass', frequency: 400, Q: 0.7 });
        const roarGain = new Tone.Gain(0.5);
        roarNoise.chain(roar, roarGain, gust);
        const pitch = lfo(0.17, 700, 2400);
        const strength = lfo(0.21, 0, 1);
        const gustShape = new Tone.Pow(3);
        pitch.connect(whistle.frequency); strength.chain(gustShape, gust.gain);
        return { sources: [whistleNoise, roarNoise, pitch, strength] };
      }),
    },

    {

      top: makeSound(0.4, (out) => {
        const rustle = new Tone.NoiseSynth({
          noise: { type: 'white' },
          envelope: { attack: 0.12, decay: 0.3, sustain: 0.2, release: 0.35 },
        });
        const high = new Tone.Filter(2200, 'highpass');
        const air = new Tone.Filter(9000, 'lowpass');
        rustle.chain(high, air, out);
        const bed = new Tone.Noise('pink');
        const bedFilter = new Tone.Filter(3000, 'highpass');
        const bedGain = new Tone.Gain(0);
        bed.chain(bedFilter, bedGain, out);
        const bedLfo = lfo(0.3, 0.03, 0.15);
        bedLfo.connect(bedGain.gain);
        return {
          sources: [bed, bedLfo],
          synths: [rustle],
          every: '4n',
          play(time) {
            if (Math.random() > 0.7) return;
            rustle.triggerAttackRelease(rand(0.15, 0.5), time + rand(0, 0.15), rand(0.4, 1));
          },
        };
      }),

      bottom: makeSound(1.3, (out) => {
        const crack = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.0005, decay: 0.008, sustain: 0 } });
        const crackFilter = new Tone.Filter({ type: 'bandpass', frequency: 2600, Q: 1.5 });
        crack.chain(crackFilter, out);
        const snap = new Tone.NoiseSynth({ noise: { type: 'brown' }, envelope: { attack: 0.001, decay: 0.045, sustain: 0 } });
        const snapFilter = new Tone.Filter(1800, 'lowpass');
        snap.chain(snapFilter, out);
        return {
          synths: [crack, snap],
          every: '2n',
          play(time) {
            if (Math.random() > 0.65) return;
            const start = time + rand(0, 0.1);
            snap.triggerAttackRelease(0.03, start, rand(0.5, 1));
            const clicks = 7 + Math.floor(Math.random() * 8);
            let t = start;
            for (let k = 0; k < clicks; k++) {
              t += rand(0.012, 0.035);
              crack.triggerAttackRelease(0.004, t, rand(0.3, 1));
            }
          },
        };
      }),
    },

    {

      top: makeSound(0.37, (out) => {
        const bed = new Tone.Noise('pink');
        const bedFilter = new Tone.Filter({ type: 'bandpass', frequency: 700, Q: 0.6 });
        const bedGain = new Tone.Gain(0.35);
        bed.chain(bedFilter, bedGain, out);
        const bedLfo = lfo(0.2, 500, 1000);
        bedLfo.connect(bedFilter.frequency);

        const bubbles = [0, 1].map(() => {
          const synth = new Tone.Synth({
            oscillator: { type: 'sine' },
            envelope: { attack: 0.002, decay: 0.035, sustain: 0, release: 0.01 },
          });
          synth.connect(out);
          return synth;
        });
        return {
          sources: [bed, bedLfo],
          synths: bubbles,
          every: '32n',
          play(time) {
            const window = seconds('32n') * 0.8;
            bubbles.forEach((synth) => {
              if (Math.random() > 0.7) return;
              const t = time + rand(0, window);
              const f = rand(350, 1250);
              synth.triggerAttackRelease(f, 0.03, t, rand(0.3, 0.8));
              synth.frequency.exponentialRampToValueAtTime(f * 1.6, t + 0.025);
            });
          },
        };
      }),

      bottom: makeSound(0.58, (out) => {
        const splash = new Tone.NoiseSynth({
          noise: { type: 'white' },
          envelope: { attack: 0.004, decay: 0.3, sustain: 0, release: 0.1 },
        });
        const splashFilter = new Tone.Filter(3000, 'lowpass');
        splash.chain(splashFilter, out);
        const plop = new Tone.Synth({
          oscillator: { type: 'sine' },
          envelope: { attack: 0.002, decay: 0.12, sustain: 0, release: 0.02 },
        });
        plop.connect(out);
        return {
          synths: [splash, plop],
          every: '1m',
          play(time) {
            if (Math.random() > 0.85) return;
            const t = time + rand(0, seconds('2n'));
            splashFilter.frequency.setValueAtTime(4500, t);
            splashFilter.frequency.exponentialRampToValueAtTime(500, t + 0.35);
            splash.triggerAttackRelease(0.25, t, 0.9);
            plop.triggerAttackRelease(320, 0.1, t + 0.01, 0.8);
            plop.frequency.exponentialRampToValueAtTime(130, t + 0.11);
            splash.triggerAttackRelease(0.12, t + 0.2, 0.4);
          },
        };
      }),
    },
  ].map((pair) => ({ ...pair, side: 0 }));
}

export function updateAmbience(index) {
  if (!ready) return;
  const pair = ambience[index];
  const gains = pairToGains(state.ambience[index]);
  const now = Tone.now();
  const fade = effectParams(state.fx).pairFade;
  const switching = pair.side !== 0 && gains.side !== 0 && pair.side !== gains.side;
  const startNew = switching ? now + fade : now;

  [['top', gains.top], ['bottom', gains.bottom]].forEach(([key, value]) => {
    const sound = pair[key];
    const target = value * sound.level;
    const param = sound.out.gain;
    param.cancelAndHoldAtTime(now);
    if (target === 0) {
      param.linearRampToValueAtTime(0, now + fade);
    } else {
      param.setValueAtTime(param.getValueAtTime(now), startNew);
      param.linearRampToValueAtTime(target, startNew + fade);
    }
    sound.active = target > 0;
  });
  pair.side = gains.side;
}

function createDrums() {
  const bus = drumsBus;
  const kick = new Tone.MembraneSynth({
    pitchDecay: 0.03, octaves: 6,
    envelope: { attack: 0.001, decay: 0.35, sustain: 0, release: 0.05 },
  }).connect(bus);

  const snareNoise = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.14, sustain: 0 } });
  const snareFilter = new Tone.Filter(1200, 'highpass');
  const snareGain = new Tone.Gain(0.6);
  snareNoise.chain(snareFilter, snareGain, bus);
  const snareBody = new Tone.MembraneSynth({ pitchDecay: 0.01, octaves: 1.5, envelope: { decay: 0.08, sustain: 0 } });
  const snareBodyGain = new Tone.Gain(0.5);
  snareBody.chain(snareBodyGain, bus);

  const clap = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.12, sustain: 0 } });
  const clapFilter = new Tone.Filter({ type: 'bandpass', frequency: 1300, Q: 0.8 });
  const clapGain = new Tone.Gain(0.9);
  clap.chain(clapFilter, clapGain, bus);

  const hat = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.035, sustain: 0 } });
  const hatFilter = new Tone.Filter(7500, 'highpass');
  const hatGain = new Tone.Gain(0.35);
  hat.chain(hatFilter, hatGain, bus);

  const open = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.002, decay: 0.28, sustain: 0 } });
  const openFilter = new Tone.Filter(6000, 'highpass');
  const openGain = new Tone.Gain(0.3);
  open.chain(openFilter, openGain, bus);

  const click = new Tone.MembraneSynth({ pitchDecay: 0.004, octaves: 1, envelope: { attack: 0.001, decay: 0.03, sustain: 0 } });
  const clickGain = new Tone.Gain(0.45);
  click.chain(clickGain, bus);

  const play = {
    kick: (t, v) => kick.triggerAttackRelease('C1', 0.2, t, v),
    snare: (t, v) => { snareNoise.triggerAttackRelease(0.1, t, v); snareBody.triggerAttackRelease(190, 0.06, t, v); },

    clap: (t, v) => { [0, 0.011, 0.022].forEach((d) => clap.triggerAttackRelease(0.08, t + d, v)); },
    hat: (t, v) => hat.triggerAttackRelease(0.03, t, v),
    open: (t, v) => open.triggerAttackRelease(0.2, t, v),
    click: (t, v) => click.triggerAttackRelease('G5', 0.02, t, v),
  };
  const synths = [kick, snareNoise, snareBody, clap, hat, open, click];
  synths.forEach((synth) => registerEnvelope(synth, 'drum'));
  return { play, synths };
}

function scheduleDrums() {

  transport.scheduleRepeat((time) => {
    const step = stepAt(time, '16n', 16);
    hitsAtStep(state.drums.preset, state.drums.density, step).forEach((hit) => {
      drums.play[hit.instrument](time, hit.velocity);
    });
  }, '16n', 0);
}

export function updateDrums() {
  if (!ready) return;
  const v = state.drums.volume;
  drumsBus.gain.rampTo(v * v * 0.55, SMOOTH);
}

export function updateTempo() {
  if (!ready) return;
  transport.bpm.value = state.tempo;

  fx.echo.delayTime.rampTo(seconds('8n.'), 0.1);
}

export function updateMaster() {
  if (!ready) return;
  const v = state.masterVolume;
  master.gain.rampTo(v * v, SMOOTH);
}

export function updateAll() {
  if (!ready) return;
  updateTempo();
  updateMaster();
  updateDrums();
  updateEffects();
  VOICE_IDS.forEach(updateVoice);
  state.ambience.forEach((_, i) => updateAmbience(i));
}

export function play() {
  if (!ready || playing) return;
  playing = true;
  cancelPendingPause();
  recorder.start();
  const now = Tone.now();
  if (transport.state !== 'started') transport.start(now + 0.05);
  fader.gain.cancelAndHoldAtTime(now);
  fader.gain.linearRampToValueAtTime(1, now + 0.12);
}

let pausePromise = null;
export function pause() {
  if (!ready) return Promise.resolve();
  if (!playing) return pausePromise || Promise.resolve();
  playing = false;
  const now = Tone.now();
  fader.gain.cancelAndHoldAtTime(now);
  fader.gain.linearRampToValueAtTime(0, now + 0.3);
  pausePromise = new Promise((resolve) => {
    pauseResolvers.push(resolve);
    pauseTimer = setTimeout(async () => {
      pauseTimer = null;
      transport.pause();
      releaseEverything();
      await recorder.stop();
      finishPause();
    }, 360);
  });
  return pausePromise;
}

function cancelPendingPause() {
  if (pauseTimer) {
    clearTimeout(pauseTimer);
    pauseTimer = null;
    finishPause();
  }
}

function finishPause() {
  pauseResolvers.forEach((resolve) => resolve());
  pauseResolvers = [];
  pausePromise = null;
}

export async function stopAndClear() {
  if (!ready) return;
  cancelPendingPause();
  playing = false;
  const now = Tone.now();
  fader.gain.cancelAndHoldAtTime(now);
  fader.gain.linearRampToValueAtTime(0, now + 0.08);
  await new Promise((resolve) => setTimeout(resolve, 120));
  transport.stop();
  transport.position = 0;
  releaseEverything();
  if (recorder.isCapturing) await recorder.stop();
  recorder.clear();
}

function releaseEverything() {
  const now = Tone.now();
  VOICE_IDS.forEach((id) => voices[id].synth.triggerRelease(now));
  ambience.forEach((pair) => [pair.top, pair.bottom].forEach((sound) => {
    sound.synths.forEach((synth) => {
      if (synth.releaseAll) synth.releaseAll(now);
      else if (synth.triggerRelease) synth.triggerRelease(now);
    });
  }));
}

const BANDS = [[40, 200], [200, 500], [500, 1200], [1200, 3000], [3000, 6500], [6500, 14000]];
export function getBandLevels() {
  if (!ready) return BANDS.map(() => 0);
  const values = fft.getValue();
  const binWidth = Tone.getContext().sampleRate / 2 / values.length;
  return BANDS.map(([lo, hi]) => {
    let max = -Infinity;
    for (let i = Math.floor(lo / binWidth); i <= Math.min(values.length - 1, Math.ceil(hi / binWidth)); i++) {
      if (values[i] > max) max = values[i];
    }
    return Math.max(0, Math.min(1, (max + 80) / 62));
  });
}

export function debugNodes() {
  return { voices, ambience, drumsBus, voicesBus, ambienceBus, mixBus, fx, master, fader, limiter, transport, envelopeTargets };
}
