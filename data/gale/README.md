<!-- Generated with AI assistance for NASA Space Apps 2026; reviewed by the team -->
# Gale Crater dataset — Mount Sharp boxwork (`?data=gale`)

Second site for Marswalk Budget (gale lane: data by `amarz-claude`, stops by `louis-claude`). Same contracts as `data/real/`
(CONTRACTS.md §1–§3). Jezero stays the primary site; nothing here changes the Jezero files.

| File | What | Source |
|---|---|---|
| `area.json` | 2 km square, 5 m cells, centred on the boxwork campaign (sols ~4578–4851, sites 117–121) | NASA/JPL MMGIS MSL waypoints |
| `terrain.json` | 400 × 400 cells: `elevation` (m, MOLA areoid) + `roughness`; **no** `thermalInertia` | USGS MSL Gale DEM mosaic v3, 1 m/px (HiRISE stereo) |
| `targets.json` | habitat (sol 4548) + 4 stops G1–G4 on real Curiosity parking spots, 2–3 raw photos each | MMGIS waypoints; mars.nasa.gov raw-image API |
| `imagery.png` | 1000 × 996 px, 2 m/px, north-up, exactly `area.json` bounds (Leaflet `imageOverlay`) | USGS MSL Gale HiRISE LRGB colour mosaic (25 cm COG) |
| `traverse.json` | Curiosity's drive path clipped to the area, GeoJSON `[lon, lat]` | NASA/JPL MMGIS MSL traverse |

## Honest caveats

- **Stops (updated by `louis-claude`, 2026-11-14):** four real Curiosity stops of the boxwork
  campaign, each with a one-sentence note and a link to the NASA Curiosity blog post for those sols:
  G1 boxwork trough (sol 4578), G2 Río Frío ridge wall (sol 4636), G3 the Nevado Sajama / Valle de
  la Luna drill pair (sols 4709-4722), G4 the exit to the polygonal sulfate unit (sol 4851). Values
  (5-10) and work times (30-70 min) are the team's choice. G2 is moved 5 m from the rover's spot
  because the ridge wall itself is steeper than the 20° suit limit.
- **Demo outcome:** a normal walk fits (0.27 of 0.40 kg O₂); dust, heavy kit or a solar event alone
  still fit; all three together go over on oxygen and dose, and the planner offers the best set.
- **No sand layer:** no thermal-inertia map was prepared for Gale, so the engine treats every cell
  as firm ground. Ripples and sand patches are **not** priced on this site.
- **Steep site:** 26 % of the cells are steeper than 20° (Mount Sharp buttes and scarps), against
  4.8 % at Jezero.
- **Elevation datum:** the DEM is relative to the MOLA areoid; MMGIS `elev_geoid` values sit on a
  different datum, so do not compare the two directly.
- **Dose:** Curiosity RAD measured 0.64 mSv/day here, in Gale itself, so it is not a proxy on this site.

## Photo credits

Navcam: NASA/JPL-Caltech. Mastcam and MAHLI: NASA/JPL-Caltech/MSSS. Each photo carries its own
`credit` field. HiRISE imagery: NASA/JPL-Caltech/UArizona, mosaic by USGS Astrogeology.

## Rebuild

```bash
npm install                              # geotiff (devDependency)
node scripts/prep_gale.mjs               # terrain.json, imagery.png, traverse.json (~2 min first run, cached in raw/)
node scripts/fetch_gale_photos.mjs       # targets.json (habitat, stops, photos)
npm test                                 # includes tests/gale.test.mjs
npm run plan-demo -- data/gale
```
