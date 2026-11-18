import * as THREE from 'three';

export type BossId = 'genichiro' | 'isshin';

export type PerilousType = 'none' | 'thrust' | 'sweep' | 'grab' | 'lightning';

export type CombatArtId = 'mortal_draw' | 'ichimonji' | 'whirlwind';

export type ProstheticId = 'shuriken' | 'firecracker' | 'flame_vent';

export type TrailStyle =
  | 'steel'
  | 'mortal'
  | 'boss_steel'
  | 'wind_wave'
  | 'lightning'
  | 'fire';

export interface AttackStrike {
  /** Normalized progress [0..1] in move duration when strike is active */
  hitStart: number;
  hitEnd: number;
  damage: number;
  postureDamage: number;
  deflectPostureToBoss: number;
  range: number;
  arcCos: number;
  perilous: PerilousType;
  knockback: number;
  trailStyle?: TrailStyle;
  /** Optional projectile spawned at hitStart */
  projectile?: 'arrow' | 'lightning_arrow' | 'bullet' | 'dragon_flash' | 'shockwave';
  /** Pose keyframe hint */
  swingDir: 'right_to_left' | 'left_to_right' | 'overhead' | 'thrust' | 'uppercut' | 'spin' | 'sweep_low' | 'bow_shot' | 'pistol_shot' | 'grab';
  fired?: boolean;
}

export interface BossMoveDef {
  id: string;
  nameZh: string;
  duration: number;
  perilousWarningTime?: number;
  perilousType?: PerilousType;
  glintTime?: number;
  jumpArcHeight?: number;
  forwardMotion: number;
  strikes: AttackStrike[];
}

export interface ProjectileEntity {
  mesh: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  fromPlayer: boolean;
  kind: 'shuriken' | 'arrow' | 'lightning_arrow' | 'bullet' | 'dragon_flash';
  damage: number;
  postureDamage: number;
  perilous: PerilousType;
  life: number;
}
