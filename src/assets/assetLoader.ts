import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface LoadedSekiroAssets {
  wolfScene: THREE.Group;
  genichiroScene: THREE.Group;
  isshinScene: THREE.Group;
  weaponsAndArena: THREE.Group;
  groundColorTex: THREE.Texture;
  rockColorTex: THREE.Texture;
  woodColorTex: THREE.Texture;
}

export async function loadSekiroAssets(
  onProgress?: (pct: number, label: string) => void
): Promise<LoadedSekiroAssets> {
  const texLoader = new THREE.TextureLoader();
  const gltfLoader = new GLTFLoader();

  const loadTex = (url: string, forGltf: boolean, repeat = 1): Promise<THREE.Texture> =>
    new Promise((resolve) => {
      texLoader.load(
        url,
        (t) => {
          t.colorSpace = THREE.SRGBColorSpace;
          t.flipY = !forGltf;
          t.wrapS = THREE.RepeatWrapping;
          t.wrapT = THREE.RepeatWrapping;
          t.repeat.set(repeat, repeat);
          t.anisotropy = 8;
          resolve(t);
        },
        undefined,
        () => {
          const fallback = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
          fallback.needsUpdate = true;
          resolve(fallback);
        }
      );
    });

  onProgress?.(12, '锻造玉钢与苇名甲胄贴图...');
  const [
    armorTex,
    haoriTex,
    steelTex,
    woodGltfTex,
    rockGltfTex,
    groundColorTex,
    rockColorTex,
    woodColorTex,
  ] = await Promise.all([
    loadTex('./textures/sengoku_armor.jpg', true, 2),
    loadTex('./textures/shinobi_haori.jpg', true, 2),
    loadTex('./textures/tamahagane_steel.jpg', true, 2),
    loadTex('./textures/cedar_wood.jpg', true, 2),
    loadTex('./textures/cliff_rock.jpg', true, 1.5),
    loadTex('./textures/ashina_ground.jpg', false, 26),
    loadTex('./textures/cliff_rock.jpg', false, 4),
    loadTex('./textures/cedar_wood.jpg', false, 3),
  ]);

  onProgress?.(45, '载入独臂忍者「狼」与忍义手模型...');
  const wolfGltf = await gltfLoader.loadAsync('./models/shinobi_wolf.glb');

  onProgress?.(68, '载入「苇名弦一郎」与「剑圣·苇名一心」...');
  const [genGltf, issGltf] = await Promise.all([
    gltfLoader.loadAsync('./models/boss_genichiro.glb'),
    gltfLoader.loadAsync('./models/boss_isshin.glb'),
  ]);

  onProgress?.(88, '构建月下芒草芦苇原与名刀兵器库...');
  const wpnArenaGltf = await gltfLoader.loadAsync('./models/weapons_and_arena.glb');

  const enhanceMaterials = (root: THREE.Object3D) => {
    root.traverse((obj) => {
      if (!(obj as THREE.Mesh).isMesh) return;
      const mesh = obj as THREE.Mesh;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const oldMat = mesh.material as THREE.MeshStandardMaterial;
      if (!oldMat) return;
      const mat = oldMat.clone();
      const mName = mat.name || '';

      if (mName.includes('MAT_Haori')) {
        mat.map = haoriTex;
        mat.color.setHex(0xdf7b3e);
        mat.roughness = 0.82;
      } else if (mName.includes('MAT_YoroiArmor')) {
        mat.map = armorTex;
        mat.color.setHex(0x9a9aa4);
        mat.metalness = 0.68;
        mat.roughness = 0.34;
      } else if (mName.includes('MAT_BladeSteel')) {
        mat.map = steelTex;
        mat.color.setHex(0xf2f6ff);
        mat.metalness = 0.94;
        mat.roughness = 0.14;
      } else if (mName.includes('MAT_MortalBladeCrimson')) {
        mat.map = steelTex;
        mat.color.setHex(0xd4192a);
        mat.emissive.setHex(0x7a0814);
        mat.emissiveIntensity = 0.85;
        mat.metalness = 0.82;
        mat.roughness = 0.2;
      } else if (mName.includes('MAT_CedarWood')) {
        mat.map = woodGltfTex;
        mat.color.setHex(0x9c826e);
        mat.roughness = 0.86;
      } else if (mName.includes('MAT_CliffRock') || mName.includes('MAT_IdolStone')) {
        mat.map = rockGltfTex;
        mat.color.setHex(mName.includes('Idol') ? 0x8d968d : 0x7a808a);
        mat.roughness = 0.88;
      }
      mesh.material = mat;
    });
  };

  enhanceMaterials(wolfGltf.scene);
  enhanceMaterials(genGltf.scene);
  enhanceMaterials(issGltf.scene);
  enhanceMaterials(wpnArenaGltf.scene);

  onProgress?.(100, '准备就绪');
  return {
    wolfScene: wolfGltf.scene,
    genichiroScene: genGltf.scene,
    isshinScene: issGltf.scene,
    weaponsAndArena: wpnArenaGltf.scene,
    groundColorTex,
    rockColorTex,
    woodColorTex,
  };
}
