/* Bootstrap and the top-level state machine.
 *
 *   boot -> loading -> menu -> { class | edit | multiplayer | settings }
 *                           -> game
 *
 * WebAudio cannot start without a gesture, so the loading screen holds at
 * 100% until the player presses a key or a face button; that press is what
 * initialises the audio engine. */

import * as THREE from 'three';
import { Save } from './core/save.js';
import { Audio } from './core/audio.js';
import { Input } from './core/input.js';
import { Screens } from './ui/screens.js';
import { Game } from './game/game.js';
import { TIPS } from './data/gamedata.js';
import { loadingArt, menuArt, classArt, loadArtManifest } from './art/art.js';
import { buildWeapon } from './entities/models.js';
import { wait } from './core/util.js';

const canvas = document.getElementById('gl');

/* ---------------- fatal error surface ---------------- */
function fatal(err) {
  console.error(err);
  const n = document.createElement('div');
  n.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#0a0705;color:#f4ece0;' +
    'font:15px/1.6 ui-monospace,monospace;padding:6vh 6vw;overflow:auto';
  n.innerHTML = `<h2 style="font-family:Cinzel,serif;letter-spacing:.2em;color:#f0a24a;margin-bottom:18px">
      SOMETHING BROKE</h2>
    <p style="opacity:.75;margin-bottom:20px">The game hit an error it could not recover from.
    Your save is untouched — reload to try again.</p>
    <pre style="white-space:pre-wrap;opacity:.6;font-size:12.5px">${(err?.stack || err)}</pre>`;
  document.body.appendChild(n);
}

addEventListener('error', e => { if (!window.__booted) fatal(e.error || e.message); });
addEventListener('unhandledrejection', e => console.error('[unhandled]', e.reason));

/* ============================================================
   Forge preview — a small standalone renderer for the edit screen
   ============================================================ */
async function makeForgePreview(canvasEl) {
  const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, .1, 60);
  camera.position.set(0, .55, 3.1);
  camera.lookAt(0, .5, 0);

  scene.add(new THREE.AmbientLight(0xffffff, .35));
  const key = new THREE.DirectionalLight(0xffe0c0, 3.2);
  key.position.set(3, 5, 4); scene.add(key);
  const rim = new THREE.DirectionalLight(0xf0a24a, 2.4);
  rim.position.set(-4, 2, -3); scene.add(rim);
  const fill = new THREE.PointLight(0x6ab4ff, 1.6, 14);
  fill.position.set(-2, 1, 3); scene.add(fill);

  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(.7, .9, .18, 32),
    new THREE.MeshStandardMaterial({ color: 0x14110e, roughness: .7, metalness: .3 })
  );
  pedestal.position.y = -.62;
  scene.add(pedestal);

  const holder = new THREE.Group();
  scene.add(holder);

  // Cycle through a representative weapon of each colourable kind.
  const SHOWCASE = ['kontana', 'sword', 'axe', 'bow', 'iron_shield', 'knives'];
  let idx = 0, swapT = 0, current = null;

  const rebuild = colors => {
    if (current) holder.remove(current);
    current = buildWeapon(SHOWCASE[idx], colors);
    current.traverse(o => { if (o.isMesh) { o.castShadow = false; } });
    // Centre whatever we built inside the pedestal.
    const bb = new THREE.Box3().setFromObject(current);
    const c = bb.getCenter(new THREE.Vector3());
    current.position.sub(c);
    const size = bb.getSize(new THREE.Vector3());
    const s = 1.5 / Math.max(size.length(), .001) * 1.1;
    current.scale.setScalar(s);
    holder.add(current);
  };

  let colors = null;
  const resize = () => {
    const r = canvasEl.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
  };

  return {
    setColors(c) { colors = c; rebuild(c); },
    update(dt) {
      resize();
      holder.rotation.y += dt * .7;
      swapT += dt;
      if (swapT > 4) { swapT = 0; idx = (idx + 1) % SHOWCASE.length; rebuild(colors); }
      pedestal.rotation.y -= dt * .2;
      renderer.render(scene, camera);
    },
    dispose() { renderer.dispose(); }
  };
}

/* ============================================================
   Boot
   ============================================================ */
async function boot() {
  Save.load();
  // Always have a save object in memory so the menus can read colours,
  // classes and level before the player has ever pressed Play.
  Save.start();

  const input = new Input(canvas);
  const screens = new Screens(input, null);
  const game = new Game(canvas, input, screens);
  screens.game = game;

  // Keep the input layer in step with saved settings.
  const applySettings = s => {
    Audio.setVolumes({ master: s.masterVolume, music: s.musicVolume, sfx: s.sfxVolume, muted: s.muted });
    input.sensitivity = s.sensitivity;
    input.padSensitivity = s.padSensitivity;
    input.invertY = s.invertY;
    game.applySettings(s);
  };

  input.onPad = (connected, pad) => {
    if (connected) screens.toast(`CONTROLLER CONNECTED — ${(pad?.id || '').slice(0, 28).toUpperCase()}`);
  };

  /* ---------------- loading ---------------- */
  const loader = screens.loading({
    tip: TIPS[0],                            // "God and Jesus love you"
    onDone: () => {
      // First gesture: this is where audio is allowed to exist.
      Audio.init();
      applySettings(Save.settings);
      Audio.resume();
      toMenu();
    }
  });

  // Real work drives the bar: art generation is genuinely the slow part.
  const steps = [
    ['Reading custom artwork', () => loadArtManifest()],
    ['Painting the ridgeline', () => loadingArt()],
    ['Painting the charge', () => menuArt()],
    ['Waking the classes', () => { ['shrine', 'bamboo', 'temple'].forEach(n => classArt(n)); }],
    ['Waking the classes', () => { ['ocean', 'nebula', 'desert'].forEach(n => classArt(n)); }],
    ['Waking the classes', () => { ['snow', 'savanna', 'peaks'].forEach(n => classArt(n)); }],
    ['Waking the classes', () => { ['kingdom', 'skyland'].forEach(n => classArt(n)); }],
    ['Folding steel', () => { /* geometry caches warm on first use */ }],
    ['Reading the save', () => Save.start()]
  ];

  for (let i = 0; i < steps.length; i++) {
    loader.setProgress(i / steps.length);
    // Yield so the ring actually animates between chunks of work.
    await new Promise(r => requestAnimationFrame(() => r()));
    try { steps[i][1](); } catch (e) { console.warn('[boot]', steps[i][0], e); }
  }
  loader.setProgress(1);
  window.__booted = true;

  /* ---------------- navigation ---------------- */
  function toMenu() {
    game.stop();
    input.releaseLock();
    Audio.play('menu');
    screens.mainMenu({
      onPlay: fresh => startGame(fresh === true),
      onEdit: toEdit,
      onClass: toClasses,
      onMultiplayer: toMultiplayer,
      onSettings: toSettings
    });
  }

  function toClasses(opts = {}) {
    screens.classSelect({
      onBack: toMenu,
      onPick: () => { game.player?.refreshStats(); setTimeout(toMenu, 700); },
      ...opts
    });
  }

  function toEdit() {
    screens.edit({
      onBack: toMenu,
      previewMount: makeForgePreview
    });
  }

  function toSettings() {
    screens.settings({ onBack: toMenu, onApply: applySettings });
  }

  function toMultiplayer() {
    screens.multiplayer({
      onBack: toMenu,
      onVersus: async () => {
        screens.clear();
        Save.start();
        await game.startVersus();
        input.requestLock();
      },
      onCoop: () => startGame(false, 'coop')
    });
  }

  async function startGame(fresh = false, mode = 'single') {
    screens.clear();
    Save.start(fresh);
    applySettings(Save.settings);

    const d = Save.data;
    game.mode = mode;
    game.onReturnToMenu = toMenu;
    game.onOpenSettings = () => screens.settings({ onBack: () => { screens.clear(); input.requestLock(); }, onApply: applySettings });

    const firstTime = !d.flags.seenIntro;
    const worldId = d.world || 1;

    // The forge belongs at the start of a run: pick your steel before you
    // ever hold it. Only on a genuinely new game, and skippable.
    if (firstTime && !d.flags.forgeDone) {
      await new Promise(resolve => {
        screens.edit({
          firstRun: true,
          previewMount: makeForgePreview,
          onBack: () => { d.flags.forgeDone = true; Save.write(true); screens.clear(); resolve(); }
        });
      });
      await wait(650);
    }

    // Restore where they stood, if the save has it and the world matches.
    const spawnPos = (!firstTime && d.pos)
      ? { x: d.pos[0], y: d.pos[1], z: d.pos[2] }
      : null;

    // World 1 always starts with a sword so the tutorial mission is possible.
    if (firstTime) {
      d.inventory[0] = { id: 'sword', qty: 1 };
      d.inventory[1] = { id: 'knives', qty: 12 };
      d.inventory[4] = { id: 'potion_hp', qty: 3 };
      d.inventory[5] = { id: 'food', qty: 5 };
      d.equipped = 0;
      Save.write(true);
    }

    await game.loadWorld(worldId, { spawnPos, intro: true });
    game.start(mode);

    if (!firstTime && d.stats) {
      game.player.hp = Math.max(1, d.stats.hp || game.player.hpMax);
      game.player.stamina = d.stats.stamina ?? game.player.staminaMax;
      game.player.power = d.stats.power ?? game.player.powerMax;
      game.player.yaw = d.yaw || 0;
    }

    input.requestLock();
    await game.story.spawnCutscene({ firstTime });
    input.requestLock();
  }

  /* Re-acquire pointer lock after the browser drops it (alt-tab, Esc). */
  input.onLockChange = locked => {
    if (!locked && game.running && !game.uiFocus && !game.paused &&
        !game.inventory.open && !game.dialogue.open) {
      game.togglePause();
    }
  };
  canvas.addEventListener('click', () => {
    if (game.running && !game.uiFocus && !game.paused && !input.locked) input.requestLock();
  });
}

// Exposed so tooling and the browser console can inspect a run.
window.__S = Save;

boot().catch(fatal);
