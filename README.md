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
| Space | Jump · hold while falling to glide with your parasol |
| E / click | Talk, pet, sit, read, ride, ring bells… |
| Mouse drag · scroll | Orbit camera · zoom |
| J / Tab | Journal (places, friends, critters, fast travel) |
| P | Photo mode (hides the UI) |
| M | Mute · H: help |

On phones and tablets:

| Touch | Action |
| --- | --- |
| Left side of the screen | Floating joystick: touch anywhere and drag to walk, push all the way to run |
| JUMP | Jump · hold while falling to glide |
| Pop-up button (above JUMP) | Appears when something's nearby: Talk, Pet, Sit, Read, Row, Board, Ring… and Stand up / Hop out / Jump out while sitting, rowing or flying. The floating label over the target can be tapped too |
| Drag (right side) · Pinch | Orbit camera · zoom |
| 📖 📷 🔊 ? | Journal, photo mode (tap **✕ Done** to leave), sound, help |

Starting the game on a phone goes fullscreen where the browser allows it. Add `?touch=1` (or `?touch=0`) to the
URL to force the touch controls on or off.

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

- [three.js](https://threejs.org) + [Vite](https://vitejs.dev), no other runtime dependencies.
- **Planet**: cube-sphere terrain generated from simplex noise, region "cones", terracing, land-bridge paths
  and flattened plazas (`src/planet.js`).
- **Look**: toon (cel) materials with a 4-band ramp, a custom post pass that draws wobbly ink outlines from
  depth discontinuities, creases and colour edges, plus paper grain and vignette (`src/post.js`). Foliage and
  grass sway in the wind and bend around the player; anything between the camera and player dithers away.
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
