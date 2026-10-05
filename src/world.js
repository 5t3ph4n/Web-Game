import * as THREE from 'three';
import { R, sample, normalAt, regionAt, regionById, REGIONS, biomeAt, tangentBasis, angle } from './planet.js';
import { Scatter, surfaceMatrix, surfaceQuat, makeObject, getModel, modelCollider, trunkRadius } from './assets.js';
import { resolve } from './collision.js';
import { IS_TOUCH } from './input.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toonMaterial, globalUniforms } from './toon.js';
import { mulberry32 } from './noise.js';
import { buildPeople, offsetDir } from './npcs.js';
import { FX } from './fx.js';
import { orient, tangent, WATER_DEPTH_SWIM } from './player.js';

// Models to preload. `wind` = sway strength for foliage.
const N = (n, wind = 0) => ({ path: 'nature/' + n, wind });
export const MODEL_LIST = [
  // nature
  ...['tree_oak', 'tree_default', 'tree_detailed', 'tree_fat', 'tree_tall', 'tree_cone', 'tree_small', 'tree_simple', 'tree_plateau',
    'tree_oak_dark', 'tree_default_dark', 'tree_detailed_dark', 'tree_fat_darkh', 'tree_tall_dark', 'tree_cone_dark',
    'tree_oak_fall', 'tree_default_fall', 'tree_blocks_fall',
    'tree_pineDefaultA', 'tree_pineDefaultB', 'tree_pineRoundA', 'tree_pineRoundC', 'tree_pineTallA', 'tree_pineTallB', 'tree_pineSmallA',
    'tree_palmTall', 'tree_palmBend', 'tree_palmDetailedTall', 'tree_palmShort', 'plant_bush', 'plant_bushLarge', 'plant_bushDetailed',
    'plant_bushSmall', 'flower_purpleA', 'flower_purpleB', 'flower_redA', 'flower_redB', 'flower_yellowA', 'flower_yellowB',
    'grass_large', 'grass_leafsLarge', 'crops_cornStageC', 'crops_cornStageD', 'crops_wheatStageB', 'crops_leafsStageB', 'crop_pumpkin',
    'crop_melon', 'crops_bambooStageB', 'hanging_moss'].map((n) => N(n, n.includes('palm') ? 0.03 : 0.05)),
  ...['rock_largeA', 'rock_largeB', 'rock_largeC', 'rock_tallA', 'rock_tallB', 'rock_tallE', 'rock_smallA', 'rock_smallC', 'rock_smallFlatA',
    'stone_largeA', 'stone_tallA', 'stone_tallC', 'stone_smallB', 'cactus_tall', 'cactus_short', 'log', 'log_large', 'log_stack',
    'stump_round', 'stump_old', 'mushroom_red', 'mushroom_redTall', 'mushroom_redGroup', 'mushroom_tan', 'mushroom_tanTall', 'mushroom_tanGroup',
    'statue_column', 'statue_columnDamaged', 'statue_head', 'statue_obelisk', 'statue_ring', 'statue_block', 'lily_large', 'lily_small',
    'tent_detailedOpen', 'tent_smallClosed', 'campfire_stones', 'campfire_logs', 'canoe', 'sign', 'fence_simple', 'fence_planks', 'pot_large',
    'bridge_wood', 'path_stone', 'path_stoneCircle', 'cliff_rock', 'cliff_large_rock', 'platform_stone'].map((n) => N(n)),
  // houses & town
  ...'abcdefghijklmnopqrstu'.split('').map((c) => 'houses/building-type-' + c),
  'houses/tree-large', 'houses/tree-small', 'houses/planter', 'houses/fence-low', 'houses/path-stones-long',
  ...['fountain-round', 'fountain-center', 'lantern', 'stall', 'stall-red', 'stall-green', 'stall-bench', 'stall-stool', 'cart', 'cart-high',
    'banner-red', 'banner-green', 'hedge', 'hedge-large', 'fence', 'pillar-stone', 'windmill', 'watermill', 'wheel', 'rock-large', 'rock-wide',
    'poles', 'stairs-stone', 'overhang'].map((n) => 'town/' + n),
  // survival & boats
  ...['barrel', 'box', 'box-large', 'chest', 'bucket', 'signpost', 'tent', 'tent-canvas', 'campfire-pit', 'bedroll', 'fish', 'fish-large',
    'workbench', 'resource-wood', 'rock-sand-a', 'rock-sand-b', 'tree-autumn', 'patch-grass-large', 'structure', 'fence-fortified'].map((n) => 'survival/' + n),
  ...['boat-row-large', 'boat-row-small', 'boat-sail-a', 'boat-sail-b', 'boat-fishing-small', 'ship-small', 'ship-large', 'ship-ocean-liner-small', 'buoy', 'buoy-flag', 'boat-house-a', 'cargo-pile-a', 'cargo-container-a'].map((n) => 'boats/' + n),
];

const BIOME_SCATTER = {
  village: [['tree_default', 1, 5], ['tree_oak', 1, 5], ['plant_bush', 2, 3.5], ['flower_yellowA', 3, 4], ['flower_redA', 2, 4], ['rock_smallA', 0.6, 4], ['grass_large', 3, 4]],
  meadow: [['flower_yellowA', 6, 4.5], ['flower_yellowB', 4, 4.5], ['flower_redA', 4, 4.5], ['flower_redB', 3, 4.5], ['flower_purpleA', 4, 4.5], ['flower_purpleB', 4, 4.5], ['plant_bushSmall', 2, 4], ['tree_default', 0.5, 5], ['tree_simple', 0.4, 5], ['grass_large', 4, 4], ['grass_leafsLarge', 2, 4]],
  farm: [['flower_yellowA', 2, 4], ['tree_default', 0.4, 5], ['plant_bush', 1, 3.5], ['grass_large', 3, 4]],
  forest: [['tree_oak_dark', 2.5, 5.5], ['tree_detailed_dark', 2.5, 5.5], ['tree_fat_darkh', 2, 5], ['tree_tall_dark', 2, 5.5], ['tree_default_dark', 2, 5.5], ['tree_cone_dark', 1.5, 5], ['tree_oak_fall', 0.5, 5.5], ['tree_default_fall', 0.4, 5.5], ['plant_bushLarge', 1.5, 4], ['plant_bushDetailed', 1.5, 4], ['mushroom_red', 1.2, 5], ['mushroom_tanGroup', 1, 5], ['log', 0.4, 4.5], ['stump_round', 0.5, 4.5], ['grass_leafsLarge', 2, 4], ['rock_smallC', 0.6, 4]],
  mushroom: [['mushroom_redTall', 3, 9], ['mushroom_tanTall', 3, 9], ['mushroom_redGroup', 3, 7], ['mushroom_tanGroup', 3, 7], ['tree_blocks_fall', 0.6, 5], ['plant_bushDetailed', 1, 4], ['flower_purpleA', 3, 4]],
  mountain: [['tree_pineDefaultA', 2, 5], ['tree_pineDefaultB', 2, 5], ['tree_pineRoundA', 1.5, 5], ['tree_pineTallA', 1.5, 5], ['tree_pineSmallA', 1.5, 5], ['rock_largeA', 0.8, 4], ['rock_tallA', 0.6, 4], ['stone_smallB', 1, 4], ['plant_bushSmall', 1, 4]],
  beach: [['tree_palmTall', 1.5, 5], ['tree_palmBend', 1.5, 5], ['tree_palmDetailedTall', 1, 5], ['rock_smallFlatA', 1, 4], ['plant_bushSmall', 1, 4]],
  desert: [['cactus_tall', 1.6, 5], ['cactus_short', 2, 5], ['survival/rock-sand-a', 1, 2.6], ['survival/rock-sand-b', 1, 2.6], ['rock_tallE', 0.4, 4.5], ['tree_plateau', 0.6, 5]],
  snow: [['tree_pineTallB', 2.5, 5], ['tree_pineRoundC', 2, 5], ['tree_pineSmallA', 2, 5], ['stone_tallA', 0.8, 4], ['stone_largeA', 0.8, 4], ['stone_smallB', 1, 4]],
  crater: [['stone_tallC', 1.5, 4.5], ['stone_largeA', 1.5, 4.5], ['rock_tallB', 1, 4], ['cactus_short', 0.5, 4], ['plant_bushSmall', 0.6, 4]],
  ruins: [['tree_detailed', 1, 5.5], ['tree_oak', 0.8, 5.5], ['plant_bushDetailed', 1.5, 4], ['statue_block', 0.6, 4], ['flower_purpleB', 2, 4], ['rock_largeB', 0.5, 4], ['grass_large', 3, 4]],
};

// Which scattered props are solid by default: trees just at the trunk, chunky things by their actual mesh.
const AUTO_COLLIDE = (path) => {
  if (/tree|palm/.test(path)) return 'trunk';
  if (/cactus|rock_large|stone_large|rock-sand|rock_tall|stone_tall|log|stump|statue|mushroom_.*Tall/.test(path)) return 'mesh';
  return false;
};

export async function buildWorld(game) {
  const { scene, colliders, audio, save, ui } = game;
  const scatter = new Scatter();
  const rand = mulberry32(2024);
  const fx = new FX(scene);
  const world = { scatter, fx, biomeHere: 'village', regionHere: null, seats: [] };
  game.world = world;

  const P = (n) => (n.includes('/') ? n : 'nature/' + n);
  /**
   * Place a static prop. Its collider comes from the model's own mesh (`collide: 'mesh'`), just a tree trunk
   * ('trunk'), nothing (false), or a plain cylinder of the given radius (number, with optional `top`).
   * Defaults to AUTO_COLLIDE. Returns the matrix.
   */
  function prop(path, dir, { yaw = 0, scale = 1, lift = 0, collide, top, shadow = true, height, onLand } = {}) {
    path = P(path);
    const m = surfaceMatrix(dir, { yaw, scale, lift, height });
    scatter.add(path, m, { shadow });
    if (collide === undefined) collide = AUTO_COLLIDE(path);
    if (collide) {
      const h = height !== undefined ? height : sample(dir);
      const base = dir.clone().multiplyScalar(R + h + lift);
      if (collide === 'mesh') colliders.add(modelCollider(path, base, dir, { yaw, scale, onLand }));
      else if (collide === 'trunk') colliders.add({ pos: base, r: trunkRadius(path) * scale, top: getModel(path).size.y * scale });
      else colliders.add({ pos: base, r: collide, top: top ?? Infinity, onLand });
    }
    return m;
  }
  const at = (rid, e, n) => offsetDir(regionById[rid].dir, e, n);
  const yawToward = (from, to) => {
    // yaw so that +Z faces from -> to in the local frame of `from`
    const q = surfaceQuat(from, 0);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const d = to.clone().sub(from);
    return Math.atan2(d.dot(right), d.dot(fwd));
  };
  const addInteract = (o) => { game.interactables.push(o); return o; };
  const surfPos = (dir, lift = 0) => dir.clone().multiplyScalar(R + sample(dir) + lift);

  // ---------------------------------------------------------------- Pebbleton (village)
  const V = regionById.village.dir;
  {
    // fountain
    const fdir = V.clone();
    prop('town/fountain-round', fdir, { scale: 2.6, collide: 'mesh' });
    prop('town/fountain-center', fdir, { scale: 2.6, lift: 0.0, collide: 'mesh', shadow: true });
    const water = new THREE.Mesh(new THREE.CircleGeometry(2.2, 24), toonMaterial({ color: 0x8fdcd8 }));
    water.position.copy(surfPos(fdir, 0.5)); water.quaternion.copy(surfaceQuat(fdir)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
    scene.add(water);
    addInteract({ pos: surfPos(fdir, 0.6), radius: 3.6, label: 'Make a wish', action: () => {
      audio.chime(1046); fx.sparkle(surfPos(fdir, 2.5), 20, 0x9fe8ff);
      ui.toast(['You toss a pebble. Plip!', 'You wish for... it\'s a secret.', 'Somewhere, a bird sneezes.', 'The fountain gurgles happily.'][Math.floor(Math.random() * 4)]);
    } });
    // houses in a ring
    const houses = 'abcdefghijklmnopqrstu'.split('');
    const ringN = 13;
    for (let i = 0; i < ringN; i++) {
      const a = (i / ringN) * Math.PI * 2 + 0.2;
      if (Math.abs(Math.sin(a - 1.35)) < 0.12 || Math.abs(Math.sin(a - 4.45)) < 0.08) continue; // keep roads open
      const r = 17 + (i % 3) * 1.5;
      const d = offsetDir(V, Math.cos(a) * r, Math.sin(a) * r);
      const yaw = yawToward(d, V);
      const type = houses[(i * 5) % houses.length];
      prop('houses/building-type-' + type, d, { yaw, scale: 6.5, lift: -0.15, collide: 'mesh' });
      // a lantern & planter in front
      const front = offsetDir(V, Math.cos(a) * (r - 6.2), Math.sin(a) * (r - 6.2));
      if (i % 2 === 0) {
        const pole = offsetDir(V, Math.cos(a + 0.18) * (r - 6), Math.sin(a + 0.18) * (r - 6));
        prop('town/lantern', pole, { scale: 2.4, collide: 'mesh' });
        fx.addGlow(surfPos(pole, 3.5), 0xffc46b, 3);
        if (i === 6) bannerOnPole('town/banner-red', pole);
        if (i === 12) bannerOnPole('town/banner-green', pole);
      } else prop('houses/planter', front, { yaw, scale: 3, collide: 'mesh' });
    }
    // outer houses
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.55;
      const r = 32 + (i % 2) * 4;
      const d = offsetDir(V, Math.cos(a) * r, Math.sin(a) * r);
      if (sample(d) < 1.5) continue;
      prop('houses/building-type-' + houses[(i * 7 + 3) % houses.length], d, { yaw: yawToward(d, V), scale: 6.5, lift: -0.2, collide: 'mesh' });
      prop('houses/tree-large', offsetDir(V, Math.cos(a + 0.12) * (r + 2), Math.sin(a + 0.12) * (r + 2)), { scale: 6 });
    }
    // market stalls
    const stalls = ['town/stall-red', 'town/stall-green', 'town/stall', 'town/stall-red'];
    stalls.forEach((s, i) => {
      const d = at('village', 9 + i * 0.3, 7 - i * 3.2);
      prop(s, d, { yaw: yawToward(d, V), scale: 2.4, collide: 'mesh' });
    });
    prop('town/cart', at('village', -10, 7), { yaw: 0.6, scale: 2.4, collide: 'mesh' });
    prop('survival/barrel', at('village', 11, 0), { scale: 2.6, collide: 'mesh' });
    prop('survival/barrel', at('village', 11.8, -0.8), { scale: 2.6, collide: 'mesh' });
    prop('survival/box-large', at('village', 12, 1.2), { scale: 2.6, collide: 'mesh' });
    // benches around fountain
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const d = offsetDir(V, Math.cos(a) * 7, Math.sin(a) * 7);
      addBench(d, yawToward(d, V) + Math.PI / 2, V);
    }
    // little trees in square
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      prop('houses/tree-small', offsetDir(V, Math.cos(a) * 11.5, Math.sin(a) * 11.5), { scale: 5 });
    }
    // signpost
    addSign(at('village', 0, -14), 'Pebbleton  ·  East: Gull Harbor  ·  North-East: Mount Hush  ·  West: Mirror Lake  ·  South: Windmill Farm');
  }

  // ---------------------------------------------------------------- benches, banners & signs helpers
  // Benches and logs are long along their local Z: you sit on top, facing across them (local ±X).
  function acrossSeat(dir, yaw, lookAt) {
    const x = new THREE.Vector3(1, 0, 0).applyQuaternion(surfaceQuat(dir, yaw));
    if (lookAt && x.dot(lookAt) < x.dot(dir)) x.negate(); // turn toward lookAt
    return x;
  }
  /** Where to put a sitter: on top of the seat at `dir` (the sit pose sits on whatever is under its feet). */
  function seatPos(dir) {
    const probe = surfPos(dir, 0.02);
    const res = resolve(colliders, probe.clone(), 0.15, { step: 1.5 });
    return dir.clone().multiplyScalar(Math.max(probe.length(), res.floor) - 0.03);
  }
  function addBench(dir, yaw, lookAt) {
    prop('town/stall-bench', dir, { yaw, scale: 2.6, collide: 'mesh' });
    const seat = { dir, facing: acrossSeat(dir, yaw, lookAt), pos: seatPos(dir) };
    world.seats.push(seat);
    addInteract({ pos: seat.pos, radius: 2.0, label: 'Sit', action: () => sitDown(seat) });
    return seat;
  }
  /**
   * The banner models are wall banners: a cloth hanging from a short rod ~1m off the model's origin. Hang one
   * from a lamp post instead, cloth facing the square and its rod resting against the pole.
   */
  function bannerOnPole(path, pole, scale = 2.6) {
    const yaw = yawToward(pole, V) - Math.PI / 2; // the cloth's normal (model +X) points at the square
    const q = surfaceQuat(pole, yaw);
    const off = new THREE.Vector3(1, 0, 0).applyQuaternion(q).multiplyScalar(-0.4 * scale)
      .addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(q), -(0.12 * scale + 0.14));
    const d = pole.clone().multiplyScalar(R).add(off).normalize();
    prop(path, d, { yaw, scale, height: sample(pole), collide: 'mesh' });
  }
  function addSign(dir, text) {
    prop('survival/signpost', dir, { scale: 2.8, collide: 'mesh' });
    addInteract({ pos: surfPos(dir, 1), radius: 2.5, label: 'Read', action: () => ui.dialogue('Signpost', [text], 0, null) });
  }
  world.addSeat = (npc) => {
    // put a bench (or log) under a sitting NPC, turned across the way they face, and sit them on top of it
    const d = npc.home;
    const biome = biomeAt(d);
    const yaw = yawToward(d, d.clone().add(npc.facing)) - Math.PI / 2;
    if (biome === 'forest' || biome === 'beach' || biome === 'desert') prop('log', d, { scale: 4, yaw: yaw + (rand() - 0.5) * 0.3, collide: 'mesh' });
    else prop('town/stall-bench', d, { scale: 2.6, yaw, collide: 'mesh' });
    npc.pos.copy(seatPos(d));
    npc.sync();
  };

  let seated = null;
  function sitDown(seat) {
    const p = game.player;
    seated = seat;
    p.mode = 'sit';
    p.pos.copy(seat.pos);
    p.facing.copy(seat.facing);
    p.sync();
    p.anim.play('sit', 0.2);
    ui.toast(IS_TOUCH ? 'Sitting. Time flies... (tap Stand up when you\'re ready)' : 'Sitting. Time flies... (press E or SPACE to stand)');
  }
  game.updaters.push((dt) => {
    const p = game.player, inp = game.input;
    const ax = inp.axes();
    const walkAway = inp.hit('KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight') || (inp.touchMove.active && Math.hypot(ax.x, ax.y) > 0.6);
    if (seated && p.mode === 'sit' && (inp.hit('KeyE', 'Space', 'Tap') || walkAway)) {
      seated = null; p.mode = 'walk';
      p.pos.addScaledVector(p.facing, 0.9);
      p.anim.play('idle', 0.2);
      game.input.pressed.clear();
    }
  });

  // ---------------------------------------------------------------- Gull Harbor
  const H = regionById.harbor.dir;
  {
    const houses = ['k', 'b', 'e', 'p', 'g'];
    houses.forEach((t, i) => {
      const d = at('harbor', -10 + i * 5.5, 8 + (i % 2) * 2);
      prop('houses/building-type-' + t, d, { yaw: Math.PI, scale: 5.5, lift: -0.15, collide: 'mesh' });
    });
    prop('boats/boat-house-a', at('harbor', -14, -6), { scale: 2.2, yaw: 1.2, collide: 'mesh' });
    prop('boats/cargo-pile-a', at('harbor', -6, -9), { scale: 2, collide: 'mesh' });
    for (let i = 0; i < 6; i++) prop('survival/' + (i % 2 ? 'barrel' : 'box'), at('harbor', 2 + i * 0.9, -5 - (i % 3)), { scale: 2.6, collide: 'mesh' });
    addSign(at('harbor', -2, 2), 'Gull Harbor  ·  Rowboat for hire (free!)  ·  Turtle Isle: far, far east across the sea');
    prop('town/lantern', at('harbor', 3, 4), { scale: 2.4, collide: 'mesh' });
    fx.addGlow(surfPos(at('harbor', 3, 4), 3.5), 0xffc46b, 3);
  }
  // pier: walk east from the harbor until the water
  const pier = buildPier(H, 1, 0, 26);
  // boats moored
  const moored = [
    ['boats/boat-sail-a', 2.2, [16, 10], 0.4], ['boats/boat-fishing-small', 2.2, [20, -9], 2.0], ['boats/ship-small', 3, [40, 18], 1.0],
    ['boats/ship-large', 3, [70, -30], 2.4], ['boats/boat-sail-b', 2.2, [-30, 70], 0.3], ['boats/ship-ocean-liner-small', 3, [-40, 120], 1.3],
  ];
  const bobbers = [];
  for (const [path, s, [e, n], yaw] of moored) {
    const d = at('harbor', e, n);
    if (sample(d) > -1.5) continue;
    const o = makeObject(path);
    o.scale.setScalar(s);
    scene.add(o);
    bobbers.push({ o, d, yaw, ph: rand() * 6 });
    colliders.add(modelCollider(path, d.clone().multiplyScalar(R - 0.15), d, { yaw, scale: s }));
  }
  // buoys around the reef
  for (let i = 0; i < 8; i++) {
    const d = offsetDir(regionById.reef.dir, Math.cos(i) * 14, Math.sin(i) * 14);
    if (sample(d) > -1) continue;
    const o = makeObject(i % 2 ? 'boats/buoy' : 'boats/buoy-flag');
    o.scale.setScalar(2);
    scene.add(o);
    bobbers.push({ o, d, yaw: i, ph: i });
  }
  game.updaters.push((dt, g) => {
    for (const b of bobbers) {
      if (!b.o.visible && b.o.position.lengthSq() > 0 && b.o.position.distanceToSquared(g.player.pos) > 150 * 150) continue;
      b.o.position.copy(b.d).multiplyScalar(R - 0.15 + Math.sin(g.time * 1.3 + b.ph) * 0.15);
      b.o.quaternion.copy(surfaceQuat(b.d, b.yaw));
      b.o.rotateX(Math.sin(g.time * 1.1 + b.ph) * 0.05);
      b.o.rotateZ(Math.cos(g.time * 0.9 + b.ph) * 0.06);
    }
  });

  function buildPier(center, de, dn, len) {
    // find shoreline heading east from region centre and extend a wooden pier over the water
    const mat = toonMaterial({ color: 0xb98a5e });
    const postMat = toonMaterial({ color: 0x7a5a40 });
    const g = new THREE.Group();
    let start = null, end = null;
    for (let s = 0; s < 120; s += 0.5) {
      const d = offsetDir(center, de * s, dn * s);
      if (start === null && sample(d) < 0.4 && sample(offsetDir(center, de * (s + 3), dn * (s + 3))) < -0.3) start = s;
      if (start !== null && s - start > len) { end = s; break; }
    }
    if (start === null || end === null) return null;
    start -= 4;
    const deck = 1.5;
    // reach back up the beach until the first plank is a comfortable step up from the sand
    const start0 = start;
    for (let k = 0; k < 10 && sample(offsetDir(center, de * start, dn * start)) < deck - 0.35; k++) start -= 1.15;
    const plankGeo = new THREE.BoxGeometry(3, 0.25, 1.1);
    const postGeo = new THREE.CylinderGeometry(0.18, 0.18, 4, 6);
    let last;
    for (let s = start; s < end; s += 1.15) {
      const d = offsetDir(center, de * s, dn * s);
      const m = new THREE.Mesh(plankGeo, mat);
      m.position.copy(d).multiplyScalar(R + deck);
      const fwd = tangent(offsetDir(center, de * (s + 1), dn * (s + 1)).sub(d), d);
      orient(m, d, fwd);
      m.rotateY(s < start0 - 0.01 ? Math.sin(s * 12.9898) * 0.025 : (rand() - 0.5) * 0.05);
      m.castShadow = m.receiveShadow = true;
      g.add(m);
      colliders.add({
        pos: d.clone().multiplyScalar(R + deck + 0.12 - 8), up: d.clone(), y1: 8,
        ax: new THREE.Vector3().crossVectors(d, fwd).normalize(), az: fwd.clone(), hx: 1.5, hz: 0.6,
      });
      if (Math.round(s / 1.15) % 3 === 0) {
        for (const side of [-1.35, 1.35]) {
          const pd = offsetDir(center, de * s + dn * side, dn * s - de * side);
          const p = new THREE.Mesh(postGeo, postMat);
          p.position.copy(pd).multiplyScalar(R + deck - 1.6);
          p.quaternion.copy(surfaceQuat(pd));
          p.castShadow = true;
          g.add(p);
        }
      }
      last = d;
    }
    // bake planks and posts into two meshes (2 draw calls instead of dozens)
    const bake = (matFilter) => {
      const geos = [];
      g.children.filter((c) => c.material === matFilter).forEach((c) => { c.updateMatrix(); geos.push(c.geometry.clone().applyMatrix4(c.matrix)); });
      const mesh = new THREE.Mesh(mergeGeometries(geos), matFilter);
      mesh.castShadow = mesh.receiveShadow = true;
      return mesh;
    };
    scene.add(bake(mat), bake(postMat));
    return { start: offsetDir(center, de * start, dn * start), end: last, deck };
  }

  // ---------------------------------------------------------------- Rowboat (rideable)
  {
    const boatObj = makeObject('boats/boat-row-large');
    boatObj.scale.setScalar(1.7);
    scene.add(boatObj);
    const endD = pier ? offsetDir(pier.end, 0, -2.6) : offsetDir(H, 30, 0);
    const boat = { dir: endD.clone(), facing: new THREE.Vector3(), speed: 0, riding: false, obj: boatObj };
    tangentBasis(boat.dir, boat.facing, new THREE.Vector3());
    world.boat = boat;
    const it = addInteract({ get pos() { return boat.obj.position; }, radius: 3.6, label: 'Row the boat', icon: '🚣', action: () => {
      const p = game.player;
      boat.riding = true; p.mode = 'ride'; p.anim.play('sit', 0.2);
      boat.facing.copy(p.facing); tangent(boat.facing, boat.dir);
      boat.landing = null; boat.scanT = 0;
      ui.toast(IS_TOUCH ? 'Push the stick to row & steer · "Hop out" pops up near land' : 'W to row · A/D to steer · E near land to hop out');
      it.enabled = false;
    } });
    boat.interact = it;
    // nearest dry spot to hop out onto (or the pier), refreshed a few times a second while rowing
    const findLanding = () => {
      if (pier && boat.dir.angleTo(pier.end) * R < 6) return { onPier: true };
      let best = null;
      for (let a = 0; a < 16; a++) {
        for (const r of [3, 5, 7]) {
          const d = offsetDir(boat.dir, Math.cos(a / 16 * 6.283) * r, Math.sin(a / 16 * 6.283) * r);
          if (sample(d) > 0.3 && (!best || r < best.r)) best = { d, r };
        }
      }
      return best;
    };
    game.updaters.push((dt, g) => {
      const p = g.player, inp = g.input;
      const up = boat.dir;
      if (boat.riding) {
        const ax = inp.axes();
        boat.facing.applyAxisAngle(up, -ax.x * dt * 1.6);
        boat.speed += (ax.y * (inp.down('ShiftLeft', 'ShiftRight') || inp.touchRun ? 13 : 9) - boat.speed) * Math.min(1, dt * 1.5);
        tangent(boat.facing, up);
        const nd = up.clone().addScaledVector(boat.facing, (boat.speed * dt) / R).normalize();
        if (sample(nd) < -1.0) boat.dir.copy(nd); else boat.speed *= -0.3;
        p.pos.copy(boat.dir).multiplyScalar(R + 0.5);
        p.facing.copy(boat.facing);
        p.speed = Math.abs(boat.speed);
        p.sync();
        p.anim.play('sit', 0.2);
        if (Math.abs(boat.speed) > 1 && Math.random() < dt * 4) audio.swim();
        boat.scanT -= dt;
        if (boat.scanT <= 0) { boat.scanT = 0.2; boat.landing = findLanding(); }
        if (inp.hit('KeyE', 'Tap')) {
          // hop out onto nearest land
          const best = findLanding();
          if (best) {
            boat.riding = false; p.mode = 'walk';
            if (best.onPier) p.place(pier.end, p.facing); else p.place(best.d, p.facing);
            p.pos.setLength(p.pos.length() + (best.onPier ? pier.deck + 0.3 : 0.2));
            it.enabled = true;
            boat.landing = null;
            inp.pressed.clear();
          } else ui.toast('Too far from land to hop out!');
        }
      } else boat.speed *= 1 - dt;
      tangent(boat.facing, up);
      boat.obj.position.copy(boat.dir).multiplyScalar(R - 0.25 + Math.sin(g.time * 1.4) * 0.08);
      orient(boat.obj, up, boat.facing);
      boat.obj.rotateZ(Math.sin(g.time * 1.2) * 0.04 + (boat.riding ? -0.0 : 0));
    });
  }

  // ---------------------------------------------------------------- Lighthouse
  {
    const d = at('lighthouse', 4, 0);
    const base = R + sample(d);
    const g = new THREE.Group();
    const white = toonMaterial({ color: 0xf6f1e7 }), red = toonMaterial({ color: 0xe0605a }), dark = toonMaterial({ color: 0x4b4f63 });
    for (let i = 0; i < 6; i++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(1.9 - i * 0.18 - 0.18, 1.9 - i * 0.18, 2.2, 14), i % 2 ? red : white);
      seg.position.y = 1.1 + i * 2.2; seg.castShadow = seg.receiveShadow = true;
      g.add(seg);
    }
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 0.3, 14), dark); deck.position.y = 13.4; g.add(deck);
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.6, 10), toonMaterial({ color: 0xfff2b0, emissive: 0xffe08a, emissiveIntensity: 0.4 }));
    lamp.position.y = 14.4; g.add(lamp);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.4, 1.6, 12), red); roof.position.y = 16; g.add(roof);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.6, 0.3), dark); door.position.set(0, 0.8, 1.75); g.add(door);
    // rotating beam
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff1b8, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const beam = new THREE.Mesh(new THREE.ConeGeometry(3.5, 40, 16, 1, true), beamMat);
    beam.rotation.z = Math.PI / 2; beam.position.x = 20;
    const beamPivot = new THREE.Group(); beamPivot.position.y = 14.4; beamPivot.add(beam); g.add(beamPivot);
    g.position.copy(d).multiplyScalar(base - 0.2);
    g.quaternion.copy(surfaceQuat(d));
    scene.add(g);
    // tapering tower, walkable balcony, lamp room and a roof you can perch on (the Stardrop sits just above it)
    const lb = d.clone().multiplyScalar(base - 0.2);
    colliders.add({ pos: lb, r: 1.9, rt: 0.82, top: 13.2 });
    colliders.add({ pos: lb, r: 1.7, y0: 13.2, top: 13.55 });
    colliders.add({ pos: lb, r: 0.9, y0: 13.55, top: 15.2 });
    colliders.add({ pos: lb, r: 1.4, rt: 0.05, y0: 15.2, top: 16.8, standR: 0.45 });
    fx.addGlow(d.clone().multiplyScalar(base + 14.4), 0xffe7a0, 9);
    game.updaters.push((dt, gm) => {
      beamPivot.rotation.y += dt * 0.8;
      beamMat.opacity = gm.sky.night * 0.28;
      lamp.material.emissiveIntensity = 0.3 + gm.sky.night * 1.5;
    });
    addSign(at('lighthouse', -1, -4), 'Lighthouse Point  ·  Please do not feed the crabs (they will ask for more)');
  }

  // ---------------------------------------------------------------- Mirror Lake
  {
    const L = regionById.lake.dir;
    for (let i = 0; i < 14; i++) {
      const a = rand() * 6.28, r = 2 + rand() * 7;
      const d = offsetDir(L, Math.cos(a) * r, Math.sin(a) * r);
      if (sample(d) > -0.5) continue;
      const yaw = rand() * 6, sc = 4 + rand() * 2;
      const m = surfaceMatrix(d, { yaw, scale: sc, height: 0.05 });
      scatter.add(P(i % 3 ? 'lily_large' : 'lily_small'), m, { shadow: false });
      // every pad can be climbed onto from the water and hopped across
      colliders.add({ pos: d.clone().multiplyScalar(R - 3), r: (i % 3 ? 0.14 : 0.1) * sc, top: 3.1 });
    }
    // dock on the lake
    buildPier(L, -1, 0.2, 7);
    prop('canoe', at('lake', 13, -3), { scale: 4, yaw: 1, collide: 'mesh' });
    addBench(at('lake', 14, 6), 2.2);
    prop('town/watermill', at('lake', -16, 4), { scale: 3, collide: 'mesh', yaw: 1.4 });
  }

  // ---------------------------------------------------------------- Windmill Farm
  {
    const F = regionById.farm.dir;
    // procedural windmill tower + Kenney rotor
    const wd = at('farm', -6, 8);
    const base = R + sample(wd);
    const g = new THREE.Group();
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.6, 9, 8), toonMaterial({ color: 0xf2e6cf }));
    tower.position.y = 4.5; tower.castShadow = tower.receiveShadow = true;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(2.2, 2.4, 8), toonMaterial({ color: 0xc0564e }));
    cap.position.y = 10.2; cap.castShadow = true;
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.9, 0.4), toonMaterial({ color: 0x6b4a3a }));
    door.position.set(0, 0.95, 2.35);
    const rotor = makeObject('town/windmill');
    rotor.scale.setScalar(2.6);
    const pivot = new THREE.Group(); pivot.position.set(0, 8.4, 2.0); pivot.rotation.y = Math.PI / 2; pivot.add(rotor);
    g.add(tower, cap, door, pivot);
    g.position.copy(wd).multiplyScalar(base - 0.3);
    g.quaternion.copy(surfaceQuat(wd, 0.4));
    scene.add(g);
    const wb = wd.clone().multiplyScalar(base - 0.3);
    colliders.add({ pos: wb, r: 2.6, rt: 1.6, top: 9 }); // tapering tower
    colliders.add({ pos: wb, r: 2.2, rt: 0.05, y0: 9, top: 11.4, standR: 0.45 }); // pointy cap (Stardrop on top)
    game.updaters.push((dt) => { rotor.rotation.x += dt * 0.7 * globalUniforms.uWind.value; });
    // barn & farmhouse
    prop('houses/building-type-m', at('farm', 9, 7), { scale: 6.5, yaw: -2.2, collide: 'mesh' });
    prop('houses/building-type-h', at('farm', 11, -6), { scale: 6.5, yaw: -1.2, collide: 'mesh' });
    // crops in rows
    const crops = ['crops_cornStageD', 'crops_wheatStageB', 'crop_pumpkin', 'crops_leafsStageB', 'crop_melon', 'crops_cornStageC'];
    for (let row = 0; row < 6; row++) {
      for (let k = 0; k < 9; k++) {
        const d = at('farm', -12 + k * 1.6, -6 - row * 1.8);
        prop(crops[row], d, { scale: 4.5, yaw: rand() * 0.4, shadow: row % 2 === 0 });
      }
    }
    // fences around paddock
    for (let k = 0; k < 18; k++) {
      const a = (k / 18) * Math.PI * 2;
      const d = offsetDir(F, 2 + Math.cos(a) * 9, -16 + Math.sin(a) * 6);
      prop('fence_simple', d, { scale: 4, yaw: -a, collide: 'mesh' });
    }
    prop('town/cart-high', at('farm', 3, -2), { scale: 2.4, yaw: 2.4, collide: 'mesh' });
    prop('survival/bucket', at('farm', 4, -3.5), { scale: 2.6 });
    for (let i = 0; i < 3; i++) prop('log_stack', at('farm', 14 + i * 0.1, 1 + i * 2.2), { scale: 4, yaw: 1.6, collide: 'mesh' });
    addSign(at('farm', 0, 12), 'Windmill Farm  ·  Please close the gate (there is no gate)');
  }

  // ---------------------------------------------------------------- Bloom Meadow & balloon
  {
    const M = regionById.meadow.dir;
    addBench(at('meadow', -2, -8), 0.4);
    // beehives (barrels)
    for (let i = 0; i < 3; i++) prop('survival/barrel', at('meadow', -10 + i * 1.6, 2), { scale: 2.6, collide: 'mesh' });
    buildBalloon(at('meadow', 12, 1));
    addSign(at('meadow', 5, 6), 'Bloom Meadow  ·  Hot air balloon: round-the-world tours, departing whenever you like');
  }

  function buildBalloon(dir) {
    const g = new THREE.Group();
    const cols = [0xf28b82, 0xfff1a8, 0x8fd3e8, 0xf6b26b];
    const envGeo = new THREE.SphereGeometry(4.2, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.82);
    const segs = 8;
    for (let i = 0; i < segs; i++) {
      const piece = new THREE.Mesh(new THREE.SphereGeometry(4.2, 4, 12, (i / segs) * Math.PI * 2, Math.PI * 2 / segs, 0, Math.PI * 0.85), toonMaterial({ color: cols[i % cols.length] }));
      piece.castShadow = true;
      g.add(piece);
    }
    g.children.forEach((c) => { c.position.y = 9; c.scale.y = 1.15; });
    const basket = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.0, 1.1, 10), toonMaterial({ color: 0xb07a4a }));
    basket.position.y = 0.55; basket.castShadow = true;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.1, 6, 16), toonMaterial({ color: 0x7a5233 }));
    rim.rotation.x = Math.PI / 2; rim.position.y = 1.1;
    g.add(basket, rim);
    const ropeMat = toonMaterial({ color: 0x6b5a4a });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.78;
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 4.4), ropeMat);
      rope.position.set(Math.cos(a) * 1.4, 3.1, Math.sin(a) * 1.4);
      rope.rotation.z = Math.cos(a) * -0.18; rope.rotation.x = Math.sin(a) * 0.18;
      g.add(rope);
    }
    const flame = fx.addGlow(new THREE.Vector3(), 0xffa040, 1.6);
    flame.userData.always = true;
    scene.add(g);
    const home = dir.clone();
    const baseR = R + sample(home);
    const st = { flying: false, t: 0, obj: g };
    const axis = new THREE.Vector3().crossVectors(home, new THREE.Vector3(0.3, 1, 0.2).normalize()).normalize();
    const homeCol = colliders.add({ pos: home.clone().multiplyScalar(baseR), r: 1.0, rt: 1.2, top: 1.1 });
    const it = addInteract({ get pos() { return g.position; }, radius: 3.0, label: 'Board balloon', icon: '🎈', action: () => {
      const p = game.player;
      st.flying = true; st.t = 0; p.mode = 'ride';
      p.anim.play('idle', 0.2);
      it.enabled = false;
      homeCol.removed = true;
      ui.toast(IS_TOUCH ? 'Up, up and away! (tap Jump out to leap)' : 'Up, up and away! (SPACE to jump out)');
      audio.discover();
    } });
    world.balloon = st;
    game.updaters.push((dt, gm) => {
      const p = gm.player;
      let d = home.clone(), alt = 0;
      if (st.flying) {
        st.t += dt;
        const T = 75; // seconds per loop
        const k = st.t / T;
        const ang = k * Math.PI * 2;
        alt = Math.min(1, st.t / 8, (T - st.t) / 8) * 48;
        d = home.clone().applyAxisAngle(axis, ang);
        if (st.t >= T) { st.flying = false; it.enabled = true; homeCol.removed = false; if (p.mode === 'ride' && !world.boat.riding) { p.mode = 'walk'; } }
      }
      const r = baseR + Math.max(alt, 0) + Math.sin(gm.time * 1.2) * 0.15 * (alt > 1 ? 4 : 0);
      g.position.copy(d).multiplyScalar(Math.max(r, R + Math.max(sample(d), 0)));
      const f = axis.clone().cross(d).normalize();
      orient(g, d, f);
      flame.position.copy(g.position).addScaledVector(d, 4.6);
      flame.scale.setScalar(st.flying ? 1.6 + Math.random() * 0.5 : 0.8);
      if (st.flying && p.mode === 'ride' && !world.boat.riding) {
        p.pos.copy(g.position).addScaledVector(d, 0.25);
        p.facing.copy(f); p.speed = 0;
        p.sync();
        p.anim.update(dt);
        if (gm.input.hit('Space')) {
          p.mode = 'walk'; p.vUp = 6; p.onGround = false;
          p.vel.copy(f).multiplyScalar(6);
          p.speed = 6;
          gm.input.pressed.delete('Space');
          ui.toast(p.hasGlider ? '{Hold SPACE} to open your parasol!' : 'Wheee! (You might want a parasol next time...)');
        }
      }
    });
  }

  // ---------------------------------------------------------------- Whisperwood camp
  {
    const cd = at('forest', -7, -8);
    prop('campfire_stones', cd, { scale: 4, collide: 'mesh' });
    prop('campfire_logs', cd, { scale: 4, collide: false });
    prop('tent_detailedOpen', at('forest', -12, -3), { scale: 5, yaw: 2.4, collide: 'mesh' });
    prop('tent_smallClosed', at('forest', -3, -13), { scale: 5, yaw: -0.3, collide: 'mesh' });
    const fire = fx.addGlow(surfPos(cd, 0.8), 0xff8a3a, 3.5);
    fire.userData.always = true;
    game.updaters.push((dt, gm) => {
      fire.scale.setScalar(3 + Math.sin(gm.time * 13) * 0.3 + Math.random() * 0.4);
      if (Math.random() < dt * 6 && fire.position.distanceToSquared(gm.player.pos) < 900) {
        fx.sprite('spark', fire.position.clone(), { vel: cd.clone().multiplyScalar(2).add(new THREE.Vector3().randomDirection().multiplyScalar(0.4)), life: 1, size: 0.25, additive: true, color: 0xffa040 });
      }
    });
    addSign(at('forest', 6, -14), 'Whisperwood  ·  Please whisper');
  }

  // ---------------------------------------------------------------- Glowcap Grove: giant bouncy mushrooms
  {
    const G = regionById.grove.dir;
    const caps = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.3, r = 7 + (i % 3) * 4;
      const d = offsetDir(G, Math.cos(a) * r, Math.sin(a) * r);
      const s = 22 + (i % 3) * 8;
      const path = i % 2 ? 'mushroom_red' : 'mushroom_tan';
      const o = makeObject('nature/' + path);
      o.scale.setScalar(s);
      o.position.copy(surfPos(d, -0.1));
      const yaw = rand() * 6;
      o.quaternion.copy(surfaceQuat(d, yaw));
      scene.add(o);
      const capTop = getModel('nature/' + path).box.max.y * s - 0.1;
      // collider straight from the mesh: walk under the cap, bounce off wherever you land on it
      const col = colliders.add(modelCollider('nature/' + path, surfPos(d, -0.1), d, {
        yaw, scale: s,
        onLand: (p) => {
          p.vUp = 15 + s * 0.12; p.onGround = false; p.mode = 'walk';
          audio.bounce();
          bounce.t = 0.35; bounce.o = o; bounce.s = s;
        },
      }));
      const glow = fx.addGlow(surfPos(d, capTop + 0.5), i % 2 ? 0xff7fbf : 0x9fd8ff, s * 0.35);
      caps.push(col);
    }
    const bounce = { t: 0, o: null, s: 1 };
    game.updaters.push((dt) => {
      if (bounce.t > 0) {
        bounce.t -= dt;
        const k = Math.sin((1 - bounce.t / 0.35) * Math.PI) * 0.18;
        bounce.o.scale.set(bounce.s * (1 + k), bounce.s * (1 - k), bounce.s * (1 + k));
        if (bounce.t <= 0) bounce.o.scale.setScalar(bounce.s);
      }
    });
  }

  // ---------------------------------------------------------------- Mount Hush temple & bells
  {
    const top = regionById.mountain.dir;
    const base = R + sample(top);
    // flatten-ish platform
    // low enough to just walk up onto (STEP)
    const plat = new THREE.Mesh(new THREE.CylinderGeometry(7, 7.6, 1.2, 20), toonMaterial({ color: 0xd8d0c4 }));
    plat.position.copy(top).multiplyScalar(base - 0.15);
    plat.quaternion.copy(surfaceQuat(top));
    plat.castShadow = plat.receiveShadow = true;
    scene.add(plat);
    colliders.add({ pos: top.clone().multiplyScalar(base - 2), r: 7.6, rt: 7.0, top: 2.45 });
    const deckH = 0.45;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const d = offsetDir(top, Math.cos(a) * 6, Math.sin(a) * 6);
      prop(i % 3 === 2 ? 'statue_columnDamaged' : 'statue_column', d, { scale: 4.5, height: base - R + deckH, collide: 'mesh' });
    }
    // bells
    const bellMat = toonMaterial({ color: 0xe8b84a });
    const notes = [523.25, 659.25, 783.99, 1046.5];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const d = offsetDir(top, Math.cos(a) * 3.2, Math.sin(a) * 3.2);
      const g = new THREE.Group();
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3.2, 0.25), toonMaterial({ color: 0x7a4b3a }));
      post.position.y = 1.6;
      const beam = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.25, 0.25), toonMaterial({ color: 0x7a4b3a }));
      beam.position.set(0.7, 3.1, 0);
      const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.55, 0.8, 12, 1, true), bellMat);
      bell.material.side = THREE.DoubleSide;
      const pivot = new THREE.Group(); pivot.position.set(1.3, 3.0, 0); bell.position.y = -0.45; pivot.add(bell);
      g.add(post, beam, pivot);
      g.position.copy(d).multiplyScalar(base + deckH);
      g.quaternion.copy(surfaceQuat(d, a));
      g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      scene.add(g);
      colliders.add({ pos: d.clone().multiplyScalar(base + deckH), r: 0.2, top: 3.25 }); // post
      const st = { swing: 0 };
      addInteract({ pos: d.clone().multiplyScalar(base + deckH + 1), radius: 2.6, label: 'Ring bell', icon: '🔔', action: () => {
        audio.chime(notes[i]); st.swing = 1;
        fx.sparkle(g.localToWorld(new THREE.Vector3(1.3, 2.6, 0)), 8, 0xffe08a);
      } });
      game.updaters.push((dt, gm) => {
        st.swing *= 1 - dt * 1.2;
        pivot.rotation.z = Math.sin(gm.time * 8) * 0.35 * st.swing;
      });
    }
    prop('statue_obelisk', top, { scale: 5, height: base - R + deckH, collide: 'mesh' });
    fx.addGlow(top.clone().multiplyScalar(base + 6), 0xbfe8ff, 5);
    addSign(at('mountain', -6, -24), 'Mount Hush  ·  The temple is at the top  ·  Jump the ledges if you get stuck');
  }

  // ---------------------------------------------------------------- Old Ruins & singing stones
  {
    const O = regionById.ruins.dir;
    prop('statue_head', at('ruins', 0, 14), { scale: 9, yaw: Math.PI, collide: 'mesh' });
    prop('statue_ring', at('ruins', -14, -4), { scale: 7, yaw: 1, collide: 'mesh' });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const d = offsetDir(O, Math.cos(a) * 11, Math.sin(a) * 11);
      prop(i % 3 ? 'statue_columnDamaged' : 'statue_column', d, { scale: 4.5 + (i % 3), yaw: a, collide: 'mesh' });
    }
    // seven singing stones in a winding line
    const scale = [261.63, 293.66, 329.63, 349.23, 392.0, 440.0, 493.88];
    const order = [3, 0, 5, 2, 6, 1, 4]; // physical placement is shuffled
    const stoneMat = [0xd9c7a3, 0xe8b4a0, 0xf3d28b, 0xb9d99a, 0x9fd0e0, 0xb7a6e0, 0xe7a6c8];
    let seq = [];
    const solved = () => save.has('stars', 'ruins-song');
    order.forEach((note, i) => {
      const a = (i / 7) * Math.PI * 2;
      const d = offsetDir(O, Math.cos(a) * 5.5, Math.sin(a) * 5.5);
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.15, 0.4, 10), toonMaterial({ color: stoneMat[note] }));
      disc.position.copy(surfPos(d, 0.1)); disc.quaternion.copy(surfaceQuat(d));
      disc.castShadow = disc.receiveShadow = true;
      scene.add(disc);
      colliders.add({
        pos: surfPos(d), r: 1.0, top: 0.3,
        onLand: () => {
          audio.note(scale[note]);
          disc.position.copy(surfPos(d, -0.05));
          setTimeout(() => disc.position.copy(surfPos(d, 0.1)), 200);
          fx.sparkle(surfPos(d, 0.8), 6, stoneMat[note]);
          seq.push(note);
          if (seq.length > 7) seq.shift();
          if (seq.join() === '0,1,2,3,4,5,6' && !solved()) {
            ui.toast('The stones sing together! A Stardrop appears!', 'star');
            audio.discover();
            world.spawnStar('ruins-song', offsetDir(O, 0, 0), 2.5);
          }
        },
      });
    });
    addSign(at('ruins', 6, -12), 'Old Ruins  ·  "Low to high, the stones will sing"');
  }

  // ---------------------------------------------------------------- Starfall Crater
  {
    const C = regionById.crater.dir;
    const meteor = new THREE.Mesh(new THREE.IcosahedronGeometry(2.4, 0), toonMaterial({ color: 0x7b6fb8, emissive: 0x5d4fd0, emissiveIntensity: 0.4 }));
    meteor.position.copy(surfPos(C, 1.2)); meteor.quaternion.copy(surfaceQuat(C)); meteor.castShadow = true;
    scene.add(meteor);
    colliders.add({ shape: 'sphere', pos: surfPos(C), r: 2.4, cy: 1.2 });
    const glow = fx.addGlow(surfPos(C, 2), 0xa48cff, 8); glow.userData.always = true;
    addInteract({ pos: meteor.position, radius: 4, label: 'Touch the stone', icon: '✋', action: () => {
      audio.chime(392); audio.chime(587.33);
      fx.sparkle(surfPos(C, 3.5), 30, 0xb59cff);
      for (let i = 0; i < 6; i++) setTimeout(() => fx.shootingStar(game), i * 150);
      ui.toast('It hums. It\'s warm. For a second you remember the stars.');
    } });
    game.updaters.push((dt, gm) => {
      meteor.rotateY(dt * 0.2);
      meteor.material.emissiveIntensity = 0.3 + Math.sin(gm.time * 2) * 0.15 + gm.sky.night * 0.5;
    });
    // telescope
    const td = at('crater', 8, 20);
    const tg = new THREE.Group();
    const legM = toonMaterial({ color: 0x5b4a3e });
    for (let i = 0; i < 3; i++) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.8), legM); const a = i * 2.09; l.position.set(Math.cos(a) * 0.35, 0.85, Math.sin(a) * 0.35); l.rotation.set(Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3); tg.add(l); }
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 2.2, 10), toonMaterial({ color: 0x3f6fb5 }));
    tube.position.y = 2.0; tube.rotation.x = -0.9; tg.add(tube);
    tg.position.copy(surfPos(td)); tg.quaternion.copy(surfaceQuat(td, 2)); tg.traverse((o) => { o.castShadow = true; });
    scene.add(tg);
    colliders.add({ pos: surfPos(td), r: 0.45, top: 2.6 });
    addInteract({ pos: surfPos(td, 1.5), radius: 2.5, label: 'Look', icon: '🔭', action: () => {
      if (game.sky.night > 0.5) ui.dialogue('Telescope', ['So many stars! One of them winks at you. Rude.', 'You spot a tiny planet far away. Someone there is looking back.'], 0, null);
      else ui.dialogue('Telescope', ['You see... the sky. Very blue. Try again at night.'], 0, null);
    } });
  }

  // ---------------------------------------------------------------- Frostcap igloo & Desert camp & Oasis & Isle
  {
    const fd = at('frost', -6, 6);
    const ig = new THREE.Mesh(new THREE.SphereGeometry(3.2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), toonMaterial({ color: 0xf4f8fc }));
    ig.position.copy(surfPos(fd, -0.2)); ig.quaternion.copy(surfaceQuat(fd)); ig.castShadow = ig.receiveShadow = true;
    const tunnel = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 2.4, 10, 1, false, 0, Math.PI), toonMaterial({ color: 0xe8f0f8 }));
    tunnel.rotation.z = Math.PI / 2; tunnel.rotation.y = Math.PI / 2; tunnel.position.set(0, 0, 3.2);
    ig.add(tunnel);
    scene.add(ig);
    // a dome you can scramble up (there's a Stardrop on top), plus the entrance tunnel
    colliders.add({ shape: 'sphere', pos: surfPos(fd), r: 3.2, cy: -0.2, step: 1.0 });
    const iq = surfaceQuat(fd);
    colliders.add({
      pos: surfPos(fd), up: fd.clone(), ax: new THREE.Vector3(1, 0, 0).applyQuaternion(iq), az: new THREE.Vector3(0, 0, 1).applyQuaternion(iq),
      hx: 1.1, hz: 1.2, cz: 3.2, top: 0.85, step: 1.0,
    });
    prop('survival/fish-large', at('frost', 3, -1), { scale: 3 });
    prop('survival/bucket', at('frost', 3.6, -2), { scale: 2.6 });
    addSign(at('frost', 0, 8), 'Frostcap  ·  Population: 1 human, many penguins');

    prop('survival/tent-canvas', at('desert', -8, 2), { scale: 2.8, yaw: 0.5, collide: 'mesh' });
    prop('survival/campfire-pit', at('desert', -5, 0), { scale: 2.8, collide: 'mesh' });
    addSign(at('desert', 0, 12), 'Sunscorch Dunes  ·  Hydrate!');

    // Oasis palms ring
    const OA = regionById.oasis.dir;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const d = offsetDir(OA, Math.cos(a) * 8, Math.sin(a) * 8);
      if (sample(d) > 0.3) prop(i % 2 ? 'tree_palmTall' : 'tree_palmDetailedTall', d, { scale: 5, yaw: a });
    }
    // Turtle Isle treasure
    const cd = at('isle', -3, 3);
    const chestObj = makeObject('survival/chest');
    chestObj.scale.setScalar(3.4);
    chestObj.position.copy(surfPos(cd)); chestObj.quaternion.copy(surfaceQuat(cd, 0.7));
    scene.add(chestObj);
    colliders.add(modelCollider('survival/chest', surfPos(cd), cd, { yaw: 0.7, scale: 3.4 }));
    addInteract({ pos: surfPos(cd, 0.4), radius: 2.5, label: 'Open chest', icon: '🗝️', action: () => {
      if (save.has('stars', 'isle-chest') || world.stars.find((s) => s.id === 'isle-chest')) { ui.toast('Empty. Except for a little sand. And a crab. Hi crab.'); return; }
      audio.discover();
      ui.toast('Treasure! A Stardrop!', 'star');
      world.spawnStar('isle-chest', cd, 2);
    } });
  }

  // ---------------------------------------------------------------- landmarks: signposts between places
  // ---------------------------------------------------------------- random scatter per biome
  {
    const d = new THREE.Vector3(), n = new THREE.Vector3();
    const keep = REGIONS.filter((r) => ['village', 'harbor', 'farm'].includes(r.id));
    for (let i = 0; i < 26000; i++) {
      d.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
      const l = d.length(); if (l > 1 || l < 0.1) continue;
      d.divideScalar(l);
      const h = sample(d);
      if (h < 0.8) continue;
      const reg = regionAt(d);
      if (!reg) continue;
      // clear spaces in towns and around special spots
      let blocked = false;
      for (const k of keep) if (angle(d, k.dir) < (k.flat ? k.flat.r * 1.25 : 0.1)) blocked = true;
      if (reg.id === 'mountain' && angle(d, reg.dir) < 0.1) blocked = true;
      if (reg.id === 'grove' && angle(d, reg.dir) < 0.2 && rand() < 0.6) blocked = true;
      if (reg.id === 'ruins' && angle(d, reg.dir) < 0.17) blocked = true;
      if (reg.id === 'crater' && angle(d, reg.dir) < 0.08) blocked = true;
      if (blocked) continue;
      let list = BIOME_SCATTER[reg.biome];
      if (h < 1.6 && reg.biome !== 'desert' && reg.biome !== 'snow') list = BIOME_SCATTER.beach;
      if (!list) continue;
      normalAt(d, n);
      const flat = n.dot(d);
      if (flat < 0.8) continue;
      const total = list.reduce((s, x) => s + x[1], 0);
      if (rand() > total / 22) continue;
      let pick = rand() * total;
      let choice = list[0];
      for (const c of list) { pick -= c[1]; if (pick <= 0) { choice = c; break; } }
      const [name, , sc] = choice;
      const scale = sc * (0.8 + rand() * 0.45);
      const small = /flower|grass|bush|mushroom_(red|tan)$|Group|lily|rock_small|stone_small/.test(name);
      prop(name, d, { yaw: rand() * 6.283, scale, lift: -0.05, shadow: !small || /bushLarge|bushDetailed/.test(name) });
    }
  }

  // ---------------------------------------------------------------- Stardrops (collectibles)
  world.stars = [];
  const starGeo = (() => {
    const s = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 0.22 : 0.5, a = (i / 10) * Math.PI * 2 + Math.PI / 2;
      if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r); else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.18, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 1 });
    g.center();
    return g;
  })();
  const starMat = toonMaterial({ color: 0xffe066, emissive: 0xffb300, emissiveIntensity: 0.35 });
  world.spawnStar = (id, dir, lift = 1.3, height) => {
    if (save.has('stars', id)) return;
    const m = new THREE.Mesh(starGeo, starMat);
    const h = height !== undefined ? height : Math.max(sample(dir), 0);
    const pos = dir.clone().multiplyScalar(R + h + lift);
    m.position.copy(pos);
    m.castShadow = true;
    scene.add(m);
    const glow = fx.addGlow(pos, 0xffe27a, 2.2); glow.userData.always = true;
    world.stars.push({ id, m, pos, glow, dir: dir.clone() });
  };
  {
    const fixed = [
      ['peak', regionById.mountain.dir, 8], ['lighthouse-top', at('lighthouse', 4, 0), 17.6],
      ['fountain', regionById.village.dir, 4.2], ['grove-cap', at('grove', 7, 0), 9], ['crater', regionById.crater.dir, 4.5],
      ['isle-palm', at('isle', 4, -2), 1.3], ['lake-pad', at('lake', 0, 0), 1.0, 0], ['oasis', regionById.oasis.dir, 1.0, 0],
      ['windmill', at('farm', -6, 8), 12], ['igloo', at('frost', -6, 6), 4], ['ruins-head', at('ruins', 0, 14), 10],
      ['reef', regionById.reef.dir, 1.5, 0], ['far-sea', offsetDir(regionById.isle.dir, -40, 50), 1.5, 0], ['pier-end', pier ? pier.end : H, 3.2, 0],
      ['camp', at('forest', -7, -8), 1.5], ['desert-tent', at('desert', -8, 2), 4.5], ['meadow-hill', at('meadow', -20, -16), 1.3],
      ['south-pole', new THREE.Vector3(0, -1, 0), 1.3], ['north-pole', new THREE.Vector3(0, 1, 0), 1.3],
    ];
    for (const [id, d, lift, height] of fixed) world.spawnStar(id, d, lift, height);
    // scattered across the land
    let n = 0;
    const r2 = mulberry32(77);
    while (n < 40) {
      const d = new THREE.Vector3(r2() * 2 - 1, r2() * 2 - 1, r2() * 2 - 1).normalize();
      if (sample(d) < 1 || !regionAt(d)) continue;
      world.spawnStar('s' + n, d, 1.3);
      n++;
    }
    world.totalStars = fixed.length + 40 + 2; // +ruins song +chest
  }
  game.updaters.push((dt, gm) => {
    const pp = gm.player.pos;
    for (let i = world.stars.length - 1; i >= 0; i--) {
      const s = world.stars[i];
      const far = s.pos.distanceToSquared(pp) > 140 * 140;
      s.m.visible = !far;
      if (far) continue;
      const up = s.pos.clone().normalize();
      s.m.position.copy(s.pos).addScaledVector(up, Math.sin(gm.time * 2 + i) * 0.2);
      s.m.quaternion.copy(surfaceQuat(up, gm.time * 2 + i));
      s.glow.position.copy(s.m.position);
      if (s.m.position.distanceToSquared(pp.clone().addScaledVector(gm.player.up, 0.9)) < 1.8 * 1.8) {
        scene.remove(s.m); s.glow.visible = false; s.glow.userData.always = false; s.glow.scale.setScalar(0);
        world.stars.splice(i, 1);
        save.add('stars', s.id);
        audio.pickup(save.data.stars.length);
        fx.burst(s.m.position, 10);
        fx.sparkle(s.m.position, 12);
        ui.starCount(save.data.stars.length, world.totalStars);
      }
    }
  });

  // ---------------------------------------------------------------- kickable balls
  {
    const balls = [];
    const ballSpots = [[at('village', -4, -4), 0xf26b6b], [at('harbor', 6, -10), 0x6bb7f2], [at('isle', 0, 4), 0xffd166], [at('meadow', 2, -2), 0xa0e07a], [at('lighthouse', -6, -6), 0xf6a6d9]];
    for (const [d, color] of ballSpots) {
      const g = new THREE.Group();
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 2), toonMaterial({ color }));
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.555, 0.07, 6, 20), toonMaterial({ color: 0xffffff }));
      m.castShadow = true; g.add(m, band);
      scene.add(g);
      const b = { g, pos: surfPos(d, 0.55), vel: new THREE.Vector3(), vUp: 0, home: d.clone() };
      balls.push(b);
    }
    const _q = new THREE.Quaternion();
    game.updaters.push((dt, gm) => {
      const p = gm.player;
      for (const b of balls) {
        const up = b.pos.clone().normalize();
        if (b.pos.distanceToSquared(p.pos) > 120 * 120) continue;
        // kick
        const toB = b.pos.clone().sub(p.pos.clone().addScaledVector(p.up, 0.5));
        if (toB.length() < 1.1) {
          const push = tangent(toB.clone(), up);
          b.vel.copy(push).multiplyScalar(Math.max(4, p.speed * 1.6));
          b.vUp = 2 + p.speed * 0.5;
          audio.kick();
        }
        tangent(b.vel.lengthSq() > 1e-8 ? b.vel : b.vel.set(0, 0, 0), up);
        const sp = b.vel.length();
        b.pos.addScaledVector(b.vel, dt);
        b.vUp -= 20 * dt;
        const prevR = b.pos.length() - 0.55;
        let r = b.pos.length() + b.vUp * dt;
        const nd = b.pos.clone().normalize();
        const gh = sample(nd);
        // bounce off props (the ball's "feet" are its bottom) and roll along their tops
        const feet = nd.clone().multiplyScalar(r - 0.55);
        const res = resolve(gm.colliders, feet, 0.55, { height: 1.1, step: 0.3, prevR });
        if (res.push.lengthSq() > 1e-8) {
          const nrm = res.push.clone().normalize();
          const vn = b.vel.dot(nrm);
          if (vn < 0) b.vel.addScaledVector(nrm, -2 * vn).multiplyScalar(0.7);
        }
        nd.copy(feet).normalize();
        r = feet.length() + 0.55;
        const floor = Math.max(R + Math.max(gh, -0.5), res.floor) + 0.55;
        if (r < floor) { r = floor; if (b.vUp < -2) b.vUp = -b.vUp * 0.55; else b.vUp = 0; }
        b.pos.copy(nd).multiplyScalar(r);
        if (gh < 0) b.vUp += 10 * dt; // floats
        b.vel.multiplyScalar(1 - dt * (r <= floor + 0.05 ? 1.2 : 0.2));
        b.g.position.copy(b.pos);
        if (sp > 0.01) {
          const axis = new THREE.Vector3().crossVectors(up, b.vel).normalize();
          _q.setFromAxisAngle(axis, (sp * dt) / 0.55);
          b.g.quaternion.premultiply(_q);
        }
        // respawn if lost at sea for long
        if (gh < -6 && b.pos.distanceTo(p.pos) > 60) { b.pos.copy(surfPos(b.home, 0.6)); b.vel.set(0, 0, 0); }
      }
    });
  }

  // ---------------------------------------------------------------- jumping fish at the reef & sea
  {
    const fishObjs = [];
    for (let i = 0; i < 10; i++) {
      const o = makeObject(i % 3 ? 'survival/fish' : 'survival/fish-large', { shadow: false });
      o.scale.setScalar(2.4);
      scene.add(o);
      const base = i < 6 ? regionById.reef.dir : regionById.harbor.dir;
      fishObjs.push({ o, base, t: rand() * 8, d: new THREE.Vector3(), f: new THREE.Vector3() });
    }
    game.updaters.push((dt, gm) => {
      for (const f of fishObjs) {
        f.t -= dt;
        if (f.t <= -1.2) {
          f.t = 2 + rand() * 5;
          for (let k = 0; k < 10; k++) {
            const d = offsetDir(f.base, (rand() - 0.5) * 50 + (f.base === regionById.harbor.dir ? 40 : 0), (rand() - 0.5) * 50);
            if (sample(d) < -2) { f.d.copy(d); break; }
          }
          tangentBasis(f.d, f.f, new THREE.Vector3());
          f.f.applyAxisAngle(f.d, rand() * 6.28);
        }
        if (f.t < 0) {
          const k = -f.t / 1.2; // 0..1 jump arc
          const pos = f.d.clone().addScaledVector(f.f, (k - 0.5) * 3 / R).normalize();
          f.o.visible = true;
          f.o.position.copy(pos).multiplyScalar(R - 0.5 + Math.sin(k * Math.PI) * 2.2);
          orient(f.o, pos, f.f);
          f.o.rotateX(-(k - 0.5) * 2.2);
          if (k < 0.05 || (k > 0.93 && k < 0.98)) { if (f.o.position.distanceToSquared(gm.player.pos) < 400) audio.splash(); }
        } else f.o.visible = false;
      }
    });
  }

  // ---------------------------------------------------------------- people & critters
  const people = await buildPeople(game, fx);
  world.people = people;
  game.updaters.push((dt) => people.update(dt));

  // birds circle the harbor, village, lighthouse, isle
  fx.setBirdCenters([regionById.harbor.dir, regionById.village.dir, regionById.lighthouse.dir, regionById.isle.dir, regionById.lake.dir]);
  game.updaters.push((dt, gm) => fx.update(dt, gm));

  // ---------------------------------------------------------------- region tracking & discovery
  world.discovered = new Set(save.data.places);
  let regionTimer = 0;
  game.updaters.push((dt, gm) => {
    regionTimer -= dt;
    if (regionTimer > 0) return;
    regionTimer = 0.4;
    const d = gm.player.pos.clone().normalize();
    const reg = regionAt(d);
    world.biomeHere = reg ? reg.biome : 'ocean';
    // reef is a marker region at sea
    let here = reg;
    if (angle(d, regionById.reef.dir) < 0.15) here = regionById.reef;
    if (here !== world.regionHere) {
      world.regionHere = here;
      if (here) {
        const isNew = save.add('places', here.id);
        ui.placeTitle(here.name, here.sub, isNew);
        if (isNew) audio.discover();
      }
    }
  });

  // shore proximity for wave sound
  game.updaters.push((dt, gm) => {
    const d = gm.player.pos.clone().normalize();
    const h = sample(d);
    const shore = 1 - THREE.MathUtils.smoothstep(Math.abs(h), 0, 6);
    audio.update(dt, { shore, rain: gm.sky.rainAmt, altitude: Math.max(0, h - 5), night: gm.sky.night > 0.5 ? 1 : 0, time: gm.time });
  });

  // ---------------------------------------------------------------- build instanced scenery
  scene.add(scatter.build());

  // fast travel to a discovered place (finds dry land near its centre)
  world.travelTo = (id) => {
    const reg = regionById[id];
    let target = reg.dir.clone();
    outer: for (let r = 0; r < 40; r += 2) {
      for (let a = 0; a < 12; a++) {
        const d = offsetDir(reg.dir, Math.cos(a / 12 * 6.283) * r, Math.sin(a / 12 * 6.283) * r);
        if (sample(d) <= 0.8) continue;
        const pos = surfPos(d);
        const test = pos.clone();
        const res = resolve(colliders, test, 1.0);
        const blocked = test.distanceToSquared(pos) > 1e-4 || res.floor > pos.length() + 0.6;
        if (!blocked) { target = d; break outer; }
      }
    }
    const veil = document.createElement('div');
    veil.className = 'fadeblack';
    document.getElementById('ui').appendChild(veil);
    requestAnimationFrame(() => veil.classList.add('on'));
    setTimeout(() => {
      const p = game.player;
      if (world.boat.riding) { world.boat.riding = false; world.boat.interact.enabled = true; world.boat.landing = null; }
      p.mode = 'walk';
      p.place(target, p.facing);
      game.follow.snap(p);
      veil.classList.remove('on');
      setTimeout(() => veil.remove(), 400);
    }, 380);
  };

  world.spawn = {
    dir: offsetDir(V, 0, -9),
    facing: (() => { const t = new THREE.Vector3(), t2 = new THREE.Vector3(); tangentBasis(offsetDir(V, 0, -9), t, t2); return t2; })(),
  };
  return world;
}
