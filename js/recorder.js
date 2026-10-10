// recorder.js — запись итогового звука в настоящий WAV-файл.
//
// Почему не Tone.Recorder: он использует MediaRecorder, который пишет
// WebM/Ogg/MP4 (формат зависит от браузера), а в Tone.js 15.1.22 его
// продолжение после паузы ожидает событие "start", которое браузер при resume
// не присылает. Поэтому здесь маленький AudioWorklet (стандартный браузерный
// аудио-API): он получает те же сэмплы, что уходят в колонки, и передаёт их
// в основной поток. Пока инструмент на паузе, сэмплы не сохраняются —
// поэтому в файле нет длинных пауз. В конце сэмплы упаковываются в WAV
// (16 бит, стерео) — расширение .wav соответствует содержимому.

const PROCESSOR_NAME = 'bitonika-tap';
export const MAX_SECONDS = 10 * 60; // предел записи: 10 минут ≈ 110 МБ WAV

// Код процессора. Он выполняется в отдельном аудиопотоке браузера.
// Создаём его из строки (Blob URL), чтобы не было ещё одного файла.
const WORKLET_SOURCE = `
class BitonikaTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.size = 4096;                       // сколько кадров копить перед отправкой
    this.left = new Float32Array(this.size);
    this.right = new Float32Array(this.size);
    this.filled = 0;
    this.port.onmessage = (event) => {
      if (event.data === 'start') this.recording = true;
      if (event.data === 'stop') {
        this.recording = false;
        this.flush();
        this.port.postMessage({ type: 'stopped' });
      }
    };
  }
  flush() {
    if (this.filled === 0) return;
    const l = this.left.slice(0, this.filled);
    const r = this.right.slice(0, this.filled);
    this.port.postMessage({ type: 'data', left: l, right: r }, [l.buffer, r.buffer]);
    this.filled = 0;
  }
  process(inputs) {
    if (!this.recording) return true;
    const input = inputs[0] || [];
    const frames = input[0] ? input[0].length : 128;
    for (let i = 0; i < frames; i++) {
      this.left[this.filled] = input[0] ? input[0][i] : 0;
      this.right[this.filled] = input[1] ? input[1][i] : (input[0] ? input[0][i] : 0);
      this.filled++;
      if (this.filled === this.size) this.flush();
    }
    return true;
  }
}
registerProcessor('${PROCESSOR_NAME}', BitonikaTap);
`;

// Создаёт запись, подключённую к узлу source (итоговый выход инструмента).
export async function createRecorder(Tone, source) {
  const context = Tone.getContext();
  const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
  await context.addAudioWorkletModule(url);
  URL.revokeObjectURL(url);

  const node = context.createAudioWorkletNode(PROCESSOR_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
  });
  Tone.connect(source, node);
  // Узел должен быть подключён к выходу, иначе браузер может его не вызывать.
  // Gain(0) гарантирует, что звук не удвоится.
  const silent = new Tone.Gain(0).toDestination();
  Tone.connect(node, silent);

  const sampleRate = context.sampleRate;
  let chunks = [];        // массивы Int16Array (кадры L,R,L,R…)
  let frameCount = 0;
  let capturing = false;
  let stopWaiters = [];
  const listeners = { limit: null };

  node.port.onmessage = (event) => {
    const msg = event.data;
    if (msg.type === 'data') {
      if (frameCount >= MAX_SECONDS * sampleRate) return;
      chunks.push(floatToInt16(msg.left, msg.right));
      frameCount += msg.left.length;
      if (frameCount >= MAX_SECONDS * sampleRate && listeners.limit) listeners.limit();
    }
    if (msg.type === 'stopped') {
      stopWaiters.forEach((resolve) => resolve());
      stopWaiters = [];
    }
  };

  return {
    // Начать или продолжить запись.
    start() {
      if (capturing) return;
      capturing = true;
      node.port.postMessage('start');
    },
    // Приостановить запись. Промис выполняется, когда все сэмплы получены.
    stop() {
      return new Promise((resolve) => {
        stopWaiters.push(resolve);
        capturing = false;
        node.port.postMessage('stop');
      });
    },
    // Удалить накопленную запись (кнопка «Сброс»).
    clear() {
      chunks = [];
      frameCount = 0;
    },
    onLimit(callback) { listeners.limit = callback; },
    get seconds() { return frameCount / sampleRate; },
    get hasAudio() { return frameCount > 0; },
    get isCapturing() { return capturing; },
    toWavBlob() { return encodeWav(chunks, frameCount, sampleRate); },
  };
}

// Float32 (-1…1) → Int16, каналы чередуются: L R L R …
function floatToInt16(left, right) {
  const out = new Int16Array(left.length * 2);
  for (let i = 0; i < left.length; i++) {
    out[i * 2] = toInt16(left[i]);
    out[i * 2 + 1] = toInt16(right[i]);
  }
  return out;
}

function toInt16(x) {
  const s = Math.max(-1, Math.min(1, x));
  return s < 0 ? s * 0x8000 : s * 0x7fff;
}

// Стандартный 44-байтовый заголовок WAV (PCM, 16 бит, 2 канала) + данные.
export function encodeWav(chunks, frameCount, sampleRate) {
  const channels = 2;
  const bytesPerSample = 2;
  const dataSize = frameCount * channels * bytesPerSample;
  const header = new DataView(new ArrayBuffer(44));
  const writeText = (offset, text) => {
    for (let i = 0; i < text.length; i++) header.setUint8(offset + i, text.charCodeAt(i));
  };
  writeText(0, 'RIFF');
  header.setUint32(4, 36 + dataSize, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  header.setUint32(16, 16, true);                       // размер блока fmt
  header.setUint16(20, 1, true);                        // PCM
  header.setUint16(22, channels, true);
  header.setUint32(24, sampleRate, true);
  header.setUint32(28, sampleRate * channels * bytesPerSample, true);
  header.setUint16(32, channels * bytesPerSample, true);
  header.setUint16(34, 16, true);                       // бит на сэмпл
  writeText(36, 'data');
  header.setUint32(40, dataSize, true);
  return new Blob([header, ...chunks], { type: 'audio/wav' });
}
