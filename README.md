# Lafayette Days

A family-friendly 3D ramble through Lafayette, California. Walk Mt. Diablo Boulevard, take off on foot when the street isn’t enough, bike the reservoir rim, drive, or fly a helicopter over the hills as the light goes gold and the fog rolls in.

Gems and Explorer notes are optional. The town is the point.

## Play

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:4731/](http://127.0.0.1:4731/). The baked map is already in `public/data`, so the game runs offline after install. Asset paths are relative, so the same `dist/` folder works at a domain root and at [https://genemagg10.github.io/lafayette-game/](https://genemagg10.github.io/lafayette-game/).

### Keyboard and mouse

| | |
| --- | --- |
| WASD or arrows | Walk, pedal, drive, or pitch the helicopter |
| Mouse | Look. Click the view to capture the pointer. Wheel zooms. |
| Shift | Run on foot, or boost while flying |
| Space | Jump, handbrake drift, climb in the helicopter, or climb while flying. Double-tap to take off. |
| F | Take off on foot. In the air, settle toward a landing. |
| Ctrl | Descend in the helicopter, or dive while flying |
| E | Enter or leave a nearby bike, car, wagon, or helicopter. Beside another ride, E swaps seats without a camera cut. Also steps through a memory door, or winds the town clock |
| H | Bike bell or car horn |
| C | Chase, first-person, or cinematic camera |
| V | At a viewpoint, keep the view. Press again to step back into the ramble. |
| M | Street map. It fills in as you roam. Click a street you know, or a place you’ve found, then Travel. Pause lists the same places |
| F3 | Daybook: light, time, weather, places |
| Enter | Start from the title, or leave the pause menu |
| Esc | Pause, swap between Milo and Juniper, and wind the town clock |
| P | Hide the HUD |

The title flyover asks you to pick a rambler. Milo is nine, in a sun hat and a red cape, and he bounces when he runs. Juniper is eleven, in a teal jacket and a sky-blue scarf, and she is lighter on her feet. Hover either of them and they wave. The choice stays in this browser, and Esc opens it again from the boulevard.

On foot, double-tap Space or press F and you lift off. You hover, then W glides and Shift boosts, with the view widening and the wind coming up as you go faster. A and D bank, and a hard turn at speed barrel-rolls. Space climbs, Ctrl dives, and a pull-up trades the dive for a swoop. Meeting the ground gently is a soft landing. Diving into it is a ground pound. The cape stays out the whole time. Buildings and the hills stay solid, and you can set down on a roof.

The bike stays nimble on dirt. The car drifts if you turn hard or hold Space once you’re moving: the tires smoke, a tally floats, and a bump gives the speed back instead of stopping the ramble. Sheds and kiosks squish out of the way. The helicopter hovers when you let go of the sticks. Land it before you hop out. The chase camera eases back and widens as you go faster, and the screen picks up speed lines when you boost, drift, or fly.

Gold columns stand on places you haven’t found. A teal column near the plaza starts a short treasure hunt for the next column. A coral column at the reservoir is a surfboard to take to the library, and another downtown is a book for the same desk. Tour, on the right, is optional: it points at the next place and pays a couple of gems when you arrive. None of these can be failed. The corner map is a circle and pulls back while you’re in the air. Distance and gems sit at the top left, the place name at the top right.

Esc opens the town clock. Today is the town as it stands. 1955 is Mt. Diablo Boulevard before the freeway bypass: Highway 24 still runs along that street (the bypass comes about 1957–59 and is rebuilt about 1969–70), the Park Theater is the bright spot, and BART is not in the valley yet. A wagon and a cream coupe replace the modern car. The helicopter and on-foot flight stay in every year. The other years on the clock — the 1860s settlement, the orchard town with the electric railway (passengers 1913–41), and the 1970s — are listed from the history pack and locked, because those towns are not rebuilt to walk yet. A brass clock also stands on the downtown sidewalk; press E there. The year dissolves and the street rebuilds around you. Discovery cards in 1955 show the sourced year and what the same place is today. A line marked placeholder is an invented look. The globe lamps, orchard rows, wagon, and cream coupe are those stand-ins.

### Gamepad

Left stick moves or steers. Right stick looks. A jumps, drifts, or climbs. Double-tap A to take off on foot. B is the bell or horn. X enters or exits. Y opens the map. RB changes the camera. RT is throttle, sprint, or a flight boost. LT brakes, descends, or dives.

### Touch

On a phone or iPad the left stick moves, the right side of the screen looks, and the buttons cover ride, jump, fly, down, horn, run, camera, map, and photo. Double-tap Jump or tap Fly to take off. At a viewpoint, Photo keeps the view. At a memory door the Ride button reads Enter, and inside the memory it reads Back.

## What’s on the map

This slice covers downtown Lafayette, Lafayette BART, the reservoir and its rim trail, the start of the Lafayette–Moraga Regional Trail, pieces of Happy Valley and Burton Valley, and the Hwy 24 corridor.

Landmarks from the research file chime when you arrive, inside the playable heightfield. The card names the place, gives the sourced history, and lists who made it possible. A card marked **Approximate location** is a low-confidence, interpolated, or partial-segment geocode. Open the map and choose Hall of Builders: that page stays empty until you have visited a place, then enters the people and organizations behind it. Three viewpoints — the boulevard from the hill, the Res from the rim, and across the water — open a photo moment. The clock holds, the frame letterboxes, and a shutter keeps a card. Press V or tap Photo again and the day starts moving.

Keepsakes are optional and remembered in this browser: six brass medallions on the reservoir rim, a red kite in an oak near the overlook, and a token on the library roof, the community hall roof, and the town hall roof. The big map draws a road only after you have walked it, and pins a place after you have found it. The corner mini-map stays local, so the next block is always visible.

A glowing door stands at a landmark that has a splat capture. Walk up and the scan fades in against the mesh town, depth-tested so a wall in front of it still wins. Press E to step through. The street gives way to the photoreal capture, and the door behind you steps back out. The plaza door is a stand-in until a real Lafayette scan arrives: the lion there is not the fountain.

## Accuracy and playability

Streets, names, building footprints, businesses, trails, elevation, and landmarks follow the baked OpenStreetMap and USGS data, so a block downtown should read as that block. Where a surveyed detail would make the ramble worse, playability wins, and the bend is listed here.

- Trail ribbons keep the surveyed centerline. Footways, paths, and tracks are drawn at least 2.65 m wide, and steps at least 2.05 m, so a bike fits a path the map recorded as narrower. The line on the ground is still the real path.
- The heightfield is still about 13 m cells, now filled from the USGS 3DEP 1 m DEM (tiles x57y420 and x58y420, with the 2021 Alameda tile where it has data). Each cell is a 5-point median of that 1 m surface, and a cell that still jumps more than 8 m from its neighbors is blended toward that neighborhood. Reservoir water cells keep the surveyed surface.
- The file has an edge. Inside a band about 64 m wide the hills ease you back along your walk, ride, or flight, and a line 12 m in keeps you on the heightfield. The note you get is that the real hills continue. There is no fail state for wandering, and flight is left intact.
- Cars on the arterials slow from about 22 m out and drift aside when you are close. People on the paths step around you. Nothing in traffic is allowed to hit you.
- The Park Theater marquee follows the researched geocode on Mt. Diablo Boulevard (census address interpolation, so the card says the spot is approximate). The plaza fountain follows the researched plaza point, also approximate. The hillside cross is a modest pale stone marker at the memorial’s surveyed coordinate. Storefront color and signage are unknown, so downtown shops wear pale stand-in tints from `public/data/businesses.json`. Edit `style.wall` and `style.awning` on a business to override that facade.
- The big map hides streets you have not walked, and draws a water body once you have reached any of its shore. The mini-map does not use that fog: it always shows the streets around you.
- There is no combat. Finding a place, a view, or a keepsake is the whole reward.
- Memory doors are a scanned layer on top of the mesh town. The shipped plaza capture is a CC BY lion by Renaud, not a survey of the fountain. A real capture replaces it by dropping a file in `public/splats/` and pointing the manifest at that landmark.
- The same terrain draws every year. A building, road, or plant with no `start_year` / `end_year` stays in all of them, so Today matches the untimed town until you wind the clock. Lafayette Station’s block is tagged from 1973, when BART opened on May 21. Motorway and trunk ribbons start in 1957, when Highway 24’s bypass was built through town; before that the highway was Mt. Diablo Boulevard, and the bypass was rebuilt about 1969–70. The reservoir has been here since the dam was finished in 1933 and opened to the public on June 13, 1966, so the shore still chimes in 1955. The city incorporated in July 1968. The 1955 globe lamps, orchard rows, wagon, and cream coupe are placeholder dressing. The film grade and the quiet street bed are part of that year, and they drop back out in Today.

## Data

Geography comes from OpenStreetMap. Elevation in the playable grid is resampled from the USGS 3DEP 1 m DEM, which is in the public domain. Curated research lives in `data/` (the brief, the source list, and the GeoJSON). The raw OSM extracts were left out of the repo.

| File | What it holds |
| --- | --- |
| `public/data/terrain.bin` | Height grid and land flags |
| `public/data/roads.json` | Streets, trails, sidewalks, crossings |
| `public/data/chunks.json` | Source bake for buildings, trees, and parking. The game streams the packed tiles instead. |
| `public/data/tileset.json` | OpenMapTiles-style index: zoom, origin, which tiles exist |
| `public/data/tiles/{z}/{x}/{y}.json` | One vector tile: building, transportation, poi, landuse, plus Lafayette trees and crossings |
| `public/data/water.json` | Reservoir, ponds, creeks |
| `public/data/meta.json` | Names, signals, places, spawn |
| `public/data/pois.json` | Landmark stories generated from `data/pois.geojson` |
| `public/data/businesses.json` | Downtown businesses and the facade colors you can override |
| `data/LAFAYETTE_RESEARCH.md` | Sourced brief. Gaps are marked UNKNOWN or GAP |
| `data/data_sources.csv` | Licenses and endpoints |
| `data/pois.geojson` | 93 POIs: 68 businesses and 25 landmarks |
| `data/HISTORY.md` | Era notes. Public-domain USGS topo URLs are listed there. Lafayette Historical Society photos are rights-reserved and are not in the game |
| `data/history_pois.geojson` | 26 era-tagged places. Five have no geometry and do not chime |
| `public/data/history_pois.geojson` | The same file, fetched at startup for year windows and card copy |
| `public/data/eras.json` | Fallback then-and-now lines. `[Placeholder]` marks an invented look |
| `public/splats/manifest.json` | Where each capture sits, and which landmark anchors it |
| `public/splats/*.spz` | Gaussian splat files. The lion is a placeholder |

### Landmark stories

`python3 scripts/import-research.py` reads `data/pois.geojson` and writes the two public JSON files. A landmark record is `name`, `lat`, `lon`, `history`, `people[{name, role, contribution, source}]`, plus `approximate` when the geocode is low-confidence, interpolated, or only a trail segment. The game also accepts a GeoJSON FeatureCollection, or a wrapper `{ "pois": [...] }` / `{ "places": [...] }`. Research credits use `blurb` for the contribution line.

A landmark inside the heightfield that does not match an existing place becomes its own discovery. Places outside this slice (Briones, the Caldecott Tunnel, Heather Farm, and the far south) stay in the file and do not chime, because the walk cannot reach them yet.

`public/data/history_pois.geojson` is the era pack: 26 features, five with null geometry. The game copies a feature onto a landmark it already knows (the plaza, the Park Theater, Lafayette Station, the library on the veterans hall site, the reservoir) and, when the point is inside the heightfield and not in the water, adds the others as their own stops. Null geometry, the Rancho Acalanes centroid, the Caldecott third bore, the freeway median point, and the lake centroid do not chime. A `start_year` hides a place until that year: BART from 1973, the Highway 24 bypass from 1957, the Lafayette–Moraga Trail from 1974. An `end_year` removes a place only when the use itself ended — the hotel corner in 1925, the cornfield in 1915, Carrie Van Meter’s post office in 1927, and Sacramento Northern passengers in 1941. The dam’s 1933 is the year construction finished, and the Park Theater’s 2005 is the year it closed; both sites stay on the map. Dates come from `data/HISTORY.md`. A sentence with `[Placeholder]` is an invented look, and the card says so. The clock’s other years are in the catalog and not playable yet. A mesh with no years is drawn in every era. The choice of year stays in this browser under `lafayette-days-era`.

USGS historical topo maps (Walnut Creek and Briones Valley 1:24,000, 1947–95; Concord 1:62,500, 1897–1959) are public domain. The GeoPDF links are in `data/HISTORY.md` and can stand in as era ground-truth. They are not painted into the minimap in this slice. Lafayette Historical Society photographs are rights-reserved and are not embedded.

Building footprints in the town are OpenStreetMap, under the ODbL. Microsoft Global ML Building Footprints (ODbL) and Overture Maps are listed in `data/data_sources.csv` for a later extract; they are not merged on top of the OSM walls. Trees are the OSM points. Canopy rasters — NLCD/USFS (public domain), Meta/WRI 1 m canopy height (CC BY 4.0), and CAL FIRE urban canopy (license not verified) — are listed there and were not sampled into this slice. Google imagery is not used.

© OpenStreetMap contributors, available under the [Open Database License](https://opendatacommons.org/licenses/odbl/). Elevation: USGS 3DEP 1 m DEM, public domain, tiles x57y420 and x58y420 from CA_NoCAL_Wildfires_B5b_2018, plus CA_AlamedaCounty_2021_B21 x57y420 on the west. The placeholder lion splat is by Renaud, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), from [superspl.at/scene/56155c3f](https://superspl.at/scene/56155c3f). See `public/data/ATTRIBUTION.txt`.

### Memory captures

The owner’s captures are a first-class layer. Three.js draws them with the same WebGPU renderer as the town, depth-tested against the mesh world so a building in front of a splat still occludes it. One capture is resident at a time. It streams in near its landmark and fades out as you leave. There is no splat octree in this renderer, so the level of detail is a count budget: the file is stride-sampled down to a cap before it becomes a mesh.

| Picture | WebGPU cap | WebGL fallback cap |
| --- | --- | --- |
| Vivid | 80,000 | 12,000 |
| Balanced | 36,000 | 8,000 |
| Soft | 16,000 | 5,000 |

A record can set a lower `budget` of its own. The WebGL fallback sorts splats on the CPU, which is why that column is smaller. If the frame rate stays under 34, the game still steps the whole picture down, and the splat cap steps with it. The goal is to stay near 60 fps with one doorway live, not to draw every Gaussian in a raw export.

Until the iPhone scans arrive, `public/splats/lion.spz` stands at the plaza fountain. It is a free capture, not Lafayette.

**Capture a landmark**

1. On an iPhone, open Scaniverse or Polycam and walk a slow loop around the spot: the ground, the facade, and the way in. Keep people out of the frame if you can.
2. Export a Gaussian splat as `.spz` if the app offers it, otherwise `.ply` or `.splat`. `.spz` is the smallest.
3. Drop the file in `public/splats/`. Do not put it in a subfolder.
4. Add a record to `public/splats/manifest.json`:

```json
{
  "id": "theater-marquee",
  "file": "theater.spz",
  "format": "spz",
  "anchor": "theater",
  "title": "Park Theater",
  "blurb": "The marquee, scanned from the sidewalk.",
  "credit": "Captured on iPhone, Lafayette.",
  "position": [0, 0, 0],
  "rotation": [0, 0, 0],
  "yaw": 0,
  "scale": 1,
  "fitHeight": 8,
  "memoryFitHeight": 14,
  "blendIn": 12,
  "blendOut": 28,
  "stream": 80,
  "budget": 48000
}
```

`anchor` is the place id the game already knows: `plaza`, `theater`, `library`, `cross`, `bart`, `reservoir`, or the slug of a researched landmark inside the heightfield. `position` is meters from that anchor, x east, y up, z south. `rotation` is degrees. `yaw` turns the glowing door. `fitHeight` is how tall the scan stands on the street; `memoryFitHeight` is how tall it stands after you step through. Optional `lat` and `lon` override the anchor point when the scan was taken a few meters off the pin.

5. Reload. The door appears at the landmark. Walk close and the scan fades in. Press E to step into it, and E again at the door behind you to come back. The Daybook (F3) has a Plaza button that stands you in front of the sample door.

Replace the lion record when the real plaza scan is ready, or leave the lion and add the new landmark beside it. Only the nearest capture within `stream` meters is loaded.

### Rebuild the map

`npm run bake` needs a network connection. It queries the Overpass API and downloads zoom-15 terrain tiles for the bounding box in `scripts/bake-map.mjs`, then writes `public/data`. Raw responses are cached in `.cache/` (gitignored). Re-run it if you widen the box or change how roads and buildings are simplified.

`npm run tiles` packs that bake into OpenMapTiles-style vector tiles with no network. Layer names follow the [OpenMapTiles schema](https://openmaptiles.org/schema/) (`building`, `transportation`, `poi`, `landuse`). Trees, parking, crossings, and reeds are a Lafayette detail layer a whole-Earth stream would collapse into landcover. Tiles are `{z}/{x}/{y}` in a local meter grid (x east, y south). Downtown, the station, the reservoir, and the overlook are marked rich: parapets, shop fronts, street names, and category pins. The rest of the map stays a clean extrusion so the same reader can later point at a real tile endpoint and keep Lafayette as the dense city layer.

## Build and deploy

```bash
npm run build
npm run preview
```

`vite.config.ts` sets `base: './'`, so `dist/` is a static site. GitHub Pages and Vercel can both host it with no extra rewrite rules. Point the host at `dist` after `npm run build`.

## Stack

Vite, TypeScript, and Three.js. The picture uses a WebGPU renderer and falls back to WebGL2 when the browser needs it. Gaussian splats use that same renderer (`GaussianSplat` in Three r186), so they share the town’s depth and the post stack. WebGPU sorts them on the GPU; WebGL sorts them on the CPU, under a smaller count cap. Downtown stays the crisp Apple Maps v1 town: pale buildings, cased roads, readable pills. The hills around it are a painterly, saturated landscape.

Vivid quality runs a 16³ warm LUT, soft bloom on the sun and the fog, a short raymarch for valley mist and night shafts when those terms are actually on, a little distance blur, and ground-truth ambient occlusion on WebGPU. Contact shading on walls and the ground is in the vertex colors. On WebGPU, Vivid also uses two cascaded shadows that follow the sun. Balanced uses one 512 map and no cascades. Soft drops the shadow. WebGL keeps a single shadow. Shadows are warm grey at 22% with a soft edge. The Daybook (F3) is three controls: Light, Time, and Weather, plus a list of places. The fps line and the WebGPU adapter dump stay behind `?debug`. If the frame rate stays low, the game first drops the pixel ratio to 0.75 and turns shadows and bloom off. It can then step from Vivid to Balanced. Canopy meshes stay in place at every setting. It steps back up only after the picture has been smooth for several seconds. `?gpu=webgl` starts on WebGL, `?gpu=lose` drops the device twice so recovery can be checked, and `?gpu=info` prints the adapter line.

The daylight is a Preetham sky, so the color moves with the sun instead of crossfading a backdrop. One wind field bends the grass, the oak canopies, the boulevard flags, and Milo’s cape or Juniper’s scarf together. Grass and wildflowers are instanced blades around you. On WebGPU a compute pass hides blades outside the view. Tree crowns stay lobed at every distance. Summer hills go gold, winter hills go green, and spring adds flowers. Mt. Diablo and a ring of ridge impostors sit past the heightfield, hazed with the distance. The season button in the Daybook cycles summer, winter, and spring.

Terrain is one heightfield. Buildings and trees stream by chunk. Nearby trees are instanced meshes in the wind; farther ones become crossed cards.
