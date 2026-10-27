// Перемещение только за ручку: ползунок и кнопка ноты работают независимо.
export function setupNoteReorder(box, { getOrder, onChange, announce }) {
  let drag = null;
  const rows = () => [...box.querySelectorAll('.note')];
  const marker = document.createElement('div');
  marker.className = 'notes__insert';
  marker.setAttribute('aria-hidden', 'true');

  function targetAt(y) {
    const others = rows().filter((row) => row !== drag.row);
    const index = others.findIndex((row) => {
      const rect = row.getBoundingClientRect();
      return y < rect.top + rect.height / 2;
    });
    return index < 0 ? others.length : index;
  }

  function finish(commit) {
    if (!drag) return;
    const { row, handle, pointerId, target, active } = drag;
    drag = null;
    row.classList.remove('is-dragging');
    box.classList.remove('is-reordering');
    marker.remove();
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    if (commit && active) {
      const note = Number(row.dataset.note);
      const order = getOrder().filter((n) => n !== note);
      order.splice(target, 0, note);
      onChange(order);
      announce(row.querySelector('.note__label').textContent, target + 1);
      handle.focus({ preventScroll: true });
    }
  }

  box.addEventListener('pointerdown', (event) => {
    const handle = event.target.closest('.note__handle');
    if (!handle || !event.isPrimary || event.button !== 0 || drag) return;
    const row = handle.closest('.note');
    drag = { row, handle, pointerId: event.pointerId, startY: event.clientY,
      target: getOrder().indexOf(Number(row.dataset.note)), active: false };
    handle.setPointerCapture(event.pointerId);
    handle.focus({ preventScroll: true });
    event.preventDefault();
  });

  box.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.active && Math.abs(event.clientY - drag.startY) < 4) return;
    drag.active = true;
    drag.row.classList.add('is-dragging');
    box.classList.add('is-reordering');
    drag.target = targetAt(event.clientY);
    const others = rows().filter((row) => row !== drag.row);
    const next = others[drag.target];
    const bounds = box.getBoundingClientRect();
    const y = next ? next.getBoundingClientRect().top : others.at(-1).getBoundingClientRect().bottom;
    marker.style.top = `${y - bounds.top}px`;
    box.append(marker);
    event.preventDefault();
  });
  box.addEventListener('pointerup', (event) => {
    if (drag && event.pointerId === drag.pointerId) finish(true);
  });
  box.addEventListener('pointercancel', () => finish(false));
  box.addEventListener('lostpointercapture', () => finish(false));
  window.addEventListener('blur', () => finish(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && drag) { event.preventDefault(); finish(false); }
  });
  box.addEventListener('keydown', (event) => {
    const handle = event.target.closest('.note__handle');
    if (!handle || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (drag) return;
    const row = handle.closest('.note');
    const note = Number(row.dataset.note);
    const order = [...getOrder()];
    const from = order.indexOf(note);
    const to = event.key === 'Home' ? 0 : event.key === 'End' ? order.length - 1 :
      Math.max(0, Math.min(order.length - 1, from + (event.key === 'ArrowUp' ? -1 : 1)));
    if (from === to) return;
    order.splice(from, 1);
    order.splice(to, 0, note);
    onChange(order);
    handle.focus({ preventScroll: true });
    announce(row.querySelector('.note__label').textContent, to + 1);
  });
}
