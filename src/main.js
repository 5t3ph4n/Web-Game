import * as THREE from 'three';
import './style.css';
import { R, buildTerrain, sample, regionAt, regionById, tangentBasis } from './planet.js';
import { toonMaterial, globalUniforms, addCaustics, setNight } from './toon.js';
import { PostFX } from './post.js';
import { settings, saveSettings, REALISTIC, q, QUALITY } from './settings.js';
import { LightPool } from './lights.js';
import { waveHeight } from './water.js';
import { Sky } from './sky.js';
import { buildWater } from './water.js';
import { buildGrass } from './grass.js';
import { Input } from './input.js';
import { Player, tangent } from './player.js';
import { FollowCam } from './camera.js';
import { Colliders } from './collision.js';
import { Audio } from './audio.js';
import { makeCharacter, CHARACTER_SKINS, defaultLook } from './character.js';
import { buildWorld, MODEL_LIST } from './world.js';
import { preloadModels } from './assets.js';
import { UI } from './ui.js';
import { Save } from './save.js';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, q().dpr));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = REALISTIC ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = REALISTIC ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
renderer.toneMappingExposure = 0.92;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.3, 1000);
const post = new PostFX(renderer);
if (!REALISTIC && settings.outlines === false && !settings._styleInit) { settings.outlines = true; settings._styleInit = true; saveSettings(); }
const ui = new UI();
const save = new Save();
const audio = new Audio();
audio.setMuted(save.data.muted);

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  post.setSize();
}
addEventListener('resize', resize);

const tick = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

async function boot() {
  ui.loading(0.02, 'Shaping the planet…');
  await tick();
  const sky = new Sky(scene);
  if (save.data.time !== undefined) sky.time = save.data.time;

  const terrainMat = toonMaterial({ vertexColors: true, roughness: 0.95 }, { fade: false });
  if (REALISTIC) addCaustics(terrainMat);
  const terrain = buildTerrain(terrainMat, 150);
  scene.add(terrain);
  ui.loading(0.25, 'Filling the oceans…');
  await tick();
  const water = buildWater(sky);
  scene.add(water);
  ui.loading(0.32, 'Growing grass…');
  await tick();
  const grass = buildGrass(scene, 140000);

  ui.loading(0.4, 'Unpacking little houses…');
  await preloadModels(MODEL_LIST, (p) => ui.loading(0.4 + p * 0.4, 'Unpacking little houses…'));
  ui.loading(0.82, 'Waking everyone up…');
  await tick();

  const east = new THREE.Vector3(), north = new THREE.Vector3();
  const colliders = new Colliders();
  const input = new Input(canvas);
  const follow = new FollowCam(camera);
  follow.colliders = colliders;
  const look = { ...defaultLook(save.data.skin || CHARACTER_SKINS[0]), ...(save.data.look || {}) };
  const playerAnim = await makeCharacter(look);
  const player = new Player(playerAnim, colliders, audio);
  player.setAnim(playerAnim, scene);
  audio.musicOn = settings.music;

  const lights = new LightPool(scene);
  const game = {
    scene, camera, renderer, sky, colliders, input, follow, player, audio, ui, save, water, terrain, lights, post,
    interactables: [], updaters: [], time: 0,
  };
  const world = await buildWorld(game);
  game.world = world;
  // swap the player's look (character creator)
  game.setLook = async (lk, persist) => {
    const a = await makeCharacter(lk);
    player.setAnim(a, scene);
    if (player.holding) player.holding = null;
    save.data.look = lk;
    save.data.skin = lk.base;
    if (persist) save.write();
  };
  ui.bind(game);

  // spawn
  const spawn = world.spawn;
  if (save.data.pos) {
    player.place(new THREE.Vector3().fromArray(save.data.pos), new THREE.Vector3().fromArray(save.data.facing || [0, 0, 1]));
  } else player.place(spawn.dir, spawn.facing);
  player.hasGlider = !!save.data.glider;
  follow.snap(player);
  follow.update(0.016, player, input);
  resize();
  ui.loading(1, 'Ready!');
  await tick();

  // title screen (the creator can be opened from it)
  let lastStill = performance.now();
  await ui.title(save, () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastStill) / 1000);
    lastStill = now;
    player.anim.update(dt);
    player.updateCloth(dt);
    creatorView(dt);
    input.endFrame();
    renderFrame(dt, true);
  });
  audio.start();
  follow.snap(player);

  if (input.isTouch) ui.showTouch(input);
  ui.hud(true);

  let last = performance.now();
  let saveT = 0;
  // adaptive quality: step down when frames are slow
  let perfT = 0, perfN = 0, slowStreak = 0;
  function frame(now) {
    const rawDt = (now - last) / 1000;
    const dt = Math.min(0.05, rawDt);
    last = now;
    perfT += rawDt; perfN++;
    if (perfT > 3) {
      const fps = perfN / perfT;
      slowStreak = fps < 34 ? slowStreak + 1 : 0;
      if (slowStreak >= 2 && settings.autoQuality && settings.quality !== 'low') {
        applyQuality(settings.quality === 'high' ? 'medium' : 'low');
        ui.toast(`Graphics set to ${settings.quality} for smoother play (change it in Settings)`);
        slowStreak = 0;
      }
      perfT = 0; perfN = 0;
    }
    game.time += dt;
    globalUniforms.uTime.value = game.time;

    if (!ui.modal) {
      player.update(dt, input, follow);
    } else { player.anim.update(dt); player.updateCloth(dt); }
    globalUniforms.uPlayer.value.copy(player.pos);

    for (const u of game.updaters) u(dt, game);
    if (ui.creatorState) creatorView(dt);
    else follow.update(dt, player, input, ui.focus);
    ui.update(dt, game);

    renderFrame(dt);
    input.endFrame();

    saveT += dt;
    if (saveT > 5) {
      saveT = 0;
      save.data.pos = player.pos.clone().normalize().toArray();
      save.data.facing = player.facing.toArray();
      save.data.time = sky.time;
      save.write();
    }
    requestAnimationFrame(frame);
  }

  // camera for the title screen and character creator: in front of the character
  function creatorView(dt) {
    const st = ui.creatorState || { yaw: 0, tab: 'body' };
    st.yaw = (st.yaw || 0) + input.look.dx * 0.01;
    const up = player.up;
    const fwd = player.facing.clone().applyAxisAngle(up, st.yaw);
    const side = new THREE.Vector3().crossVectors(up, fwd).normalize();
    const L = player.anim.look || { height: 1 };
    const head = st.tab === 'hair';
    const tgt = player.pos.clone().addScaledVector(up, (head ? 1.55 : 1.05) * L.height);
    const dist = head ? 2.6 : ui.creatorState ? 4.6 : 5.5;
    camera.position.copy(tgt).addScaledVector(fwd, dist).addScaledVector(up, head ? 0.25 : 0.7).addScaledVector(side, ui.creatorState && innerWidth > 700 ? 1.3 : -1.4);
    camera.up.copy(up);
    camera.lookAt(tgt.clone().addScaledVector(side, ui.creatorState && innerWidth > 700 ? 0.9 : 0).addScaledVector(up, head ? 0 : 0.35));
  }

  function applyQuality(name) {
    settings.quality = name;
    saveSettings();
    renderer.setPixelRatio(Math.min(devicePixelRatio, q().dpr));
    const sm = q().shadow;
    sky.sun.shadow.mapSize.set(sm, sm);
    if (sky.sun.shadow.map) { sky.sun.shadow.map.dispose(); sky.sun.shadow.map = null; }
    resize();
  }
  game.applyQuality = applyQuality;

  const _cd = new THREE.Vector3();
  function renderFrame(dt, still) {
    const up = player.up;
    // stable east/north in the player's frame (based on world axis)
    tangentBasis(up, east, north);
    sky.update(still ? 0 : dt * (player.mode === 'sit' ? 25 : 1), {
      up, east, north, camPos: camera.position, target: player.pos,
      inSnow: world.biomeHere === 'snow',
    });
    sky.updateEnv(renderer, dt);
    water.update();
    lights.update(dt, game);
    setNight(sky.night);
    world.scatter.update(camera.position, q().viewDist);
    grass.update(camera.position, q().grassDist);
    camera.updateMatrixWorld();
    globalUniforms.uPlayerView.value.copy(player.pos).addScaledVector(player.up, 1.0).applyMatrix4(camera.matrixWorldInverse);
    // underwater?
    const camR = camera.position.length();
    const surf = R + waveHeight(camera.position, game.time) * 0.85;
    const under = camR < surf - 0.05 ? 1 : 0;
    post.render(scene, camera, game.time, { under, underDepth: Math.max(0, surf - camR), exposure: REALISTIC ? 1.0 : 1 });
  }

  requestAnimationFrame(frame);
  window.__game = game;
  window.__regions = regionById;
}

boot().catch((e) => {
  console.error(e);
  ui.error(e);
});
