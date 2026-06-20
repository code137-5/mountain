import { PROJECTS } from './projects.js';

/** Builds the project list, wires hover -> onHover(index), and the loader/enter flow. */
export class UI {
  constructor({ onHover, onLeave, onEnter }) {
    this.onHover = onHover;
    this.onLeave = onLeave;
    this.onEnter = onEnter;

    this.list = document.getElementById('projectList');
    this.loader = document.getElementById('loader');
    this.fill = document.getElementById('loaderFill');
    this.pct = document.getElementById('loaderPct');
    this.enter = document.getElementById('enter');

    this._buildList();
    this._wireEnter();
  }

  _buildList() {
    PROJECTS.forEach((p, i) => {
      const a = document.createElement('a');
      a.href = '#';
      a.textContent = p.name;
      a.addEventListener('mouseenter', () => {
        this.list.classList.add('dim');
        [...this.list.children].forEach((el) => el.classList.toggle('active', el === a));
        this.onHover(i);
      });
      a.addEventListener('click', (e) => e.preventDefault());
      this.list.appendChild(a);
    });
    this.list.addEventListener('mouseleave', () => {
      this.list.classList.remove('dim');
      [...this.list.children].forEach((el) => el.classList.remove('active'));
      this.onLeave?.();
    });
  }

  setProgress(p) {
    const v = Math.round(p * 100);
    this.fill.style.width = v + '%';
    this.pct.textContent = v;
  }

  ready() {
    this.enter.classList.remove('hidden');
  }

  _wireEnter() {
    this.enter.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sound = btn.dataset.sound === 'on';
        this.loader.classList.add('done');
        if (sound) startAmbient();
        this.onEnter?.(sound);
      });
    });
  }
}

/**
 * Self-contained ambient pad via WebAudio (no asset needed).
 * Swap for Howler + an mp3 to match the real site exactly:
 *   const howl = new Howl({ src: ['ambient.mp3'], loop: true, volume: 0.4 }); howl.play();
 */
function startAmbient() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const master = ctx.createGain();
    master.gain.value = 0.0;
    master.connect(ctx.destination);
    master.gain.linearRampToValueAtTime(0.16, ctx.currentTime + 4);

    [110, 164.81, 220].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = i === 0 ? 0.6 : 0.25;
      // slow detune wobble for movement
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + i * 0.03;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 2.5;
      lfo.connect(lfoGain).connect(osc.detune);
      osc.connect(g).connect(master);
      osc.start();
      lfo.start();
    });
  } catch (e) {
    /* audio not available */
  }
}
