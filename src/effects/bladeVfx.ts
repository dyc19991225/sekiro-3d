import * as THREE from 'three';
import type { TrailStyle } from '../types';

interface TrailSample {
  base: THREE.Vector3;
  tip: THREE.Vector3;
  age: number;
}

export class SwordRibbonTrail {
  public readonly mesh: THREE.Mesh;
  private readonly maxSamples = 28;
  private samples: TrailSample[] = [];
  private posAttr: THREE.BufferAttribute;
  private uvAttr: THREE.BufferAttribute;
  private mat: THREE.ShaderMaterial;
  private active = false;

  constructor(scene: THREE.Scene) {
    const vertsCount = this.maxSamples * 2;
    const positions = new Float32Array(vertsCount * 3);
    const uvs = new Float32Array(vertsCount * 2);
    const indices: number[] = [];

    for (let i = 0; i < this.maxSamples - 1; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, c, b, d, c);
    }

    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(positions, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.uvAttr = new THREE.BufferAttribute(uvs, 2);
    this.uvAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('uv', this.uvAttr);
    geo.setIndex(indices);

    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uCoreColor: { value: new THREE.Color(0xe8f4ff) },
        uEdgeColor: { value: new THREE.Color(0x5ca8ff) },
        uOpacity: { value: 0.92 },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uCoreColor;
        uniform vec3 uEdgeColor;
        uniform float uOpacity;
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          // vUv.x = 0 (newest head) -> 1 (oldest tail), vUv.y = 0 (hilt base) -> 1 (blade tip)
          float lifeFade = pow(max(0.0, 1.0 - vUv.x), 1.65);
          float bladeProfile = smoothstep(0.05, 0.45, vUv.y);
          float razorTip = smoothstep(0.72, 0.99, vUv.y);
          float streak = 0.78 + 0.22 * sin(vUv.y * 28.0 - vUv.x * 14.0 + uTime * 22.0);
          vec3 col = mix(uEdgeColor, uCoreColor, razorTip * 0.85 + (1.0 - vUv.x) * 0.35);
          float alpha = lifeFade * bladeProfile * streak * uOpacity;
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(col * (1.15 + razorTip * 0.8), alpha);
        }
      `,
    });

    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    scene.add(this.mesh);
  }

  public setStyle(style: TrailStyle): void {
    const core = this.mat.uniforms.uCoreColor.value as THREE.Color;
    const edge = this.mat.uniforms.uEdgeColor.value as THREE.Color;
    switch (style) {
      case 'mortal':
        core.setHex(0xff384c);
        edge.setHex(0x6e0514);
        this.mat.uniforms.uOpacity.value = 1.0;
        break;
      case 'lightning':
        core.setHex(0xfffbe0);
        edge.setHex(0xffb418);
        this.mat.uniforms.uOpacity.value = 1.0;
        break;
      case 'wind_wave':
        core.setHex(0xffffff);
        edge.setHex(0x9fd6ff);
        this.mat.uniforms.uOpacity.value = 0.98;
        break;
      case 'fire':
        core.setHex(0xffe08a);
        edge.setHex(0xff4a12);
        this.mat.uniforms.uOpacity.value = 0.96;
        break;
      case 'boss_steel':
        core.setHex(0xfff1dc);
        edge.setHex(0x8aa8d8);
        this.mat.uniforms.uOpacity.value = 0.88;
        break;
      default:
        core.setHex(0xf0f8ff);
        edge.setHex(0x68a8eb);
        this.mat.uniforms.uOpacity.value = 0.9;
        break;
    }
  }

  public setActive(on: boolean): void {
    if (on && !this.active) {
      this.samples.length = 0;
    }
    this.active = on;
  }

  public recordAndUpdate(baseWorld: THREE.Vector3, tipWorld: THREE.Vector3, dt: number, elapsed: number): void {
    this.mat.uniforms.uTime.value = elapsed;

    if (this.active) {
      if (this.samples.length > 0) {
        // Interpolate midpoints when blade moves fast so crescent arc is silky smooth!
        const prev = this.samples[0];
        const tipDist = prev.tip.distanceTo(tipWorld);
        const subSteps = Math.min(4, Math.max(1, Math.ceil(tipDist / 0.24)));
        for (let s = 1; s <= subSteps; s++) {
          const t = s / subSteps;
          this.samples.unshift({
            base: prev.base.clone().lerp(baseWorld, t),
            tip: prev.tip.clone().lerp(tipWorld, t),
            age: 0,
          });
        }
      } else {
        this.samples.unshift({ base: baseWorld.clone(), tip: tipWorld.clone(), age: 0 });
      }
    }

    const maxAge = 0.16;
    for (let i = this.samples.length - 1; i >= 0; i--) {
      this.samples[i].age += dt;
      if (this.samples[i].age > maxAge || i >= this.maxSamples) {
        this.samples.splice(i, 1);
      }
    }

    if (this.samples.length < 2) {
      this.mesh.visible = false;
      return;
    }

    this.mesh.visible = true;
    const arr = this.posAttr.array as Float32Array;
    const uvs = this.uvAttr.array as Float32Array;
    const count = this.samples.length;

    for (let i = 0; i < this.maxSamples; i++) {
      const smp = this.samples[Math.min(i, count - 1)];
      const u = Math.min(1, smp.age / maxAge);
      const vi = i * 6;
      arr[vi] = smp.base.x;
      arr[vi + 1] = smp.base.y;
      arr[vi + 2] = smp.base.z;
      arr[vi + 3] = smp.tip.x;
      arr[vi + 4] = smp.tip.y;
      arr[vi + 5] = smp.tip.z;

      const ui = i * 4;
      uvs[ui] = u;
      uvs[ui + 1] = 0;
      uvs[ui + 2] = u;
      uvs[ui + 3] = 1;
    }
    this.posAttr.needsUpdate = true;
    this.uvAttr.needsUpdate = true;
  }
}

interface SparkParticle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  gravity: number;
  isBlood: boolean;
}

interface SlashArcEffect {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  growSpeed: number;
}

export class BladeVfxManager {
  private scene: THREE.Scene;
  private sparks: SparkParticle[] = [];
  private arcs: SlashArcEffect[] = [];
  private rings: { mesh: THREE.Mesh; life: number; maxLife: number; maxScale: number }[] = [];
  private clashLight: THREE.PointLight;
  private clashLightTimer = 0;

  private sparkGeo: THREE.BoxGeometry;
  private bloodGeo: THREE.SphereGeometry;
  private arcGeo: THREE.RingGeometry;
  private ringGeo: THREE.RingGeometry;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.sparkGeo = new THREE.BoxGeometry(0.024, 0.024, 0.28);
    this.bloodGeo = new THREE.SphereGeometry(0.055, 6, 6);
    this.arcGeo = new THREE.RingGeometry(0.85, 1.48, 28, 1, -Math.PI * 0.42, Math.PI * 0.84);
    this.ringGeo = new THREE.RingGeometry(0.18, 0.34, 32);

    this.clashLight = new THREE.PointLight(0xffb84d, 0, 12, 1.6);
    scene.add(this.clashLight);
  }

  /** Blinding Sekiro Perfect Deflect / Guard Clash Sparks + Shockwave Ring ("刀光剑影·弹反火花") */
  public spawnClash(pos: THREE.Vector3, perfect: boolean, lightning = false): void {
    const count = perfect ? 34 : 14;
    const baseHex = lightning ? 0xffe866 : perfect ? 0xffae34 : 0x9ec4ff;
    const coreHex = 0xffffff;

    this.clashLight.color.setHex(baseHex);
    this.clashLight.position.copy(pos);
    this.clashLight.intensity = perfect ? 18 : 6.5;
    this.clashLightTimer = perfect ? 0.14 : 0.07;

    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: i % 3 === 0 ? coreHex : baseHex,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      });
      const m = new THREE.Mesh(this.sparkGeo, mat);
      m.position.copy(pos);
      const theta = Math.random() * Math.PI * 2;
      const phi = (Math.random() - 0.32) * Math.PI * 0.85;
      const spd = (perfect ? 7.5 : 4.2) + Math.random() * (perfect ? 11.5 : 5.0);
      const vel = new THREE.Vector3(
        Math.cos(theta) * Math.cos(phi) * spd,
        Math.sin(phi) * spd + 1.8,
        Math.sin(theta) * Math.cos(phi) * spd
      );
      m.lookAt(pos.clone().add(vel));
      this.scene.add(m);
      this.sparks.push({
        mesh: m,
        vel,
        life: 0,
        maxLife: (perfect ? 0.28 : 0.16) + Math.random() * 0.18,
        gravity: 19.5,
        isBlood: false,
      });
    }

    // Golden-white Deflect Shockwave Ring + Anamorphic Cross-Flash!
    const ringMat = new THREE.MeshBasicMaterial({
      color: baseHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: perfect ? 0.95 : 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(this.ringGeo, ringMat);
    ring.position.copy(pos);
    ring.rotation.set(Math.random() * 0.8, Math.random() * Math.PI, Math.random() * 0.8);
    this.scene.add(ring);
    this.rings.push({
      mesh: ring,
      life: 0,
      maxLife: perfect ? 0.22 : 0.14,
      maxScale: perfect ? 5.6 : 2.6,
    });

    if (perfect) {
      // Secondary perpendicular flash ring for 3D anime/Sekiro blade-clash cross flare
      const ring2 = new THREE.Mesh(this.ringGeo, ringMat.clone());
      ring2.position.copy(pos);
      ring2.rotation.set(Math.PI * 0.5, 0, Math.random() * Math.PI);
      this.scene.add(ring2);
      this.rings.push({
        mesh: ring2,
        life: 0,
        maxLife: 0.18,
        maxScale: 4.4,
      });
    }
  }

  /** Sword Glint ("居合寒光") when Isshin / Genichiro charges Ashina Cross or Perilous Thrust */
  public spawnSwordGlint(pos: THREE.Vector3, crimson = false): void {
    const hex = crimson ? 0xff2838 : 0xe8f6ff;
    for (let i = 0; i < 2; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: hex,
        transparent: true,
        opacity: 1.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const flare = new THREE.Mesh(new THREE.PlaneGeometry(i === 0 ? 1.8 : 0.14, i === 0 ? 0.14 : 1.8), mat);
      flare.position.copy(pos);
      this.scene.add(flare);
      this.rings.push({ mesh: flare, life: 0, maxLife: 0.24, maxScale: 1.8 });
    }
  }

  /** 3D Crescent Sword-Qi Slash Arc ("剑气刀芒": Mortal Draw, Ashina Cross, Ichimonji, Dragon Flash) */
  public spawnSlashWave(
    pos: THREE.Vector3,
    forward: THREE.Vector3,
    tiltRad: number,
    style: TrailStyle,
    travelSpeed = 0
  ): void {
    let hex = 0xdff2ff;
    if (style === 'mortal') hex = 0xff1e38;
    else if (style === 'lightning') hex = 0xffd83b;
    else if (style === 'fire') hex = 0xff5a18;
    else if (style === 'wind_wave') hex = 0xf5fbff;

    const mat = new THREE.MeshBasicMaterial({
      color: hex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const arc = new THREE.Mesh(this.arcGeo, mat);
    arc.position.copy(pos);
    const yaw = Math.atan2(forward.x, forward.z);
    arc.rotation.order = 'YXZ';
    arc.rotation.y = yaw;
    arc.rotation.x = Math.PI * 0.5;
    arc.rotation.z = tiltRad;
    // Rotate local Z so the ring open side faces +forward
    arc.rotateZ(-Math.PI * 0.5);

    this.scene.add(arc);
    this.arcs.push({
      mesh: arc,
      vel: forward.clone().normalize().multiplyScalar(travelSpeed),
      life: 0,
      maxLife: travelSpeed > 2 ? 0.65 : 0.22,
      growSpeed: travelSpeed > 2 ? 2.4 : 4.2,
    });
  }

  /** Blood & Sumi-e Ink Spray on Vitality Hit / Shinobi Deathblow */
  public spawnBloodSpray(pos: THREE.Vector3, dir: THREE.Vector3, deathblow = false): void {
    const count = deathblow ? 42 : 16;
    for (let i = 0; i < count; i++) {
      const isInk = i % 4 === 0;
      const mat = new THREE.MeshBasicMaterial({
        color: isInk ? 0x180608 : i % 2 === 0 ? 0xb80d18 : 0x7a060d,
        transparent: true,
        opacity: 0.92,
      });
      const m = new THREE.Mesh(this.bloodGeo, mat);
      m.position.copy(pos);
      const spd = (deathblow ? 5.5 : 3.0) + Math.random() * (deathblow ? 8.5 : 4.2);
      const vel = dir
        .clone()
        .add(new THREE.Vector3((Math.random() - 0.5) * 1.4, Math.random() * 0.9 + 0.2, (Math.random() - 0.5) * 1.4))
        .normalize()
        .multiplyScalar(spd);
      m.scale.setScalar(deathblow ? 1.35 : 0.85);
      this.scene.add(m);
      this.sparks.push({
        mesh: m,
        vel,
        life: 0,
        maxLife: (deathblow ? 0.62 : 0.35) + Math.random() * 0.25,
        gravity: 15.0,
        isBlood: true,
      });
    }
  }

  /** Prosthetic Firecracker / Flame Vent Cone / Lightning Burst */
  public spawnBurstCone(pos: THREE.Vector3, forward: THREE.Vector3, mode: 'firecracker' | 'flame' | 'lightning'): void {
    const count = mode === 'lightning' ? 36 : 28;
    const hexA = mode === 'firecracker' ? 0xfff4c2 : mode === 'flame' ? 0xff6218 : 0xfff68f;
    const hexB = mode === 'firecracker' ? 0xff8822 : mode === 'flame' ? 0xffaa22 : 0xffaa00;

    this.clashLight.color.setHex(hexA);
    this.clashLight.position.copy(pos).addScaledVector(forward, 1.2);
    this.clashLight.intensity = 22;
    this.clashLightTimer = 0.22;

    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? hexA : hexB,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const m = new THREE.Mesh(this.sparkGeo, mat);
      m.position.copy(pos);
      const spread = mode === 'lightning' ? 1.8 : 0.85;
      const vel = forward
        .clone()
        .add(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.2) * spread, (Math.random() - 0.5) * spread))
        .normalize()
        .multiplyScalar(6 + Math.random() * 9);
      m.lookAt(pos.clone().add(vel));
      m.scale.set(1.5, 1.5, mode === 'lightning' ? 2.4 : 1.4);
      this.scene.add(m);
      this.sparks.push({
        mesh: m,
        vel,
        life: 0,
        maxLife: 0.28 + Math.random() * 0.22,
        gravity: mode === 'flame' ? -3.5 : 8.0,
        isBlood: false,
      });
    }
  }

  public update(dt: number, cameraPos: THREE.Vector3): void {
    if (this.clashLightTimer > 0) {
      this.clashLightTimer -= dt;
      if (this.clashLightTimer <= 0) this.clashLight.intensity = 0;
      else this.clashLight.intensity *= 0.82;
    }

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life += dt;
      if (s.life >= s.maxLife) {
        this.scene.remove(s.mesh);
        (s.mesh.material as THREE.Material).dispose();
        this.sparks.splice(i, 1);
        continue;
      }
      s.vel.y -= s.gravity * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      if (s.mesh.position.y < 0.03) {
        s.mesh.position.y = 0.03;
        s.vel.y *= -0.35;
        s.vel.x *= 0.7;
        s.vel.z *= 0.7;
      }
      if (!s.isBlood) {
        s.mesh.lookAt(s.mesh.position.clone().add(s.vel));
      }
      const alpha = 1 - s.life / s.maxLife;
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = alpha;
    }

    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const a = this.arcs[i];
      a.life += dt;
      if (a.life >= a.maxLife) {
        this.scene.remove(a.mesh);
        (a.mesh.material as THREE.Material).dispose();
        this.arcs.splice(i, 1);
        continue;
      }
      a.mesh.position.addScaledVector(a.vel, dt);
      a.mesh.scale.addScalar(a.growSpeed * dt);
      (a.mesh.material as THREE.MeshBasicMaterial).opacity = Math.pow(1 - a.life / a.maxLife, 1.4) * 0.9;
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life += dt;
      if (r.life >= r.maxLife) {
        this.scene.remove(r.mesh);
        (r.mesh.material as THREE.Material).dispose();
        if (r.mesh.geometry !== this.ringGeo) r.mesh.geometry.dispose();
        this.rings.splice(i, 1);
        continue;
      }
      const t = r.life / r.maxLife;
      const sc = 0.4 + t * r.maxScale;
      r.mesh.scale.setScalar(sc);
      if (r.mesh.geometry !== this.ringGeo) {
        r.mesh.lookAt(cameraPos);
      }
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.92;
    }
  }
}
