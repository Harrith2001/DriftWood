# Driftwood

An interactive 3D portfolio. You arrive by freefall — a cinematic drop into a
street in Lima at dusk, ending in a hard landing — and then take the controls
and explore the neighbourhood on foot to find the work.

Built with Angular 20, Three.js and GSAP.

## Running it

```bash
npm install
npm start          # http://localhost:4200
```

```bash
npm run build      # production build + prerender
npm test           # unit tests
```

## How it fits together

The Three.js layer is deliberately framework-agnostic — it knows nothing about
Angular. `OceanWorld` is constructed with a canvas and a set of callbacks; the
Angular shell adapts those callbacks onto signals and decides which overlay is
on screen.

```
src/app/
├── core/
│   ├── content/      copy for every panel — the only file with prose in it
│   ├── models/       domain types
│   ├── services/     experience state (signals), device capability tiers
│   └── world/        world coordinates, camera keyframes, hotspots
├── three/
│   ├── engine/       renderer + post-processing chain
│   ├── world/        sky, clouds, lighting, city, beacons, ground probe
│   ├── character/    mesh, animation retargeting, procedural landing crouch
│   ├── camera/       third-person rig, occlusion pull-in
│   ├── controls/     walk controller, keyboard/touch input
│   ├── sequences/    the cinematic arrival
│   └── effects/      impact dust and shockwave
└── features/experience/
    ├── experience.*  the shell that owns the canvas
    └── ui/           loader, intro, HUD, content panel, touch controls
```

Rendering runs outside the Angular zone, so the render loop never schedules
change detection. UI updates come from explicit signal writes instead.

### Editing the content

All human-facing copy lives in `src/app/core/content/portfolio.content.ts`.
Nothing in that file affects the 3D scene or the layout.

### Controls

`W`/`A`/`S`/`D` or the arrow keys to move, `Shift` to run, `E` to open a
location. On touch devices an on-screen stick appears instead. Every location is
also reachable from the HUD list, so the 3D experience is never a gate on the
information.

### Quality tiers

`DeviceService` probes core count, memory and pointer type before anything is
built, and scales pixel ratio, shadows, cloud count and post-processing to
match. `prefers-reduced-motion` skips the arrival entirely rather than
autoplaying eight seconds of camera work at someone who asked it not to.

## Assets

The runtime models in `src/assets/models/` are committed, so a fresh clone runs
without any extra steps.

They are *generated*. The raw downloads live in `assets-src/`, which is
gitignored — it is roughly 480 MB and nothing in it is served. To regenerate:

```bash
npm run assets:build
```

This matters because the raw exports are unusably heavy for the web: every
animation download bundles a full duplicate of the character mesh plus its 4K
PNG texture set — about 55 MB each, for what amounts to ~21 KB of keyframes.
The pipeline (`tools/optimize-assets.mjs`) strips meshes and textures out of the
animation files entirely, and resizes and re-encodes the rest.

| asset | raw | runtime |
| --- | --- | --- |
| idle | 55.6 MB | 0.41 MB |
| walk | 95.7 MB | 0.09 MB |
| fall | 55.1 MB | 0.07 MB |
| character | 55.6 MB | 5.7 MB |
| city | ~30 MB | 3.1 MB |
| **total** | **~292 MB** | **9.4 MB** |

Textures are JPEG or PNG, chosen per texture by measuring whether the alpha
channel is actually used. Not WebP: `EXT_texture_webp` silently drops every
texture on any runtime that cannot decode it, which renders the whole scene
flat white.

The city also arrives using the legacy specular/glossiness workflow, which
Three.js no longer loads. `metalRough()` converts it during the build; without
that step every diffuse texture stays stranded inside an extension the loader
ignores, and the model renders in flat untextured colour with nothing but a
console warning to say why.

## Notes for future work

A few things in here are load-bearing and easy to break:

- **Animation retargeting** (`three/character/animation-retarget.ts`). The three
  animation exports disagree with the character rig on bone naming, on their
  translation origin, and on which way is up. All three are reconciled at load
  time and covered by tests — those tests are the guard rail.
- **Ground probing** (`three/world/ground-sampler.ts`). Walkability is sampled
  from the real geometry against an allow-list of standable materials, not from
  hand-measured rectangles. The probe window travels with the character, because
  the playable streets climb and fall by 25 metres and several rooftops sit at
  exactly the height of a road one street over.
- **The walkability map** (`tools/dev/probe-city.mjs` → `core/world/city-blockers.ts`).
  Where you can walk is read off the mesh, not drawn over a screenshot. The probe
  rasterises every triangle onto a grid, flood-fills to find what is reachable on
  foot, and emits the blocked rectangles as a generated file. Re-run it after
  changing the model — and keep its `WALKABLE` set in step with
  `WALKABLE_SURFACE` in `three/world/environment.ts`, since the two answer the
  same question in different places.
- **Why the blockers are baked and not probed.** Most buildings here are modelled
  from below the roadway up through it, so a raycast through the space the body
  would occupy sits strictly inside the solid with no face along it to hit. There
  is nothing to fix by tuning the cast — surfaces are all a ray can find.
  Rasterising offline knows the full vertical span of a cell and has no such
  blind spot.
- **No occluder fading.** Pulling the camera in is the only occlusion technique
  used. Fading needs per-object granularity that downloaded environments rarely
  have — see the note in `three/camera/camera-rig.ts` for what that cost last
  time.

## Credits

The environment is ["Popular Streets of Lima | PS1 Environment"](https://sketchfab.com/3d-models/popular-streets-of-lima-ps1-environment-d914a9adf2e24635a5310c909800009d)
by [McPato](https://sketchfab.com/McPato), licensed under
[CC BY 4.0](http://creativecommons.org/licenses/by/4.0/). Commercial use is
permitted and attribution is required, so the credit also appears in the About
panel of the site itself — keep it there.
