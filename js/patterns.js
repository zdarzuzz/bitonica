// patterns.js — ритмические рисунки пяти барабанных пресетов.
//
// Каждая строка — 16 шагов одного такта (шестнадцатые ноты).
//   "."   — пауза;
//   1…5   — удар, который звучит, начиная с этого уровня плотности.
// Плотность (большая крутилка) превращается в уровень 1…5:
// на уровне 1 остаётся только основа, на уровне 5 звучат все удары.
//
// Инструменты: kick — бочка, snare — малый барабан, clap — клэп,
// hat — закрытый хэт, open — открытый хэт, click — сухой щелчок.

export const DRUM_PRESETS = {
  1: {
    name: 'Двор',
    kick:  '1.........3.....',
    snare: '................',
    clap:  '............4...',
    hat:   '......4.......5.',
    open:  '................',
    click: '..2...1...5..3..',
  },
  2: {
    name: 'Шаг',
    kick:  '1.......1.....4.',
    snare: '....2.......2...',
    clap:  '................',
    hat:   '15351535153515..',
    open:  '..............3.',
    click: '......4.......5.',
  },
  3: {
    name: 'Поток',
    kick:  '1.....2...3.2...',
    snare: '....1.......1..3',
    clap:  '............5...',
    hat:   '1323132313231323',
    open:  '......4.......5.',
    click: '...4.......4....',
  },
  4: {
    name: 'Метро',
    kick:  '1..2..1..2..1.3.',
    snare: '....3.......3...',
    clap:  '..............5.',
    hat:   '3.4.3.4.3.4.3.4.',
    open:  '................',
    click: '..1...1...1...1.',
  },
  5: {
    name: 'Клуб',
    kick:  '1...1...1...1.5.',
    snare: '...............4',
    clap:  '....1.......1...',
    hat:   '3..53..53..53..5',
    open:  '..2...2...2...2.',
    click: '.....5.......5..',
  },
};

export const DRUM_INSTRUMENTS = ['kick', 'snare', 'clap', 'hat', 'open', 'click'];

// Плотность 0…1 → уровень 1…5.
export function densityToLevel(density) {
  const d = Math.min(1, Math.max(0, Number(density) || 0));
  return 1 + Math.round(d * 4);
}

// Какие инструменты звучат на шаге step (0…15) при выбранном пресете и плотности.
// Возвращает массив вида [{ instrument: 'kick', velocity: 0.9 }, …].
export function hitsAtStep(presetNumber, density, step) {
  const preset = DRUM_PRESETS[presetNumber] || DRUM_PRESETS[1];
  const level = densityToLevel(density);
  const hits = [];
  DRUM_INSTRUMENTS.forEach((instrument) => {
    const symbol = preset[instrument][step % 16];
    const need = Number(symbol);
    if (symbol !== '.' && need <= level) {
      // Основные удары громче, дополнительные (высокий уровень) — тише.
      hits.push({ instrument, velocity: 1 - (need - 1) * 0.13 });
    }
  });
  return hits;
}
