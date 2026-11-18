import * as THREE from 'three';
import type { LoadedSekiroAssets } from '../assets/assetLoader';
import { SekiroAudio } from '../audio/sekiroAudio';
import { BladeVfxManager, SwordRibbonTrail } from '../effects/bladeVfx';
import { FighterRig, type PoseMode } from '../entities/fighterRig';
import { AshinaArena } from '../world/ashinaArena';
import { GENICHIRO_MOVES, ISSHIN_MOVES } from './bossMoves';
import { SekiroHud, projectWorldToScreen } from '../ui/hud';
import type {
  AttackStrike,
  BossId,
  BossMoveDef,
  CombatArtId,
  PerilousType,
  ProjectileEntity,
  ProstheticId,
} from '../types';

const COMBAT_ARTS: CombatArtId[] = ['mortal_draw', 'ichimonji', 'whirlwind'];
const PROSTHETICS: ProstheticId[] = ['shuriken', 'firecracker', 'flame_vent'];

export class SekiroGame {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private arena: AshinaArena;
  private vfx: BladeVfxManager;
  private audio: SekiroAudio;
  private hud: SekiroHud;

  private wolfRig: FighterRig;
  private genichiroRig: FighterRig;
  private isshinRig: FighterRig;
  private activeBossRig: FighterRig;

  private wolfTrail: SwordRibbonTrail;
  private bossTrail: SwordRibbonTrail;

  // Templates for projectiles
  private arrowTpl?: THREE.Object3D;
  private shurikenTpl?: THREE.Object3D;
  private projectiles: ProjectileEntity[] = [];

  // Game State
  public isRunning = false;
  public currentBossId: BossId = 'genichiro';
  private elapsed = 0;
  private fightTimer = 0;
  private hitstopTimer = 0;
  private slowMoTimer = 0;
  private slowMoFactor = 1.0;

  // Camera
  private lockedOn = true;
  private camYaw = Math.PI;
  private camPitch = 0.24;
  private camShake = 0;
  private fovKick = 0;
  private cinematicTimer = 0;

  // Input
  private keys = new Set<string>();
  private guardHeld = false;

  // Player ("狼") Combat State
  private pPos = new THREE.Vector3(0, 0, 8.5);
  private pVel = new THREE.Vector3();
  private pYaw = Math.PI;
  private pHp = 100;
  private pMaxHp = 100;
  private pPosture = 0;
  private pMaxPosture = 100;
  private gourdCharges = 5;
  private spiritEmblems = 18;
  private resurrections = 2;
  private artIdx = 0;
  private prosIdx = 0;

  private pState:
    | 'free'
    | 'attack'
    | 'dodge'
    | 'mikiri'
    | 'stagger'
    | 'guard_broken'
    | 'heal'
    | 'deathblow'
    | 'dying' = 'free';
  private pStateTimer = 0;
  private pStateDuration = 0;
  private pComboStep = 0;
  private pQueuedAttack = false;
  private pAttackHitDone = false;
  private pAttackKind: 'slash' | 'mortal_1' | 'mortal_2' | 'ichimonji_1' | 'ichimonji_2' | 'whirlwind' | 'chasing_slice' | 'lightning_reversal' = 'slash';
  private pSwingDir: AttackStrike['swingDir'] = 'right_to_left';

  // Sekiro Deflect Timing State!
  private lastGuardPressTime = -10;
  private deflectSpamPenalty = 0;
  private deflectPoseTimer = 0;
  private deflectComboCount = 0;
  private dodgeIFrameTimer = 0;
  private mikiriWindowTimer = 0;
  private shurikenFollowupTimer = 0;
  private lightningCaughtTimer = 0;
  private jumpCount = 0;

  // Boss State
  private bPos = new THREE.Vector3(0, 0, -6.5);
  private bYaw = 0;
  private bBaseY = 0;
  private bHp = 100;
  private bMaxHp = 100;
  private bPosture = 0;
  private bMaxPosture = 120;
  private bLives = 3;
  private bMaxLives = 3;
  private bPhase = 1; // 1, 2, 3
  private bBurnTimer = 0;
  private bShockStunTimer = 0;

  private bState: 'idle_strafe' | 'move_attack' | 'deflect_react' | 'stagger' | 'deathblow_vuln' | 'phase_transition' | 'dead' = 'idle_strafe';
  private bStateTimer = 0;
  private bStrafeDir = 1;
  private bActiveMove: BossMoveDef | null = null;
  private bMoveTime = 0;
  private bPerilousWarned = false;
  private bGlintSpawned = false;
  private bConsecutiveBlocks = 0;
  private deathblowVulnTimer = 0;

  // Fight Stats
  private statDeflects = 0;
  private statCounters = 0;

  constructor(private canvas: HTMLCanvasElement, private assets: LoadedSekiroAssets) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(54, window.innerWidth / window.innerHeight, 0.12, 300);

    this.audio = new SekiroAudio();
    this.hud = new SekiroHud();
    this.arena = new AshinaArena(this.scene, assets);
    this.vfx = new BladeVfxManager(this.scene);

    // Subtle moonlit rim-fill light following fighters so armor & ochre haori pop clearly at night
    const duelLight = new THREE.DirectionalLight(0xdbe8ff, 1.45);
    duelLight.position.set(8, 14, 18);
    this.scene.add(duelLight);

    // Build Wolf Rig + Weapons
    this.wolfRig = new FighterRig(assets.wolfScene);
    this.wolfRig.attachRightWeapon(assets.weaponsAndArena.getObjectByName('WPN_Kusabimaru'), 1.02, false);
    this.wolfRig.attachRightWeapon(assets.weaponsAndArena.getObjectByName('WPN_MortalBlade'), 1.30, true);
    this.scene.add(this.wolfRig.root);

    // Build Boss 1: Genichiro Ashina Rig + Odachi + Greatbow
    this.genichiroRig = new FighterRig(assets.genichiroScene);
    this.genichiroRig.attachRightWeapon(assets.weaponsAndArena.getObjectByName('WPN_GenichiroOdachi'), 1.42, false);
    this.genichiroRig.attachLeftWeapon(assets.weaponsAndArena.getObjectByName('WPN_GenichiroBow'), 1.8, false);
    if (this.genichiroRig.offhandWeapon) this.genichiroRig.offhandWeapon.visible = false;
    this.scene.add(this.genichiroRig.root);

    // Build Boss 2: Sword Saint Isshin Rig + Katana + 2.68m Jumonji Cross-Spear + Pistol
    this.isshinRig = new FighterRig(assets.isshinScene);
    this.isshinRig.attachRightWeapon(assets.weaponsAndArena.getObjectByName('WPN_IsshinKatana'), 1.22, false);
    this.isshinRig.attachLeftWeapon(assets.weaponsAndArena.getObjectByName('WPN_IsshinSpear'), 2.68, false);
    this.isshinRig.attachLeftWeapon(assets.weaponsAndArena.getObjectByName('WPN_IsshinPistol'), 0.4, true);
    if (this.isshinRig.offhandWeapon) this.isshinRig.offhandWeapon.visible = false;
    this.isshinRig.root.visible = false;
    this.scene.add(this.isshinRig.root);

    this.activeBossRig = this.genichiroRig;

    this.arrowTpl = assets.weaponsAndArena.getObjectByName('WPN_Arrow');
    this.shurikenTpl = assets.weaponsAndArena.getObjectByName('WPN_Shuriken');

    this.wolfTrail = new SwordRibbonTrail(this.scene);
    this.bossTrail = new SwordRibbonTrail(this.scene);
    this.bossTrail.setStyle('boss_steel');

    this.bindEvents();
    this.setupEncounter('genichiro', false);
  }

  public startFight(bossId: BossId): void {
    this.audio.unlock();
    this.hud.hideModals();
    this.setupEncounter(bossId, true);
    this.isRunning = true;
    this.safeRequestPointerLock();
  }

  private safeRequestPointerLock(): void {
    try {
      const p = this.canvas.requestPointerLock?.() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      // Ignore in sandboxed webviews
    }
  }

  public setupEncounter(bossId: BossId, announce: boolean): void {
    this.currentBossId = bossId;
    this.clearProjectiles();
    this.arena.setStormMode(false);

    // Reset Wolf
    this.pPos.set(0, 0, 8.5);
    this.pVel.set(0, 0, 0);
    this.pYaw = Math.PI;
    this.pHp = 100;
    this.pPosture = 0;
    this.gourdCharges = 5;
    this.spiritEmblems = 18;
    this.resurrections = 2;
    this.pState = 'free';
    this.pComboStep = 0;
    this.lightningCaughtTimer = 0;
    this.wolfRig.setAltRightActive(false);

    // Reset Boss
    this.bPos.set(0, 0, -7.2);
    this.bYaw = 0;
    this.bBaseY = 0;
    this.bPhase = 1;
    this.bLives = 3;
    this.bMaxLives = 3;
    this.bMaxHp = bossId === 'isshin' ? 135 : 115;
    this.bHp = this.bMaxHp;
    this.bMaxPosture = bossId === 'isshin' ? 145 : 125;
    this.bPosture = 0;
    this.bState = 'idle_strafe';
    this.bStateTimer = 1.1;
    this.bActiveMove = null;
    this.bBurnTimer = 0;
    this.bShockStunTimer = 0;
    this.statDeflects = 0;
    this.statCounters = 0;
    this.fightTimer = 0;
    this.lockedOn = true;

    this.genichiroRig.root.visible = bossId === 'genichiro';
    this.isshinRig.root.visible = bossId === 'isshin';
    this.activeBossRig = bossId === 'genichiro' ? this.genichiroRig : this.isshinRig;

    // Reset phase-specific visuals
    const outerArmor = this.genichiroRig.root.getObjectByName('VIS_OuterArmor');
    const tomoeScars = this.genichiroRig.root.getObjectByName('VIS_TomoeScars');
    if (outerArmor) outerArmor.visible = true;
    if (tomoeScars) tomoeScars.visible = false;
    if (this.genichiroRig.offhandWeapon) this.genichiroRig.offhandWeapon.visible = false;
    if (this.isshinRig.offhandWeapon) this.isshinRig.offhandWeapon.visible = false;
    if (this.isshinRig.pistolWeapon) this.isshinRig.pistolWeapon.visible = false;
    this.activeBossRig.usingOffhandTrail = false;

    this.syncPositionsAndPoses(0);

    if (announce) {
      this.audio.setIntensity(0.65);
      const title = bossId === 'genichiro' ? '苇名弦一郎' : '剑圣 · 苇名一心';
      const sub = bossId === 'genichiro' ? '「为了苇名……纵使身堕修罗！」' : '「来吧，只狼！犹豫就会败北！」';
      this.hud.showExecutionBanner(title, sub, 2.2);
    }
  }

  private clearProjectiles(): void {
    for (const pr of this.projectiles) {
      this.scene.remove(pr.mesh);
    }
    this.projectiles.length = 0;
  }

  private getBossDisplayName(): string {
    if (this.currentBossId === 'genichiro') {
      return this.bPhase === 3 ? '巴流 · 苇名弦一郎' : '苇名弦一郎';
    }
    if (this.bPhase === 1) return '苇名一心';
    if (this.bPhase === 2) return '剑圣 · 苇名一心 (十文字枪)';
    return '剑圣 · 苇名一心 (巴之雷)';
  }

  private bindEvents(): void {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    window.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (!this.isRunning) return;

      if (e.code === 'KeyJ') this.handleAttackInput();
      if (e.code === 'KeyK') this.startGuard();
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.handleDodgeOrMikiri();
      if (e.code === 'Space') {
        e.preventDefault();
        this.handleJumpOrStomp();
      }
      if (e.code === 'KeyF') this.handleCombatArt();
      if (e.code === 'KeyE') this.handleProsthetic();
      if (e.code === 'KeyR' || e.code === 'Digit1') this.handleHealGourd();
      if (e.code === 'KeyQ') {
        this.artIdx = (this.artIdx + 1) % COMBAT_ARTS.length;
        this.hud.showCallout('切换流派招式', '#b8dcff');
      }
      if (e.code === 'KeyC' || e.code === 'Tab') {
        e.preventDefault();
        this.prosIdx = (this.prosIdx + 1) % PROSTHETICS.length;
        this.hud.showCallout('切换忍义手忍具', '#b8dcff');
      }
      if (e.code === 'KeyT') {
        this.lockedOn = !this.lockedOn;
        this.hud.showCallout(this.lockedOn ? '视角已锁定首领' : '自由视角', '#dce8ff');
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'KeyK') this.guardHeld = false;
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.isRunning) return;
      this.audio.unlock();
      if (document.pointerLockElement !== this.canvas) {
        this.safeRequestPointerLock();
      }
      if (e.button === 0) {
        this.handleAttackInput();
      } else if (e.button === 2) {
        this.startGuard();
      } else if (e.button === 1) {
        e.preventDefault();
        this.lockedOn = !this.lockedOn;
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) this.guardHeld = false;
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isRunning || document.pointerLockElement !== this.canvas) return;
      if (!this.lockedOn) {
        this.camYaw -= e.movementX * 0.0026;
      }
      this.camPitch = Math.max(0.06, Math.min(0.68, this.camPitch + e.movementY * 0.002));
    });
  }

  private startGuard(): void {
    if (this.pState === 'dying' || this.pState === 'deathblow' || this.pState === 'guard_broken') return;
    // Allow Sekiro's iconic early-attack-cancel into Deflect!
    if (this.pState === 'attack' && this.pStateTimer < 0.14 && !this.pAttackHitDone) {
      this.pState = 'free';
      this.wolfTrail.setActive(false);
      this.wolfRig.setAltRightActive(false);
    }
    const gap = this.elapsed - this.lastGuardPressTime;
    if (gap < 0.28) {
      this.deflectSpamPenalty = Math.min(0.13, this.deflectSpamPenalty + 0.05);
    } else {
      this.deflectSpamPenalty = 0;
    }
    this.lastGuardPressTime = this.elapsed;
    this.guardHeld = true;
  }

  private handleAttackInput(): void {
    if (this.pState === 'dying' || this.pState === 'deathblow' || this.pState === 'guard_broken') return;

    // 1. Mid-air Lightning Reversal ("雷返"!)
    if (this.lightningCaughtTimer > 0 && this.pPos.y > 0.15) {
      this.executeLightningReversal();
      return;
    }

    // 2. Crimson Shinobi Deathblow Execution ("忍杀"!)
    if (this.bState === 'deathblow_vuln' && this.pPos.distanceTo(this.bPos) < 5.2) {
      this.executeShinobiDeathblow();
      return;
    }

    // 3. Prosthetic Shuriken Chasing Slice ("手里剑·追斩"!)
    if (this.shurikenFollowupTimer > 0 && (this.pState === 'free' || this.pState === 'dodge')) {
      this.shurikenFollowupTimer = 0;
      this.beginPlayerAttack('chasing_slice', 0.42, 'left_to_right');
      return;
    }

    if (this.pState === 'attack') {
      if (this.pStateTimer > this.pStateDuration * 0.42) {
        this.pQueuedAttack = true;
      }
      return;
    }

    if (this.pState === 'free' || this.pState === 'dodge') {
      this.pComboStep = (this.pComboStep % 4) + 1;
      const dirs: AttackStrike['swingDir'][] = ['right_to_left', 'left_to_right', 'uppercut', 'overhead'];
      this.beginPlayerAttack('slash', this.pComboStep === 4 ? 0.50 : 0.37, dirs[this.pComboStep - 1]);
    }
  }

  private beginPlayerAttack(
    kind: SekiroGame['pAttackKind'],
    duration: number,
    swingDir: AttackStrike['swingDir']
  ): void {
    this.pState = 'attack';
    this.pAttackKind = kind;
    this.pStateDuration = duration;
    this.pStateTimer = 0;
    this.pAttackHitDone = false;
    this.pQueuedAttack = false;
    this.pSwingDir = swingDir;
    this.guardHeld = false;

    const isMortal = kind === 'mortal_1' || kind === 'mortal_2';
    this.wolfRig.setAltRightActive(isMortal);
    this.wolfTrail.setStyle(
      isMortal ? 'mortal' : kind === 'lightning_reversal' ? 'lightning' : 'steel'
    );
    this.wolfTrail.setActive(true);

    // Face Boss if locked on
    if (this.lockedOn) {
      this.pYaw = Math.atan2(this.bPos.x - this.pPos.x, this.bPos.z - this.pPos.z);
    }
    this.audio.playSlash(kind !== 'slash', isMortal);
  }

  private handleCombatArt(): void {
    if (this.pState !== 'free') return;
    const art = COMBAT_ARTS[this.artIdx];
    if (art === 'mortal_draw') {
      const hasEmblems = this.spiritEmblems >= 3;
      if (hasEmblems) this.spiritEmblems -= 3;
      this.hud.showCallout(hasEmblems ? '秘传 · 不死斩！' : '不死斩 (纸人耗尽·威力减弱)', '#ff4258');
      this.beginPlayerAttack('mortal_1', 0.68, 'right_to_left');
    } else if (art === 'ichimonji') {
      this.hud.showCallout('苇名流 · 一文字二连！', '#ffd878');
      this.beginPlayerAttack('ichimonji_1', 0.56, 'overhead');
    } else {
      this.hud.showCallout('流派招式 · 旋风斩！', '#bfe4ff');
      this.beginPlayerAttack('whirlwind', 0.54, 'spin');
    }
  }

  private handleProsthetic(): void {
    if (this.pState !== 'free') return;
    const pros = PROSTHETICS[this.prosIdx];
    if (this.lockedOn) {
      this.pYaw = Math.atan2(this.bPos.x - this.pPos.x, this.bPos.z - this.pPos.z);
    }
    const forward = new THREE.Vector3(Math.sin(this.pYaw), 0, Math.cos(this.pYaw));

    if (pros === 'shuriken') {
      if (this.spiritEmblems < 1) {
        this.hud.showCallout('纸人不足！', '#ff6e6e');
        return;
      }
      this.spiritEmblems -= 1;
      this.spawnProjectile('shuriken', this.pPos.clone().add(new THREE.Vector3(0, 1.32, 0)).addScaledVector(forward, 0.7), forward.clone().multiplyScalar(28), true, 12, 14, 'none');
      this.audio.playSlash(false, false);
      this.shurikenFollowupTimer = 0.75;
      this.hud.showCallout('手里剑！(按左键可发动追斩)', '#cce6ff');
    } else if (pros === 'firecracker') {
      if (this.spiritEmblems < 2) {
        this.hud.showCallout('纸人不足！', '#ff6e6e');
        return;
      }
      this.spiritEmblems -= 2;
      this.audio.playFirecracker();
      this.vfx.spawnBurstCone(this.pPos.clone().add(new THREE.Vector3(0, 1.25, 0)), forward, 'firecracker');
      this.camShake = 0.28;
      if (this.pPos.distanceTo(this.bPos) < 5.4 && this.bState !== 'deathblow_vuln' && this.bState !== 'dead') {
        this.interruptBossWithStagger(1.15, 18);
        this.hud.showCallout('罗伯特爆竹 · 首领硬直！', '#ffd269');
      }
    } else if (pros === 'flame_vent') {
      if (this.spiritEmblems < 3) {
        this.hud.showCallout('纸人不足！', '#ff6e6e');
        return;
      }
      this.spiritEmblems -= 3;
      this.audio.playFirecracker();
      this.vfx.spawnBurstCone(this.pPos.clone().add(new THREE.Vector3(0, 1.25, 0)), forward, 'flame');
      if (this.pPos.distanceTo(this.bPos) < 5.2 && this.bState !== 'dead') {
        this.damageBossVitality(24, 16);
        this.bBurnTimer = 6.5;
        this.hud.showCallout('火吹筒 · 炎上状态！(阻止首领架势恢复)', '#ff7832');
      }
    }
  }

  private handleHealGourd(): void {
    if (this.pState !== 'free' || this.pPos.y > 0.1) return;
    if (this.gourdCharges <= 0) {
      this.hud.showCallout('伤药葫芦已空！', '#ff6e6e');
      return;
    }
    this.gourdCharges--;
    this.pState = 'heal';
    this.pStateDuration = 0.62;
    this.pStateTimer = 0;
    this.pHp = Math.min(this.pMaxHp, this.pHp + 62);
    this.audio.playWeaponSpecial('gourd');
    this.hud.showCallout('饮用伤药葫芦 (+生命值)', '#8bf59b');
  }

  private handleDodgeOrMikiri(): void {
    if (this.pState !== 'free' && !(this.pState === 'attack' && this.pStateTimer < 0.12)) return;

    // Check if Boss is currently executing or telegraphing a Perilous Thrust within range -> MIKIRI WINDOW!
    const moveDir = this.getInputWorldDir();
    const toBoss = this.bPos.clone().sub(this.pPos);
    toBoss.y = 0;
    const dist = toBoss.length();
    toBoss.normalize();

    const forwardIntoBoss = moveDir.lengthSq() < 0.01 || moveDir.dot(toBoss) > 0.15;
    if (forwardIntoBoss && dist < 6.5) {
      this.mikiriWindowTimer = 0.34;
      // Check immediate active perilous thrust
      if (this.isBossInPerilousThrustWindow()) {
        this.executeMikiriCounter();
        return;
      }
    }

    this.pState = 'dodge';
    this.pStateDuration = 0.28;
    this.pStateTimer = 0;
    this.dodgeIFrameTimer = 0.22;
    const dashDir = moveDir.lengthSq() > 0.01 ? moveDir : toBoss;
    this.pYaw = Math.atan2(dashDir.x, dashDir.z);
    this.pVel.x = dashDir.x * 11.5;
    this.pVel.z = dashDir.z * 11.5;
  }

  private handleJumpOrStomp(): void {
    if (this.pState === 'dying' || this.pState === 'deathblow' || this.pState === 'guard_broken') return;

    // Ground Jump
    if (this.pPos.y <= 0.05 && (this.pState === 'free' || this.pState === 'dodge')) {
      this.pVel.y = 8.4;
      this.pPos.y = 0.06;
      this.jumpCount = 1;
      return;
    }

    // Mid-Air Head Stomp ("踩头"!) when near Boss!
    if (this.pPos.y > 0.25 && this.jumpCount === 1 && this.pPos.distanceTo(this.bPos) < 3.6) {
      this.jumpCount = 2;
      const counteringSweep = this.isBossInPerilousSweepWindow();
      this.pVel.y = 7.6;
      const away = this.pPos.clone().sub(this.bPos).setY(0).normalize();
      this.pVel.x = away.x * 5.2;
      this.pVel.z = away.z * 5.2;

      const postureHit = counteringSweep ? 38 : 14;
      this.addBossPosture(postureHit);
      this.vfx.spawnClash(this.bPos.clone().add(new THREE.Vector3(0, 1.85, 0)), counteringSweep);
      if (counteringSweep) {
        this.statCounters++;
        this.audio.playMikiriCounter();
        this.hitstopTimer = 0.09;
        this.camShake = 0.35;
        this.interruptBossWithStagger(0.85, 0);
        this.hud.showCallout('下段看破 · 腾空踩头！(大幅削减架势)', '#ffe066');
      } else {
        this.audio.playBlock();
      }
    }
  }

  private isBossInPerilousThrustWindow(): boolean {
    if (this.bState !== 'move_attack' || !this.bActiveMove) return false;
    const p = this.bMoveTime / this.bActiveMove.duration;
    return this.bActiveMove.strikes.some(
      (st) => st.perilous === 'thrust' && p >= st.hitStart - 0.14 && p <= st.hitEnd + 0.06
    );
  }

  private isBossInPerilousSweepWindow(): boolean {
    if (this.bState !== 'move_attack' || !this.bActiveMove) return false;
    const p = this.bMoveTime / this.bActiveMove.duration;
    return this.bActiveMove.strikes.some(
      (st) => st.perilous === 'sweep' && p >= st.hitStart - 0.18 && p <= st.hitEnd + 0.1
    );
  }

  /** Iconic Sekiro Mikiri Counter ("识破 / 看破")! */
  private executeMikiriCounter(): void {
    this.mikiriWindowTimer = 0;
    this.statCounters++;
    this.pState = 'mikiri';
    this.pStateDuration = 0.62;
    this.pStateTimer = 0;
    this.wolfTrail.setActive(false);

    // Snap Wolf directly in front of Boss stomping down the thrusting weapon!
    const bossFwd = new THREE.Vector3(Math.sin(this.bYaw), 0, Math.cos(this.bYaw));
    this.pPos.copy(this.bPos).addScaledVector(bossFwd, 1.75);
    this.pPos.y = 0;
    this.pVel.set(0, 0, 0);
    this.pYaw = Math.atan2(this.bPos.x - this.pPos.x, this.bPos.z - this.pPos.z);

    const clashPt = this.pPos.clone().lerp(this.bPos, 0.45).add(new THREE.Vector3(0, 0.45, 0));
    this.vfx.spawnClash(clashPt, true);
    this.audio.playMikiriCounter();
    this.hitstopTimer = 0.12;
    this.fovKick = -6.5;
    this.camShake = 0.48;

    this.interruptBossWithStagger(1.05, 42);
    this.hud.showCallout('识 破 ！(踏刃反制 · 巨额架势伤害)', '#ffcf56');
  }

  /** Way of Tomoe Mid-Air Lightning Reversal ("巴之雷 · 雷返")! */
  private executeLightningReversal(): void {
    this.lightningCaughtTimer = 0;
    this.statCounters++;
    this.beginPlayerAttack('lightning_reversal', 0.48, 'right_to_left');
    this.audio.playLightning();
    this.arena.triggerLightningFlash();

    const forward = this.bPos.clone().sub(this.pPos).setY(0).normalize();
    this.vfx.spawnSlashWave(
      this.pPos.clone().add(new THREE.Vector3(0, 1.3, 0)),
      forward,
      0.25,
      'lightning',
      22
    );

    if (this.pPos.distanceTo(this.bPos) < 15.0) {
      this.damageBossVitality(34, 44);
      this.bShockStunTimer = 2.6;
      this.interruptBossWithStagger(2.2, 0);
      this.vfx.spawnBurstCone(this.bPos.clone().add(new THREE.Vector3(0, 1.2, 0)), new THREE.Vector3(0, 1, 0), 'lightning');
      this.hud.showCallout('⚡ 雷 返 成 功 ！首领麻痹硬直！', '#ffe95c');
    }
  }

  /** Cinematic Shinobi Deathblow ("忍杀处决")! */
  private executeShinobiDeathblow(): void {
    this.pState = 'deathblow';
    this.pStateDuration = 1.25;
    this.pStateTimer = 0;
    this.cinematicTimer = 1.25;
    this.slowMoTimer = 0.55;
    this.slowMoFactor = 0.28;

    const toBoss = this.bPos.clone().sub(this.pPos).setY(0).normalize();
    this.pPos.copy(this.bPos).addScaledVector(toBoss, -1.35);
    this.pPos.y = 0;
    this.pYaw = Math.atan2(toBoss.x, toBoss.z);

    this.bLives--;
    const finalKill = this.bLives <= 0;
    this.audio.playDeathblow(finalKill);
    this.camShake = 0.65;
    this.fovKick = -8.0;

    const chestPos = this.bPos.clone().add(new THREE.Vector3(0, 1.35, 0));
    this.vfx.spawnBloodSpray(chestPos, toBoss, true);
    this.vfx.spawnSlashWave(chestPos, toBoss, -0.45, 'mortal', 0);

    // Restore 1 Resurrection charge on successful Deathblow (authentic Sekiro mechanic!)
    this.resurrections = Math.min(2, this.resurrections + 1);

    if (finalKill) {
      this.bState = 'dead';
      this.bHp = 0;
      this.audio.setIntensity(0.1);
      const kanji = this.currentBossId === 'isshin' ? '不 死 斩 断' : '忍 杀';
      const sub = this.currentBossId === 'isshin' ? 'IMMORTALITY SEVERED' : 'SHINOBI EXECUTION';
      this.hud.showExecutionBanner(kanji, sub, 3.2);

      window.setTimeout(() => {
        if (document.pointerLockElement === this.canvas) {
          document.exitPointerLock?.();
        }
        this.hud.showVictoryModal(
          this.currentBossId,
          {
            deflects: this.statDeflects,
            mikiris: this.statCounters,
            timeSec: this.fightTimer,
          },
          () => this.startFight(this.currentBossId === 'genichiro' ? 'isshin' : 'genichiro'),
          () => this.startFight(this.currentBossId)
        );
      }, 2100);
    } else {
      // Advance Boss Phase!
      this.bPhase++;
      this.bHp = this.bMaxHp;
      this.bPosture = 0;
      this.bState = 'phase_transition';
      this.bStateTimer = 1.65;
      this.applyBossPhaseVisuals();
    }
  }

  private applyBossPhaseVisuals(): void {
    if (this.currentBossId === 'genichiro' && this.bPhase === 3) {
      // Phase 3: Way of Tomoe! Sheds heavy armor, reveals golden lightning scars, thunderclouds gather!
      const outer = this.genichiroRig.root.getObjectByName('VIS_OuterArmor');
      const scars = this.genichiroRig.root.getObjectByName('VIS_TomoeScars');
      if (outer) outer.visible = false;
      if (scars) scars.visible = true;
      this.arena.setStormMode(true);
      this.arena.triggerLightningFlash();
      this.audio.playLightning();
      this.audio.setIntensity(1.0);
      this.hud.showExecutionBanner('巴 流 · 苇 名 弦 一 郎', '「见识巴之雷吧……为了守护苇名！」', 2.4);
    } else if (this.currentBossId === 'genichiro' && this.bPhase === 2) {
      this.hud.showExecutionBanner('忍 杀', '弦一郎重整架势 · 解锁下段扫击与连珠弓！', 1.7);
      this.audio.setIntensity(0.82);
    } else if (this.currentBossId === 'isshin' && this.bPhase === 2) {
      // Sword Saint draws the 2.68m Jumonji Cross-Spear from the silvergrass!
      if (this.isshinRig.offhandWeapon) this.isshinRig.offhandWeapon.visible = true;
      this.isshinRig.usingOffhandTrail = true;
      this.vfx.spawnBurstCone(this.bPos.clone().add(new THREE.Vector3(0, 0.5, 0)), new THREE.Vector3(0, 1, 0), 'firecracker');
      this.hud.showExecutionBanner('剑 圣 二 阶 段', '苇名一心拔出「十文字长枪」与「连发火铳」！', 2.2);
      this.audio.setIntensity(0.88);
    } else if (this.currentBossId === 'isshin' && this.bPhase === 3) {
      this.arena.setStormMode(true);
      this.arena.triggerLightningFlash();
      this.audio.playLightning();
      this.audio.setIntensity(1.0);
      this.hud.showExecutionBanner('剑 圣 · 巴 之 雷', '雷云降临 · 跃空接雷发动「雷返」！', 2.3);
    }
  }

  private interruptBossWithStagger(duration: number, postureBonus: number): void {
    this.bActiveMove = null;
    this.bossTrail.setActive(false);
    this.bBaseY = 0;
    this.bPos.y = 0;
    this.bState = 'stagger';
    this.bStateTimer = duration;
    if (postureBonus > 0) {
      this.addBossPosture(postureBonus);
    }
  }

  private addBossPosture(amount: number): void {
    if (this.bState === 'dead' || this.bState === 'deathblow_vuln') return;
    this.bPosture = Math.min(this.bMaxPosture, this.bPosture + amount);
    if (this.bPosture >= this.bMaxPosture) {
      this.enterBossDeathblowState();
    }
  }

  private damageBossVitality(hpDmg: number, postureDmg: number): void {
    if (this.bState === 'dead' || this.bState === 'deathblow_vuln') return;
    this.bHp = Math.max(0, this.bHp - hpDmg);
    if (this.bHp <= 0) {
      this.enterBossDeathblowState();
      return;
    }
    this.addBossPosture(postureDmg);
  }

  private enterBossDeathblowState(): void {
    this.bActiveMove = null;
    this.bossTrail.setActive(false);
    this.bBaseY = 0;
    this.bPos.y = 0;
    this.bPosture = this.bMaxPosture;
    this.bState = 'deathblow_vuln';
    this.deathblowVulnTimer = 3.6;
    this.slowMoTimer = 0.28;
    this.slowMoFactor = 0.4;
    this.audio.playMikiriCounter();
    this.hud.showCallout('🔴 首领躯干崩解！快上前按 [鼠标左键] 发动忍杀！', '#ff3b4e');
  }

  private getInputWorldDir(): THREE.Vector3 {
    let ix = 0;
    let iz = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) iz += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) iz -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) ix -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) ix += 1;
    if (ix === 0 && iz === 0) return new THREE.Vector3();

    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    return fwd.multiplyScalar(iz).addScaledVector(right, ix).normalize();
  }

  private spawnProjectile(
    kind: ProjectileEntity['kind'],
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    fromPlayer: boolean,
    damage: number,
    postureDamage: number,
    perilous: PerilousType
  ): void {
    let mesh: THREE.Object3D;
    if (kind === 'shuriken' && this.shurikenTpl) {
      mesh = this.shurikenTpl.clone(true);
      mesh.scale.setScalar(1.25);
    } else if ((kind === 'arrow' || kind === 'lightning_arrow') && this.arrowTpl) {
      mesh = this.arrowTpl.clone(true);
      mesh.scale.setScalar(1.3);
    } else {
      const col = kind === 'dragon_flash' ? 0xe8f8ff : 0xffcc55;
      const geo = kind === 'dragon_flash' ? new THREE.BoxGeometry(0.16, 2.8, 1.4) : new THREE.SphereGeometry(0.09, 8, 8);
      mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col }));
    }
    mesh.position.copy(pos);
    mesh.lookAt(pos.clone().add(vel));
    this.scene.add(mesh);

    this.projectiles.push({
      mesh,
      pos: pos.clone(),
      vel,
      fromPlayer,
      kind,
      damage,
      postureDamage,
      perilous,
      life: 2.2,
    });
  }

  public step(rawDt: number): void {
    const clampedDt = Math.min(0.05, rawDt);
    this.elapsed += clampedDt;

    if (this.hitstopTimer > 0) {
      this.hitstopTimer -= clampedDt;
      this.vfx.update(clampedDt * 0.25, this.camera.position);
      this.renderScene();
      return;
    }

    let dt = clampedDt;
    if (this.slowMoTimer > 0) {
      this.slowMoTimer -= clampedDt;
      dt *= this.slowMoFactor;
    }

    if (this.isRunning) {
      this.fightTimer += dt;
      this.updatePlayer(dt);
      this.updateBoss(dt);
      this.updateProjectiles(dt);
      this.enforceFighterSeparation();
    }

    this.syncPositionsAndPoses(dt);
    this.arena.update(dt, this.elapsed, this.pPos, this.bPos);
    this.vfx.update(dt, this.camera.position);
    this.updateCamera(clampedDt);
    this.updateHud(clampedDt);
    this.renderScene();
  }

  private updatePlayer(dt: number): void {
    if (this.deflectPoseTimer > 0) this.deflectPoseTimer -= dt;
    if (this.dodgeIFrameTimer > 0) this.dodgeIFrameTimer -= dt;
    if (this.shurikenFollowupTimer > 0) this.shurikenFollowupTimer -= dt;
    if (this.cinematicTimer > 0) this.cinematicTimer -= dt;

    if (this.mikiriWindowTimer > 0) {
      this.mikiriWindowTimer -= dt;
      if (this.isBossInPerilousThrustWindow() && this.pPos.distanceTo(this.bPos) < 6.4) {
        this.executeMikiriCounter();
        return;
      }
    }

    // Mid-air Lightning Overload punishment if player lands without pressing LMB!
    if (this.lightningCaughtTimer > 0) {
      this.lightningCaughtTimer -= dt;
      if (this.pPos.y <= 0.04 || this.lightningCaughtTimer <= 0) {
        this.lightningCaughtTimer = 0;
        this.audio.playLightning();
        this.takePlayerVitalityDamage(42, 35, true);
        this.hud.showCallout('⚡ 未及时雷返 · 触地感电硬直！', '#ff5252');
      }
    }

    // Gravity & Jump Physics
    if (this.pPos.y > 0 || this.pVel.y !== 0) {
      this.pVel.y -= 23.0 * dt;
      this.pPos.y += this.pVel.y * dt;
      if (this.pPos.y <= 0) {
        this.pPos.y = 0;
        this.pVel.y = 0;
        this.jumpCount = 0;
      }
    }

    // Authentic Sekiro Player Posture Recovery:
    // Holding Guard while free recovers your own Posture TWICE as fast!
    if (this.pState === 'free' && this.pPosture > 0) {
      const hpFactor = 0.45 + 0.55 * (this.pHp / this.pMaxHp);
      const guardBoost = this.guardHeld ? 2.2 : 1.0;
      this.pPosture = Math.max(0, this.pPosture - 13.5 * hpFactor * guardBoost * dt);
    }

    if (this.pState === 'dying') return;

    if (this.pState === 'free') {
      this.wolfTrail.setActive(false);
      this.wolfRig.setAltRightActive(false);
      const dir = this.getInputWorldDir();
      const speed = this.guardHeld ? 3.5 : 6.9;
      this.pVel.x = dir.x * speed;
      this.pVel.z = dir.z * speed;
      this.pPos.x += this.pVel.x * dt;
      this.pPos.z += this.pVel.z * dt;

      if (this.lockedOn) {
        const targetYaw = Math.atan2(this.bPos.x - this.pPos.x, this.bPos.z - this.pPos.z);
        this.pYaw = lerpAngle(this.pYaw, targetYaw, Math.min(1, dt * 14));
      } else if (dir.lengthSq() > 0.01) {
        const targetYaw = Math.atan2(dir.x, dir.z);
        this.pYaw = lerpAngle(this.pYaw, targetYaw, Math.min(1, dt * 12));
      }
    } else {
      this.pStateTimer += dt;

      if (this.pState === 'dodge') {
        this.pPos.x += this.pVel.x * dt;
        this.pPos.z += this.pVel.z * dt;
        this.pVel.x *= 0.88;
        this.pVel.z *= 0.88;
        if (this.pStateTimer >= this.pStateDuration) this.pState = 'free';
      } else if (this.pState === 'attack') {
        // Forward step lunge during sword swing
        const fwd = new THREE.Vector3(Math.sin(this.pYaw), 0, Math.cos(this.pYaw));
        const stepSpd = this.pAttackKind === 'chasing_slice' ? 14.5 : this.pStateTimer < 0.2 ? 4.2 : 0.6;
        this.pPos.addScaledVector(fwd, stepSpd * dt);

        const prog = this.pStateTimer / this.pStateDuration;
        if (!this.pAttackHitDone && prog >= 0.42) {
          this.pAttackHitDone = true;
          this.resolvePlayerStrikeHit(fwd);
        }

        if (this.pStateTimer >= this.pStateDuration) {
          this.wolfTrail.setActive(false);
          if (this.pAttackKind === 'mortal_1' && this.pQueuedAttack) {
            this.beginPlayerAttack('mortal_2', 0.62, 'left_to_right');
          } else if (this.pAttackKind === 'ichimonji_1') {
            // Automatic or chained Ichimonji Double!
            this.beginPlayerAttack('ichimonji_2', 0.52, 'overhead');
          } else if (this.pQueuedAttack) {
            this.pComboStep = (this.pComboStep % 4) + 1;
            const dirs: AttackStrike['swingDir'][] = ['right_to_left', 'left_to_right', 'uppercut', 'overhead'];
            this.beginPlayerAttack('slash', this.pComboStep === 4 ? 0.50 : 0.37, dirs[this.pComboStep - 1]);
          } else {
            this.pState = 'free';
            this.wolfRig.setAltRightActive(false);
          }
        }
      } else if (
        this.pState === 'mikiri' ||
        this.pState === 'stagger' ||
        this.pState === 'guard_broken' ||
        this.pState === 'heal' ||
        this.pState === 'deathblow'
      ) {
        if (this.pStateTimer >= this.pStateDuration) {
          this.pState = 'free';
        }
      }
    }

    // Clamp inside Ashina Moonlit Field perimeter
    const r = Math.hypot(this.pPos.x, this.pPos.z);
    if (r > this.arena.arenaRadius) {
      const sc = this.arena.arenaRadius / r;
      this.pPos.x *= sc;
      this.pPos.z *= sc;
    }
  }

  private resolvePlayerStrikeHit(fwd: THREE.Vector3): void {
    const isMortal = this.pAttackKind === 'mortal_1' || this.pAttackKind === 'mortal_2';
    const isIchimonji = this.pAttackKind === 'ichimonji_1' || this.pAttackKind === 'ichimonji_2';
    const range = isMortal ? 4.8 : this.pAttackKind === 'chasing_slice' ? 3.8 : 3.25;

    if (isMortal) {
      this.vfx.spawnSlashWave(
        this.pPos.clone().add(new THREE.Vector3(0, 1.25, 0)),
        fwd,
        this.pAttackKind === 'mortal_1' ? 0.32 : -0.32,
        'mortal',
        5.5
      );
    } else if (this.pAttackKind === 'whirlwind') {
      this.vfx.spawnSlashWave(this.pPos.clone().add(new THREE.Vector3(0, 1.15, 0)), fwd, 0.05, 'steel', 2.0);
    }

    // Ichimonji recovers Wolf's own posture!
    if (isIchimonji) {
      this.pPosture = Math.max(0, this.pPosture - 34);
    }

    if (this.bState === 'dead' || this.bState === 'deathblow_vuln' || this.bState === 'phase_transition') return;

    const toBoss = this.bPos.clone().sub(this.pPos);
    const dist = Math.hypot(toBoss.x, toBoss.z);
    if (dist > range) return;

    const dir2d = new THREE.Vector3(toBoss.x, 0, toBoss.z).normalize();
    if (this.pAttackKind !== 'whirlwind' && fwd.dot(dir2d) < 0.15) return;

    const contactPt = this.pPos.clone().lerp(this.bPos, 0.62).add(new THREE.Vector3(0, 1.32, 0));

    // Does Boss guard/deflect or take direct flesh hit?
    // Boss takes direct Vitality damage if staggered, recovering at end of a whiffed combo, shock-stunned, or hit by Mortal Draw!
    const bossExposed =
      isMortal ||
      this.bShockStunTimer > 0 ||
      this.bState === 'stagger' ||
      (this.bState === 'move_attack' && this.bActiveMove !== null && this.bMoveTime > this.bActiveMove.duration * 0.82);

    if (bossExposed) {
      const hpDmg = isMortal ? 26 : isIchimonji ? 18 : 13;
      const posDmg = isMortal ? 28 : isIchimonji ? 24 : 14;
      this.damageBossVitality(hpDmg, posDmg);
      this.audio.playFleshHit(isMortal || isIchimonji);
      this.vfx.spawnBloodSpray(contactPt, fwd, false);
      this.hitstopTimer = isMortal ? 0.07 : 0.04;
      this.camShake = 0.22;
      if (this.bState === 'idle_strafe') {
        this.bState = 'stagger';
        this.bStateTimer = 0.28;
      }
    } else {
      // Authentic Sekiro Sword Dance: Boss blocks first 1-2 slashes, then PERFECT DEFLECTS Wolf ("铛！！") and immediately counter-attacks!
      this.bConsecutiveBlocks++;
      const bossCounterDeflects = this.bConsecutiveBlocks >= (2 + (Math.random() > 0.5 ? 1 : 0));
      if (bossCounterDeflects) {
        this.bConsecutiveBlocks = 0;
        this.audio.playPerfectDeflect(4);
        this.vfx.spawnClash(contactPt, true);
        this.addBossPosture(isIchimonji ? 14 : 7);
        this.hitstopTimer = 0.06;
        this.camShake = 0.26;
        this.hud.showCallout('首领完美弹反 · 小心反击！', '#ffa654');
        if (this.bState === 'idle_strafe') {
          this.startNextBossAttack(true);
        }
      } else {
        this.audio.playBlock();
        this.vfx.spawnClash(contactPt, false);
        this.addBossPosture(isIchimonji ? 16 : 9);
        this.hitstopTimer = 0.03;
        if (this.bState === 'idle_strafe') {
          this.bState = 'deflect_react';
          this.bStateTimer = 0.22;
        }
      }
    }
  }

  private updateBoss(dt: number): void {
    if (this.bState === 'dead') return;

    // Burn DoT ("炎上")
    if (this.bBurnTimer > 0) {
      this.bBurnTimer -= dt;
      this.bHp = Math.max(1, this.bHp - 3.2 * dt);
    }
    if (this.bShockStunTimer > 0) {
      this.bShockStunTimer -= dt;
    }

    // Authentic Sekiro Boss Posture Recovery:
    // Scales heavily with Boss remaining Vitality %! High HP = fast posture recovery; <50% HP or Burn = sluggish recovery!
    if (this.bState === 'idle_strafe' && this.bPosture > 0 && this.bBurnTimer <= 0) {
      const hpRatio = this.bHp / this.bMaxHp;
      const regenRate = hpRatio > 0.75 ? 11.5 : hpRatio > 0.45 ? 5.2 : 1.4;
      this.bPosture = Math.max(0, this.bPosture - regenRate * dt);
    }

    if (this.bState === 'deathblow_vuln') {
      this.deathblowVulnTimer -= dt;
      if (this.deathblowVulnTimer <= 0) {
        // Missed Deathblow window -> Boss recovers 32% posture!
        this.bPosture = this.bMaxPosture * 0.68;
        this.bHp = Math.max(this.bHp, 12);
        this.bState = 'idle_strafe';
        this.bStateTimer = 0.5;
        this.hud.showCallout('错失忍杀时机 · 首领重整架势！', '#ff8866');
      }
      return;
    }

    if (this.bState === 'phase_transition' || this.bState === 'stagger' || this.bState === 'deflect_react') {
      this.bStateTimer -= dt;
      if (this.bStateTimer <= 0) {
        this.bState = 'idle_strafe';
        this.bStateTimer = 0.35;
      }
      return;
    }

    const toPlayer = this.pPos.clone().sub(this.bPos);
    const dist = Math.hypot(toPlayer.x, toPlayer.z);
    const targetYaw = Math.atan2(toPlayer.x, toPlayer.z);

    if (this.bState === 'idle_strafe') {
      this.bossTrail.setActive(false);
      this.bYaw = lerpAngle(this.bYaw, targetYaw, Math.min(1, dt * 8));
      const fwd = new THREE.Vector3(Math.sin(this.bYaw), 0, Math.cos(this.bYaw));
      const side = new THREE.Vector3(-fwd.z, 0, fwd.x);

      // Close distance or circle-strafe menacingly
      const approachSpd = dist > 5.2 ? 4.8 : dist < 2.3 ? -1.8 : 0.8;
      this.bPos.addScaledVector(fwd, approachSpd * dt);
      this.bPos.addScaledVector(side, this.bStrafeDir * 1.9 * dt);

      this.bStateTimer -= dt;
      if (this.bStateTimer <= 0 && dist < 11.5) {
        this.startNextBossAttack(false);
      }
    } else if (this.bState === 'move_attack' && this.bActiveMove) {
      const mv = this.bActiveMove;
      this.bMoveTime += dt;
      const prog = Math.min(1, this.bMoveTime / mv.duration);

      // Track player during early windup
      if (prog < 0.45) {
        this.bYaw = lerpAngle(this.bYaw, targetYaw, Math.min(1, dt * 7.5));
      }

      // Jump arc height (e.g., Jump Slam, Quad Bow Volley, Lightning Slash)
      if (mv.jumpArcHeight && prog > 0.12 && prog < 0.82) {
        const jp = (prog - 0.12) / 0.70;
        this.bBaseY = Math.sin(jp * Math.PI) * mv.jumpArcHeight;
      } else {
        this.bBaseY = 0;
      }
      this.bPos.y = this.bBaseY;

      // Forward / Backward motion
      if (prog > 0.15 && prog < 0.78) {
        const fwd = new THREE.Vector3(Math.sin(this.bYaw), 0, Math.cos(this.bYaw));
        if (dist > 1.85 || mv.forwardMotion < 0) {
          this.bPos.addScaledVector(fwd, (mv.forwardMotion / (mv.duration * 0.63)) * dt);
        }
      }

      // Perilous "危" Warning Kanji!
      if (!this.bPerilousWarned && mv.perilousWarningTime !== undefined && prog >= mv.perilousWarningTime) {
        this.bPerilousWarned = true;
        this.audio.playPerilousWarning();
        this.hud.triggerPerilousKanji(mv.perilousType || 'thrust');
      }

      // Sword Glint ("居合寒光")
      if (!this.bGlintSpawned && mv.glintTime !== undefined && prog >= mv.glintTime) {
        this.bGlintSpawned = true;
        this.audio.playWeaponSpecial('glint');
        this.vfx.spawnSwordGlint(this.bPos.clone().add(new THREE.Vector3(0, 1.35, 0)), mv.perilousType === 'thrust');
      }

      // Toggle offhand Bow / Pistol visibility during ranged moves
      if (this.currentBossId === 'genichiro' && this.genichiroRig.offhandWeapon) {
        this.genichiroRig.offhandWeapon.visible = mv.id === 'quad_bow_volley';
      }
      if (this.currentBossId === 'isshin' && this.isshinRig.pistolWeapon && this.isshinRig.offhandWeapon) {
        const firingPistol = mv.id === 'pistol_volley_spear_thrust' && prog < 0.6;
        this.isshinRig.pistolWeapon.visible = firingPistol;
        this.isshinRig.offhandWeapon.visible = this.bPhase >= 2 && !firingPistol;
        this.isshinRig.usingOffhandTrail = this.bPhase >= 2 && !firingPistol && mv.id !== 'ashina_cross';
      }

      // Evaluate Active Strikes
      let anyTrailActive = false;
      for (const st of mv.strikes) {
        if (prog >= st.hitStart - 0.08 && prog <= st.hitEnd + 0.05 && st.range > 0) {
          anyTrailActive = true;
          this.bossTrail.setStyle(st.trailStyle || 'boss_steel');
        }
        if (!st.fired && prog >= st.hitStart) {
          st.fired = true;
          this.executeBossStrike(st);
        }
      }
      this.bossTrail.setActive(anyTrailActive);

      if (this.bMoveTime >= mv.duration) {
        this.bActiveMove = null;
        this.bossTrail.setActive(false);
        this.bBaseY = 0;
        this.bPos.y = 0;
        if (this.currentBossId === 'genichiro' && this.genichiroRig.offhandWeapon) {
          this.genichiroRig.offhandWeapon.visible = false;
        }
        if (this.currentBossId === 'isshin' && this.isshinRig.pistolWeapon) {
          this.isshinRig.pistolWeapon.visible = false;
          if (this.isshinRig.offhandWeapon) this.isshinRig.offhandWeapon.visible = this.bPhase >= 2;
        }
        this.bState = 'idle_strafe';
        this.bStrafeDir = Math.random() > 0.5 ? 1 : -1;
        this.bStateTimer = 0.55 + Math.random() * 0.55;
      }
    }

    const r = Math.hypot(this.bPos.x, this.bPos.z);
    if (r > this.arena.arenaRadius - 0.5) {
      const sc = (this.arena.arenaRadius - 0.5) / r;
      this.bPos.x *= sc;
      this.bPos.z *= sc;
    }
  }

  private startNextBossAttack(fromCounter: boolean): void {
    const dist = this.pPos.distanceTo(this.bPos);
    let pool: BossMoveDef[] = [];

    if (this.currentBossId === 'genichiro') {
      if (this.bPhase === 1) {
        pool = dist > 5.5
          ? [GENICHIRO_MOVES.quad_bow_volley, GENICHIRO_MOVES.jump_slam_thrust]
          : [GENICHIRO_MOVES.slash_combo_3, GENICHIRO_MOVES.floating_passage, GENICHIRO_MOVES.jump_slam_thrust];
      } else if (this.bPhase === 2) {
        pool = dist > 5.5
          ? [GENICHIRO_MOVES.quad_bow_volley, GENICHIRO_MOVES.jump_slam_sweep]
          : [GENICHIRO_MOVES.floating_passage, GENICHIRO_MOVES.jump_slam_sweep, GENICHIRO_MOVES.jump_slam_thrust, GENICHIRO_MOVES.slash_combo_3];
      } else {
        // Phase 3: Way of Tomoe!
        pool = dist > 5.2
          ? [GENICHIRO_MOVES.leaping_thrust, GENICHIRO_MOVES.tomoe_lightning_slash]
          : [GENICHIRO_MOVES.tomoe_lightning_slash, GENICHIRO_MOVES.leaping_thrust, GENICHIRO_MOVES.floating_passage, GENICHIRO_MOVES.jump_slam_sweep];
      }
    } else {
      // Sword Saint Isshin!
      if (this.bPhase === 1) {
        pool = dist > 5.0
          ? [ISSHIN_MOVES.ashina_cross, ISSHIN_MOVES.ichimonji_dragon_flash]
          : [ISSHIN_MOVES.saint_combo_thrust, ISSHIN_MOVES.ashina_cross, ISSHIN_MOVES.ichimonji_dragon_flash];
      } else if (this.bPhase === 2) {
        pool = dist > 5.2
          ? [ISSHIN_MOVES.spear_leap_combo, ISSHIN_MOVES.pistol_volley_spear_thrust]
          : [ISSHIN_MOVES.pistol_volley_spear_thrust, ISSHIN_MOVES.spear_whirlwind_sweep, ISSHIN_MOVES.spear_leap_combo];
      } else {
        pool = [
          ISSHIN_MOVES.saint_lightning_spear,
          ISSHIN_MOVES.pistol_volley_spear_thrust,
          ISSHIN_MOVES.spear_whirlwind_sweep,
          ISSHIN_MOVES.ashina_cross,
        ];
      }
    }

    if (fromCounter) {
      pool = this.currentBossId === 'genichiro'
        ? [GENICHIRO_MOVES.slash_combo_3, GENICHIRO_MOVES.jump_slam_thrust, GENICHIRO_MOVES.floating_passage]
        : [ISSHIN_MOVES.saint_combo_thrust, ISSHIN_MOVES.ashina_cross];
    }

    const picked = pool[Math.floor(Math.random() * pool.length)];
    // Deep clone strikes so `.fired` resets cleanly
    this.bActiveMove = {
      ...picked,
      strikes: picked.strikes.map((s) => ({ ...s, fired: false })),
    };
    this.bMoveTime = 0;
    this.bPerilousWarned = false;
    this.bGlintSpawned = false;
    this.bState = 'move_attack';
  }

  private executeBossStrike(st: AttackStrike): void {
    const bossFwd = new THREE.Vector3(Math.sin(this.bYaw), 0, Math.cos(this.bYaw));
    const origin = this.bPos.clone().add(new THREE.Vector3(0, 1.35, 0));

    // Spawn Ranged Projectiles / Wind Waves
    if (st.projectile === 'arrow' || st.projectile === 'bullet' || st.projectile === 'dragon_flash') {
      const aim = this.pPos.clone().add(new THREE.Vector3(0, 1.15, 0)).sub(origin).normalize();
      const spd = st.projectile === 'bullet' ? 34 : st.projectile === 'dragon_flash' ? 22 : 26;
      this.audio.playWeaponSpecial(st.projectile === 'bullet' ? 'pistol' : 'bow');
      if (st.projectile === 'dragon_flash') {
        this.vfx.spawnSlashWave(origin, bossFwd, 1.57, 'wind_wave', 22);
      }
      this.spawnProjectile(st.projectile, origin.clone().addScaledVector(bossFwd, 0.9), aim.multiplyScalar(spd), false, st.damage, st.postureDamage, st.perilous);
      if (st.range <= 0) return;
    }

    if (st.trailStyle === 'lightning') {
      this.audio.playLightning();
      this.arena.triggerLightningFlash();
      this.vfx.spawnSlashWave(origin, bossFwd, 0.25, 'lightning', 8);
    } else {
      this.audio.playSlash(st.damage >= 34, false);
      if (st.trailStyle === 'wind_wave') {
        this.vfx.spawnSlashWave(origin, bossFwd, st.swingDir === 'sweep_low' ? 0.04 : 0.35, 'wind_wave', 3.5);
      }
    }

    // Melee Hit Check vs Player ("狼")
    const toPlayer = this.pPos.clone().sub(this.bPos);
    const dist2d = Math.hypot(toPlayer.x, toPlayer.z);
    if (dist2d > st.range) return;

    const dir2d = new THREE.Vector3(toPlayer.x, 0, toPlayer.z).normalize();
    if (bossFwd.dot(dir2d) < st.arcCos) return;

    // 1. Perilous Sweep: Jumping cleanly avoids low sweep!
    if (st.perilous === 'sweep') {
      if (this.pPos.y > 0.42) return; // Vaulted cleanly over the blade!
      this.takePlayerVitalityDamage(st.damage, st.postureDamage, true);
      return;
    }

    // 2. Perilous Lightning: Jumping catches lightning on Kusabimaru for Lightning Reversal ("雷返")!
    if (st.perilous === 'lightning') {
      if (this.pPos.y > 0.38) {
        this.lightningCaughtTimer = 1.15;
        this.pVel.y = Math.max(this.pVel.y, 4.2);
        this.vfx.spawnClash(this.pPos.clone().add(new THREE.Vector3(0, 1.5, 0)), true, true);
        this.audio.playLightning();
        return;
      }
      this.takePlayerVitalityDamage(st.damage, st.postureDamage, true);
      return;
    }

    // 3. Perilous Thrust: Check active Mikiri Counter first!
    if (st.perilous === 'thrust' && this.mikiriWindowTimer > 0) {
      this.executeMikiriCounter();
      return;
    }

    // 4. Step-Dodge I-Frames
    if (this.dodgeIFrameTimer > 0) {
      return;
    }

    // 5. SEKIRO PERFECT DEFLECT & GUARD EVALUATION!
    const deflectWindow = Math.max(0.08, 0.24 - this.deflectSpamPenalty);
    const isPerfectDeflect =
      this.elapsed - this.lastGuardPressTime <= deflectWindow &&
      this.pState !== 'guard_broken' &&
      this.pState !== 'heal';

    const clashPos = this.pPos
      .clone()
      .addScaledVector(dir2d, -0.55)
      .add(new THREE.Vector3(0, 1.32, 0));

    if (isPerfectDeflect) {
      // ★ PERFECT DEFLECT ("完美弹反 · 铛！！！")
      // Even Perilous Thrusts CAN be Perfect Deflected in Sekiro (just not normal-blocked)!
      this.statDeflects++;
      this.deflectComboCount++;
      this.deflectPoseTimer = 0.22;
      this.lastGuardPressTime = -10; // Consume press so next rapid hit requires fresh tap!

      this.audio.playPerfectDeflect(this.deflectComboCount);
      this.vfx.spawnClash(clashPos, true);
      this.hitstopTimer = 0.052;
      this.camShake = 0.28;
      this.fovKick = -2.4;

      // Crucial Sekiro Rule: Perfect Deflect NEVER breaks Wolf's posture (caps at max - 1)!
      this.pPosture = Math.min(this.pMaxPosture - 1, this.pPosture + st.postureDamage * 0.32);
      this.addBossPosture(st.deflectPostureToBoss);

      const pushBack = dir2d.clone().multiplyScalar(st.knockback * 0.35);
      this.pPos.add(pushBack);
      this.hud.showCallout(`完美弹反！(+${st.deflectPostureToBoss} 首领架势)`, '#ffd86b');
      return;
    }

    // Normal Guard Block (Perilous attacks CANNOT be normal-blocked!)
    if (this.guardHeld && st.perilous === 'none' && this.pState === 'free') {
      this.deflectComboCount = 0;
      this.audio.playBlock();
      this.vfx.spawnClash(clashPos, false);
      this.camShake = 0.14;
      this.pPosture += st.postureDamage;
      this.addBossPosture(Math.round(st.deflectPostureToBoss * 0.22));
      this.pPos.addScaledVector(dir2d, st.knockback * 0.55);

      if (this.pPosture >= this.pMaxPosture) {
        this.pPosture = this.pMaxPosture * 0.55;
        this.pState = 'guard_broken';
        this.pStateDuration = 1.05;
        this.pStateTimer = 0;
        this.guardHeld = false;
        this.hud.showCallout('架势崩解！(按准时机右键完美弹反不会崩防)', '#ff6262');
      }
      return;
    }

    // Direct Vitality Hit on Wolf!
    this.deflectComboCount = 0;
    this.takePlayerVitalityDamage(st.damage, st.postureDamage, true);
  }

  private takePlayerVitalityDamage(hpDmg: number, postureDmg: number, stagger: boolean): void {
    if (this.pState === 'dying' || this.pState === 'deathblow' || this.pState === 'mikiri') return;
    this.pHp = Math.max(0, this.pHp - hpDmg);
    this.pPosture = Math.min(this.pMaxPosture, this.pPosture + postureDmg * 0.65);
    this.audio.playFleshHit(hpDmg >= 34);
    this.vfx.spawnBloodSpray(this.pPos.clone().add(new THREE.Vector3(0, 1.25, 0)), new THREE.Vector3(0, 0.5, 1), false);
    this.camShake = 0.38;
    this.wolfTrail.setActive(false);
    this.wolfRig.setAltRightActive(false);

    if (this.pHp <= 0) {
      this.pState = 'dying';
      this.guardHeld = false;
      if (document.pointerLockElement === this.canvas) {
        document.exitPointerLock?.();
      }
      this.hud.showDeathModal(
        this.resurrections > 0,
        () => {
          // RESURRECTION ("回生"!)
          this.resurrections--;
          this.pHp = Math.round(this.pMaxHp * 0.65);
          this.pPosture = 0;
          this.pState = 'free';
          this.vfx.spawnBurstCone(this.pPos.clone().add(new THREE.Vector3(0, 1.0, 0)), new THREE.Vector3(0, 1, 0), 'firecracker');
          this.hud.showExecutionBanner('回 生', '龙胤之力 · 再起死斗！', 1.5);
          this.safeRequestPointerLock();
        },
        () => this.startFight(this.currentBossId)
      );
      return;
    }

    if (stagger) {
      this.pState = 'stagger';
      this.pStateDuration = 0.36;
      this.pStateTimer = 0;
    }
  }

  private updateProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.life -= dt;
      pr.pos.addScaledVector(pr.vel, dt);
      pr.mesh.position.copy(pr.pos);
      if (pr.kind === 'shuriken') {
        pr.mesh.rotation.z += dt * 36;
      }

      let remove = pr.life <= 0 || pr.pos.y < -0.5;
      if (!remove && pr.fromPlayer) {
        const bChest = this.bPos.clone().add(new THREE.Vector3(0, 1.25, 0));
        if (pr.pos.distanceTo(bChest) < 1.25 && this.bState !== 'dead') {
          const airborneBonus = this.bBaseY > 0.6 ? 2.4 : 1.0;
          this.damageBossVitality(pr.damage * airborneBonus, pr.postureDamage * airborneBonus);
          this.vfx.spawnClash(pr.pos, airborneBonus > 1.5);
          this.audio.playBlock();
          if (airborneBonus > 1.5) {
            this.interruptBossWithStagger(0.95, 16);
            this.hud.showCallout('手里剑击落空中首领！', '#ffd86b');
          }
          remove = true;
        }
      } else if (!remove && !pr.fromPlayer) {
        const pChest = this.pPos.clone().add(new THREE.Vector3(0, 1.2, 0));
        if (pr.pos.distanceTo(pChest) < 1.15 && this.dodgeIFrameTimer <= 0) {
          const isPerfect = this.elapsed - this.lastGuardPressTime <= 0.24;
          if (isPerfect) {
            this.statDeflects++;
            this.deflectPoseTimer = 0.2;
            this.lastGuardPressTime = -10;
            this.audio.playPerfectDeflect(2);
            this.vfx.spawnClash(pr.pos, true);
            this.hud.showCallout('刀劈飞矢 / 弹反火铳！', '#ffd86b');
          } else if (this.guardHeld && this.pState === 'free') {
            this.audio.playBlock();
            this.vfx.spawnClash(pr.pos, false);
            this.pPosture = Math.min(this.pMaxPosture, this.pPosture + pr.postureDamage);
          } else {
            this.takePlayerVitalityDamage(pr.damage, pr.postureDamage, true);
          }
          remove = true;
        }
      }

      if (remove) {
        this.scene.remove(pr.mesh);
        this.projectiles.splice(i, 1);
      }
    }
  }

  private enforceFighterSeparation(): void {
    if (this.bState === 'dead') return;
    const dx = this.pPos.x - this.bPos.x;
    const dz = this.pPos.z - this.bPos.z;
    const d = Math.hypot(dx, dz);
    const minDist = 1.18;
    if (d < minDist && d > 0.0001) {
      const push = (minDist - d) * 0.5;
      const nx = dx / d;
      const nz = dz / d;
      this.pPos.x += nx * push;
      this.pPos.z += nz * push;
      this.bPos.x -= nx * push;
      this.bPos.z -= nz * push;
    }
  }

  private syncPositionsAndPoses(dt: number): void {
    // Wolf Pose
    this.wolfRig.root.position.copy(this.pPos);
    this.wolfRig.root.rotation.y = this.pYaw;
    const pMoveSpd = Math.hypot(this.pVel.x, this.pVel.z) / 7.0;

    let wolfPose: PoseMode = 'idle';
    let wolfAtkProg = 0;
    if (this.pState === 'dying') wolfPose = 'dead';
    else if (this.pState === 'mikiri') wolfPose = 'mikiri';
    else if (this.pState === 'guard_broken') wolfPose = 'guard_broken';
    else if (this.pState === 'stagger') wolfPose = 'hit_stagger';
    else if (this.pState === 'heal') wolfPose = 'heal';
    else if (this.pState === 'attack' || this.pState === 'deathblow') {
      wolfPose = 'attack';
      wolfAtkProg = this.pStateDuration > 0 ? this.pStateTimer / this.pStateDuration : 0.5;
    } else if (this.pPos.y > 0.1) wolfPose = 'jump';
    else if (this.deflectPoseTimer > 0) wolfPose = 'deflect';
    else if (this.guardHeld) wolfPose = 'guard';
    else if (pMoveSpd > 0.12) wolfPose = 'move';

    this.wolfRig.applyPose(wolfPose, this.elapsed, pMoveSpd, wolfAtkProg, this.pSwingDir, this.deflectComboCount);

    // Boss Pose
    this.activeBossRig.root.position.copy(this.bPos);
    this.activeBossRig.root.rotation.y = this.bYaw;
    let bossPose: PoseMode = 'idle';
    let bossAtkProg = 0;
    let bossSwing: AttackStrike['swingDir'] = 'right_to_left';

    if (this.bState === 'dead') bossPose = 'dead';
    else if (this.bState === 'deathblow_vuln') bossPose = 'kneel_deathblow';
    else if (this.bState === 'stagger') bossPose = 'hit_stagger';
    else if (this.bState === 'deflect_react') bossPose = 'deflect';
    else if (this.bState === 'move_attack' && this.bActiveMove) {
      bossPose = 'attack';
      const mv = this.bActiveMove;
      const globalP = this.bMoveTime / mv.duration;
      // Pick the currently active or next strike in the move for crisp per-slash animation!
      const curSt =
        mv.strikes.find((s) => globalP <= s.hitEnd + 0.06) || mv.strikes[mv.strikes.length - 1];
      const windowStart = Math.max(0, curSt.hitStart - 0.22);
      const windowLen = Math.max(0.16, curSt.hitEnd + 0.08 - windowStart);
      bossAtkProg = Math.max(0, Math.min(1, (globalP - windowStart) / windowLen));
      bossSwing = curSt.swingDir;
    } else {
      bossPose = 'move';
    }

    this.activeBossRig.applyPose(bossPose, this.elapsed * 0.72, 0.45, bossAtkProg, bossSwing, 1);

    // Sample World-Space Blade Base & Tip for 3D Sword-Light Ribbons ("刀光剑影")!
    const bBase = new THREE.Vector3();
    const bTip = new THREE.Vector3();
    this.wolfRig.getBladeWorldPoints(bBase, bTip);
    this.wolfTrail.recordAndUpdate(bBase, bTip, dt, this.elapsed);

    this.activeBossRig.getBladeWorldPoints(bBase, bTip);
    this.bossTrail.recordAndUpdate(bBase, bTip, dt, this.elapsed);
  }

  private updateCamera(dt: number): void {
    this.fovKick += (0 - this.fovKick) * Math.min(1, dt * 10);
    const targetFov = 54 + this.fovKick;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = targetFov;
      this.camera.updateProjectionMatrix();
    }

    if (!this.isRunning) {
      // Frame Wolf and Boss on the right half of the viewport (clear of the left Title card!) under the Moon & Torii
      const sway = Math.sin(this.elapsed * 0.35) * 0.8;
      this.pPos.set(1.8, 0, 4.2);
      this.pYaw = Math.atan2(this.bPos.x - this.pPos.x, this.bPos.z - this.pPos.z);
      this.bPos.set(2.6, 0, -2.2);
      this.bYaw = Math.atan2(this.pPos.x - this.bPos.x, this.pPos.z - this.bPos.z);
      this.camera.position.set(-2.6 + sway * 0.35, 1.85, 8.2);
      this.camera.lookAt(-0.4, 1.55, -6.5);
      return;
    }

    if (this.cinematicTimer > 0) {
      // Cinematic Shinobi Execution Close-Up Orbit!
      const side = new THREE.Vector3(Math.cos(this.pYaw), 0, -Math.sin(this.pYaw));
      const focus = this.pPos.clone().lerp(this.bPos, 0.55).add(new THREE.Vector3(0, 1.35, 0));
      const camTarget = focus.clone().addScaledVector(side, 2.85).add(new THREE.Vector3(0, 0.55, 0));
      this.camera.position.lerp(camTarget, Math.min(1, dt * 12));
      this.camera.lookAt(focus);
      return;
    }

    if (this.lockedOn && this.bState !== 'dead') {
      const desiredYaw = Math.atan2(this.bPos.x - this.pPos.x, this.bPos.z - this.pPos.z);
      this.camYaw = lerpAngle(this.camYaw, desiredYaw, Math.min(1, dt * 9.5));
    }

    const fwd = new THREE.Vector3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);

    const dist = 4.65;
    const height = 1.95 + this.camPitch * 2.2;
    const desiredPos = this.pPos
      .clone()
      .addScaledVector(fwd, -dist)
      .addScaledVector(right, 0.65)
      .add(new THREE.Vector3(0, height, 0));

    // Clamp camera within cliff boundary so rocks never occlude view
    const cr = Math.hypot(desiredPos.x, desiredPos.z);
    if (cr > this.arena.arenaRadius - 0.8) {
      const sc = (this.arena.arenaRadius - 0.8) / cr;
      desiredPos.x *= sc;
      desiredPos.z *= sc;
    }

    this.camera.position.lerp(desiredPos, Math.min(1, dt * 15));

    if (this.camShake > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.camShake;
      this.camera.position.y += (Math.random() - 0.5) * this.camShake;
      this.camShake *= Math.pow(0.015, dt);
    }

    const lookTarget = this.lockedOn
      ? this.pPos.clone().lerp(this.bPos, 0.58).add(new THREE.Vector3(0, 1.38, 0))
      : this.pPos.clone().addScaledVector(fwd, 6.0).add(new THREE.Vector3(0, 1.45, 0));
    this.camera.lookAt(lookTarget);
  }

  private updateHud(dt: number): void {
    const bossChest = this.bPos.clone().add(new THREE.Vector3(0, 1.38, 0));
    const proj = projectWorldToScreen(bossChest, this.camera);

    this.hud.update(dt, {
      bossName: this.getBossDisplayName(),
      bossHp: this.bHp,
      bossMaxHp: this.bMaxHp,
      bossPosture: this.bPosture,
      bossMaxPosture: this.bMaxPosture,
      bossLivesLeft: this.bLives,
      bossMaxLives: this.bMaxLives,
      bossMoveHint: this.bActiveMove ? `首领招式：${this.bActiveMove.nameZh}` : this.bBurnTimer > 0 ? '状态：炎上灼烧中' : '',

      playerHp: this.pHp,
      playerMaxHp: this.pMaxHp,
      playerPosture: this.pPosture,
      playerMaxPosture: this.pMaxPosture,
      gourdCharges: this.gourdCharges,
      spiritEmblems: this.spiritEmblems,
      resurrections: this.resurrections,
      combatArt: COMBAT_ARTS[this.artIdx],
      prosthetic: PROSTHETICS[this.prosIdx],
      lightningCharged: this.lightningCaughtTimer > 0,

      lockedOn: this.lockedOn && this.isRunning && this.bState !== 'dead',
      deathblowReady: this.bState === 'deathblow_vuln' && this.isRunning,
      bossChestScreen: proj,
    });
  }

  private renderScene(): void {
    this.renderer.render(this.scene, this.camera);
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}
