import * as THREE from 'three';
import type { BossId, CombatArtId, PerilousType, ProstheticId } from '../types';

export interface HudState {
  bossName: string;
  bossHp: number;
  bossMaxHp: number;
  bossPosture: number;
  bossMaxPosture: number;
  bossLivesLeft: number;
  bossMaxLives: number;
  bossMoveHint: string;

  playerHp: number;
  playerMaxHp: number;
  playerPosture: number;
  playerMaxPosture: number;
  gourdCharges: number;
  spiritEmblems: number;
  resurrections: number;
  combatArt: CombatArtId;
  prosthetic: ProstheticId;
  lightningCharged: boolean;

  lockedOn: boolean;
  deathblowReady: boolean;
  bossChestScreen: { x: number; y: number; visible: boolean };
}

const ART_NAMES: Record<CombatArtId, string> = {
  mortal_draw: '秘传·不死斩 (消耗3纸人)',
  ichimonji: '苇名流·一文字二连 (恢复架势)',
  whirlwind: '旋风斩 (双连回旋)',
};

const PROSTHETIC_NAMES: Record<ProstheticId, string> = {
  shuriken: '手里剑·追斩 (消耗1纸人)',
  firecracker: '罗伯特爆竹·惊慑 (消耗2纸人)',
  flame_vent: '火吹筒·炎上 (消耗3纸人)',
};

export class SekiroHud {
  private bossNameEl = document.getElementById('boss-name')!;
  private bossHpFill = document.getElementById('boss-hp-fill')!;
  private bossOrbsEl = document.getElementById('boss-deathblow-orbs')!;
  private bossPostureL = document.getElementById('boss-posture-l')!;
  private bossPostureR = document.getElementById('boss-posture-r')!;
  private bossPostureWrap = document.getElementById('boss-posture-wrap')!;
  private bossMoveLabel = document.getElementById('boss-move-label')!;

  private playerHpFill = document.getElementById('player-hp-fill')!;
  private playerPostureL = document.getElementById('player-posture-l')!;
  private playerPostureR = document.getElementById('player-posture-r')!;
  private gourdCountEl = document.getElementById('gourd-count')!;
  private emblemCountEl = document.getElementById('emblem-count')!;
  private resOrbsEl = document.getElementById('res-orbs')!;
  private artNameEl = document.getElementById('art-name')!;
  private prosNameEl = document.getElementById('pros-name')!;

  private kanjiDangerEl = document.getElementById('kanji-danger')!;
  private kanjiSubEl = document.getElementById('kanji-sub')!;
  private calloutEl = document.getElementById('combat-callout')!;
  private bannerOverlay = document.getElementById('execution-banner')!;
  private bannerMain = document.getElementById('banner-kanji')!;
  private bannerSub = document.getElementById('banner-sub')!;

  private lockReticle = document.getElementById('lock-reticle')!;
  private deathblowReticle = document.getElementById('deathblow-reticle')!;
  private deathModal = document.getElementById('death-modal')!;
  private btnResurrect = document.getElementById('btn-resurrect') as HTMLButtonElement;
  private victoryModal = document.getElementById('victory-modal')!;
  private victoryStatsEl = document.getElementById('victory-stats')!;

  private dangerTimer = 0;
  private calloutTimer = 0;
  private bannerTimer = 0;

  public triggerPerilousKanji(type: PerilousType): void {
    this.kanjiDangerEl.classList.remove('active');
    void this.kanjiDangerEl.offsetWidth;
    this.kanjiDangerEl.classList.add('active');
    if (type === 'thrust') {
      this.kanjiSubEl.textContent = '突刺危 · 按 [Shift / W+Shift] 识破踏刃！';
    } else if (type === 'sweep') {
      this.kanjiSubEl.textContent = '下段危 · 按 [Space] 跳跃再按 [Space] 踩头！';
    } else if (type === 'lightning') {
      this.kanjiSubEl.textContent = '巴之雷 · 按 [Space] 跃空接雷 + 落地前 [左键] 雷返！';
    } else {
      this.kanjiSubEl.textContent = '危 · 闪避！';
    }
    this.dangerTimer = 1.05;
  }

  public showCallout(text: string, color = '#ffd97d'): void {
    this.calloutEl.textContent = text;
    this.calloutEl.style.color = color;
    this.calloutEl.classList.add('visible');
    this.calloutTimer = 0.95;
  }

  public showExecutionBanner(kanji: string, sub: string, duration = 2.4): void {
    this.bannerMain.textContent = kanji;
    this.bannerSub.textContent = sub;
    this.bannerOverlay.classList.add('active');
    this.bannerTimer = duration;
  }

  public showDeathModal(canResurrect: boolean, onResurrect: () => void, onRetry: () => void): void {
    this.deathModal.classList.remove('hidden');
    this.btnResurrect.style.display = canResurrect ? 'inline-flex' : 'none';
    this.btnResurrect.onclick = () => {
      this.deathModal.classList.add('hidden');
      onResurrect();
    };
    const btnRetry = document.getElementById('btn-retry')!;
    btnRetry.onclick = () => {
      this.deathModal.classList.add('hidden');
      onRetry();
    };
  }

  public showVictoryModal(
    bossId: BossId,
    stats: { deflects: number; mikiris: number; timeSec: number },
    onNextBoss: () => void,
    onRematch: () => void
  ): void {
    this.victoryModal.classList.remove('hidden');
    this.victoryStatsEl.innerHTML = `
      <div>完美弹反次数：<strong>${stats.deflects}</strong> 次</div>
      <div>识破 / 踩头 / 雷返：<strong>${stats.mikiris}</strong> 次</div>
      <div>讨伐用时：<strong>${stats.timeSec.toFixed(1)}</strong> 秒</div>
    `;
    const nextBtn = document.getElementById('btn-next-boss')!;
    nextBtn.textContent = bossId === 'genichiro' ? '挑战最终首领：剑圣·苇名一心' : '挑战首领：苇名弦一郎';
    nextBtn.onclick = () => {
      this.victoryModal.classList.add('hidden');
      onNextBoss();
    };
    document.getElementById('btn-rematch')!.onclick = () => {
      this.victoryModal.classList.add('hidden');
      onRematch();
    };
  }

  public hideModals(): void {
    this.deathModal.classList.add('hidden');
    this.victoryModal.classList.add('hidden');
  }

  public update(dt: number, s: HudState): void {
    if (this.dangerTimer > 0) {
      this.dangerTimer -= dt;
      if (this.dangerTimer <= 0) this.kanjiDangerEl.classList.remove('active');
    }
    if (this.calloutTimer > 0) {
      this.calloutTimer -= dt;
      if (this.calloutTimer <= 0) this.calloutEl.classList.remove('visible');
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.bannerOverlay.classList.remove('active');
    }

    this.bossNameEl.textContent = s.bossName;
    const bossHpPct = Math.max(0, Math.min(100, (s.bossHp / s.bossMaxHp) * 100));
    this.bossHpFill.style.width = `${bossHpPct}%`;
    this.bossMoveLabel.textContent = s.bossMoveHint;

    // Boss Deathblow Red Orbs
    let orbsHtml = '';
    for (let i = 0; i < s.bossMaxLives; i++) {
      const filled = i < s.bossLivesLeft;
      orbsHtml += `<span class="db-orb ${filled ? 'alive' : 'spent'}"></span>`;
    }
    if (this.bossOrbsEl.innerHTML !== orbsHtml) {
      this.bossOrbsEl.innerHTML = orbsHtml;
    }

    // Boss Posture (0 -> 50% each side from center)
    const bpPct = Math.max(0, Math.min(1, s.bossPosture / s.bossMaxPosture));
    const halfBp = bpPct * 50;
    this.bossPostureL.style.width = `${halfBp}%`;
    this.bossPostureR.style.width = `${halfBp}%`;
    // Tint posture bar deeper orange-red when Boss Vitality is low (<55%) or posture >75%
    const dangerTint = bpPct > 0.75 || bossHpPct < 50;
    this.bossPostureWrap.classList.toggle('critical', dangerTint);

    // Player Vitality & Posture
    const pHpPct = Math.max(0, Math.min(100, (s.playerHp / s.playerMaxHp) * 100));
    this.playerHpFill.style.width = `${pHpPct}%`;
    const ppPct = Math.max(0, Math.min(1, s.playerPosture / s.playerMaxPosture));
    this.playerPostureL.style.width = `${ppPct * 50}%`;
    this.playerPostureR.style.width = `${ppPct * 50}%`;

    this.gourdCountEl.textContent = `${s.gourdCharges}`;
    this.emblemCountEl.textContent = `${s.spiritEmblems}`;
    this.artNameEl.textContent = ART_NAMES[s.combatArt];
    this.prosNameEl.textContent = PROSTHETIC_NAMES[s.prosthetic];

    let resHtml = '';
    for (let i = 0; i < s.resurrections; i++) {
      resHtml += `<span class="res-orb">回</span>`;
    }
    if (this.resOrbsEl.innerHTML !== resHtml) {
      this.resOrbsEl.innerHTML = resHtml;
    }

    if (s.lightningCharged) {
      this.showCallout('⚡ 雷电在身！落地前快按 [鼠标左键] 发动雷返！', '#ffe659');
    }

    // 3D Projected Lock-On & Crimson Shinobi Deathblow Reticle
    if (s.bossChestScreen.visible) {
      const x = s.bossChestScreen.x;
      const y = s.bossChestScreen.y;
      if (s.deathblowReady) {
        this.deathblowReticle.style.display = 'block';
        this.deathblowReticle.style.left = `${x}px`;
        this.deathblowReticle.style.top = `${y}px`;
        this.lockReticle.style.display = 'none';
      } else if (s.lockedOn) {
        this.lockReticle.style.display = 'block';
        this.lockReticle.style.left = `${x}px`;
        this.lockReticle.style.top = `${y}px`;
        this.deathblowReticle.style.display = 'none';
      } else {
        this.lockReticle.style.display = 'none';
        this.deathblowReticle.style.display = 'none';
      }
    } else {
      this.lockReticle.style.display = 'none';
      this.deathblowReticle.style.display = 'none';
    }
  }
}

export function projectWorldToScreen(
  worldPos: THREE.Vector3,
  camera: THREE.PerspectiveCamera
): { x: number; y: number; visible: boolean } {
  const v = worldPos.clone().project(camera);
  if (v.z > 1 || v.z < -1) {
    return { x: 0, y: 0, visible: false };
  }
  return {
    x: (v.x * 0.5 + 0.5) * window.innerWidth,
    y: (-v.y * 0.5 + 0.5) * window.innerHeight,
    visible: true,
  };
}
