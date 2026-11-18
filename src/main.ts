import './styles/main.css';
import { loadSekiroAssets } from './assets/assetLoader';
import { SekiroGame } from './combat/sekiroGame';
import type { BossId } from './types';

async function bootstrap(): Promise<void> {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const loadOverlay = document.getElementById('loading-overlay')!;
  const loadStatus = document.getElementById('loading-status')!;
  const loadBar = document.getElementById('load-bar-fill')!;
  const titleOverlay = document.getElementById('title-overlay')!;
  const hudRoot = document.getElementById('hud-root')!;

  let selectedBoss: BossId = 'genichiro';

  const assets = await loadSekiroAssets((pct, label) => {
    loadBar.style.width = `${pct}%`;
    loadStatus.textContent = label;
  });

  const game = new SekiroGame(canvas, assets);

  loadOverlay.classList.add('hidden');
  titleOverlay.classList.remove('hidden');

  const cardGen = document.getElementById('card-genichiro')!;
  const cardIss = document.getElementById('card-isshin')!;

  const selectBossCard = (id: BossId) => {
    selectedBoss = id;
    cardGen.classList.toggle('selected', id === 'genichiro');
    cardIss.classList.toggle('selected', id === 'isshin');
    game.setupEncounter(id, false);
  };

  cardGen.addEventListener('click', () => selectBossCard('genichiro'));
  cardIss.addEventListener('click', () => selectBossCard('isshin'));

  document.getElementById('btn-start-duel')!.addEventListener('click', () => {
    titleOverlay.classList.add('hidden');
    hudRoot.classList.remove('hidden');
    game.startFight(selectedBoss);
  });

  document.getElementById('btn-switch-boss')!.addEventListener('click', () => {
    const next: BossId = game.currentBossId === 'genichiro' ? 'isshin' : 'genichiro';
    selectedBoss = next;
    game.startFight(next);
  });

  document.getElementById('btn-back-title')!.addEventListener('click', () => {
    game.isRunning = false;
    if (document.pointerLockElement === canvas) {
      document.exitPointerLock?.();
    }
    hudRoot.classList.add('hidden');
    titleOverlay.classList.remove('hidden');
    game.setupEncounter(selectedBoss, false);
  });

  let lastTime = performance.now();
  const loop = (now: number) => {
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    game.step(dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

bootstrap().catch((err) => {
  console.error('Sekiro bootstrap failed:', err);
  const st = document.getElementById('loading-status');
  if (st) st.textContent = `加载异常: ${String(err)}`;
});
