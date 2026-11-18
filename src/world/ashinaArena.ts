import * as THREE from 'three';
import type { LoadedSekiroAssets } from '../assets/assetLoader';

/**
 * Ashina Reservoir Moonlit Silvergrass Field ("苇名底·月下芒草旷野"):
 * - Giant full moon + night-mist dome + Phase 3 Way of Tomoe thundercloud flashes
 * - 18,000 GPU-instanced swaying Susuki silvergrass stalks & white plumes that part dynamically around Wolf & Boss!
 * - Sculpted Blender Torii gate, Ruined Ashina Watchtower Pagoda, Sculptor's Idol (鬼佛), Stone Lanterns, Banners, Cliffs
 * - Floating moonlit silvergrass seeds / fireflies
 */
export class AshinaArena {
  public readonly arenaRadius = 25.5;
  private grassMat!: THREE.ShaderMaterial;
  private skyMat!: THREE.ShaderMaterial;
  private moonLight!: THREE.DirectionalLight;
  private stormFlash = 0;
  private stormMode = false;
  private seedsPoints!: THREE.Points;
  private bannerCloths: THREE.Object3D[] = [];

  constructor(private scene: THREE.Scene, assets: LoadedSekiroAssets) {
    this.buildSkyAndMoon();
    this.buildLighting();
    this.buildTerrain(assets);
    this.buildLandmarks(assets);
    this.buildSilvergrassField();
    this.buildFloatingSeeds();
  }

  public setStormMode(on: boolean): void {
    this.stormMode = on;
  }

  public triggerLightningFlash(): void {
    this.stormFlash = 1.0;
  }

  private buildSkyAndMoon(): void {
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uStorm: { value: 0 },
        uFlash: { value: 0 },
        uMoonDir: { value: new THREE.Vector3(0.0, 0.34, -0.94).normalize() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldDir;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldDir = normalize(wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uStorm;
        uniform float uFlash;
        uniform vec3 uMoonDir;
        varying vec3 vWorldDir;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                     mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
        }

        void main() {
          vec3 d = normalize(vWorldDir);
          float h = clamp(d.y, -0.1, 1.0);

          vec3 zenith = mix(vec3(0.035, 0.055, 0.105), vec3(0.02, 0.022, 0.04), uStorm);
          vec3 horizon = mix(vec3(0.11, 0.155, 0.23), vec3(0.08, 0.075, 0.11), uStorm);
          vec3 col = mix(horizon, zenith, pow(max(0.0, h), 0.62));

          // Giant Ashina Full Moon
          float moonCos = dot(d, uMoonDir);
          float moonDisc = smoothstep(0.9865, 0.9882, moonCos);
          float moonHalo = pow(max(0.0, moonCos), 26.0) * 0.45 + pow(max(0.0, moonCos), 6.0) * 0.14;
          float crater = noise(d.xy * 18.0 + 3.1) * 0.16;
          vec3 moonCol = vec3(0.95, 0.97, 1.0) * (1.0 - crater);

          // Drifting Sengoku night clouds across the moon
          vec2 cloudUv = d.xz / max(0.14, d.y + 0.18) * 1.4 + vec2(uTime * 0.018, uTime * 0.008);
          float cld = noise(cloudUv) * 0.6 + noise(cloudUv * 2.3 - uTime * 0.02) * 0.4;
          float cloudMask = smoothstep(0.42 - uStorm * 0.18, 0.82, cld) * smoothstep(0.0, 0.22, d.y);

          col += vec3(0.62, 0.74, 0.95) * moonHalo * (1.0 - uStorm * 0.35);
          col = mix(col, moonCol, moonDisc * (1.0 - cloudMask * 0.62));
          col = mix(col, vec3(0.04, 0.05, 0.08), cloudMask * (0.48 + uStorm * 0.38));

          // Storm lightning flash in Phase 3 Way of Tomoe
          col += vec3(0.95, 0.88, 0.62) * uFlash * 0.65;

          // Distant mountain silhouette band near horizon
          float mtnAngle = atan(d.x, d.z);
          float mtnHeight = 0.055 + 0.045 * sin(mtnAngle * 5.0 + 1.2) + 0.025 * cos(mtnAngle * 13.0);
          float mtnMask = smoothstep(mtnHeight + 0.012, mtnHeight - 0.008, d.y);
          col = mix(col, vec3(0.028, 0.038, 0.06), mtnMask * 0.88);

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    const skyDome = new THREE.Mesh(new THREE.SphereGeometry(190, 40, 24), this.skyMat);
    this.scene.add(skyDome);
    this.scene.fog = new THREE.FogExp2(0x131b29, 0.0145);
  }

  private buildLighting(): void {
    const hemi = new THREE.HemisphereLight(0x6f8fc4, 0x1e221b, 1.05);
    this.scene.add(hemi);

    this.moonLight = new THREE.DirectionalLight(0xcde0ff, 2.35);
    this.moonLight.position.set(0, 26, -56);
    this.moonLight.castShadow = true;
    this.moonLight.shadow.mapSize.set(2048, 2048);
    this.moonLight.shadow.camera.near = 5;
    this.moonLight.shadow.camera.far = 120;
    const d = 32;
    this.moonLight.shadow.camera.left = -d;
    this.moonLight.shadow.camera.right = d;
    this.moonLight.shadow.camera.top = d;
    this.moonLight.shadow.camera.bottom = -d;
    this.moonLight.shadow.bias = -0.0005;
    this.scene.add(this.moonLight);

    // Subtle warm rim from Sculptor's Idol & Stone Lanterns
    const idolLight = new THREE.PointLight(0x3ba4ff, 3.2, 14, 1.6);
    idolLight.position.set(-8.5, 1.6, 17.5);
    this.scene.add(idolLight);

    const lanternL = new THREE.PointLight(0xffa43b, 3.6, 15, 1.6);
    lanternL.position.set(-5.2, 2.1, -21.5);
    this.scene.add(lanternL);

    const lanternR = new THREE.PointLight(0xffa43b, 3.6, 15, 1.6);
    lanternR.position.set(5.2, 2.1, -21.5);
    this.scene.add(lanternR);
  }

  private buildTerrain(assets: LoadedSekiroAssets): void {
    const geo = new THREE.PlaneGeometry(150, 150, 72, 72);
    geo.rotateX(-Math.PI * 0.5);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const r = Math.hypot(x, z);
      // Keep entire playable arena & Torii gate zone (r <= 31m) flat, gently roll low distant hills outside
      const rim = Math.max(0, r - 31.0);
      const y = Math.min(4.2, rim * 0.11) + Math.sin(x * 0.14) * Math.cos(z * 0.14) * (r > 29 ? 0.35 : 0.02);
      pos.setY(i, y);
    }
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      map: assets.groundColorTex,
      color: 0x7e8a96,
      roughness: 0.92,
      metalness: 0.05,
    });
    const ground = new THREE.Mesh(geo, mat);
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  private buildLandmarks(assets: LoadedSekiroAssets): void {
    const src = assets.weaponsAndArena;
    const spawnProp = (name: string, x: number, y: number, z: number, ry = 0, scale = 1): THREE.Object3D | null => {
      const tpl = src.getObjectByName(name);
      if (!tpl) return null;
      const clone = tpl.clone(true);
      clone.position.set(x, y, z);
      clone.rotation.y = ry;
      clone.scale.setScalar(scale);
      this.scene.add(clone);
      return clone;
    };

    // North Moon-Framing Weathered Torii Gate & Ashina Secret Passage Watchtower Pagoda
    spawnProp('ENV_ToriiGate', 0, 0, -25.8, 0, 1.08);
    spawnProp('ENV_RuinedPagoda', -17.5, 0.2, -32.0, 0.42, 1.05);

    // South Entrance Sculptor's Idol ("鬼佛") near player spawn
    spawnProp('ENV_SculptorIdol', -7.8, 0, 18.2, -0.55, 1.15);

    // Flanking Mossy Stone Lanterns
    spawnProp('ENV_StoneLantern', -5.2, 0, -22.2, 0.2, 1.0);
    spawnProp('ENV_StoneLantern', 5.2, 0, -22.2, -0.2, 1.0);
    spawnProp('ENV_StoneLantern', -9.4, 0, 17.5, 0.4, 0.92);

    // Tattered Sengoku War Banners around the battlefield perimeter
    const bannerCoords = [
      [-15.5, -18.5, 0.3],
      [15.8, -17.8, -0.4],
      [-22.5, 4.2, 1.1],
      [22.8, 5.5, -1.2],
      [13.2, 20.4, -2.4],
    ];
    for (const [bx, bz, bry] of bannerCoords) {
      const b = spawnProp('ENV_WarBanner', bx, 0, bz, bry, 1.05);
      if (b) {
        const cloth = b.getObjectByName('Banner_FlagCloth');
        if (cloth) this.bannerCloths.push(cloth);
      }
    }

    // Perimeter Jagged Cliff Rocks enclosing the 25.5m arena naturally!
    const rockCount = 26;
    for (let i = 0; i < rockCount; i++) {
      const ang = (i / rockCount) * Math.PI * 2;
      // Leave slight visual gap straight north behind Torii gate so full moon reflects clearly
      if (Math.abs(Math.sin(ang)) < 0.22 && Math.cos(ang) < -0.9) continue;
      const rad = 27.6 + (i % 3) * 1.8;
      const x = Math.sin(ang) * rad;
      const z = Math.cos(ang) * rad;
      const sc = 1.25 + (i % 4) * 0.38;
      spawnProp('ENV_CliffRock', x, -0.2, z, ang * 1.7, sc);
    }
  }

  /** 18,000 GPU-Instanced Moonlit Susuki Silvergrass ("芒草") Stalks with Wind & Fighter Parting! */
  private buildSilvergrassField(): void {
    const count = 18000;
    // Tapered curved grass blade + feathery silver plume tip (5 height segments)
    const segs = 5;
    const bladeGeo = new THREE.BufferGeometry();
    const verts: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const y = t * 1.38;
      // Slight natural droop forward + feathery plume widening near top (t ~ 0.8)
      const plume = t > 0.68 ? Math.sin(((t - 0.68) / 0.32) * Math.PI) * 0.028 : 0;
      const w = (1.0 - t * 0.82) * 0.032 + plume;
      const bendZ = t * t * 0.24;
      verts.push(-w, y, bendZ, w, y, bendZ);
      uvs.push(0, t, 1, t);
      if (s < segs) {
        const b = s * 2;
        indices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      }
    }
    bladeGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    bladeGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    bladeGeo.setIndex(indices);
    bladeGeo.computeVertexNormals();

    this.grassMat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uPlayerPos: { value: new THREE.Vector3(0, 0, 8) },
        uBossPos: { value: new THREE.Vector3(0, 0, -8) },
        uStorm: { value: 0 },
        uFlash: { value: 0 },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uPlayerPos;
        uniform vec3 uBossPos;
        uniform float uStorm;
        varying float vHeight;
        varying float vShade;

        void main() {
          vHeight = uv.y;
          vec4 worldOrigin = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          vec4 wp = instanceMatrix * vec4(position, 1.0);

          float bendFactor = uv.y * uv.y;
          float windSpd = 2.1 + uStorm * 2.4;
          float gust = sin(worldOrigin.x * 0.16 + worldOrigin.z * 0.12 + uTime * windSpd)
                     + 0.5 * cos(worldOrigin.x * 0.35 - uTime * (windSpd * 1.4));
          wp.x += gust * (0.22 + uStorm * 0.22) * bendFactor;
          wp.z += gust * 0.14 * bendFactor;

          // Dynamic fighter trample/parting around Wolf and Boss!
          vec2 toP = wp.xz - uPlayerPos.xz;
          float dP = length(toP);
          if (dP < 1.85 && dP > 0.001) {
            float push = (1.0 - dP / 1.85) * 0.95 * bendFactor;
            wp.xz += normalize(toP) * push;
            wp.y -= push * 0.38;
          }

          vec2 toB = wp.xz - uBossPos.xz;
          float dB = length(toB);
          if (dB < 2.25 && dB > 0.001) {
            float pushB = (1.0 - dB / 2.25) * 1.15 * bendFactor;
            wp.xz += normalize(toB) * pushB;
            wp.y -= pushB * 0.42;
          }

          vShade = 0.55 + 0.45 * sin(worldOrigin.x * 0.7 + worldOrigin.z * 0.9);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uFlash;
        varying float vHeight;
        varying float vShade;

        void main() {
          // Dark slate-olive stalk base -> silvery moonlit Susuki plume tip!
          vec3 baseCol = vec3(0.08, 0.11, 0.12) * vShade;
          vec3 midCol = vec3(0.24, 0.28, 0.30) * (0.8 + 0.2 * vShade);
          vec3 plumeCol = vec3(0.76, 0.82, 0.90);

          vec3 col = mix(baseCol, midCol, smoothstep(0.0, 0.65, vHeight));
          col = mix(col, plumeCol, smoothstep(0.66, 0.98, vHeight));
          col += vec3(0.7, 0.65, 0.45) * uFlash * 0.4 * vHeight;

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    const inst = new THREE.InstancedMesh(bladeGeo, this.grassMat, count);
    inst.frustumCulled = false;
    const dummy = new THREE.Object3D();

    let idx = 0;
    let seed = 1337;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    while (idx < count) {
      const r = Math.sqrt(rand()) * 27.5;
      const ang = rand() * Math.PI * 2;
      const x = Math.cos(ang) * r;
      const z = Math.sin(ang) * r;

      // Leave a wider worn dueling clearing down the center & scale down inner stalks so Wolf & Boss silhouettes read clearly!
      const centerClear = Math.exp(-(x * x) / 36.0) * Math.exp(-(z * z) / 220.0);
      if (rand() < centerClear * 0.84) continue;

      dummy.position.set(x, 0, z);
      dummy.rotation.set((rand() - 0.5) * 0.18, rand() * Math.PI * 2, (rand() - 0.5) * 0.18);
      const innerShorten = 0.52 + 0.48 * Math.min(1, r / 12.0);
      const sc = (0.58 + rand() * 0.52) * innerShorten;
      dummy.scale.set(sc, sc * (0.78 + rand() * 0.36), sc);
      dummy.updateMatrix();
      inst.setMatrixAt(idx++, dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    this.scene.add(inst);
  }

  private buildFloatingSeeds(): void {
    const count = 260;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 46;
      pos[i * 3 + 1] = 0.4 + Math.random() * 6.5;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 46;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xdcebff,
      size: 0.085,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.seedsPoints = new THREE.Points(geo, mat);
    this.scene.add(this.seedsPoints);
  }

  public update(dt: number, elapsed: number, playerPos: THREE.Vector3, bossPos: THREE.Vector3): void {
    const targetStorm = this.stormMode ? 1.0 : 0.0;
    const curStorm = this.skyMat.uniforms.uStorm.value as number;
    const nextStorm = curStorm + (targetStorm - curStorm) * Math.min(1, dt * 1.8);

    if (this.stormMode && Math.random() < dt * 0.28) {
      this.stormFlash = Math.max(this.stormFlash, 0.65);
    }
    this.stormFlash = Math.max(0, this.stormFlash - dt * 3.8);

    this.skyMat.uniforms.uTime.value = elapsed;
    this.skyMat.uniforms.uStorm.value = nextStorm;
    this.skyMat.uniforms.uFlash.value = this.stormFlash;

    this.grassMat.uniforms.uTime.value = elapsed;
    this.grassMat.uniforms.uStorm.value = nextStorm;
    this.grassMat.uniforms.uFlash.value = this.stormFlash;
    (this.grassMat.uniforms.uPlayerPos.value as THREE.Vector3).copy(playerPos);
    (this.grassMat.uniforms.uBossPos.value as THREE.Vector3).copy(bossPos);

    this.moonLight.intensity = 2.35 - nextStorm * 0.55 + this.stormFlash * 3.2;

    // Drift silvergrass seeds in the night breeze
    const pAttr = this.seedsPoints.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pAttr.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] += dt * (0.65 + nextStorm * 1.4);
      arr[i + 1] += Math.sin(elapsed * 1.6 + i) * dt * 0.22;
      if (arr[i] > 24) arr[i] = -24;
    }
    pAttr.needsUpdate = true;

    for (let i = 0; i < this.bannerCloths.length; i++) {
      this.bannerCloths[i].rotation.y = Math.sin(elapsed * 3.4 + i) * (0.14 + nextStorm * 0.16);
    }
  }
}
