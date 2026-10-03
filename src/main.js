import * as THREE from 'three';
import './style.css';
import { R, buildTerrain, sample, regionAt, regionById, tangentBasis } from './planet.js';
import { toonMaterial, globalUniforms } from './toon.js';
import { InkPass } from './post.js';
import { Sky } from './sky.js';
import { buildWater } from './water.js';
import { buildGrass } from './grass.js';
import { Input } from './input.js';
import { Player, tangent } from './player.js';
import { FollowCam } from './camera.js';
import { Colliders } from './collision.js';
import { Audio } from './audio.js';
import { makeCharacter, CHARACTER_SKINS } from './character.js';
import { buildWorld, MODEL_LIST } from './world.js';
import { preloadModels } from './assets.js';
import { UI } from './ui.js';
import { Save } from './save.js';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const DPR = Math.min(devicePixelRatio, 2);
renderer.setPixelRatio(DPR);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.3, 1000);
const ink = new InkPass(renderer);
const ui = new UI();
const save = new Save();
const audio = new Audio();
audio.setMuted(save.data.muted);

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  const s = renderer.getDrawingBufferSize(new THREE.Vector2());
  ink.setSize(s.x, s.y);
}
addEventListener('resize', resize);

const tick = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

async function boot() {
  ui.loading(0.02, 'Shaping the planet…');
  await tick();
  const sky = new Sky(scene);
  if (save.data.time !== undefined) sky.time = save.data.time;

  const terrainMat = toonMaterial({ vertexColors: true }, { fade: false });
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
  const playerAnim = await makeCharacter(save.data.skin || CHARACTER_SKINS[0]);
  scene.add(playerAnim.root);
  const player = new Player(playerAnim, colliders, audio);

  const game = {
    scene, camera, renderer, sky, colliders, input, follow, player, audio, ui, save, water, terrain,
    interactables: [], updaters: [], time: 0,
  };
  const world = await buildWorld(game);
  game.world = world;
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

  // title screen
  await ui.title(save, async (skin) => {
    if (skin !== (save.data.skin || CHARACTER_SKINS[0])) {
      const a = await makeCharacter(skin);
      scene.remove(player.anim.root);
      a.root.add(player.parasol);
      player.anim = a; player.obj = a.root;
      scene.add(a.root);
      player.sync();
    }
    save.data.skin = skin;
    save.write();
    audio.start();
  }, () => {
    // title view: camera in front of the character
    player.anim.update(0.016);
    const up = player.up;
    const tgt = player.pos.clone().addScaledVector(up, 1.1);
    const side = new THREE.Vector3().crossVectors(up, player.facing).normalize();
    camera.position.copy(tgt).addScaledVector(player.facing, 5.5).addScaledVector(up, 0.9).addScaledVector(side, -1.6);
    camera.up.copy(up);
    camera.lookAt(tgt.clone().addScaledVector(up, 0.6));
    renderFrame(0.016, true);
  });
  follow.snap(player);

  if (input.isTouch) ui.showTouch(input);
  ui.hud(true);

  let last = performance.now();
  let saveT = 0;
  // adaptive resolution: drop pixel ratio if frames are slow
  let perfT = 0, perfN = 0, dpr = DPR;
  function frame(now) {
    const rawDt = (now - last) / 1000;
    const dt = Math.min(0.05, rawDt);
    last = now;
    perfT += rawDt; perfN++;
    if (perfT > 3) {
      const fps = perfN / perfT;
      if (fps < 42 && dpr > 1) { dpr = Math.max(1, dpr - 0.5); renderer.setPixelRatio(dpr); resize(); }
      perfT = 0; perfN = 0;
    }
    game.time += dt;
    globalUniforms.uTime.value = game.time;

    if (!ui.modal) {
      player.update(dt, input, follow);
    } else player.anim.update(dt);
    globalUniforms.uPlayer.value.copy(player.pos);

    for (const u of game.updaters) u(dt, game);
    follow.update(dt, player, input, ui.focus);
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

  function renderFrame(dt, still) {
    const up = player.up;
    // stable east/north in the player's frame (based on world axis)
    tangentBasis(up, east, north);
    sky.update(still ? 0 : dt * (player.mode === 'sit' ? 25 : 1), {
      up, east, north, camPos: camera.position, target: player.pos,
      inSnow: world.biomeHere === 'snow',
    });
    water.update();
    terrain.children.forEach(() => {});
    world.scatter.update(camera.position, 135);
    grass.update(camera.position);
    ink.material.uniforms.uNight.value = sky.night;
    camera.updateMatrixWorld();
    globalUniforms.uPlayerView.value.copy(player.pos).addScaledVector(player.up, 1.0).applyMatrix4(camera.matrixWorldInverse);
    ink.render(scene, camera, game.time);
  }

  requestAnimationFrame(frame);
  window.__game = game;
  window.__regions = regionById;
}

boot().catch((e) => {
  console.error(e);
  ui.error(e);
});
