// controls.js — элементы управления: ползунки, крутилки, переключатели.
// Каждая функция создаёт элемент и возвращает { el, set(value) }.
// set() меняет только внешний вид (без вызова onInput) — так интерфейс
// можно обновить после сброса или загрузки ссылки.

const ICONS = 'assets/icons/icons.svg';

export function icon(name, className = 'icon') {
  return `<svg class="${className}" aria-hidden="true" focusable="false"><use href="${ICONS}#i-${name}"/></svg>`;
}

/* ---------- Всплывающее значение параметра ---------- */
const readout = document.getElementById('readout');
let readoutTimer = null;

export function showReadout(target, text) {
  const box = target.getBoundingClientRect();
  readout.textContent = text;
  readout.style.left = `${box.left + box.width / 2}px`;
  readout.style.top = `${Math.max(28, box.top - 8)}px`;
  readout.classList.add('is-visible');
  clearTimeout(readoutTimer);
  readoutTimer = setTimeout(() => readout.classList.remove('is-visible'), 1100);
}

/* ---------- Ползунок ----------
   Основан на <input type="range">: мышь, касание и клавиатура работают «из коробки».
   options: { min, max, step, value, label, orientation, length, format, onInput, defaultValue } */
export function createFader(options) {
  const {
    min = 0, max = 1, step = 0.01, value = 0, label,
    orientation = 'vertical', length, format = (v) => String(v),
    onInput = () => {}, defaultValue,
  } = options;

  const input = document.createElement('input');
  input.type = 'range';
  input.className = `fader fader--${orientation}`;
  input.min = min;
  input.max = max;
  input.step = step;
  input.value = value;
  input.setAttribute('aria-label', label);
  input.title = label;
  if (length && orientation === 'vertical') input.style.height = `calc(${length} * var(--u))`;

  const describe = () => {
    const text = format(Number(input.value));
    input.setAttribute('aria-valuetext', text);
    return text;
  };
  describe();

  input.addEventListener('input', () => {
    const v = Number(input.value);
    onInput(v);
    showReadout(input, `${label}: ${describe()}`);
  });

  // Двойное нажатие — вернуть значение по умолчанию.
  if (defaultValue !== undefined) {
    input.addEventListener('dblclick', () => {
      input.value = defaultValue;
      input.dispatchEvent(new Event('input'));
    });
  }

  return {
    el: input,
    set(v) { input.value = v; describe(); },
  };
}

/* ---------- Парный ползунок среды ----------
   Значение -1…1: центр — тишина, вверх — верхний звук, вниз — нижний.
   Рядом с центром — «липкая» зона: отпущенный там ползунок встаёт ровно в центр.
   Двойное нажатие возвращает в центр. */
export function createPairSlider({ label, value = 0, deadZone, describe, onInput }) {
  const wrap = document.createElement('div');
  wrap.className = 'pair__track';
  const input = document.createElement('input');
  input.type = 'range';
  input.className = 'fader fader--pair';
  input.min = -100;
  input.max = 100;
  input.step = 1;
  input.setAttribute('aria-label', label);
  input.title = `${label} (двойное нажатие — в центр)`;
  wrap.append(input);

  const paint = (v) => {
    // Подсветка от центра (50 %) до положения ручки
    const pos = 50 + v * 50;
    input.style.setProperty('--from', `${Math.min(50, pos)}%`);
    input.style.setProperty('--to', `${Math.max(50, pos)}%`);
    input.setAttribute('aria-valuetext', describe(v));
  };

  const set = (v) => {
    input.value = Math.round(v * 100);
    paint(v);
  };

  const commit = (v) => {
    set(v);
    onInput(v);
    showReadout(input, describe(v));
  };

  input.addEventListener('input', () => commit(Number(input.value) / 100));
  input.addEventListener('change', () => {
    const v = Number(input.value) / 100;
    if (v !== 0 && Math.abs(v) <= deadZone) commit(0);
  });
  input.addEventListener('dblclick', () => commit(0));

  set(value);
  return { el: wrap, input, set };
}

/* ---------- Крутилка ----------
   Перетаскивание вверх/вправо — больше, вниз/влево — меньше.
   Колесо мыши, стрелки, PageUp/PageDown, Home/End; двойное нажатие — по умолчанию.
   Значение всегда 0…1; format превращает его в подпись. */
export function createKnob({ label, value = 0, defaultValue = 0, big = false, format, onInput, marks = [] }) {
  const wrap = document.createElement('div');
  wrap.className = 'knob-wrap';
  const knob = document.createElement('div');
  knob.className = big ? 'knob knob--big' : 'knob';
  knob.tabIndex = 0;
  knob.setAttribute('role', 'slider');
  knob.setAttribute('aria-label', label);
  knob.setAttribute('aria-valuemin', '0');
  knob.setAttribute('aria-valuemax', '100');
  knob.title = `${label} (двойное нажатие — по умолчанию)`;
  knob.innerHTML = `${tickRing(big, marks)}<div class="knob__cap"><span class="knob__pointer"></span></div>`;
  wrap.append(knob);
  if (!big) {
    const caption = document.createElement('span');
    caption.className = 'knob__label';
    caption.textContent = label;
    caption.setAttribute('aria-hidden', 'true');
    wrap.append(caption);
  }

  let current = value;
  const set = (v) => {
    current = Math.min(1, Math.max(0, v));
    knob.style.setProperty('--angle', `${-135 + current * 270}deg`);
    knob.setAttribute('aria-valuenow', String(Math.round(current * 100)));
    knob.setAttribute('aria-valuetext', format(current));
  };
  const change = (v) => {
    const before = current;
    set(v);
    if (current !== before) onInput(current);
    showReadout(knob, `${label}: ${format(current)}`);
  };

  // Перетаскивание (мышь и касание через Pointer Events)
  let start = null;
  knob.addEventListener('pointerdown', (e) => {
    knob.setPointerCapture(e.pointerId);
    start = { x: e.clientX, y: e.clientY, value: current };
    e.preventDefault();
    knob.focus();
  });
  knob.addEventListener('pointermove', (e) => {
    if (!start) return;
    const delta = (start.y - e.clientY + (e.clientX - start.x)) / 220;
    change(start.value + delta);
  });
  const stop = () => { start = null; };
  knob.addEventListener('pointerup', stop);
  knob.addEventListener('pointercancel', stop);

  knob.addEventListener('wheel', (e) => {
    e.preventDefault();
    change(current + (e.deltaY < 0 ? 0.03 : -0.03));
  }, { passive: false });

  knob.addEventListener('keydown', (e) => {
    const steps = { ArrowUp: 0.02, ArrowRight: 0.02, ArrowDown: -0.02, ArrowLeft: -0.02, PageUp: 0.1, PageDown: -0.1 };
    if (e.key in steps) change(current + steps[e.key]);
    else if (e.key === 'Home') change(0);
    else if (e.key === 'End') change(1);
    else return;
    e.preventDefault();
  });

  knob.addEventListener('dblclick', () => change(defaultValue));

  set(value);
  return { el: wrap, set };
}

// Кольцо рисок вокруг крутилки (SVG). Для большой крутилки — длинные метки и иконки.
function tickRing(big, marks) {
  const r1 = big ? 104 : 74;     // внутренний радиус рисок (в координатах viewBox)
  const r2 = big ? 118 : 84;     // внешний
  const view = big ? 125 : 86;
  let lines = '';
  for (let a = -140; a <= 140; a += big ? 2.5 : 3) {
    lines += line(a, r1, r2, 0.9);
  }
  let extra = '';
  marks.forEach(({ angle, icon: name }) => {
    extra += line(angle, 122, 150, 2.6);
    const p = polar(angle, 172);
    extra += `<use href="${ICONS}#i-${name}" x="${p.x - 13}" y="${p.y - 13}" width="26" height="26"/>`;
  });
  return `<svg class="knob__ticks" viewBox="${-view} ${-view} ${view * 2} ${view * 2}" aria-hidden="true">
    <g stroke="currentColor" stroke-linecap="round" opacity="0.75">${lines}</g>
    <g stroke="currentColor" stroke-linecap="round">${extra}</g></svg>`;
}

function polar(angle, r) {
  const rad = (angle - 90) * Math.PI / 180;
  return { x: Math.cos(rad) * r, y: Math.sin(rad) * r };
}

function line(angle, r1, r2, width) {
  const a = polar(angle, r1);
  const b = polar(angle, r2);
  return `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke-width="${width}"/>`;
}

/* ---------- Сегментированный переключатель (radiogroup) ----------
   items: [{ value, label, html }] — html содержимое кнопки (иконка или текст). */
export function createSegmented(container, items, value, onChange, buttonClass = 'segmented__btn') {
  const buttons = items.map((item) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = buttonClass;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', item.label);
    b.title = item.label;
    b.dataset.value = String(item.value);
    b.innerHTML = item.html;
    b.addEventListener('click', () => { set(item.value); onChange(item.value); });
    container.append(b);
    return b;
  });

  // Стрелки влево/вправо переключают варианты (как у радиокнопок)
  container.addEventListener('keydown', (e) => {
    const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!dir) return;
    const index = buttons.findIndex((b) => b.getAttribute('aria-checked') === 'true');
    const next = items[(index + dir + items.length) % items.length];
    set(next.value);
    onChange(next.value);
    buttons[items.indexOf(next)].focus();
    e.preventDefault();
  });

  function set(v) {
    buttons.forEach((b) => {
      const on = b.dataset.value === String(v);
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
  }
  set(value);
  return { set };
}
