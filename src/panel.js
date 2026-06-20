/**
 * Build-stack panel: toggle each layer of the background on/off, or step through
 * them one at a time to see how the scene is assembled.
 *
 * Each layer is { id, label, on(), off() }. The panel tracks enabled state and
 * calls on()/off() on change.
 */
export class Panel {
  constructor(layers) {
    this.layers = layers.map((l) => ({ ...l, enabled: true }));
    this._build();
  }

  _build() {
    const root = document.createElement('div');
    root.className = 'panel';
    root.innerHTML = `
      <div class="panel__head">BUILD STACK</div>
      <div class="panel__btns">
        <button id="pNext">▶ NEXT</button>
        <button id="pReset">⟲ RESET</button>
        <button id="pAll">ALL</button>
      </div>
      <div class="panel__list"></div>
      <div class="panel__hint">RESET → bare terrain · NEXT → add one layer</div>`;
    document.body.appendChild(root);

    const list = root.querySelector('.panel__list');
    this.rows = this.layers.map((l, i) => {
      const row = document.createElement('label');
      row.className = 'panel__row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = l.enabled;
      cb.addEventListener('change', () => this.set(i, cb.checked));
      const span = document.createElement('span');
      span.textContent = `${String(l.id).padStart(2, '0')}  ${l.label}`;
      row.append(cb, span);
      list.appendChild(row);
      return { row, cb };
    });

    root.querySelector('#pNext').addEventListener('click', () => this.next());
    root.querySelector('#pReset').addEventListener('click', () => this.reset());
    root.querySelector('#pAll').addEventListener('click', () => this.all());
  }

  set(i, on) {
    const l = this.layers[i];
    if (l.enabled === on) {
      this.rows[i].cb.checked = on;
      return;
    }
    l.enabled = on;
    this.rows[i].cb.checked = on;
    this.rows[i].row.classList.toggle('off', !on);
    on ? l.on() : l.off();
  }

  next() {
    const i = this.layers.findIndex((l) => !l.enabled);
    if (i >= 0) this.set(i, true);
  }

  reset() {
    // keep only the first layer (bare terrain)
    this.layers.forEach((_, i) => this.set(i, i === 0));
  }

  all() {
    this.layers.forEach((_, i) => this.set(i, true));
  }
}
