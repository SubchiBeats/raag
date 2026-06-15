'use strict';
/* ==========================================================================
   Raag — Indian Instruments
   Everything is synthesised live with the Web Audio API (no audio files),
   so the app is fully offline-capable and tiny.
   ========================================================================== */

/* ---------- Just-intonation note ratios (relative to Sa) ---------- */
const RATIO = {
  S:1, r:16/15, R:9/8, g:6/5, G:5/4, m:4/3, M:45/32,
  P:3/2, d:8/5, D:5/3, n:9/5, N:15/8, "S'":2
};
const freqOf = (sa, note) => sa * RATIO[note];

/* ==========================================================================
   AUDIO ENGINE
   ========================================================================== */
const Sound = (() => {
  let ctx, master, comp, reverb, dry, droneBus, targetVol = 0.55, started = false;

  function ensure() {
    if (started) { if (ctx.state === 'suspended') ctx.resume(); return; }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = targetVol;
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 24; comp.ratio.value = 3;
    master.connect(comp).connect(ctx.destination);

    reverb = ctx.createConvolver(); reverb.buffer = makeIR(2.6, 2.4);
    const rg = ctx.createGain(); rg.gain.value = 0.9;
    reverb.connect(rg).connect(master);
    dry = ctx.createGain(); dry.connect(master);

    // dedicated drone bus so it can fade in/out smoothly
    droneBus = ctx.createGain(); droneBus.gain.value = 0; droneBus.connect(master);
    const dsend = ctx.createGain(); dsend.gain.value = 0.5; droneBus.connect(dsend); dsend.connect(reverb);

    // expose for voices
    Sound._reverb = reverb; Sound._dry = dry;
    started = true;
  }

  function setVolume(v) { targetVol = Math.max(0, Math.min(1, v)); if (started) master.gain.setTargetAtTime(targetVol, ctx.currentTime, 0.02); }

  function makeIR(dur, decay) {
    const rate = ctx.sampleRate, len = Math.floor(rate * dur);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++)
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  // route a voice node to dry + reverb send
  function out(node, send = 0.3) {
    node.connect(dry);
    if (send > 0) { const s = ctx.createGain(); s.gain.value = send; node.connect(s); s.connect(reverb); }
  }

  /* --- Karplus-Strong plucked string (sitar, tanpura, chikari) --- */
  function pluck(freq, { dur = 2.4, decay = 0.995, gain = 0.7, bright = 0.5, send = 0.4, dest = null } = {}) {
    ensure();
    const sr = ctx.sampleRate, len = Math.floor(sr * dur);
    const N = Math.max(2, Math.round(sr / freq));
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < N; i++) { const w = Math.random() * 2 - 1; last = bright * w + (1 - bright) * last; d[i] = last; }
    for (let i = N; i < len; i++) d[i] = (d[i - N] + d[i - N + 1]) * 0.5 * decay;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(g);
    if (dest) g.connect(dest); else out(g, send);
    src.start();
  }

  /* --- pitched membrane tone (tabla resonant / bass bols) --- */
  function tone(freq, { dur = 0.5, bend = 1, gain = 0.7, type = 'sine', send = 0.2 } = {}) {
    ensure();
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (bend !== 1) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * bend), t + dur * 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); out(g, send);
    o.start(t); o.stop(t + dur + 0.05);
  }

  /* --- noise burst (tabla slap / breath transients) --- */
  function noise(dur, { gain = 0.5, type = 'highpass', freq = 2000, q = 1, send = 0.1 } = {}) {
    ensure();
    const sr = ctx.sampleRate, len = Math.max(1, Math.floor(sr * dur));
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(f).connect(g); out(g, send);
    src.start();
  }

  /* --- sustained reed (harmonium): hold then release --- */
  function reed(freq, { gain = 0.18 } = {}) {
    ensure();
    const t = ctx.currentTime;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.05);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2400; f.Q.value = 0.7;
    const oscs = [];
    [[1, -7], [1, 7], [2, 0], [0.5, 0]].forEach(([mult, det]) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.value = freq * mult; o.detune.value = det; o.connect(f); o.start(); oscs.push(o);
    });
    f.connect(g); out(g, 0.18);
    return { stop() { const tt = ctx.currentTime; g.gain.cancelScheduledValues(tt); g.gain.setTargetAtTime(0, tt, 0.07); oscs.forEach(o => o.stop(tt + 0.4)); } };
  }

  /* --- sustained flute (bansuri): hold, glide, release --- */
  function flute(freq, { gain = 0.26 } = {}) {
    ensure();
    const t = ctx.currentTime;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.09);
    const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.setValueAtTime(freq, t);
    const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.setValueAtTime(freq, t);
    const og2 = ctx.createGain(); og2.gain.value = 0.25;
    // vibrato
    const lfo = ctx.createOscillator(); lfo.frequency.value = 5.2;
    const lg = ctx.createGain(); lg.gain.value = freq * 0.012;
    lfo.connect(lg); lg.connect(o1.frequency); lg.connect(o2.frequency); lfo.start();
    // breath
    const nb = ctx.createBufferSource(); const nbuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const nd = nbuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    nb.buffer = nbuf; nb.loop = true;
    const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = freq * 2; nf.Q.value = 0.8;
    const ng = ctx.createGain(); ng.gain.value = gain * 0.12;
    nb.connect(nf).connect(ng); ng.connect(g); nb.start();
    o1.connect(g); o2.connect(og2).connect(g); out(g, 0.32);
    o1.start(t); o2.start(t);
    return {
      glide(nf2) { const tt = ctx.currentTime; o1.frequency.exponentialRampToValueAtTime(nf2, tt + 0.08); o2.frequency.exponentialRampToValueAtTime(nf2, tt + 0.08); },
      stop() { const tt = ctx.currentTime; g.gain.cancelScheduledValues(tt); g.gain.setTargetAtTime(0, tt, 0.06); [o1, o2, lfo, nb].forEach(n => n.stop(tt + 0.3)); }
    };
  }

  /* --- sustained bow (sarangi): hold, glide, release --- */
  function bow(freq, { gain = 0.15 } = {}) {
    ensure();
    const t = ctx.currentTime;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.13);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq * 2.4; bp.Q.value = 2.5;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
    const parts = [[1, 0], [1, 8], [2, -6], [3, 5]], oscs = [];
    parts.forEach(([m, det]) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(freq * m, t); o.detune.value = det; o.connect(bp); o.start(); oscs.push(o); });
    const lfo = ctx.createOscillator(); lfo.frequency.value = 5.5; const lg = ctx.createGain(); lg.gain.value = freq * 0.016;
    lfo.connect(lg); oscs.forEach((o, i) => lg.gain && lg.connect(o.frequency)); lfo.start();
    // bow friction noise
    const nb = ctx.createBufferSource(); const nbuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const nd = nbuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1; nb.buffer = nbuf; nb.loop = true;
    const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = freq * 3; nf.Q.value = 1;
    const ng = ctx.createGain(); ng.gain.value = gain * 0.09; nb.connect(nf).connect(ng); ng.connect(g); nb.start();
    bp.connect(lp).connect(g); out(g, 0.32);
    return {
      glide(nfq) { const tt = ctx.currentTime; oscs.forEach((o, i) => o.frequency.exponentialRampToValueAtTime(nfq * parts[i][0], tt + 0.1)); },
      stop() { const tt = ctx.currentTime; g.gain.cancelScheduledValues(tt); g.gain.setTargetAtTime(0, tt, 0.08); [...oscs, lfo, nb].forEach(n => n.stop(tt + 0.4)); }
    };
  }

  /* --- Tanpura drone (Pa Sa Sa Sa cycle) — routed through droneBus with fade --- */
  let droneTimer = null, droneStep = 0, droneOn = false;
  const DRONE_SA = 130.81; // C3
  const droneSeq = [DRONE_SA * 0.75, DRONE_SA, DRONE_SA, DRONE_SA * 0.5];
  function droneTick() {
    pluck(droneSeq[droneStep % 4], { dur: 3.4, decay: 0.997, gain: 0.32, bright: 0.42, dest: droneBus });
    droneStep++;
  }
  function droneToggle() {
    ensure();
    const tt = ctx.currentTime;
    if (droneOn) {
      droneBus.gain.cancelScheduledValues(tt); droneBus.gain.setTargetAtTime(0, tt, 0.18);
      setTimeout(() => { clearInterval(droneTimer); droneTimer = null; }, 700);
      droneOn = false;
    } else {
      droneOn = true; droneStep = 0;
      droneBus.gain.cancelScheduledValues(tt); droneBus.gain.setValueAtTime(0.0001, tt);
      droneBus.gain.exponentialRampToValueAtTime(1, tt + 1.0); // gentle fade-in
      droneTick(); droneTimer = setInterval(droneTick, 720);
    }
    return droneOn;
  }

  return { ensure, pluck, tone, noise, reed, flute, bow, droneToggle, setVolume, get on() { return droneOn; } };
})();

/* ==========================================================================
   TABLA bols (synthesised)
   ========================================================================== */
const DAYAN_SA = 330; // tuned right-hand drum
const Tabla = {
  na()  { Sound.tone(DAYAN_SA * 2, { dur: 0.35, gain: 0.42, send: 0.25 }); Sound.noise(0.04, { gain: 0.35, freq: 3200 }); },
  tin() { Sound.tone(DAYAN_SA * 2, { dur: 0.8, gain: 0.5, send: 0.3 });  Sound.noise(0.025, { gain: 0.2, freq: 4200 }); },
  tun() { Sound.tone(DAYAN_SA, { dur: 1.0, gain: 0.55, send: 0.35 }); },
  te()  { Sound.noise(0.05, { gain: 0.4, freq: 3600 }); Sound.tone(DAYAN_SA * 2.4, { dur: 0.12, gain: 0.22 }); },
  ge()  { Sound.tone(108, { dur: 0.8, bend: 0.5, gain: 0.9, send: 0.18 }); Sound.tone(150, { dur: 0.3, bend: 0.55, gain: 0.25 }); },
  ka()  { Sound.noise(0.1, { gain: 0.7, type: 'lowpass', freq: 1100, q: 0.7 }); },
  dha() { this.ge(); this.na(); },
  dhin(){ this.ge(); this.tin(); },
};

/* ==========================================================================
   DHOLAK bols (folk barrel drum — earthier than tabla)
   ========================================================================== */
const DHOL_T = 210, DHOL_B = 90;
const Dholak = {
  na()  { Sound.tone(DHOL_T * 2, { dur: 0.32, gain: 0.4, send: 0.2 }); Sound.noise(0.04, { gain: 0.3, freq: 2600 }); },
  tin() { Sound.tone(DHOL_T * 2, { dur: 0.7, gain: 0.45, send: 0.3 }); },
  ka()  { Sound.noise(0.1, { gain: 0.6, type: 'lowpass', freq: 950, q: 0.7 }); },
  ge()  { Sound.tone(DHOL_B, { dur: 0.75, bend: 0.55, gain: 0.85, send: 0.18 }); Sound.tone(DHOL_B * 1.6, { dur: 0.25, bend: 0.6, gain: 0.2 }); },
  dha() { this.ge(); this.na(); },
};

/* ==========================================================================
   INSTRUMENT DATA + BUILDERS
   ========================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

function rippleAt(host, x, y) {
  const r = el('span', 'ripple'); r.style.left = x + 'px'; r.style.top = y + 'px';
  host.appendChild(r); setTimeout(() => r.remove(), 600);
}
function setReadout(text) { const r = $('#readout'); if (!r) return; r.textContent = text; r.classList.remove('hit'); void r.offsetWidth; r.classList.add('hit'); }

const ICONS = {
  tabla: `<svg class="card-ico" viewBox="0 0 64 64" fill="none"><ellipse cx="22" cy="44" rx="13" ry="6" fill="#e8d3a8"/><path d="M9 44V34a13 6 0 0026 0v10" stroke="#c9a96e" stroke-width="3" fill="#d8b67e"/><ellipse cx="22" cy="34" rx="13" ry="6" fill="#f3e3c2"/><circle cx="22" cy="34" r="5" fill="#2a1c14"/><ellipse cx="46" cy="46" rx="11" ry="5" fill="#b9aeb0"/><path d="M35 46V38a11 5 0 0022 0v8" stroke="#8a7d84" stroke-width="3" fill="#9a8f94"/><ellipse cx="46" cy="38" rx="11" ry="5" fill="#cdc4c6"/><circle cx="46" cy="38" r="5" fill="#2a1c24"/></svg>`,
  sitar: `<svg class="card-ico" viewBox="0 0 64 64" fill="none"><circle cx="46" cy="46" r="14" fill="#8a6530"/><circle cx="46" cy="46" r="14" stroke="#caa45e" stroke-width="2"/><rect x="10" y="6" width="9" height="44" rx="4" transform="rotate(-32 14 28)" fill="#7a4a22"/><path d="M12 12L48 44" stroke="#f4cf6a" stroke-width="1.6"/><path d="M16 9L52 41" stroke="#fff" stroke-width="1"/></svg>`,
  bansuri: `<svg class="card-ico" viewBox="0 0 64 64" fill="none"><rect x="6" y="26" width="52" height="12" rx="6" fill="#a87f3e"/><rect x="6" y="26" width="52" height="12" rx="6" stroke="#caa45e" stroke-width="1.5"/><circle cx="16" cy="32" r="2.4" fill="#120c06"/><circle cx="26" cy="32" r="2.4" fill="#120c06"/><circle cx="36" cy="32" r="2.4" fill="#120c06"/><circle cx="46" cy="32" r="2.4" fill="#120c06"/></svg>`,
  harmonium: `<svg class="card-ico" viewBox="0 0 64 64" fill="none"><rect x="8" y="20" width="48" height="30" rx="4" fill="#5a3b22"/><rect x="12" y="36" width="40" height="12" fill="#fdf6e9"/><rect x="17" y="36" width="2" height="12" fill="#9a7a4a"/><rect x="24" y="36" width="2" height="12" fill="#9a7a4a"/><rect x="31" y="36" width="2" height="12" fill="#9a7a4a"/><rect x="38" y="36" width="2" height="12" fill="#9a7a4a"/><rect x="45" y="36" width="2" height="12" fill="#9a7a4a"/><rect x="15" y="36" width="4" height="7" fill="#2a1c24"/><rect x="22" y="36" width="4" height="7" fill="#2a1c24"/><rect x="36" y="36" width="4" height="7" fill="#2a1c24"/><rect x="43" y="36" width="4" height="7" fill="#2a1c24"/><rect x="8" y="14" width="48" height="8" rx="2" fill="#8f4632"/></svg>`,
  tanpura: `<svg class="card-ico" viewBox="0 0 64 64" fill="none"><ellipse cx="32" cy="50" rx="14" ry="11" fill="#8a6530"/><ellipse cx="32" cy="50" rx="14" ry="11" stroke="#caa45e" stroke-width="1.5"/><rect x="28" y="4" width="8" height="40" rx="3" fill="#7a4a22"/><path d="M30 6V44M32 6V44M34 6V44" stroke="#f4cf6a" stroke-width="1"/></svg>`,
  santoor: `<svg class="card-ico" viewBox="0 0 64 64" fill="none"><path d="M10 22h44l-7 24H17z" fill="#8a6530"/><path d="M10 22h44l-7 24H17z" stroke="#caa45e" stroke-width="2"/><path d="M15 29h35M14 35h37M13 41h39" stroke="#f4cf6a" stroke-width="1.4"/><path d="M28 14l6 6-3 3" stroke="#e8d3a8" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`,
  sarangi: `<svg class="card-ico" viewBox="0 0 64 64" fill="none"><rect x="22" y="30" width="20" height="28" rx="9" fill="#8a6530" stroke="#caa45e" stroke-width="2"/><rect x="26" y="6" width="12" height="27" rx="4" fill="#7a4a22"/><path d="M29 8v25M32 8v25M35 8v25" stroke="#f4cf6a" stroke-width="1"/><path d="M12 50L52 30" stroke="#e8d3a8" stroke-width="2.4" stroke-linecap="round"/></svg>`,
  dholak: `<svg class="card-ico" viewBox="0 0 64 64" fill="none"><rect x="14" y="24" width="36" height="18" fill="#a8763a"/><ellipse cx="14" cy="33" rx="7" ry="11" fill="#cdc4c6" stroke="#9a8f94" stroke-width="2"/><ellipse cx="50" cy="33" rx="6" ry="9.5" fill="#f3e3c2" stroke="#caa45e" stroke-width="2"/><path d="M16 24l32 0M16 42l32 0" stroke="#caa45e" stroke-width="1.6"/></svg>`,
};

const INSTRUMENTS = [
  {
    id: 'tabla', name: 'Tabla', roman: 'ਤਬਲਾ', tag: 'The heartbeat of North Indian rhythm',
    blurb: 'A pair of hand drums. Strike the zones to sound different bols.',
    info: {
      region: 'North India (Hindustani)', family: 'Membranophone (drum pair)',
      paras: [
        ['The instrument', 'The tabla is a pair of single-headed drums: the smaller, wooden <b>dayan</b> played with the right hand and tuned to the tonic, and the larger, metal <b>bayan</b> played with the left for deep bass. The black circle (<i>syahi</i>) is a tuning paste of iron filings and starch that gives the tabla its bell-like pitch.'],
        ['How it speaks', 'Tabla is a language. Each stroke is a spoken syllable called a <b>bol</b> — <i>Na, Tin, Dha, Ge, Ka, Te</i> — and players recite rhythms aloud before playing them. Combining bols builds cyclic patterns called <b>taal</b>; the most common, <b>Teental</b>, has 16 beats.'],
        ['Try it', 'Tap the bright edge of the dayan for <i>Na</i>, the centre for <i>Tin/Tun</i>. Press the bayan for the booming <i>Ge</i> (notice the pitch bend from heel pressure) or its rim for the dry <i>Ka</i>. Then hit “Teental” and play along with the moving highlight.'],
      ],
    },
  },
  {
    id: 'sitar', name: 'Sitar', roman: 'ਸਿਤਾਰ', tag: 'The shimmering voice of the raga',
    blurb: 'Tap frets to play the scale of Raga Yaman; strum the chikari drone.',
    info: {
      region: 'North India (Hindustani)', family: 'Plucked chordophone',
      paras: [
        ['The instrument', 'The sitar has a long hollow neck, a gourd resonator (<i>tumba</i>), curved movable frets, and up to 20 strings — a few played melodically, the rest <b>sympathetic strings</b> (<i>tarab</i>) that ring on their own to create its glowing halo of sound. A specially shaped bridge (<i>jawari</i>) gives the buzzing, sustaining tone.'],
        ['How it is played', 'The player plucks with a wire plectrum (<i>mizrab</i>) and bends the string sideways across the fret to slide between notes — the expressive glide called <b>meend</b> that imitates the human voice. Fast rhythmic strumming of the drone strings (<i>chikari</i>) produces the exciting <b>jhala</b>.'],
        ['Try it', 'This sitar is tuned to <b>Raga Yaman</b> (an evening raga using the sharp Ma). Tap the fret dots to climb the scale; each note rings with sympathetic shimmer. Tap the chikari panel on the right for the rhythmic drone.'],
      ],
    },
  },
  {
    id: 'bansuri', name: 'Bansuri', roman: 'ਬੰਸਰੀ', tag: 'A single bamboo, the breath of Krishna',
    blurb: 'Hold a hole to sound a note; slide your finger for smooth glides.',
    info: {
      region: 'All India', family: 'Side-blown bamboo flute (aerophone)',
      paras: [
        ['The instrument', 'The bansuri is a simple bamboo tube with six or seven finger holes and no mechanical keys — yet in skilled hands it spans three octaves. It is deeply tied to Hindu mythology as the flute of Lord Krishna, and the long <i>bass bansuri</i> popularised in classical music can be nearly a metre long.'],
        ['How it is played', 'Sound comes from blowing across the embouchure hole; pitch is shaped entirely by the fingers and the breath. Because there are no keys, players <b>slide and half-cover</b> holes to bend between notes, producing the seamless <b>meend</b> and ornaments (<i>gamak</i>) that define Indian melody.'],
        ['Try it', 'Press and hold a hole to play that note of the scale. Keep your finger down and <b>drag sideways</b> to the next hole — the pitch glides smoothly, just like the real instrument.'],
      ],
    },
  },
  {
    id: 'harmonium', name: 'Harmonium', roman: 'ਹਾਰਮੋਨੀਅਮ', tag: 'The reed organ that learned to sing Indian',
    blurb: 'A hand-pumped keyboard. Play the sargam — hold keys for sustained reeds.',
    info: {
      region: 'All India (esp. vocal & devotional music)', family: 'Free-reed keyboard (aerophone)',
      paras: [
        ['The instrument', 'Brought to India by European missionaries in the 19th century, the harmonium was reinvented as a hand-pumped, floor-sitting <b>box organ</b>. The player works the bellows with one hand while playing the keyboard with the other. It became the backbone of <b>khayal, ghazal, qawwali and bhajan</b> singing.'],
        ['Sargam', 'Indian music names its seven notes <b>Sa Re Ga Ma Pa Dha Ni</b> (the <i>sargam</i>), like Do-Re-Mi. The white keys here play the natural scale; the dark keys are the <i>komal</i> (flat) and <i>teevra</i> (sharp) notes used to colour different ragas.'],
        ['Try it', 'Hold a key — the reed sustains as long as you hold it (the bellows keep pumping). Play across the keys to find a melody, or turn on the Tanpura drone above and improvise.'],
      ],
    },
  },
  {
    id: 'tanpura', name: 'Tanpura', roman: 'ਤਾਨਪੁਰਾ', tag: 'The endless drone that holds everything together',
    blurb: 'Pluck the four strings — or let it cycle on its own as a backing drone.',
    info: {
      region: 'All India', family: 'Plucked drone chordophone',
      paras: [
        ['The instrument', 'The tanpura plays no melody and no rhythm — only a continuous <b>drone</b>. Four (sometimes five or six) long strings are plucked one after another in a slow, endless cycle, typically tuned <b>Pa – Sa – Sa – Sa</b> (or Ma–Sa–Sa–Sa). A cotton thread (<i>jivari</i>) under each string creates the rich, buzzing overtone cloud.'],
        ['Why it matters', 'That drone is the <b>tonal foundation</b> of all Indian classical music. It fixes the Sa (tonic) in the listener\'s ear so that every melodic nuance of a raga is heard in relation to it. Musicians describe sitting inside the tanpura\'s sound as the starting point of any performance.'],
        ['Try it', 'Pluck the strings left-to-right for the classic cycle, or hit “Auto-cycle” to let the tanpura drone on its own — then go back and play the sitar or bansuri over the top.'],
      ],
    },
  },
  {
    id: 'santoor', name: 'Santoor', roman: 'ਸੰਤੂਰ', tag: 'A hundred strings struck like rain',
    blurb: 'Strike the string courses with light mallets — bright and shimmering.',
    info: {
      region: 'Kashmir / North India', family: 'Hammered dulcimer (struck zither)',
      paras: [
        ['The instrument', 'The santoor is a trapezoid box bearing around 25 bridges and as many as 100 strings, struck with a pair of light curved mallets (<i>mezrab</i>) held between the fingers. Native to Kashmir, where it accompanied Sufiana music, it was brought to the Hindustani classical stage in the 20th century — most famously by Pandit Shivkumar Sharma.'],
        ['How it is played', 'Because the strings are <b>struck</b> rather than plucked or bowed, the santoor has a bright, percussive, bell-like attack with a long shimmering sustain. Melody is made by striking string courses in rapid succession; with no frets, every note must be hit cleanly.'],
        ['Try it', 'Tap any string course to strike it — each rings with a sparkling overtone. Run quickly down the rows for that signature cascade of sound.'],
      ],
    },
  },
  {
    id: 'sarangi', name: 'Sarangi', roman: 'ਸਾਰੰਗੀ', tag: 'The instrument closest to the human voice',
    blurb: 'Press &amp; hold to bow; drag to glide between notes like a singer.',
    info: {
      region: 'North India (Hindustani)', family: 'Bowed short-necked fiddle',
      paras: [
        ['The instrument', 'Carved from a single block of wood and covered with goatskin, the sarangi has three or four main gut playing strings and up to <b>35–40 sympathetic strings</b> that give it a haunting resonance. Its name is often read as “a hundred colours,” reflecting its enormous expressive range.'],
        ['How it is played', 'It is bowed with the right hand while the left stops the strings using the <b>nails and cuticles</b> — not the fingertips — sliding along the string to glide between notes. This lets it imitate the slides and ornaments of the singing voice; it was long the favoured accompaniment for vocalists.'],
        ['Try it', 'Press and hold a note to draw the bow. Keep holding and <b>drag</b> to a neighbouring note — the pitch slides smoothly, just like a sarangi player chasing a vocal line.'],
      ],
    },
  },
  {
    id: 'dholak', name: 'Dholak', roman: 'ਢੋਲਕ', tag: 'The folk drum of weddings and celebration',
    blurb: 'Tap the two heads — bright treble and booming bass.',
    info: {
      region: 'North India / South Asia (folk)', family: 'Two-headed barrel hand drum',
      paras: [
        ['The instrument', 'The dholak is a two-headed wooden barrel drum, smaller and folksier than the tabla. The right head gives a sharp, high tone; the left, often treated with paste inside, gives a deep resonant bass. It is the engine of <b>weddings, folk songs, bhajans and qawwali</b> across South Asia.'],
        ['How it is played', 'Both heads are struck with the bare hands and fingers. Players combine ringing treble strokes with sliding bass tones to drive infectious folk rhythms (<i>theka</i>) such as Kaherva and Dadra.'],
        ['Try it', 'Tap the small head on the right for crisp treble strokes; tap the large head on the left for the booming bass. Mix them to find a folk groove.'],
      ],
    },
  },
];

/* ---------- Sargam labels & play-along lessons ---------- */
const SARGAM = { S: 'Sa', r: 're', R: 'Re', g: 'ga', G: 'Ga', m: 'Ma', M: 'Má', P: 'Pa', d: 'dha', D: 'Dha', n: 'ni', N: 'Ni', "S'": 'Sá' };
const labelOf = tok => SARGAM[tok] || tok;

const LESSONS = [
  { id: 'sargam', name: 'Sa Re Ga Ma — First Steps', instr: 'harmonium', kind: 'melody', sa: 261.63, bpm: 90,
    desc: 'The seven notes of Indian music, climbing up and back down.',
    seq: ['S', 'R', 'G', 'm', 'P', 'D', 'N', "S'", "S'", 'N', 'D', 'P', 'm', 'G', 'R', 'S'] },
  { id: 'twinkle', name: 'Twinkle Twinkle (in Sargam)', instr: 'bansuri', kind: 'melody', sa: 261.63, bpm: 112,
    desc: 'A tune you already know — a gentle way to find the notes.',
    seq: ['S', 'S', 'P', 'P', 'D', 'D', 'P', 'm', 'm', 'G', 'G', 'R', 'R', 'S'] },
  { id: 'yaman', name: 'Raga Yaman — Aroha & Avaroha', instr: 'sitar', kind: 'melody', sa: 246.94, bpm: 80,
    desc: 'The ascending and descending scale of a serene evening raga.',
    seq: ['S', 'R', 'G', 'M', 'P', 'D', 'N', "S'", "S'", 'N', 'D', 'P', 'M', 'G', 'R', 'S'] },
  { id: 'bhairavi', name: 'Bhairavi — A Soulful Phrase', instr: 'sarangi', kind: 'melody', sa: 220, bpm: 66,
    desc: 'A tender phrase in the beloved morning raga Bhairavi.',
    seq: ['S', 'r', 'g', 'm', 'P', 'd', 'n', "S'", 'n', 'd', 'P', 'm', 'g', 'r', 'S'] },
  { id: 'santoor-cascade', name: 'Santoor Cascade', instr: 'santoor', kind: 'melody', sa: 261.63, bpm: 130,
    desc: 'A quick shimmering run down the strings.',
    seq: ["S'", 'N', 'D', 'P', 'm', 'G', 'R', 'S', 'S', 'R', 'G', 'm', 'P', 'D', 'N', "S'"] },
  { id: 'teental', name: 'Teental — the 16-beat Cycle', instr: 'tabla', kind: 'rhythm', sa: 0, bpm: 100,
    desc: 'Recite and play the most common tabla rhythmic cycle.',
    seq: ['Dha', 'Dhin', 'Dhin', 'Dha', 'Dha', 'Dhin', 'Dhin', 'Dha', 'Dha', 'Tin', 'Tin', 'Ta', 'Te', 'Dhin', 'Dhin', 'Dha'] },
  { id: 'kaherva', name: 'Kaherva — Folk Groove', instr: 'dholak', kind: 'rhythm', sa: 0, bpm: 120,
    desc: 'The 8-beat folk groove behind countless wedding songs.',
    seq: ['Dha', 'Ge', 'Na', 'Tin', 'Na', 'Ka', 'Dha', 'Tin'] },
];

/* play a single lesson token on the right instrument */
function lessonStrike(instr, sa, token) {
  if (instr === 'tabla')  { ({ Dha: 'dha', Dhin: 'dhin', Tin: 'tin', Ta: 'na', Te: 'te' }[token]) && Tabla[{ Dha: 'dha', Dhin: 'dhin', Tin: 'tin', Ta: 'na', Te: 'te' }[token]](); return; }
  if (instr === 'dholak') { const m = { Dha: 'dha', Na: 'na', Tin: 'tin', Ka: 'ka', Ge: 'ge' }[token]; m && Dholak[m](); return; }
  const f = freqOf(sa, token);
  switch (instr) {
    case 'sitar':   Sound.pluck(f, { dur: 2.2, gain: 0.55, bright: 0.6, send: 0.4 }); Sound.pluck(f * 2, { dur: 1.4, gain: 0.1, bright: 0.5, send: 0.5 }); break;
    case 'santoor': Sound.pluck(f, { dur: 1.4, decay: 0.99, gain: 0.42, bright: 0.82, send: 0.5 }); Sound.pluck(f * 2, { dur: 0.9, gain: 0.1, bright: 0.7, send: 0.5 }); break;
    case 'harmonium': { const v = Sound.reed(f); setTimeout(() => v.stop(), 600); break; }
    case 'bansuri':   { const v = Sound.flute(f); setTimeout(() => v.stop(), 600); break; }
    case 'sarangi':   { const v = Sound.bow(f); setTimeout(() => v.stop(), 700); break; }
    default: Sound.pluck(f, { gain: 0.5 });
  }
}

/* ==========================================================================
   BUILDERS — each returns a teardown() function
   ========================================================================== */
const BUILDERS = {

  /* ---------------- TABLA ---------------- */
  tabla(stage) {
    stage.innerHTML = '';
    const readout = el('div', 'readout'); readout.id = 'readout'; readout.textContent = 'Dha';
    const sub = el('div', 'sublabel', 'Tap the drums to speak their bols.');

    const wrap = el('div', 'tabla');
    // dayan zones: outer ring = Na/Tin, centre = Tun
    const dayan = el('div', 'drum dayan', `<div class="drum-head"><div class="syahi"></div></div><div class="drum-name">Dayan · treble</div>`);
    const bayan = el('div', 'drum bayan', `<div class="drum-head"><div class="syahi"></div></div><div class="drum-name">Bayan · bass</div>`);

    const hit = (host, bolName, fn, e) => {
      Sound.ensure(); fn();
      const head = host.querySelector('.drum-head');
      head.classList.remove('struck'); void head.offsetWidth; head.classList.add('struck');
      const r = head.getBoundingClientRect();
      rippleAt(head, (e.clientX ?? r.left + r.width / 2) - r.left, (e.clientY ?? r.top + r.height / 2) - r.top);
      setReadout(bolName);
    };

    dayan.addEventListener('pointerdown', e => {
      const head = dayan.querySelector('.drum-head'); const r = head.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const dist = Math.hypot(dx, dy);
      if (dist > 0.62) hit(dayan, 'Na', () => Tabla.na(), e);
      else if (dist > 0.34) hit(dayan, 'Tin', () => Tabla.tin(), e);
      else hit(dayan, 'Tun', () => Tabla.tun(), e);
    });
    bayan.addEventListener('pointerdown', e => {
      const head = bayan.querySelector('.drum-head'); const r = head.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      if (Math.hypot(dx, dy) > 0.6) hit(bayan, 'Ka', () => Tabla.ka(), e);
      else hit(bayan, 'Ge', () => Tabla.ge(), e);
    });

    wrap.append(bayan, dayan);

    // Teental trainer
    const TEENTAL = ['Dha','Dhin','Dhin','Dha','Dha','Dhin','Dhin','Dha','Dha','Tin','Tin','Ta','Te','Dhin','Dhin','Dha'];
    const play = { Dha:()=>Tabla.dha(), Dhin:()=>Tabla.dhin(), Tin:()=>Tabla.tin(), Ta:()=>Tabla.na(), Te:()=>Tabla.te() };
    const taal = el('div', 'taal');
    const beats = el('div', 'beats');
    TEENTAL.forEach((b, i) => {
      const cell = el('div', 'beat' + (i % 4 === 0 ? ' sam' : ''), `<div class="b-bol">${b}</div><div style="font-size:10px;opacity:.6">${i+1}</div>`);
      beats.appendChild(cell);
    });
    const ctrl = el('div', 'pill-row');
    const toggle = el('button', 'pill', '▶ Play Teental');
    const tempo = el('button', 'pill on', '90 bpm');
    ctrl.append(toggle, tempo);
    taal.append(beats, ctrl);

    let timer = null, idx = 0, bpm = 90;
    const cells = [...beats.children];
    function step() {
      cells.forEach(c => c.classList.remove('now'));
      const c = cells[idx]; c.classList.add('now');
      play[TEENTAL[idx]]?.();
      setReadout(TEENTAL[idx]);
      idx = (idx + 1) % 16;
    }
    function start() { if (timer) return; Sound.ensure(); idx = 0; step(); timer = setInterval(step, 60000 / bpm); toggle.textContent = '⏸ Stop'; }
    function stop() { clearInterval(timer); timer = null; cells.forEach(c => c.classList.remove('now')); toggle.textContent = '▶ Play Teental'; }
    toggle.addEventListener('click', () => timer ? stop() : start());
    tempo.addEventListener('click', () => { bpm = bpm === 90 ? 140 : bpm === 140 ? 60 : 90; tempo.textContent = bpm + ' bpm'; if (timer) { stop(); start(); } });

    stage.append(readout, sub, wrap, taal);
    return () => stop();
  },

  /* ---------------- SITAR ---------------- */
  sitar(stage) {
    stage.innerHTML = '';
    const readout = el('div', 'readout'); readout.id = 'readout'; readout.textContent = 'Sa';
    const sub = el('div', 'sublabel', 'Raga Yaman · tap the frets to climb the scale.');

    const SA = 246.94; // B3, comfortable sitar Sa
    // Yaman ascending: S R G M(teevra) P D N S'
    const scale = [['S',"Sa"],['R','Re'],['G','Ga'],['M','Ma'],['P','Pa'],['D','Dha'],['N','Ni'],["S'",'Sa']];

    const wrap = el('div', 'sitar');
    const neck = el('div', 'neck');
    const stringEl = el('div', 'string-main');
    const frets = el('div', 'frets');
    scale.forEach(([n, label]) => {
      const f = el('div', 'fret', `<div class="fret-dot">${n.replace("'", "·")}</div>`);
      f.addEventListener('pointerdown', () => {
        Sound.ensure();
        const freq = freqOf(SA, n);
        Sound.pluck(freq, { dur: 2.6, decay: 0.996, gain: 0.6, bright: 0.62, send: 0.45 });
        Sound.pluck(freq * 2, { dur: 1.8, decay: 0.994, gain: 0.12, bright: 0.5, send: 0.5 }); // sympathetic shimmer
        stringEl.classList.remove('vibrate'); void stringEl.offsetWidth; stringEl.classList.add('vibrate');
        f.classList.add('lit'); setTimeout(() => f.classList.remove('lit'), 260);
        setReadout(label);
      });
      frets.appendChild(f);
    });
    neck.append(stringEl, frets);

    // chikari drone strum
    const chikari = el('div', 'chikari', `<div class="cs"></div><div class="cs"></div><span>Chikari<br>strum</span>`);
    let jhala = null;
    const strum = () => {
      Sound.ensure();
      Sound.pluck(freqOf(SA, "S'") , { dur: 0.9, decay: 0.99, gain: 0.32, bright: 0.7, send: 0.3 });
      Sound.pluck(freqOf(SA, "S'") * 2, { dur: 0.7, decay: 0.985, gain: 0.18, bright: 0.7, send: 0.3 });
      chikari.classList.remove('strum'); void chikari.offsetWidth; chikari.classList.add('strum');
      setReadout('chik');
    };
    chikari.addEventListener('pointerdown', strum);

    wrap.append(neck, chikari);
    stage.append(readout, sub, wrap);
    return () => { if (jhala) clearInterval(jhala); };
  },

  /* ---------------- BANSURI ---------------- */
  bansuri(stage) {
    stage.innerHTML = '';
    const readout = el('div', 'readout'); readout.id = 'readout'; readout.textContent = '~';
    const sub = el('div', 'sublabel', 'Press &amp; hold a hole. Drag across holes to glide between notes.');

    const SA = 261.63; // C4
    const notes = [['S','Sa'],['R','Re'],['G','Ga'],['m','Ma'],['P','Pa'],['D','Dha'],['N','Ni'],["S'",'Sa']];

    const wrap = el('div', 'bansuri-wrap');
    const flute = el('div', 'flute');
    flute.appendChild(el('div', 'blow'));
    flute.appendChild(el('span', 'air'));
    const holes = el('div', 'holes');

    let voice = null, activeHole = null;
    function startNote(holeEl) {
      const n = holeEl.dataset.note, label = holeEl.dataset.label, freq = freqOf(SA, n);
      if (voice) { voice.glide(freq); }
      else { voice = Sound.flute(freq); flute.classList.add('blowing'); }
      [...holes.children].forEach(h => h.classList.remove('active'));
      holeEl.classList.add('active'); activeHole = holeEl;
      setReadout(label);
    }
    function stopNote() { if (voice) { voice.stop(); voice = null; } flute.classList.remove('blowing'); [...holes.children].forEach(h => h.classList.remove('active')); activeHole = null; }

    notes.forEach(([n, label]) => {
      const h = el('div', 'hole', `<span class="h-label">${n.replace("'", "·")}</span>`);
      h.dataset.note = n; h.dataset.label = label;
      h.addEventListener('pointerdown', e => { e.preventDefault(); Sound.ensure(); startNote(h); });
      h.addEventListener('pointerenter', e => { if (e.buttons || e.pressure) { if (activeHole) startNote(h); } });
      holes.appendChild(h);
    });
    // pointer-based slide support (touch): track moves across the flute
    wrap.addEventListener('pointermove', e => {
      if (!voice) return;
      const t = document.elementFromPoint(e.clientX, e.clientY);
      if (t && t.classList && t.classList.contains('hole') && t !== activeHole) startNote(t);
      else if (t && t.parentElement && t.parentElement.classList.contains('hole') && t.parentElement !== activeHole) startNote(t.parentElement);
    });
    const end = () => stopNote();
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);

    flute.appendChild(holes);
    wrap.appendChild(flute);
    stage.append(readout, sub, wrap);
    return () => { stopNote(); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); };
  },

  /* ---------------- HARMONIUM ---------------- */
  harmonium(stage) {
    stage.innerHTML = '';
    const readout = el('div', 'readout'); readout.id = 'readout'; readout.textContent = 'Sa';
    const sub = el('div', 'sublabel', 'Hold keys to sustain the reeds. White = sargam, dark = komal/teevra.');

    const SA = 261.63;
    const wrap = el('div', 'harmonium');
    const bellows = el('div', 'bellows pump');
    const keys = el('div', 'keys');

    // one octave + a bit: white keys S R G m P D N S' R'  ; blacks between
    const white = [['S','Sa',1],['R','Re',1],['G','Ga',1],['m','Ma',1],['P','Pa',1],['D','Dha',1],['N','Ni',1],["S'",'Sa',2],['R',"Re'",2]];
    const blackMap = { // after index i (0-based white), label, ratio-note, octave
      0: ['r','re'], 1: ['g','ga'], 3: ['M','Ma+'], 4: ['d','dha'], 5: ['n','ni'], 7: ['r',"re'"]
    };
    const voices = new Map();
    const startKey = (node, freq, label) => {
      Sound.ensure();
      if (voices.has(node)) return;
      voices.set(node, Sound.reed(freq));
      node.classList.add('active'); setReadout(label);
    };
    const stopKey = node => { const v = voices.get(node); if (v) { v.stop(); voices.delete(node); } node.classList.remove('active'); };
    const bindKey = (node, freq, label) => {
      node.addEventListener('pointerdown', e => { e.preventDefault(); startKey(node, freq, label); });
      node.addEventListener('pointerup', () => stopKey(node));
      node.addEventListener('pointerleave', () => stopKey(node));
      node.addEventListener('pointercancel', () => stopKey(node));
    };

    const WKEY_W = 56; // matches CSS-ish for black positioning
    white.forEach(([n, label, oct], i) => {
      const w = el('div', 'wkey', `<span class="lbl">${label}</span>`);
      bindKey(w, freqOf(SA, n) * (oct === 2 ? 2 : 1), label);
      keys.appendChild(w);
      const bk = blackMap[i];
      if (bk) {
        const b = el('div', 'bkey', `<span class="lbl">${bk[0]}</span>`);
        // place over the gap to the right of this white key
        b.style.left = `calc(${i + 1} * (clamp(40px,11vw,54px) + 2px) - clamp(13px,3.5vw,17px))`;
        const bOct = (bk[0] === 'r' && i === 7) ? 2 : 1;
        bindKey(b, freqOf(SA, bk[0]) * (bOct === 2 ? 2 : 1), bk[1]);
        keys.appendChild(b);
      }
    });

    wrap.append(bellows, keys);
    stage.append(readout, sub, wrap);
    return () => { voices.forEach(v => v.stop()); voices.clear(); };
  },

  /* ---------------- TANPURA ---------------- */
  tanpura(stage) {
    stage.innerHTML = '';
    const readout = el('div', 'readout'); readout.id = 'readout'; readout.textContent = 'Sa';
    const sub = el('div', 'sublabel', 'Pluck the strings in turn, or let it cycle on its own.');

    const SA = 146.83; // D3 tanpura Sa
    const strings = [['Pa', SA * 0.75], ['Sa', SA], ['Sa', SA], ['Sa·', SA / 2]];
    const wrap = el('div', 'tanpura');
    const row = el('div', 'tan-strings');
    const nodes = [];
    strings.forEach(([label, freq]) => {
      const s = el('div', 'tan-string', `<div class="tan-wire"></div><span>${label}</span>`);
      const pl = () => { Sound.ensure(); Sound.pluck(freq, { dur: 3.6, decay: 0.997, gain: 0.5, bright: 0.42, send: 0.55 }); s.classList.remove('pluck'); void s.offsetWidth; s.classList.add('pluck'); setReadout(label); };
      s.addEventListener('pointerdown', pl);
      s._play = pl; row.appendChild(s); nodes.push(s);
    });
    const gourd = el('div', 'tan-gourd');

    const autoRow = el('div', 'pill-row');
    const auto = el('button', 'pill', '▶ Auto-cycle');
    autoRow.appendChild(auto);
    let timer = null, i = 0;
    function tick() { nodes[i % 4]._play(); i++; }
    auto.addEventListener('click', () => {
      if (timer) { clearInterval(timer); timer = null; auto.textContent = '▶ Auto-cycle'; auto.classList.remove('on'); }
      else { i = 0; tick(); timer = setInterval(tick, 760); auto.textContent = '⏸ Stop'; auto.classList.add('on'); }
    });

    wrap.append(row, gourd, autoRow);
    stage.append(readout, sub, wrap);
    return () => { if (timer) clearInterval(timer); };
  },

  /* ---------------- SANTOOR ---------------- */
  santoor(stage) {
    stage.innerHTML = '';
    const readout = el('div', 'readout'); readout.id = 'readout'; readout.textContent = 'Sa';
    const sub = el('div', 'sublabel', 'Tap the string courses — struck with light mallets.');
    const SA = 261.63;
    const rows = [['S', 'Sa'], ['R', 'Re'], ['G', 'Ga'], ['m', 'Ma'], ['P', 'Pa'], ['D', 'Dha'], ['N', 'Ni'], ["S'", 'Sá']];
    const panel = el('div', 'santoor');
    [...rows].reverse().forEach(([n, label]) => {                 // high notes at the top
      const freq = freqOf(SA, n);
      const s = el('div', 's-string', `<span class="s-lbl">${label}</span><div class="s-line"></div>`);
      s.addEventListener('pointerdown', () => {
        Sound.ensure();
        Sound.pluck(freq, { dur: 1.5, decay: 0.991, gain: 0.42, bright: 0.82, send: 0.5 });
        Sound.pluck(freq * 1.004, { dur: 1.4, decay: 0.989, gain: 0.26, bright: 0.82, send: 0.5 });
        Sound.pluck(freq * 2, { dur: 0.9, decay: 0.984, gain: 0.09, bright: 0.7, send: 0.5 });
        s.classList.remove('hit'); void s.offsetWidth; s.classList.add('hit'); setReadout(label);
      });
      panel.appendChild(s);
    });
    stage.append(readout, sub, panel);
    return () => {};
  },

  /* ---------------- SARANGI ---------------- */
  sarangi(stage) {
    stage.innerHTML = '';
    const readout = el('div', 'readout'); readout.id = 'readout'; readout.textContent = '~';
    const sub = el('div', 'sublabel', 'Press &amp; hold to bow. Drag up or down to glide between notes.');
    const SA = 196; // G3 — vocal register
    const notes = [["S'", 'Sá'], ['N', 'Ni'], ['D', 'Dha'], ['P', 'Pa'], ['m', 'Ma'], ['G', 'Ga'], ['g', 'ga'], ['R', 'Re'], ['S', 'Sa']];
    const wrap = el('div', 'sarangi-wrap');
    const board = el('div', 'sarangi-board');
    let voice = null, active = null;
    function start(pad) {
      const freq = freqOf(SA, pad.dataset.note);
      if (voice) voice.glide(freq); else { voice = Sound.bow(freq); board.classList.add('bowing'); }
      [...board.children].forEach(c => c.classList.remove('active')); pad.classList.add('active'); active = pad; setReadout(pad.dataset.label);
    }
    function stop() { if (voice) { voice.stop(); voice = null; } board.classList.remove('bowing'); [...board.children].forEach(c => c.classList.remove('active')); active = null; }
    notes.forEach(([n, label]) => {
      const p = el('div', 'sar-note', `<span>${label}</span>`); p.dataset.note = n; p.dataset.label = label;
      p.addEventListener('pointerdown', e => { e.preventDefault(); Sound.ensure(); start(p); });
      board.appendChild(p);
    });
    wrap.addEventListener('pointermove', e => {
      if (!voice) return;
      const t = document.elementFromPoint(e.clientX, e.clientY);
      const pad = t && (t.classList.contains('sar-note') ? t : (t.parentElement && t.parentElement.classList.contains('sar-note') ? t.parentElement : null));
      if (pad && pad !== active) start(pad);
    });
    const end = () => stop();
    window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
    wrap.append(board, el('div', 'sar-bow'));
    stage.append(readout, sub, wrap);
    return () => { stop(); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); };
  },

  /* ---------------- DHOLAK ---------------- */
  dholak(stage) {
    stage.innerHTML = '';
    const readout = el('div', 'readout'); readout.id = 'readout'; readout.textContent = 'Dha';
    const sub = el('div', 'sublabel', 'Tap the heads — booming bass on the left, crisp treble on the right.');
    const wrap = el('div', 'dholak');
    const bass = el('div', 'dh-head dh-bass', `<div class="dh-skin"></div><span>Bass</span>`);
    const body = el('div', 'dh-body');
    const treb = el('div', 'dh-head dh-treb', `<div class="dh-skin"></div><span>Treble</span>`);
    const hit = (host, name, fn, e) => {
      Sound.ensure(); fn();
      const sk = host.querySelector('.dh-skin'); sk.classList.remove('struck'); void sk.offsetWidth; sk.classList.add('struck');
      const r = sk.getBoundingClientRect(); rippleAt(sk, (e.clientX ?? r.left + r.width / 2) - r.left, (e.clientY ?? r.top + r.height / 2) - r.top);
      setReadout(name);
    };
    treb.addEventListener('pointerdown', e => {
      const sk = treb.querySelector('.dh-skin'); const r = sk.getBoundingClientRect();
      const d = Math.hypot((e.clientX - (r.left + r.width / 2)) / (r.width / 2), (e.clientY - (r.top + r.height / 2)) / (r.height / 2));
      if (d > 0.55) hit(treb, 'Na', () => Dholak.na(), e); else hit(treb, 'Tin', () => Dholak.tin(), e);
    });
    bass.addEventListener('pointerdown', e => {
      const sk = bass.querySelector('.dh-skin'); const r = sk.getBoundingClientRect();
      const d = Math.hypot((e.clientX - (r.left + r.width / 2)) / (r.width / 2), (e.clientY - (r.top + r.height / 2)) / (r.height / 2));
      if (d > 0.6) hit(bass, 'Ka', () => Dholak.ka(), e); else hit(bass, 'Ge', () => Dholak.ge(), e);
    });
    wrap.append(bass, body, treb);
    stage.append(readout, sub, wrap);
    return () => {};
  },
};

/* ==========================================================================
   ROUTER / UI WIRING
   ========================================================================== */
let teardown = null, backHandler = goPicker;

function buildCards() {
  const host = $('#cards');
  INSTRUMENTS.forEach((ins, i) => {
    const card = el('button', 'card');
    card.style.animationDelay = (i * 50) + 'ms';
    card.innerHTML = `${ICONS[ins.id]}<div class="card-sheen"></div><span class="roman">${ins.roman}</span><h3>${ins.name}</h3><p>${ins.blurb}</p>`;
    card.addEventListener('click', () => openInstrument(ins.id));
    host.appendChild(card);
  });
}

function showStage(title, tagline) {
  if (teardown) { teardown(); teardown = null; }
  $('#stageTitle').textContent = title;
  $('#stageTagline').textContent = tagline;
  $('#picker').hidden = true;
  $('#stage').hidden = false;
  $('#backBtn').hidden = false;
  window.scrollTo({ top: 0 });
}

function openInstrument(id) {
  const ins = INSTRUMENTS.find(x => x.id === id);
  if (!ins) return;
  Sound.ensure();
  showStage(ins.name, ins.tag);
  $('#infoBtn').style.display = '';
  backHandler = goPicker;
  teardown = BUILDERS[id]($('#stageInner'));
  currentInfo = ins.info; currentName = ins.name;
}

function goPicker() {
  if (teardown) { teardown(); teardown = null; }
  $('#stage').hidden = true;
  $('#picker').hidden = false;
  $('#backBtn').hidden = true;
  $('#infoBtn').style.display = '';
  backHandler = goPicker;
}

/* ---- play-along lessons ---- */
function openLessonsList() {
  showStage('Play-Along Lessons', 'Listen first, then play it back — at your own pace.');
  $('#infoBtn').style.display = 'none';
  backHandler = goPicker;
  const stage = $('#stageInner'); stage.innerHTML = '';
  const grid = el('div', 'cards'); grid.style.width = '100%';
  LESSONS.forEach((l, i) => {
    const ins = INSTRUMENTS.find(x => x.id === l.instr);
    const c = el('button', 'card'); c.style.minHeight = '0'; c.style.animationDelay = (i * 50) + 'ms';
    c.innerHTML = `<div class="card-sheen"></div><span class="roman">${l.kind === 'rhythm' ? 'Rhythm' : 'Melody'} · ${ins ? ins.name : l.instr}</span><h3>${l.name}</h3><p>${l.desc}</p>`;
    c.addEventListener('click', () => openLesson(l.id));
    grid.appendChild(c);
  });
  stage.appendChild(grid);
}

function openLesson(id) {
  const L = LESSONS.find(x => x.id === id); if (!L) return;
  Sound.ensure();
  showStage(L.name, L.kind === 'rhythm' ? 'Rhythm lesson — follow the glowing stroke.' : 'Melody lesson — follow the glowing note.');
  $('#infoBtn').style.display = 'none';
  backHandler = openLessonsList;
  const stage = $('#stageInner'); stage.innerHTML = '';
  const ins = INSTRUMENTS.find(x => x.id === L.instr);

  const meta = el('div', 'lesson-meta', `<span class="chip">🎵 ${ins ? ins.name : L.instr}</span><span class="chip">${L.seq.length} ${L.kind === 'rhythm' ? 'strokes' : 'notes'}</span>`);
  const track = el('div', 'track');
  const cells = L.seq.map(tok => { const t = el('div', 'tnote', labelOf(tok)); track.appendChild(t); return t; });

  const tokens = L.kind === 'rhythm' ? [...new Set(L.seq)] : [...new Set(L.seq)].sort((a, b) => RATIO[a] - RATIO[b]);
  const pads = el('div', 'pads'); const padMap = new Map();
  tokens.forEach(tok => {
    const p = el('div', 'pad', `${labelOf(tok)}<small>${tok}</small>`);
    p.addEventListener('pointerdown', e => { e.preventDefault(); onPad(tok, p); });
    pads.appendChild(p); padMap.set(tok, p);
  });

  const status = el('div', 'lesson-status', 'Tap “Listen” to hear it, then “Practice” to play along.');
  const ctrls = el('div', 'lesson-ctrls');
  const listenBtn = el('button', 'pill', '▶ Listen');
  const practiceBtn = el('button', 'pill', '✋ Practice');
  const restartBtn = el('button', 'pill', '↺ Restart');
  const tempoBtn = el('button', 'pill on', L.bpm + ' bpm');
  ctrls.append(listenBtn, practiceBtn, restartBtn, tempoBtn);

  let mode = 'idle', pos = 0, demoTimer = null, bpm = L.bpm;
  const stepMs = () => 60000 / bpm;
  const clearHL = () => { cells.forEach(c => c.classList.remove('now')); padMap.forEach(p => p.classList.remove('target')); };
  const flash = p => { if (!p) return; p.classList.add('good'); setTimeout(() => p.classList.remove('good'), 170); };

  function stopAll() {
    if (demoTimer) { clearInterval(demoTimer); demoTimer = null; }
    mode = 'idle'; clearHL();
    listenBtn.textContent = '▶ Listen'; listenBtn.classList.remove('on');
    practiceBtn.textContent = '✋ Practice'; practiceBtn.classList.remove('on');
  }
  function demo() {
    stopAll(); cells.forEach(c => c.classList.remove('done')); mode = 'demo';
    listenBtn.textContent = '⏸ Stop'; listenBtn.classList.add('on');
    let i = 0;
    const tick = () => {
      clearHL();
      if (i >= L.seq.length) { stopAll(); status.textContent = 'That’s the phrase. Now tap “Practice”.'; return; }
      const tok = L.seq[i]; cells[i].classList.add('now'); flash(padMap.get(tok));
      lessonStrike(L.instr, L.sa, tok); status.textContent = 'Listening…'; i++;
    };
    tick(); demoTimer = setInterval(tick, stepMs());
  }
  function practice() {
    stopAll(); cells.forEach(c => c.classList.remove('done')); mode = 'practice'; pos = 0;
    practiceBtn.textContent = '⏸ Stop'; practiceBtn.classList.add('on'); target();
  }
  function target() {
    clearHL();
    if (pos >= L.seq.length) { return complete(); }
    cells[pos].classList.add('now'); padMap.get(L.seq[pos])?.classList.add('target');
    status.textContent = `Your turn — play ${labelOf(L.seq[pos])}`;
  }
  function complete() {
    mode = 'idle'; clearHL(); cells.forEach(c => c.classList.add('done'));
    status.innerHTML = '<span class="lesson-done">✓ Lesson complete — shabaash!</span>';
    practiceBtn.textContent = '✋ Practice'; practiceBtn.classList.remove('on');
  }
  function onPad(tok, p) {
    Sound.ensure();
    if (mode !== 'practice') { lessonStrike(L.instr, L.sa, tok); flash(p); return; }
    lessonStrike(L.instr, L.sa, tok);
    if (tok === L.seq[pos]) { p.classList.add('good'); setTimeout(() => p.classList.remove('good'), 200); cells[pos].classList.add('done'); pos++; target(); }
    else { p.classList.remove('bad'); void p.offsetWidth; p.classList.add('bad'); setTimeout(() => p.classList.remove('bad'), 300); }
  }
  listenBtn.addEventListener('click', () => mode === 'demo' ? stopAll() : demo());
  practiceBtn.addEventListener('click', () => mode === 'practice' ? stopAll() : practice());
  restartBtn.addEventListener('click', () => { stopAll(); cells.forEach(c => c.classList.remove('done')); pos = 0; status.textContent = 'Tap “Listen” or “Practice” to begin.'; });
  tempoBtn.addEventListener('click', () => { bpm = bpm <= 70 ? 90 : bpm <= 90 ? 120 : 70; tempoBtn.textContent = bpm + ' bpm'; if (mode === 'demo') demo(); });

  stage.append(meta, track, el('div', 'sublabel', 'Tap a pad to play it. In Practice, follow the glowing pad.'), pads, status, ctrls);
  teardown = () => stopAll();
}

/* ---- info panel ---- */
let currentInfo = null, currentName = '';
function openInfo() {
  if (!currentInfo) return;
  $('#infoTitle').textContent = currentName;
  const body = $('#infoBody');
  body.innerHTML = currentInfo.paras.map(([h, p]) => `<h4>${h}</h4><p>${p}</p>`).join('')
    + `<div class="meta"><span>📍 ${currentInfo.region}</span><span>🎼 ${currentInfo.family}</span></div>`;
  $('#infoPanel').hidden = false;
}
function closeInfo() { $('#infoPanel').hidden = true; }

/* ---- boot ---- */
document.addEventListener('DOMContentLoaded', () => {
  buildCards();
  $('#backBtn').addEventListener('click', () => backHandler());
  $('#infoBtn').addEventListener('click', openInfo);
  $('#infoClose').addEventListener('click', closeInfo);
  $('#infoPanel').addEventListener('click', e => { if (e.target.id === 'infoPanel') closeInfo(); });
  $('#lessonsCta').addEventListener('click', openLessonsList);
  $('#volRange').addEventListener('input', e => Sound.setVolume(+e.target.value / 100));

  const droneBtn = $('#droneBtn');
  droneBtn.addEventListener('click', () => {
    const on = Sound.droneToggle();
    droneBtn.setAttribute('aria-pressed', String(on));
  });

  const welcome = $('#welcome');
  const start = () => { Sound.ensure(); welcome.classList.add('hide'); setTimeout(() => welcome.hidden = true, 500); };
  $('#startBtn').addEventListener('click', start);

  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('#infoPanel').hidden) closeInfo(); else if (!$('#stage').hidden) backHandler(); } });
});
