import * as THREE from 'three';
import type { AttackStrike } from '../types';

export type PoseMode =
  | 'idle'
  | 'move'
  | 'guard'
  | 'deflect'
  | 'attack'
  | 'mikiri'
  | 'jump'
  | 'hit_stagger'
  | 'guard_broken'
  | 'kneel_deathblow'
  | 'dead'
  | 'heal';

export class FighterRig {
  public readonly root: THREE.Group;
  public pelvis!: THREE.Object3D;
  public torso!: THREE.Object3D;
  public head!: THREE.Object3D;
  public shoulderL!: THREE.Object3D;
  public elbowL!: THREE.Object3D;
  public handL!: THREE.Object3D;
  public shoulderR!: THREE.Object3D;
  public elbowR!: THREE.Object3D;
  public handR!: THREE.Object3D;
  public socketR!: THREE.Object3D;
  public socketL!: THREE.Object3D;
  public hipL!: THREE.Object3D;
  public kneeL!: THREE.Object3D;
  public footL!: THREE.Object3D;
  public hipR!: THREE.Object3D;
  public kneeR!: THREE.Object3D;
  public footR!: THREE.Object3D;
  public cape?: THREE.Object3D;
  public ponytail?: THREE.Object3D;
  public scarf?: THREE.Object3D;

  public mainWeapon: THREE.Object3D | null = null;
  public altRightWeapon: THREE.Object3D | null = null; // e.g. Wolf's Mortal Blade
  public offhandWeapon: THREE.Object3D | null = null;  // e.g. Genichiro Bow or Isshin Spear
  public pistolWeapon: THREE.Object3D | null = null;

  public mainBladeLength = 1.02;
  public altBladeLength = 1.3;
  public offhandBladeLength = 2.65;
  public usingAltRight = false;
  public usingOffhandTrail = false;

  private basePelvisY = 0.96;

  constructor(templateScene: THREE.Group) {
    this.root = templateScene.clone(true);
    const get = (name: string) => this.root.getObjectByName(name) || new THREE.Object3D();

    this.pelvis = get('JNT_Pelvis');
    this.torso = get('JNT_Torso');
    this.head = get('JNT_Head');
    this.shoulderL = get('JNT_ShoulderL');
    this.elbowL = get('JNT_ElbowL');
    this.handL = get('JNT_HandL');
    this.shoulderR = get('JNT_ShoulderR');
    this.elbowR = get('JNT_ElbowR');
    this.handR = get('JNT_HandR');
    this.socketR = get('SOCKET_WeaponR');
    this.socketL = get('SOCKET_WeaponL');
    this.hipL = get('JNT_HipL');
    this.kneeL = get('JNT_KneeL');
    this.footL = get('JNT_FootL');
    this.hipR = get('JNT_HipR');
    this.kneeR = get('JNT_KneeR');
    this.footR = get('JNT_FootR');
    this.cape = this.root.getObjectByName('JNT_Cape') || undefined;
    this.ponytail = this.root.getObjectByName('JNT_Ponytail') || undefined;
    this.scarf = this.root.getObjectByName('JNT_ScarfTail') || undefined;

    this.basePelvisY = this.pelvis.position.y || 0.96;
  }

  public attachRightWeapon(wpnTemplate: THREE.Object3D | undefined, bladeLen: number, asAlt = false): void {
    if (!wpnTemplate) return;
    const w = wpnTemplate.clone(true);
    w.position.set(0, 0, 0);
    // Weapon blade is along +Y; rotating +PI/2 around X points blade forward (+Z) when arm hangs down
    w.rotation.set(Math.PI * 0.5, 0, 0);
    this.socketR.add(w);
    if (asAlt) {
      this.altRightWeapon = w;
      this.altBladeLength = bladeLen;
      w.visible = false;
    } else {
      this.mainWeapon = w;
      this.mainBladeLength = bladeLen;
    }
  }

  public attachLeftWeapon(wpnTemplate: THREE.Object3D | undefined, bladeLen = 1.8, asPistol = false): void {
    if (!wpnTemplate) return;
    const w = wpnTemplate.clone(true);
    w.position.set(0, 0, 0);
    w.rotation.set(Math.PI * 0.5, 0, 0);
    this.socketL.add(w);
    if (asPistol) {
      this.pistolWeapon = w;
      w.visible = false;
    } else {
      this.offhandWeapon = w;
      this.offhandBladeLength = bladeLen;
    }
  }

  public setAltRightActive(on: boolean): void {
    this.usingAltRight = on;
    if (this.mainWeapon) this.mainWeapon.visible = !on;
    if (this.altRightWeapon) this.altRightWeapon.visible = on;
    const sheathedHilt = this.root.getObjectByName('VIS_MortalSheathedHilt');
    if (sheathedHilt) sheathedHilt.visible = !on;
  }

  public getBladeWorldPoints(outBase: THREE.Vector3, outTip: THREE.Vector3): void {
    this.root.updateMatrixWorld(true);
    if (this.usingOffhandTrail && this.offhandWeapon && this.offhandWeapon.visible) {
      outBase.set(0, 1.55, 0);
      outTip.set(0, this.offhandBladeLength, 0);
      this.offhandWeapon.localToWorld(outBase);
      this.offhandWeapon.localToWorld(outTip);
      return;
    }
    const activeWpn = this.usingAltRight && this.altRightWeapon ? this.altRightWeapon : this.mainWeapon;
    const len = this.usingAltRight ? this.altBladeLength : this.mainBladeLength;
    if (activeWpn) {
      outBase.set(0, 0.08, 0);
      outTip.set(0, len, 0);
      activeWpn.localToWorld(outBase);
      activeWpn.localToWorld(outTip);
    } else {
      this.handR.getWorldPosition(outBase);
      outTip.copy(outBase).add(new THREE.Vector3(0, 0.9, 0));
    }
  }

  private resetRotations(): void {
    this.pelvis.position.set(0, this.basePelvisY, 0);
    this.pelvis.rotation.set(0, 0, 0);
    this.torso.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);
    this.shoulderL.rotation.set(0, 0, 0);
    this.elbowL.rotation.set(0, 0, 0);
    this.handL.rotation.set(0, 0, 0);
    this.shoulderR.rotation.set(0, 0, 0);
    this.elbowR.rotation.set(0, 0, 0);
    this.handR.rotation.set(0, 0, 0);
    this.socketR.rotation.set(0, 0, 0);
    this.socketL.rotation.set(0, 0, 0);
    this.hipL.rotation.set(0, 0, 0);
    this.kneeL.rotation.set(0, 0, 0);
    this.footL.rotation.set(0, 0, 0);
    this.hipR.rotation.set(0, 0, 0);
    this.kneeR.rotation.set(0, 0, 0);
    this.footR.rotation.set(0, 0, 0);
  }

  public applyPose(
    mode: PoseMode,
    time: number,
    moveSpeedRatio: number,
    attackProgress = 0,
    swingDir: AttackStrike['swingDir'] = 'right_to_left',
    deflectVariant = 0
  ): void {
    this.resetRotations();
    const breathe = Math.sin(time * 2.8) * 0.03;

    // Secondary cloth/hair motion
    if (this.cape) {
      this.cape.rotation.x = 0.14 + moveSpeedRatio * 0.34 + Math.sin(time * 5.2) * 0.06;
    }
    if (this.ponytail) {
      this.ponytail.rotation.x = moveSpeedRatio * 0.38 + Math.sin(time * 6.0) * 0.08;
      this.ponytail.rotation.y = Math.cos(time * 4.5) * 0.08;
    }
    if (this.scarf) {
      this.scarf.rotation.x = 0.18 + moveSpeedRatio * 0.45 + Math.sin(time * 7.2) * 0.1;
    }

    if (mode === 'idle') {
      // Kendo Chudan / Shinobi Ready Stance
      this.pelvis.position.y = this.basePelvisY - 0.05 + breathe * 0.4;
      this.torso.rotation.set(0.10 + breathe, -0.22, 0);
      this.head.rotation.set(-0.06, 0.22, 0);
      this.shoulderR.rotation.set(-0.78, 0.22, -0.14);
      this.elbowR.rotation.set(-0.62, 0, 0);
      this.socketR.rotation.set(-0.22, 0.12, 0);

      this.shoulderL.rotation.set(-0.48, -0.18, 0.16);
      this.elbowL.rotation.set(-0.55, 0, 0);

      this.hipL.rotation.set(-0.22, 0, 0.06);
      this.kneeL.rotation.set(0.36, 0, 0);
      this.footL.rotation.set(-0.14, 0, 0);
      this.hipR.rotation.set(0.18, 0, -0.06);
      this.kneeR.rotation.set(0.28, 0, 0);
      this.footR.rotation.set(-0.42, 0, 0);
      return;
    }

    if (mode === 'move') {
      const cyc = time * 11.5;
      const s = Math.sin(cyc);
      const c = Math.cos(cyc);
      this.pelvis.position.y = this.basePelvisY - 0.08 + Math.abs(c) * 0.06;
      this.torso.rotation.set(0.28 * moveSpeedRatio, -s * 0.16, 0);
      this.head.rotation.set(-0.18 * moveSpeedRatio, s * 0.12, 0);

      // Shinobi low-slung trailing katana sprint!
      this.shoulderR.rotation.set(0.32, 0.12, -0.26);
      this.elbowR.rotation.set(-0.45, 0, 0);
      this.socketR.rotation.set(0.35, 0, -0.25);

      this.shoulderL.rotation.set(-s * 0.65 - 0.15, 0, 0.14);
      this.elbowL.rotation.set(-0.75, 0, 0);

      this.hipL.rotation.set(s * 0.72, 0, 0);
      this.kneeL.rotation.set(Math.max(0.08, -c * 0.75 + 0.35), 0, 0);
      this.hipR.rotation.set(-s * 0.72, 0, 0);
      this.kneeR.rotation.set(Math.max(0.08, c * 0.75 + 0.35), 0, 0);
      return;
    }

    if (mode === 'guard' || mode === 'deflect') {
      // Iconic Sekiro Kusabimaru Horizontal / Diagonal Cross-Face Guard & Deflect!
      const kick = mode === 'deflect' ? 1.0 : 0.0;
      const alt = deflectVariant % 2 === 0 ? 1 : -1;
      this.pelvis.position.y = this.basePelvisY - 0.09;
      this.torso.rotation.set(0.14 - kick * 0.12, 0.25 * alt, 0);
      this.head.rotation.set(-0.08, -0.22 * alt, 0);

      // Raise right sword hand high & across chest so blade spans horizontally across torso/face!
      this.shoulderR.rotation.set(-1.38 - kick * 0.18, -0.35, -0.55);
      this.elbowR.rotation.set(-0.88, 0, 0);
      this.handR.rotation.set(0, 0, 1.15 * alt);
      this.socketR.rotation.set(-0.35, 0.3 * alt, 0.72);

      // Left prosthetic arm braces near blade spine
      this.shoulderL.rotation.set(-1.22, 0.42, 0.35);
      this.elbowL.rotation.set(-0.95, 0, 0);

      this.hipL.rotation.set(-0.34, 0, 0.08);
      this.kneeL.rotation.set(0.52, 0, 0);
      this.hipR.rotation.set(0.24, 0, -0.08);
      this.kneeR.rotation.set(0.42, 0, 0);
      return;
    }

    if (mode === 'mikiri') {
      // Iconic Mikiri Counter ("识破"): Deep forward lunge, right foot stomping enemy blade into the ground!
      this.pelvis.position.y = this.basePelvisY - 0.24;
      this.torso.rotation.set(0.26, -0.32, 0);
      this.head.rotation.set(-0.18, 0.32, 0);
      this.shoulderR.rotation.set(-0.55, 0.35, -0.45);
      this.elbowR.rotation.set(-0.35, 0, 0);
      this.shoulderL.rotation.set(-0.95, -0.2, 0.35);
      this.elbowL.rotation.set(-0.4, 0, 0);
      // Right leg extended forward stomping down, left leg trailing deep
      this.hipR.rotation.set(-0.82, 0, -0.06);
      this.kneeR.rotation.set(0.75, 0, 0);
      this.footR.rotation.set(0.15, 0, 0);
      this.hipL.rotation.set(0.68, 0, 0.06);
      this.kneeL.rotation.set(0.55, 0, 0);
      return;
    }

    if (mode === 'jump') {
      this.pelvis.position.y = this.basePelvisY + 0.05;
      this.torso.rotation.set(0.22, -0.15, 0);
      this.shoulderR.rotation.set(-1.15, 0.25, -0.35);
      this.elbowR.rotation.set(-0.55, 0, 0);
      this.shoulderL.rotation.set(-0.85, -0.35, 0.45);
      this.hipL.rotation.set(-0.68, 0, 0.1);
      this.kneeL.rotation.set(1.15, 0, 0);
      this.hipR.rotation.set(-0.42, 0, -0.1);
      this.kneeR.rotation.set(0.88, 0, 0);
      return;
    }

    if (mode === 'heal') {
      this.torso.rotation.set(-0.12, 0.1, 0);
      this.head.rotation.set(-0.28, 0, 0);
      this.shoulderL.rotation.set(-1.45, 0.45, 0.2);
      this.elbowL.rotation.set(-1.25, 0, 0);
      this.shoulderR.rotation.set(-0.45, 0.2, -0.2);
      return;
    }

    if (mode === 'hit_stagger' || mode === 'guard_broken') {
      const amt = mode === 'guard_broken' ? 1.45 : 0.85;
      this.pelvis.position.y = this.basePelvisY - 0.12 * amt;
      this.torso.rotation.set(-0.32 * amt, 0.25, 0.12);
      this.head.rotation.set(-0.25 * amt, -0.15, 0);
      this.shoulderR.rotation.set(-0.25, 0.45, -0.65 * amt);
      this.shoulderL.rotation.set(-0.25, -0.45, 0.65 * amt);
      this.hipL.rotation.set(-0.28, 0, 0.12);
      this.kneeL.rotation.set(0.55, 0, 0);
      this.hipR.rotation.set(0.22, 0, -0.12);
      this.kneeR.rotation.set(0.48, 0, 0);
      return;
    }

    if (mode === 'kneel_deathblow') {
      // Staggered on knees awaiting Shinobi Deathblow!
      this.pelvis.position.y = this.basePelvisY * 0.56;
      this.torso.rotation.set(0.42, 0, 0.08);
      this.head.rotation.set(0.35, 0, 0);
      this.shoulderR.rotation.set(-0.15, 0.2, -0.32);
      this.elbowR.rotation.set(-0.45, 0, 0);
      this.shoulderL.rotation.set(-0.25, -0.2, 0.28);
      this.hipL.rotation.set(-1.15, 0, 0.12);
      this.kneeL.rotation.set(2.15, 0, 0);
      this.hipR.rotation.set(-0.95, 0, -0.12);
      this.kneeR.rotation.set(1.95, 0, 0);
      return;
    }

    if (mode === 'dead') {
      this.pelvis.position.y = 0.24;
      this.pelvis.rotation.x = Math.PI * 0.46;
      this.torso.rotation.set(0.18, 0.15, 0);
      this.shoulderR.rotation.set(0.2, 0, -0.85);
      this.shoulderL.rotation.set(0.2, 0, 0.85);
      return;
    }

    // === ATTACK KATA CHOREOGRAPHY ===
    const p = Math.max(0, Math.min(1, attackProgress));
    // Smooth windup (0..0.35) -> explosive snap (0.35..0.72) -> follow-through (0.72..1.0)
    const snap = p < 0.34 ? -p / 0.34 : Math.min(1, (p - 0.34) / 0.36);

    this.pelvis.position.y = this.basePelvisY - 0.1;
    this.hipL.rotation.set(-0.36, 0, 0.08);
    this.kneeL.rotation.set(0.56, 0, 0);
    this.hipR.rotation.set(0.28, 0, -0.08);
    this.kneeR.rotation.set(0.42, 0, 0);

    switch (swingDir) {
      case 'right_to_left': {
        this.torso.rotation.set(0.18, snap * 0.72, 0);
        this.shoulderR.rotation.set(-1.15, snap * 1.15, -0.45);
        this.elbowR.rotation.set(-0.42, 0, 0);
        this.socketR.rotation.set(0.15, 0, 0.65);
        this.shoulderL.rotation.set(-0.65, snap * 0.45, 0.28);
        break;
      }
      case 'left_to_right': {
        this.torso.rotation.set(0.18, -snap * 0.76, 0);
        this.shoulderR.rotation.set(-1.18, -snap * 1.18, 0.25);
        this.elbowR.rotation.set(-0.38, 0, 0);
        this.socketR.rotation.set(0.12, 0, -0.72);
        this.shoulderL.rotation.set(-0.72, -snap * 0.55, 0.22);
        break;
      }
      case 'overhead': {
        // Ichimonji / Heavy Overhead Cleave!
        const raise = p < 0.42 ? p / 0.42 : 1 - Math.min(1, (p - 0.42) / 0.32) * 2.1;
        this.torso.rotation.set(p < 0.42 ? -0.18 * raise : 0.38, 0, 0);
        this.shoulderR.rotation.set(-1.65 - raise * 0.95, 0.15, 0);
        this.elbowR.rotation.set(-0.35, 0, 0);
        this.socketR.rotation.set(0.32, 0, 0);
        this.shoulderL.rotation.set(-1.55 - raise * 0.85, -0.22, 0);
        this.elbowL.rotation.set(-0.45, 0, 0);
        break;
      }
      case 'thrust': {
        // Perilous / Charged Lunge Thrust!
        const lunge = p < 0.38 ? -0.55 * (p / 0.38) : Math.min(1, (p - 0.38) / 0.28);
        this.pelvis.position.y = this.basePelvisY - 0.18;
        this.torso.rotation.set(0.28, -0.52 * lunge, 0);
        this.shoulderR.rotation.set(-1.42 * Math.max(0.2, lunge) - 0.35, 0.18, 0);
        this.elbowR.rotation.set(lunge > 0 ? -0.08 : -0.85, 0, 0);
        // Point blade straight along forearm (+Z when arm is horizontal -PI/2)
        this.socketR.rotation.set(-1.35 * Math.max(0, lunge), 0, 0);
        this.shoulderL.rotation.set(0.45, -0.25, 0.35);
        break;
      }
      case 'sweep_low': {
        // Perilous 360 Low Sweep!
        this.pelvis.position.y = this.basePelvisY - 0.28;
        this.pelvis.rotation.y = p * Math.PI * 2;
        this.torso.rotation.set(0.42, 0, 0);
        this.shoulderR.rotation.set(-0.68, 0.65, -0.78);
        this.socketR.rotation.set(0.25, 0, 1.15);
        break;
      }
      case 'spin': {
        this.pelvis.rotation.y = p * Math.PI * 2;
        this.torso.rotation.set(0.2, 0, 0);
        this.shoulderR.rotation.set(-1.25, 0.4, -0.65);
        this.socketR.rotation.set(0.2, 0, 0.9);
        break;
      }
      case 'uppercut': {
        this.torso.rotation.set(0.22 - snap * 0.35, snap * 0.45, 0);
        this.shoulderR.rotation.set(-0.45 - snap * 1.45, snap * 0.35, -0.28);
        this.elbowR.rotation.set(-0.35, 0, 0);
        break;
      }
      case 'bow_shot': {
        this.torso.rotation.set(0.08, 0.68, 0);
        this.head.rotation.set(0, -0.62, 0);
        this.shoulderL.rotation.set(-1.52, 0.15, 0);
        this.elbowL.rotation.set(-0.08, 0, 0);
        this.shoulderR.rotation.set(-1.48, -0.35, -0.35);
        this.elbowR.rotation.set(-1.15, 0, 0);
        break;
      }
      case 'pistol_shot': {
        this.torso.rotation.set(0.08, -0.38, 0);
        this.shoulderL.rotation.set(-1.52, -0.12, 0);
        this.elbowL.rotation.set(-0.12, 0, 0);
        this.socketL.rotation.set(-1.35, 0, 0);
        this.shoulderR.rotation.set(-0.55, 0.25, -0.3);
        break;
      }
      case 'grab': {
        this.torso.rotation.set(0.32, snap * 0.45, 0);
        this.shoulderL.rotation.set(-1.45, snap * 0.55, 0.2);
        this.shoulderR.rotation.set(-0.85, -0.25, -0.35);
        break;
      }
    }
  }
}
