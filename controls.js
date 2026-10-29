const ICONS = 'assets/icons/icons.svg';

export const AUTHOR_ICONS = [
  'building', 'tulip', 'play', 'download', 'share', 'reset', 'sun', 'cloud-moon',
  'car', 'car-horn', 'person', 'people', 'metro', 'train', 'hammer', 'gear', 'megaphone', 'siren',
  'bird', 'gull', 'droplet', 'rain', 'wind', 'cloud-wind', 'leaf', 'leaves', 'stream', 'splash',
];

export function icon(name, className = 'icon') {
  if (AUTHOR_ICONS.includes(name)) {

    return `<img class="${className} icon-img" src="assets/icons/${name}.png" alt="" aria-hidden="true" draggable="false">`;
  }
  return `<svg class="${className}" aria-hidden="true" focusable="false"><use href="${ICONS}#i-${name}"/></svg>`;
}

export function maskIcon(name, className = 'icon') {

  const url = `url('assets/icons/${name}.png')`;
  return `<span class="${className} icon-mask" style="-webkit-mask-image: ${url}; mask-image: ${url}" aria-hidden="true"></span>`;
}

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

export function createPairToggle({ label, value = 0, describe, onInput }) {
  const wrap = document.createElement('div');
  wrap.className = 'pair__track';
  const input = document.createElement('input');
  input.type = 'range';
  input.className = 'fader fader--pair';
  input.min = -1;
  input.max = 1;
  input.step = 1;
  input.setAttribute('aria-label', label);
  input.title = label;
  wrap.append(input);

  let current = 0;
  const set = (v) => {
    current = v;
    input.value = v;
    wrap.dataset.position = v === 1 ? 'top' : v === -1 ? 'bottom' : 'center';
    input.setAttribute('aria-valuetext', describe(v));
  };

  input.addEventListener('input', () => {
    const v = Number(input.value);
    if (v === current) return;
    set(v);
    onInput(v);
    showReadout(input, describe(v));
  });

  set(value);
  return { el: wrap, input, set };
}

export function createKnob({ label, value = 0, defaultValue = 0, big = false, format, onInput, marks = [], hint }) {
  const wrap = document.createElement('div');
  wrap.className = 'knob-wrap';
  const knob = document.createElement('div');
  knob.className = big ? 'knob knob--big' : 'knob';
  knob.tabIndex = 0;
  knob.setAttribute('role', 'slider');
  knob.setAttribute('aria-label', label);
  knob.setAttribute('aria-valuemin', '0');
  knob.setAttribute('aria-valuemax', '100');
  knob.title = `${hint || label} (двойное нажатие — по умолчанию)`;
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

function tickRing(big, marks) {
  const r1 = big ? 104 : 74;
  const r2 = big ? 118 : 84;
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

export function createSegmented(container, items, value, onChange, buttonClass = 'segmented__btn', noneValue) {
  const buttons = items.map((item) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = buttonClass;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', item.label);
    b.title = item.label;
    b.dataset.value = String(item.value);
    b.innerHTML = item.html;
    b.addEventListener('click', () => {
      const next = noneValue !== undefined && b.getAttribute('aria-checked') === 'true' ? noneValue : item.value;
      set(next);
      onChange(next);
    });
    container.append(b);
    return b;
  });

  container.addEventListener('keydown', (e) => {
    const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!dir) return;
    const index = buttons.findIndex((b) => b.getAttribute('aria-checked') === 'true');
    const from = index === -1 ? (dir > 0 ? -1 : 0) : index;
    const next = items[(from + dir + items.length) % items.length];
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

    if (!buttons.some((b) => b.tabIndex === 0)) buttons[0].tabIndex = 0;
  }
  set(value);
  return { set };
}
