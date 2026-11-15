<!-- Generated with AI assistance for NASA Space Apps 2026; reviewed by the team -->
# The model behind Marswalk Budget

Owner: engine lane (`louis-claude`). Every number the planner uses lives in `js/config.js`; this page says where each one comes from. Every value is labelled SOURCE, PROXY, ASSUMPTION or DESIGN below, with a link.

## How a walk is priced

The walk area is a grid of 5 m cells built from real elevation (USGS HiRISE DTM) and thermal inertia (THEMIS). Moving between neighbouring cells costs **metabolic energy** = power × time. **Speed** follows Tobler's hiking function on the local grade, slowed by loose sand (low thermal inertia) and rough ground; cells steeper than the suit limit (20°) are impassable. **Power** rises with uphill grade, with braking downhill, on sand and with load. Energy converts to **suit oxygen** (≈ 20.1 kJ per litre of O₂). The planner finds the least-energy path between every pair of stops (A*/Dijkstra), the best visiting order (exact up to 7 stops), then totals walking time, dwell time, oxygen and **radiation dose** (surface dose rate × time). It also reports the **point of no return** (last point you can still walk home without touching the O₂ reserve), the **turn-back-by point if a dust storm starts**, the **single stop to drop**, and the **best set of stops that fits** the budget.

## Parameters

Status: **SOURCE** = published value. **PROXY** = published value from Earth, the Moon or another Mars site. **ASSUMPTION** = our number; the source gives context, not the value. **DESIGN** = a software or policy choice. Full audit with page references: [`docs/model-sources.md`](model-sources.md) (by `codex-conditions`).

| Parameter | Value | Status | What it means / why | Source |
|---|---|---|---|---|
| `walk.vFlatMps` | 1.0 | ASSUMPTION | flat-ground walking speed. Lunar xEVA tests saw ~2 km/h (0.56 m/s) on level regolith; at 0.56 the normal Jezero walk goes over budget (docs/model.md, sensitivity). | [Coan 2021, NTRS 20210000827](https://ntrs.nasa.gov/citations/20210000827) |
| `walk.toblerK` | 3.5 | PROXY | Earth hiking-function exponent; transfer to a Mars suit is assumed. | [Tobler 1993](https://escholarship.org/uc/item/05r820mz) |
| `walk.toblerG0` | 0.05 | PROXY | Earth optimum downhill grade. | [Tobler 1993](https://escholarship.org/uc/item/05r820mz) |
| `walk.maxSlopeDeg` | 20 | PROXY | suited walking up to 20° in lunar xEVA tests; not a Mars flight rule. | [Coan 2021, NTRS 20210000827](https://ntrs.nasa.gov/citations/20210000827) |
| `metabolic.baseW` | 272 | PROXY | Apollo whole-EVA mean, 234 kcal/h = 272 W. Not a fitted Mars walking law. | [NASA 1986 metabolism report (Apollo EVA data), NTRS 19930074290](https://ntrs.nasa.gov/api/citations/19930074290/downloads/19930074290.pdf) |
| `metabolic.uphillPerGrade` | 3.0 | ASSUMPTION | linear uphill surcharge (+30% at 10% grade); measured graded walking is nonlinear. | [Minetti et al. 2002](https://doi.org/10.1152/japplphysiol.01177.2001) |
| `metabolic.downhillPerGrade` | 0.5 | ASSUMPTION | braking surcharge downhill; gentle downhill can be cheaper in reality. | [Minetti et al. 2002](https://doi.org/10.1152/japplphysiol.01177.2001) |
| `metabolic.dwellW` | 284 | PROXY | Apollo geology surveys and deployments, 244 kcal/h = 284 W. | [NASA 1986 metabolism report (Apollo EVA data), NTRS 19930074290](https://ntrs.nasa.gov/api/citations/19930074290/downloads/19930074290.pdf) |
| `terrain.looseSandTI` | 200 | ASSUMPTION | thermal-inertia breakpoint for loose fines; thermal units overlap. | [Murphy et al. 2007](https://doi.org/10.1029/2005JE002586) |
| `terrain.bedrockTI` | 400 | ASSUMPTION | firm-ground proxy; inertia alone does not prove walkable bedrock. | [Murphy et al. 2007](https://doi.org/10.1029/2005JE002586) |
| `terrain.sandSpeedFactor` | 0.6 | ASSUMPTION | speed on loose sand; Earth sand studies show more effort, not this factor. | [Lejeune et al. 1998](https://doi.org/10.1242/jeb.201.13.2071) |
| `terrain.sandMetabolicFactor` | 1.4 | ASSUMPTION | power on loose sand; with the speed factor, sand costs ~2.3x per metre (Earth: 2.1-2.7x at matched speed). | [Lejeune et al. 1998](https://doi.org/10.1242/jeb.201.13.2071) |
| `terrain.roughnessBlock` | 0.8 | ASSUMPTION | dataset-specific threshold on our DTM roughness index. | [NASA 2017 EVA risk report, NTRS 20170002574](https://ntrs.nasa.gov/citations/20170002574) |
| `terrain.roughnessSpeedPenalty` | 0.5 | ASSUMPTION | dataset-specific speed penalty for roughness. | [NASA 2017 EVA risk report, NTRS 20170002574](https://ntrs.nasa.gov/citations/20170002574) |
| `suit.o2CapacityKg` | 0.5 | PROXY | Shuttle/ISS EMU primary O2 is 1.2 lb (0.544 kg); rounded down. Mars suit hardware unknown. | [Jeng et al. 2009, NTRS 20090013081](https://ntrs.nasa.gov/citations/20090013081) |
| `suit.reserveFraction` | 0.2 | DESIGN | team reserve policy: 20% of the primary O2 is never planned. | [Jeng et al. 2009, NTRS 20090013081](https://ntrs.nasa.gov/citations/20090013081) |
| `suit.o2JoulesPerLitre` | 20100 | SOURCE | ~20.1 kJ per litre of O2 (indirect calorimetry, RQ about 0.85). | [Weir 1949](https://doi.org/10.1113/jphysiol.1949.sp004363) |
| `suit.o2KgPerLitre` | 0.001429 | SOURCE | O2 density 1.429 g/L at 0 °C and 1 atm. | [NBS Circular 279](https://nvlpubs.nist.gov/nistpubs/Legacy/circ/nbscircular279.pdf) |
| `eva.maxHours` | 6 | ASSUMPTION | planned EVA length including work and a margin; Artemis timeline studies run on this scale. | [Scoville et al., NTRS 20210026296](https://ntrs.nasa.gov/api/citations/20210026296/downloads/Scoville%20Final%20presentation%20-%20compressed.pptx.pdf) |
| `safety.habitatAntennaM` | 3 | DESIGN | observer height at the habitat for line of sight. | — |
| `safety.astronautEyeM` | 1.8 | DESIGN | suited astronaut's helmet height for line of sight. | [NTRS 20230012314](https://ntrs.nasa.gov/api/citations/20230012314/downloads/EarlyArtemisSurfaceNavigation_v1-ION23-XXX-v3.docx) |
| `radiation.surfaceMSvPerDay` | 0.64 | SOURCE | Curiosity RAD dose equivalent at Gale, 0.64 ± 0.12 mSv/day; a proxy at Jezero. | [Hassler et al. 2014, Science 343](https://doi.org/10.1126/science.1244797) |
| `radiation.walkLimitMSv` | 1.0 | DESIGN | educational per-walk allocation, not a NASA exposure limit. | [NASA-STD-3001 Vol. 1, 4.8](https://www.nasa.gov/reference/4-0-human-performance/) |
| `conditions.dustStorm.speedFactor` | 0.7 | ASSUMPTION | visibility scenario; no measured link to suited walking speed. | [NASA Mars environment handbook, NTRS 20010046858](https://ntrs.nasa.gov/citations/20010046858) |
| `conditions.dustStorm.metabolicFactor` | 1.1 | ASSUMPTION | scenario factor. | [NASA 2017 EVA risk report, NTRS 20170002574](https://ntrs.nasa.gov/citations/20170002574) |
| `conditions.dustStorm.maxSlopeDeg` | 20 | DESIGN | same as the suit limit; 15° cut off half the demo stops. | [Coan 2021, NTRS 20210000827](https://ntrs.nasa.gov/citations/20210000827) |
| `conditions.solarEvent.doseFactor` | 10 | ASSUMPTION | stress-test multiplier, not a typical event; real events vary with spectrum and shielding. | [Hassler et al. 2018](https://doi.org/10.1029/2018SW001959) |
| `conditions.heavyKit.speedFactor` | 0.85 | ASSUMPTION | load carriage slows walking; kit mass not specified. | [Pandolf et al. 1977](https://doi.org/10.1152/jappl.1977.43.4.577) |
| `conditions.heavyKit.metabolicFactor` | 1.25 | ASSUMPTION | load carriage raises power; kit mass not specified. | [Pandolf et al. 1977](https://doi.org/10.1152/jappl.1977.43.4.577) |
| `conditions.heavyKit.maxSlopeDeg` | 20 | DESIGN | same as the suit limit. | [Coan 2021, NTRS 20210000827](https://ntrs.nasa.gov/citations/20210000827) |
| `planner.bruteForceMaxStops` | 7 | DESIGN | exact best order up to this many stops; heuristic above. | — |
| `planner.subsetExactMaxStops` | 10 | DESIGN | bestSubset tries every subset up to this many stops; greedy above. | — |
| `planner.contingency` | ['dustStorm'] | DESIGN | stress scenario for turnBackLatest: a dust storm starting mid-walk. | [NASA Mars environment handbook, NTRS 20010046858](https://ntrs.nasa.gov/citations/20010046858) |
| `goNoGo.dustTauStorm` | 1.0 | DESIGN | team alert threshold on dust optical depth; not an EVA rule. | [NASA Mars environment handbook, NTRS 20010046858](https://ntrs.nasa.gov/citations/20010046858) |
| `goNoGo.o2MarginCaution` | 0.10 | DESIGN | team UI policy: CAUTION under 10% usable O2 left. | [Jeng et al. 2009, NTRS 20090013081](https://ntrs.nasa.gov/citations/20090013081) |
| `goNoGo.doseCautionFraction` | 0.8 | DESIGN | team UI policy: CAUTION above 80% of the walk allocation. | [NASA-STD-3001 Vol. 1, 4.8](https://www.nasa.gov/reference/4-0-human-performance/) |
| `goNoGo.sepAlertDays` | 2 | DESIGN | Earth-catalogue recency policy; not a Mars all-clear. | [NASA CCMC DONKI](https://ccmc.gsfc.nasa.gov/tools/DONKI/) |
| `goNoGo.sepWatchDays` | 7 | DESIGN | Earth-catalogue recency policy. | [NASA CCMC DONKI](https://ccmc.gsfc.nasa.gov/tools/DONKI/) |

## Sensitivity (2026-11-14)

Real Jezero walk, all six stops; ✓ fits, ✗ over budget. The story the demo tells (a normal walk fits, any one hazard can break it) holds for the current values; a much slower walker breaks even the normal walk.

| Variant | Normal | Dust storm | Heavy kit | Solar event | All three |
|---|---|---|---|---|---|
| Current (272 W walking, 284 W working, 1.0 m/s) | ✓ 0.36 kg | ✗ 0.45 kg | ✗ 0.47 kg | ✗ dose | ✗ 0.61 kg |
| Before the audit (300 W, 200 W) | ✓ 0.30 kg | ✓ 0.40 kg | ✗ 0.41 kg | ✗ dose | ✗ 0.54 kg |
| Lunar xEVA walking speed, 0.56 m/s | ✗ 0.41 kg | ✗ 0.57 kg | ✗ 0.57 kg | ✗ | ✗ 0.80 kg |

Usable O₂ is 0.40 kg (0.5 kg × 80%); dose budget 1 mSv per walk.

## Line of sight and EVA length

Two checks from NASA traverse planning sit next to oxygen and dose. **Line of sight:** for every
point of the route, a straight sight line from the habitat antenna (3 m) to the astronaut's helmet
(1.8 m) over the elevation grid, including Mars curvature; segments where the habitat loses sight of
the astronaut are flagged (Artemis traverse plans weigh line of sight to the lander, NTRS 20230012314).
On Gale's boxwork about 350 m of the 1.9 km walk is out of sight behind ridges; at Jezero, about 20 m.
**EVA length:** the whole walk, work included, must fit in 6 hours (`eva.maxHours`, an assumption on
the scale of Artemis EVA timeline studies, NTRS 20210026296); going over is a third budget violation.

## Route options

The console can compare three routes for the same stops (`js/routes.js`): **least oxygen** (the
planner as described above), **safest** (keeps to 15° where it can and steers around sand and rough
ground) and **shortest** (fewest metres on walkable ground). Only the way paths are *chosen* changes;
every option is priced with the same walking model, so least oxygen is always the cheapest and the
others show what safety or distance costs. On the real Jezero walk: least oxygen 2.55 km / 0.356 kg,
safest 2.63 km / 0.359 kg, shortest 2.54 km / 0.364 kg.

## Check against NASA's figures (2026-11-15)

NASA's *Life Support Baseline Values and Assumptions Document* (BVAD, Anderson, Ewert and Keener,
NASA/TP-2015-218570/REV1, January 2018, https://ntrs.nasa.gov/citations/20180001338) gives two EVA oxygen figures:

| BVAD | Value |
|---|---|
| Table 4-76, EVA O₂ consumption (McBarron et al. 1993; 293 W, RQ 0.9) | **0.075 kg per crew member-hour** |
| Table 4-75, lunar surface EVA "oxygen losses" (low / nominal / high) | 0.069 / 0.092 / 0.110 kg/CM-h |

Our conversion (20.1 kJ per litre of O₂, 1.429 g/L) turns BVAD's 293 W into exactly 0.075 kg/h, so the energy-to-O₂ step
agrees with NASA's own number. At our flat-ground walking power (272 W) the suit burns 0.070 kg/h, and the default Gale
walk (4 stops, 3 h 40 min, 0.27 kg) averages **0.074 kg/h**: inside BVAD's lunar range. The model's oxygen use is
therefore in the right range; what it adds is *where* the O₂ goes (slope, sand, load, working time).

## Safe havens and supply caches (2026-11-15)

`planWalk(terrain, targets, { havens })` takes optional safe places besides the habitat (CONTRACTS §4):

- **Storm shelter** (`kind: 'shelter'`, e.g. a parked pressurized rover): reaching it with the O₂ reserve intact counts as safe.
  The point of no return and the dust-storm turn-back are measured to the **nearest** safe place; `turnBack.refuge` names it.
- **Supply cache** (`kind: 'cache'`): spare suit O₂. If the walk runs out of O₂, the planner tries one detour to a cache at the
  best place in the visiting order. Arriving refills the suit to full; swapping bottles takes 10 min (`havens.cacheSwapMin`,
  ASSUMPTION: no Mars suit does this today). The plan then lists `refills`, and `totals.o2UsableKg` grows by what the cache put back.

The places in `data/<site>/havens.json` are **hypothetical**, placed by the team on the walking route. On all three sites the
"dust storm + heavy kit" walk is over budget on O₂ and fits with the cache.

## Pressurized rover and the walk-back limit (2026-11-15)

`planRover` (`js/rover.js`) plans the same stops as a rover sortie:

- The crew drives in a shirt-sleeve cabin at **10 km/h** on flat ground (PROXY: NASA/USRA pressurized lunar rover design,
  NTRS 19940021211), slower on grades (`rover.gradeK`, ASSUMPTION), in sand and on rough ground; same 20° limit. The route is the fastest drive.
- Driving costs no suit O₂. Each stop is its own suited EVA from the rover with a fresh suit; `totals.o2UsedKg` is the longest one.
- Dose: full surface rate while suited; in the cabin 0.8 × the background rate and 0.2 × the extra from a solar event
  (ASSUMPTIONS: walls stop solar protons far better than cosmic rays).
- **Walk-back limit** (Apollo LRV traverse planning): at every point of the drive, the O₂ needed to *walk* to the habitat or a haven
  (walking model, today's conditions, sample kit left in the rover) must stay within one suit's usable O₂. Parts of the drive past
  that are reported in `walkback.beyond`, with the last safe point in `walkback.limitPoint`.

Result on our sites: the maps are 2 km squares, so the walk-back never binds (worst case about 5% of a suit). The rover's value here
is time and dose: under a solar event at Jezero the walk exceeds the dose limit (1.17 mSv) while the rover sortie stays under it (0.88 mSv).
The walk-back check matters on longer drives; the tests force it with a tiny suit supply.

## Data we looked at but do not use live

- **MOLA** (global elevation, ~463 m/pixel): too coarse for a walk; we use 1 m HiRISE DTMs and keep MOLA for the "Where on Mars?" map.
- **Mars Climate Sounder** (MRO) column dust: reconstructed maps per sol (Montabone et al. 2020, JGR Planets, arXiv:1907.08187) and the
  multi-year climatology behind the Mars Climate Database dust scenarios (Montabone et al. 2015, Icarus 251). Our dust switch and the
  manual dust optical depth field stand in for it.
- **InSight Mars Weather Service API** (https://api.nasa.gov/, `insight_weather`): still answers, but its newest sol is 675 (October 2020) and
  the mission ended in December 2022. It is a third site (Elysium Planitia), so it is historical context only, not weather for Gale or Jezero.

## Proxies and honesty notes

- **Radiation at Jezero** uses Curiosity RAD measurements from **Gale Crater** (Hassler et al. 2014, ~0.64 mSv/day): no surface dosimeter has flown at Jezero. On the Gale dataset the value is measured in place.
- **Solar particle events** come from NASA CCMC DONKI, which mostly reports events seen near Earth: used as a proxy for Mars.
- **Weather** (MEDA) is archival: the latest public sol is from 2024, so the real conditions card says so and shows CAUTION.
- **Roughness** comes from a 1 m DTM, which cannot see boulders smaller than ~2 m, so slope does most of the blocking.
- **Gale thermal inertia**: no raster found yet, so `data/gale/terrain.json` has no thermal-inertia layer and the engine treats all of Gale as firm ground (no sand penalty).

## Changes

- 2026-11-15: BVAD cross-check; safe havens and supply caches (`options.havens`); pressurized-rover sorties with the walk-back limit (`js/rover.js`).

- 2026-11-14 16:30: line of sight to the habitat and a 6 h EVA limit (third budget).
- 2026-11-14 (afternoon): source audit by `codex-conditions` applied. Walking power 300 → **272 W** and working power 200 → **284 W** (Apollo EVA averages); every parameter now has a status and a link; the 20° limit is labelled a lunar proxy; the 1 mSv walk budget is labelled an educational allocation, not a NASA limit.
- 2026-11-14: max walkable slope 25° → **20°** (NASA exploration EVA concept, NTRS 20210000827). Dust storm and heavy kit no longer lower it further: 15° cut off half the demo stops. Added `profile`, `bestSubset`, `turnBackLatest` (dust-storm contingency) and the Go/No-Go thresholds (`goNoGo`).
