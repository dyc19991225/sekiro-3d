/**
 * Procedural Sengoku WebAudio Synthesizer for Sekiro:
 * - Forged Tamahagane Perfect Deflect ("铛！！" bright multi-harmonic katana ring)
 * - Guard Block ("铿" damped iron clank)
 * - Perilous "危" Warning Sting (metallic biwa scrape + tense harmonic screech + taiko sub)
 * - Mikiri Counter Blade Stomp ("砰·铮！" iron crunch + low shock)
 * - Shinobi Deathblow ("忍杀" heartbeat + blade slash + bronze temple bell)
 * - Way of Tomoe Lightning Crack & Reversal, Firecrackers, Bow, Pistol, Taiko BGM
 */
export class SekiroAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private bgmTimer: number | null = null;
  private bgmBeat = 0;
  private combatIntensity = 0;

  public unlock(): void {
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      this.startTaikoPulse();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  public setIntensity(val: number): void {
    this.combatIntensity = Math.max(0, Math.min(1, val));
  }

  private noiseBuffer(duration: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buf;
  }

  /** Iconic Sekiro Perfect Deflect ("铛！！！") */
  public playPerfectDeflect(comboIndex = 0): void {
    this.unlock();
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    // Slight musical pitch climb during rapid combos (like Genichiro's Floating Passage!)
    const semi = Math.pow(2, ((comboIndex % 7) * 0.65) / 12);

    // High resonant forged katana steel partials
    const freqs = [1185, 1890, 2740, 4120, 5680];
    const gains = [0.42, 0.36, 0.30, 0.18, 0.12];
    const decays = [0.36, 0.44, 0.28, 0.22, 0.15];

    freqs.forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = idx % 2 === 0 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(f * semi * 1.03, now);
      osc.frequency.exponentialRampToValueAtTime(f * semi, now + 0.025);
      g.gain.setValueAtTime(gains[idx], now);
      g.gain.exponentialRampToValueAtTime(0.0008, now + decays[idx]);
      osc.connect(g).connect(this.master);
      osc.start(now);
      osc.stop(now + decays[idx] + 0.02);
    });

    // Crisp metallic spark transient
    const nSrc = ctx.createBufferSource();
    nSrc.buffer = this.noiseBuffer(0.07);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3900 * semi;
    bp.Q.value = 3.2;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.65, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.065);
    nSrc.connect(bp).connect(ng).connect(this.master);
    nSrc.start(now);

    // Low chest punch for visceral weight
    const sub = ctx.createOscillator();
    const sg = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(165, now);
    sub.frequency.exponentialRampToValueAtTime(48, now + 0.09);
    sg.gain.setValueAtTime(0.42, now);
    sg.gain.exponentialRampToValueAtTime(0.001, now + 0.095);
    sub.connect(sg).connect(this.master);
    sub.start(now);
    sub.stop(now + 0.1);
  }

  /** Normal Guard Block ("铿" duller iron block) */
  public playBlock(): void {
    this.unlock();
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    [540, 860, 1420].forEach((f, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, now);
      osc.frequency.exponentialRampToValueAtTime(f * 0.88, now + 0.11);
      g.gain.setValueAtTime(0.24 / (i + 1), now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.connect(g).connect(this.master);
      osc.start(now);
      osc.stop(now + 0.13);
    });
  }

  /** Sword Whoosh / Blade Slash */
  public playSlash(heavy = false, mortal = false): void {
    this.unlock();
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const dur = heavy ? 0.26 : 0.15;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(dur);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(heavy ? 620 : 980, now);
    filter.frequency.exponentialRampToValueAtTime(heavy ? 2200 : 2800, now + dur * 0.45);
    filter.frequency.exponentialRampToValueAtTime(420, now + dur);
    filter.Q.value = mortal ? 4.2 : 2.1;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.01, now);
    g.gain.linearRampToValueAtTime(heavy ? 0.42 : 0.26, now + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(now);

    if (mortal) {
      const eerie = ctx.createOscillator();
      const eg = ctx.createGain();
      eerie.type = 'sawtooth';
      eerie.frequency.setValueAtTime(220, now);
      eerie.frequency.exponentialRampToValueAtTime(92, now + 0.34);
      eg.gain.setValueAtTime(0.18, now);
      eg.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      eerie.connect(eg).connect(this.master);
      eerie.start(now);
      eerie.stop(now + 0.36);
    }
  }

  /** Flesh Hit / Blood Cut */
  public playFleshHit(heavy = false): void {
    this.unlock();
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(heavy ? 190 : 240, now);
    osc.frequency.exponentialRampToValueAtTime(45, now + 0.14);
    g.gain.setValueAtTime(heavy ? 0.48 : 0.32, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(g).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.16);

    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer(0.11);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.35, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    n.connect(lp).connect(ng).connect(this.master);
    n.start(now);
  }

  /** Iconic Perilous "危" Kanji Warning Sound! */
  public playPerilousWarning(): void {
    this.unlock();
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    // Dissonant metallic screech-chime + taiko drop
    [740, 1085, 1520].forEach((f, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = i === 1 ? 'sawtooth' : 'sine';
      osc.frequency.setValueAtTime(f * 0.94, now);
      osc.frequency.linearRampToValueAtTime(f * 1.06, now + 0.12);
      osc.frequency.exponentialRampToValueAtTime(f * 0.98, now + 0.42);
      g.gain.setValueAtTime(i === 1 ? 0.16 : 0.25, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.44);
      osc.connect(g).connect(this.master);
      osc.start(now);
      osc.stop(now + 0.45);
    });
  }

  /** Mikiri Counter ("识破/看破" Step on Blade!) */
  public playMikiriCounter(): void {
    this.unlock();
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    // Heavy metallic stomp + sub-bass boom + singing blade ring
    const boom = ctx.createOscillator();
    const bg = ctx.createGain();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(150, now);
    boom.frequency.exponentialRampToValueAtTime(34, now + 0.35);
    bg.gain.setValueAtTime(0.7, now);
    bg.gain.exponentialRampToValueAtTime(0.001, now + 0.36);
    boom.connect(bg).connect(this.master);
    boom.start(now);
    boom.stop(now + 0.37);

    [920, 1640, 2980].forEach((f) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(f, now + 0.02);
      g.gain.setValueAtTime(0.32, now + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.52);
      o.connect(g).connect(this.master);
      o.start(now + 0.02);
      o.stop(now + 0.54);
    });
  }

  /** Shinobi Execution ("忍杀" Temple Gong + Crimson Rend) */
  public playDeathblow(finalKill = false): void {
    this.unlock();
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    this.playFleshHit(true);

    // Deep resonant Buddhist bronze bell / gong
    const bellFreqs = finalKill ? [110, 220, 338, 512, 780] : [146, 293, 448, 690];
    bellFreqs.forEach((f, idx) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, now + 0.06);
      g.gain.setValueAtTime(0.38 / (idx * 0.65 + 1), now + 0.06);
      g.gain.exponentialRampToValueAtTime(0.0008, now + (finalKill ? 2.4 : 1.4));
      o.connect(g).connect(this.master);
      o.start(now + 0.06);
      o.stop(now + (finalKill ? 2.45 : 1.45));
    });
  }

  /** Way of Tomoe Lightning Crack & Reversal */
  public playLightning(): void {
    this.unlock();
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer(0.45);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.6, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.44);
    n.connect(hp).connect(g).connect(this.master);
    n.start(now);

    const zap = ctx.createOscillator();
    const zg = ctx.createGain();
    zap.type = 'sawtooth';
    zap.frequency.setValueAtTime(680, now);
    zap.frequency.exponentialRampToValueAtTime(75, now + 0.35);
    zg.gain.setValueAtTime(0.32, now);
    zg.gain.exponentialRampToValueAtTime(0.001, now + 0.36);
    zap.connect(zg).connect(this.master);
    zap.start(now);
    zap.stop(now + 0.37);
  }

  /** Shinobi Firecracker Blast ("罗伯特爆竹") */
  public playFirecracker(): void {
    this.unlock();
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    for (let i = 0; i < 4; i++) {
      const t = now + i * 0.038;
      const n = ctx.createBufferSource();
      n.buffer = this.noiseBuffer(0.09);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.55, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.085);
      n.connect(g).connect(this.master);
      n.start(t);
    }
  }

  /** Pistol Shot / Bow Twang / Sword Glint */
  public playWeaponSpecial(kind: 'glint' | 'bow' | 'pistol' | 'gourd'): void {
    this.unlock();
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    if (kind === 'glint') {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(2650, now);
      o.frequency.exponentialRampToValueAtTime(3950, now + 0.16);
      g.gain.setValueAtTime(0.24, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      o.connect(g).connect(this.master);
      o.start(now);
      o.stop(now + 0.23);
    } else if (kind === 'bow') {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(195, now);
      o.frequency.exponentialRampToValueAtTime(98, now + 0.16);
      g.gain.setValueAtTime(0.32, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.17);
      o.connect(g).connect(this.master);
      o.start(now);
      o.stop(now + 0.18);
    } else if (kind === 'pistol') {
      const n = ctx.createBufferSource();
      n.buffer = this.noiseBuffer(0.16);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.62, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      n.connect(g).connect(this.master);
      n.start(now);
    } else if (kind === 'gourd') {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(420, now);
      o.frequency.exponentialRampToValueAtTime(790, now + 0.25);
      g.gain.setValueAtTime(0.22, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      o.connect(g).connect(this.master);
      o.start(now);
      o.stop(now + 0.29);
    }
  }

  private startTaikoPulse(): void {
    if (this.bgmTimer !== null) return;
    this.bgmTimer = window.setInterval(() => {
      if (!this.ctx || this.ctx.state !== 'running' || this.combatIntensity <= 0.05) return;
      const pattern = [1, 0, 0.45, 0, 0.75, 0, 0.35, 0.6];
      const amp = pattern[this.bgmBeat % pattern.length] * this.combatIntensity * 0.24;
      this.bgmBeat++;
      if (amp <= 0.01) return;
      const now = this.ctx.currentTime;
      const drum = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      drum.type = 'sine';
      drum.frequency.setValueAtTime(this.bgmBeat % 4 === 1 ? 82 : 64, now);
      drum.frequency.exponentialRampToValueAtTime(32, now + 0.22);
      g.gain.setValueAtTime(amp, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      drum.connect(g).connect(this.master);
      drum.start(now);
      drum.stop(now + 0.25);
    }, 260);
  }
}
