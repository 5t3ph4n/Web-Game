# Wanderer

*It's a big little planet. Go see all of it.*

A cosy 3D exploration game for the browser, inspired by the mechanics and hand-drawn, cel-shaded look of
[Messenger](https://messenger.abeto.co) — but instead of delivering packages, you just wander a much larger,
living planet: talk to the locals, befriend animals, ride a hot-air balloon around the world, row out to a
lonely island, bounce on giant mushrooms and collect Stardrops.

## Play

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static build in dist/
```

The build is fully static, so `dist/` can be hosted anywhere. A GitHub Pages workflow is included
(`.github/workflows/deploy.yml`): enable **Settings → Pages → Source: GitHub Actions** and push.

## Controls

| Input | Action |
| --- | --- |
| WASD / Arrow keys | Walk |
| Shift | Run (animals get spooked!) |
| Space | Jump · hold while falling to glide with your parasol · swim up |
| C / Ctrl | Dive under water (watch the AIR meter) |
| E / click | Talk, pet, sit, read, ride, ring bells, pick things up… |
| F | Pick up / throw balls, crates, barrels, fruit and snowballs |
| K | Character creator |
| L | Torch on/off in dark places |
| Mouse drag · scroll | Orbit camera · zoom |
| J / Tab | Journal (places, friends, critters, fast travel) |
| P | Photo mode (hides the UI) |
| M | Mute · H: help |

On phones and tablets:

| Touch | Action |
| --- | --- |
| Left side of the screen | Floating joystick: touch anywhere and drag to walk, push all the way to run |
| JUMP | Jump · hold while falling to glide · swim up |
| DIVE | Appears while swimming: hold to dive |
| Pop-up button (above JUMP) | Appears when something's nearby: Talk, Pet, Sit, Read, Row, Board, Ring… and Stand up / Hop out / Jump out while sitting, rowing or flying. The floating label over the target can be tapped too |
| Drag (right side) · Pinch | Orbit camera · zoom |
| 📖 👕 📷 🔊 ⚙ ? | Journal, character creator, photo mode (tap **✕ Done** to leave), sound, settings, help |

Starting the game on a phone goes fullscreen where the browser allows it. Add `?touch=1` (or `?touch=0`) to the
URL to force the touch controls on or off.

## Character creator

Open it from the title screen, the 👕 button or **K**. Pick one of 12 base styles, then set skin tone, hair,
top, bottoms and shoes colours, height, head size and build, and add a hat (cap, beanie, top hat, straw or
cowboy hat, crown, wizard or party hat, flower, bunny ears, headphones), face accessory (glasses,
sunglasses, mustache, rosy cheeks, monocle) and something on your back (backpack, fairy wings, or a cape or
scarf simulated as cloth). Your look is saved with your game.

## Graphics & physics

- **Two art styles** (⚙ Settings): *Realistic* (default) uses physically based materials, image-based
  lighting from the live sky, soft shadows, screen-space ambient occlusion, bloom and filmic tone mapping;
  *Storybook* is the original cel-shaded look with ink outlines.
- **Quality presets** (Low / Medium / High) change resolution, shadow detail, anti-aliasing, AO, bloom,
  the number of dynamic lights and draw distance. The game steps down automatically if it runs slowly.
- **Textures**: procedural surface detail in the shaders: grass tufts and patches, rippled and glinting
  sand, layered rock, sparkling snow, gravel paths and cobbled town squares, plus wood grain, bark, leaf
  veins and weathered stone on props, all with bump-mapped lighting.
- **Dark nights & lights**: nights are properly dark. Street lamps line the roads between places, and
  lanterns, campfires, glowing mushrooms, the lighthouse and house windows light up the night.
- **Torch**: in really dark places (out at night away from lamps, or deep in the woods after dusk) your
  character pulls out a flickering torch that lights the way, throws embers and goes out with a hiss if you
  swim. Press L to turn this off.
- **Water**: a see-through sea with wave normals, sky reflections and sun glints; caustics and light shafts
  underwater, with fog that thickens with depth.
- **Swimming**: in deep water you swim at the surface (front crawl when moving, treading water when still)
  and can dive with an air meter. You bob on the actual waves, splash when you jump in and climb out onto
  shallows, piers and lily pads.
- **Props**: balls, crates, barrels, pumpkins, melons, snowballs and boulders have mass, bounce, friction
  and buoyancy (crates and barrels float, boulders sink). Run into them, or pick them up and throw them.
- **Movement**: momentum and drag, sliding on very steep slopes, heavy landings that squash and shake the
  camera, and a rowboat that pitches and rolls with the swell.

## Playing together

Everyone who has the game open sees everyone else: their character (with their look and name), where they
walk, swim, glide or sit, and their torch at night. A counter under the clock shows how many other explorers
are around, and a toast says hello when someone new arrives. How players find each other:

- **As a published claude.ai artifact**, everyone who opens the shared link joins the same world (artifact
  room presence). Names come from the name you type in the character creator, or the viewer's profile name.
- **Self-hosted**: run the small relay (`npm run relay`, port 8787) and open the game with
  `?relay=ws://your-host:8787`, or build with `VITE_RELAY=wss://your-host` so it's always used.
- **Otherwise** tabs in the same browser see each other, which is handy for trying it out.

Each player sends a small, absolute state about ten times a second (less when standing still); others smooth
and slightly extrapolate it. Everything received is validated before it's used (`src/net.js`).

## Performance

- Terrain and the sea are split into tiles that are skipped when they're behind the planet's horizon.
- Trees, rocks, houses and other scattered props are drawn as one instanced batch per model part, re-packed
  every few hundred milliseconds with only the instances that are in range and above the horizon. Small
  props (flowers, pebbles) use a shorter range and don't cast shadows.
- The shadow map refreshes every other frame on Low/Medium. Characters and animals off screen or over the
  horizon don't animate.
- With *Lower quality automatically* on, the game first lowers the render resolution in small steps (and
  raises it again when there's headroom), and only drops the quality preset if that's not enough.

## What's on the planet

A spherical world (radius 100 m — several times larger than Messenger's) with 16 places to discover:

- **Pebbleton** – the starting town with a fountain, market and Pip, who makes parasols
- **Gull Harbor** – a pier, moored ships and a rowboat you can take anywhere on the sea
- **Lighthouse Point** – the lamp sweeps the sea at night
- **Mount Hush** – a temple of bells at the summit (best place to jump off with a parasol)
- **Mirror Lake**, **Bloom Meadow** (with a round-the-world hot-air balloon), **Windmill Farm**
- **Whisperwood**, **Glowcap Grove** (bouncy, glowing mushrooms), **Old Ruins** (singing stones puzzle)
- **Sunscorch Dunes**, **Palm Oasis**, **Frostcap** (it's always snowing), **Starfall Crater**
- **Turtle Isle** and the **Coral Shallows**, out across the sea

Plus: 26 characters with their own lines, 24 species of animals to befriend, 61 Stardrops, a day/night
cycle with fireflies, shooting stars and lit lanterns, drifting clouds with real shadows, rain/snow
weather, birds, butterflies, jumping fish, kickable balls, benches that fast-forward time, and procedural
music and sound effects. Progress is saved in your browser.

## How it's made

- [three.js](https://threejs.org) + [Vite](https://vitejs.dev), no other runtime dependencies (the optional
  multiplayer relay uses [ws](https://github.com/websockets/ws)).
- **Planet**: cube-sphere terrain generated from simplex noise, region "cones", terracing, land-bridge paths
  and flattened plazas (`src/planet.js`).
- **Look**: a material factory (`src/toon.js`) that builds PBR or cel materials depending on the art style,
  with shader hooks for wind sway, see-through occluders, procedural terrain/prop textures (noise, Voronoi pebbles and cobbles, bump), caustics and lit windows. A
  custom render pipeline (`src/post.js`): HDR scene pass → SSAO → ink lines / underwater → bloom → ACES.
  Dynamic lights come from a fixed pool assigned to the nearest sources each frame (`src/lights.js`); the torch is a
  separate light on the hand bone (`src/torch.js`).
- **Physics**: rigid-body props with spherical gravity, buoyancy and impulses (`src/physics.js`); cloth
  capes are a verlet grid pinned to the shoulders (`Cloth` in `src/character.js`).
- **Characters**: the creator recolours the shared Kenney palette per vertex region (skin, hair, top,
  bottoms, shoes are found from each vertex's bone and height) and attaches accessories to the head bone.
- **Movement**: spherical-gravity character controller with slope limits, standable props, swimming and
  gliding (`src/player.js`); a camera that orbits in the player's curved local frame (`src/camera.js`).
  You slide along walls and cliffs instead of sticking, step up small ledges, and can climb out of the water
  onto lily pads.
- **Collision**: props collide using a heightfield built from their own mesh at load time (`getHeightfield`
  in `src/assets.js`). Each cell stores its top and underside, so walls are where you see them, roofs and
  caps can be stood on, and eaves and mushroom caps can be walked under. Hand-placed structures use
  cylinders, cones, boxes and domes (`src/collision.js`).
- **Audio**: everything is synthesised live with WebAudio (`src/audio.js`) — no sound files.

## Credits

3D models by **[Kenney](https://kenney.nl)** (CC0): Nature Kit, Mini Characters, Cube Pets, Fantasy Town Kit,
City Kit (Suburban), Survival Kit and Watercraft Kit — see `public/assets/KENNEY-LICENSE.txt`. Found via
AssetHoard's [free game asset guide](https://assethoard.com/blog/where-to-find-free-game-assets-2026).
Fonts: Silkscreen and Nunito from Google Fonts.
