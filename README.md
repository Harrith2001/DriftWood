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
    └── ui/           loader, intro, HUD, panels, touch controls, readable page
```

Rendering runs outside the Angular zone, so the render loop never schedules
change detection. UI updates come from explicit signal writes instead.

### Editing the content

All human-facing copy lives in `src/app/core/content/portfolio.content.ts`.
Nothing in that file affects the 3D scene or the layout.

### Controls

`W`/`A`/`S`/`D` or the arrow keys to move, `Shift` to run, `Space` to jump, `E`
to open a location. On touch devices an on-screen stick and two buttons appear
instead. Every location is also reachable from the HUD list, so the 3D
experience is never a gate on the information.

### The scavenger hunt

Eight bottle caps are hidden across the neighbourhood — walk into one to take
it, and two of them hang above standing reach and have to be jumped for. Finding
all eight opens a panel that is not otherwise reachable. Progress is kept in the
browser between visits, and once the hunt is done the tally in the HUD becomes
the way back into the reward.

It is deliberately not a gate: every piece of the portfolio stays one click away
in the HUD whether or not a single cap is found. The hunt exists because a place
you can only walk around is a place you look at once.

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
| character | 55.6 MB | 3.6 MB |
| city | ~30 MB | 3.1 MB |
| **total** | **~292 MB** | **7.5 MB** |

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
  the neighbourhood climbs and falls by 52 metres and several rooftops sit at
  exactly the height of a road one street over. It is cast from the height it is
  given, and the cache band is only a key — casting from the *rounded* band put
  the window a metre off the real footing and starved the downward reach, which
  showed up as the character stalling every few steps on a staircase.
- **The walkability map** (`tools/dev/probe-city.mjs` → `core/world/city-blockers.ts`).
  Where you can walk is read off the mesh, not drawn over a screenshot. The probe
  rasterises every triangle onto a half-metre grid, flood-fills from the landing
  point to find what is reachable on foot, and emits everything else as blocked
  rectangles. Re-run it after changing the model — and keep its `WALKABLE` set in
  step with `WALKABLE_SURFACE` in `three/world/environment.ts`, since the two
  answer the same question in different places.

  It also caps how high the visitor may climb, and the number is measured rather
  than chosen: below six metres the reachable ground is roadway, pavement and
  yard; above it there is not one square metre of any of them, only bare hillside
  carrying backdrop geometry built to be read from the street far below. Up there
  the illusion collapses — walls end in mid-air, a shack sits over a gap, and the
  slopes are too steep for the camera to find anywhere to sit. `find-floating.mjs`
  is the diagnostic that established this: it looks for meshes with daylight under
  them, and finding none on the ridge is what showed the problem was the whole
  undressed hilltop rather than one bad prop.

  It deliberately does *not* test the slope of the triangles under a cell. That
  is the wrong question for a staircase, whose risers are vertical and whose
  treads are flat: a per-triangle slope test rejects every stair in the model
  while happily accepting a smooth 30° bank. What decides it is the height
  difference between one foothold and the next, capped by `MAX_GRADIENT` — set
  from the stair flights, at 1.4.

  Pass a JSON file of recorded `[x, z, y]` positions as an argument and it
  checks them against the map. That is how the two are kept honest: drive the
  character around with the `driftwood` dev hook (development builds only, see
  `three/ocean-world.ts`), then feed the trace back. Reading either side alone is
  how he ended up standing in a shop.
- **Two kinds of obstacle, and they are not interchangeable.** The baked
  blockers answer "which *ground* has no route to it" — interiors, rooftops,
  banks too steep to climb — on a half-metre grid merged into axis-aligned
  rectangles. `controls/body-collider.ts` answers "is something standing in the
  way", by sweeping two rays against the real meshes. Railings, balustrades,
  lamp posts and parked cars sit on ground that is perfectly walkable either
  side of them, at a scale and angle no rectangle grid describes, so the map
  alone lets the character walk straight through them. Both rays run between the
  two ends' own ground heights rather than horizontally — a horizontal ray at
  step height buries itself in the stair flight ahead and the character refuses
  to climb his own staircase.
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
- **Speed is carried, not switched** (`controls/walk-controller.ts`). Setting it
  straight from the key state reached full pace in one frame and stopped dead in
  another, with the walk cycle snapping between rates underneath. Playback is
  also tied to actual ground speed against `STRIDE_SPEED`, which is what stops
  the feet skating — no playback rate makes a walk animation honestly cover the
  4.2 m/s the character used to move at, so `WALK_SPEED` came down to a walk and
  the run multiplier does the ground-covering.
- **The portfolio is a document first** (`ui/readable-portfolio/`). The whole of
  it renders into the DOM on every load, hidden off-screen behind the scene and
  shown as the page when there is no WebGL. Before it, the server-rendered HTML
  contained three pieces of text — a name, a role, and the word "Preparing" —
  because panels only entered the DOM once a visitor walked a character to a
  beacon. Search engines, link previews and anyone with JavaScript off saw an
  empty page, which for a portfolio is the most expensive bug available: it is
  invisible in exactly the places someone looks for you. It reads `PANELS`, so
  it cannot drift from what the panels say, and it is hidden with `clip-path`
  rather than `display: none`, which would take it out of the accessibility tree
  and defeat half the point.
- **WebGL is checked before anything is built** (`DeviceService.supportsWebGL`).
  A refused context throws from inside an async boot — an unhandled rejection
  nobody sees, leaving the loader on a progress bar that never moves. The probe
  runs first, and `boot()` catches anyway for the context that passes the probe
  and is refused later.
- **`public/` was never copied into the build.** The asset config listed only
  `src/assets`, so `favicon.ico` had been 404ing since the project started, and
  the social card would have silently gone missing too. Worth checking after any
  `angular.json` change: build, then list `dist/`.
- **Placing anything in the world means asking the probe twice.** A spot that is
  reachable is not automatically a spot you can put something on. Two bugs came
  out of assuming otherwise, both caught by `collectibles.config.spec.ts` and by
  driving the character to every cap in turn rather than trusting the map:
  coordinates are written as whole metres while the grid is half-metre cells, so
  rounding can land on the exact boundary of a blocked cell; and a terrace edge
  can drop three metres between neighbouring cells, so the height gets reported
  from the top of the step while the rounded coordinate falls to the bottom,
  leaving a cap hanging three metres overhead. The chooser now requires the
  neighbourhood to be both reachable and level.
- **Action buttons on touch fire on `pointerdown`, never `click`.** A click
  arrives only on release, and on touch it is routinely dropped when another
  pointer is already captured — one thumb on the stick, the other on jump. Bound
  to click, jump worked standing still and did nothing while moving. The click
  handler that remains is the keyboard path only, and ignores anything a pointer
  produced: a button activated with Enter or Space emits a click with
  `detail === 0`, a real press emits a positive one. That is what lets both
  coexist without firing twice.
- **The stick's listeners are attached outside Angular's zone**, and the knob is
  moved by writing to its style. Bound in the template, each of the sixty
  pointermove events a second schedules change detection across the whole
  application — while the character is moving, on the device least able to
  afford it.
- **`window:touchstart` listeners in Angular are passive.** `preventDefault()`
  on one does nothing except log an error on every touch. Worth remembering
  before reaching for it: cancelling a touchstart also cancels the click the
  browser would synthesise, which is what any button underneath depends on.
- **Templates are only checked by the Angular compiler.** `tsc --noEmit` will
  happily pass a template calling a method that does not exist; `npm run build`
  is what catches it. Run the build, not just the type-check, after touching a
  component template.
- **The camera on a hill.** Its seat height is measured from the character's
  footing, which is right on the level and wrong on a slope: walking downhill
  leaves the rig six metres back up ground that has risen in the meantime, so it
  ends up under the road behind it. `liftAboveGround` samples the surface under
  the seat and clears it. The alleys are also narrower than the rig's own
  standoff, which is why `CAM_MIN_DISTANCE` is 1.5 — below that it stops
  respecting walls entirely.

## Credits

The environment is ["Popular Streets of Lima | PS1 Environment"](https://sketchfab.com/3d-models/popular-streets-of-lima-ps1-environment-d914a9adf2e24635a5310c909800009d)
by [McPato](https://sketchfab.com/McPato), licensed under
[CC BY 4.0](http://creativecommons.org/licenses/by/4.0/). Commercial use is
permitted and attribution is required, so the credit also appears in the About
panel of the site itself — keep it there.
