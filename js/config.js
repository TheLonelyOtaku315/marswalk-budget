// Every model number lives here. Nothing else in the app should hard-code physics.
//
// Each entry is tagged:
//   SOURCE      — a published value, with the citation next to it
//   PROXY       — a published value from Earth, the Moon or another Mars site, used here
//   ASSUMPTION  — our choice; the source next to it gives context, not the number
//   DESIGN      — a software or policy choice, not a physical constant
// Full audit: docs/model-sources.md. Summary table: docs/model.md.
//
// Owner: engine lane (louis-claude). Other lanes read this file but do not edit it.

export const CONFIG = {
  // ---------- Walking speed ----------
  // Tobler-style hiking function: v = vFlat * exp(-k * |grade + g0|) / exp(-k * g0)
  // grade = rise / run (dimensionless). Fastest at a gentle downhill of -g0.
  walk: {
    vFlatMps: 1.0, // ASSUMPTION: flat-ground walking speed. Lunar xEVA tests saw ~2 km/h (0.56 m/s) on level regolith; at 0.56 the normal Jezero walk goes over budget (docs/model.md, sensitivity). — Coan 2021, NTRS 20210000827 https://ntrs.nasa.gov/citations/20210000827
    toblerK: 3.5, // PROXY: Earth hiking-function exponent; transfer to a Mars suit is assumed. — Tobler 1993 https://escholarship.org/uc/item/05r820mz
    toblerG0: 0.05, // PROXY: Earth optimum downhill grade. — Tobler 1993 https://escholarship.org/uc/item/05r820mz
    maxSlopeDeg: 20, // PROXY: suited walking up to 20° in lunar xEVA tests; not a Mars flight rule. — Coan 2021, NTRS 20210000827 https://ntrs.nasa.gov/citations/20210000827
  },

  // ---------- Metabolic cost ----------
  metabolic: {
    baseW: 272, // PROXY: Apollo whole-EVA mean, 234 kcal/h = 272 W. Not a fitted Mars walking law. — NASA 1986 metabolism report (Apollo EVA data), NTRS 19930074290 https://ntrs.nasa.gov/api/citations/19930074290/downloads/19930074290.pdf
    uphillPerGrade: 3.0, // ASSUMPTION: linear uphill surcharge (+30% at 10% grade); measured graded walking is nonlinear. — Minetti et al. 2002 https://doi.org/10.1152/japplphysiol.01177.2001
    downhillPerGrade: 0.5, // ASSUMPTION: braking surcharge downhill; gentle downhill can be cheaper in reality. — Minetti et al. 2002 https://doi.org/10.1152/japplphysiol.01177.2001
    dwellW: 284, // PROXY: Apollo geology surveys and deployments, 244 kcal/h = 284 W. — NASA 1986 metabolism report (Apollo EVA data), NTRS 19930074290 https://ntrs.nasa.gov/api/citations/19930074290/downloads/19930074290.pdf
  },

  // ---------- Terrain firmness (from thermal inertia) ----------
  // Thermal inertia in J m^-2 K^-1 s^-1/2 ("tiu").
  terrain: {
    looseSandTI: 200, // ASSUMPTION: thermal-inertia breakpoint for loose fines; thermal units overlap. — Murphy et al. 2007 https://doi.org/10.1029/2005JE002586
    bedrockTI: 400, // ASSUMPTION: firm-ground proxy; inertia alone does not prove walkable bedrock. — Murphy et al. 2007 https://doi.org/10.1029/2005JE002586
    sandSpeedFactor: 0.6, // ASSUMPTION: speed on loose sand; Earth sand studies show more effort, not this factor. — Lejeune et al. 1998 https://doi.org/10.1242/jeb.201.13.2071
    sandMetabolicFactor: 1.4, // ASSUMPTION: power on loose sand; with the speed factor, sand costs ~2.3x per metre (Earth: 2.1-2.7x at matched speed). — Lejeune et al. 1998 https://doi.org/10.1242/jeb.201.13.2071
    // Roughness is 0..1 (0 = smooth, 1 = boulder field / cliff).
    roughnessBlock: 0.8, // ASSUMPTION: dataset-specific threshold on our DTM roughness index. — NASA 2017 EVA risk report, NTRS 20170002574 https://ntrs.nasa.gov/citations/20170002574
    roughnessSpeedPenalty: 0.5, // ASSUMPTION: dataset-specific speed penalty for roughness. — NASA 2017 EVA risk report, NTRS 20170002574 https://ntrs.nasa.gov/citations/20170002574
  },

  // ---------- Suit consumables ----------
  suit: {
    o2CapacityKg: 0.5, // PROXY: Shuttle/ISS EMU primary O2 is 1.2 lb (0.544 kg); rounded down. Mars suit hardware unknown. — Jeng et al. 2009, NTRS 20090013081 https://ntrs.nasa.gov/citations/20090013081
    reserveFraction: 0.2, // DESIGN: team reserve policy: 20% of the primary O2 is never planned. — Jeng et al. 2009, NTRS 20090013081 https://ntrs.nasa.gov/citations/20090013081
    o2JoulesPerLitre: 20100, // SOURCE: ~20.1 kJ per litre of O2 (indirect calorimetry, RQ about 0.85). — Weir 1949 https://doi.org/10.1113/jphysiol.1949.sp004363
    o2KgPerLitre: 0.001429, // SOURCE: O2 density 1.429 g/L at 0 °C and 1 atm. — NBS Circular 279 https://nvlpubs.nist.gov/nistpubs/Legacy/circ/nbscircular279.pdf
  },

  // ---------- EVA length and safety ----------
  eva: {
    maxHours: 6, // ASSUMPTION: planned EVA length including work and a margin; Artemis EVA timeline studies run on this scale. — Scoville et al., NTRS 20210026296 https://ntrs.nasa.gov/api/citations/20210026296/downloads/Scoville%20Final%20presentation%20-%20compressed.pptx.pdf
  },
  safety: {
    habitatAntennaM: 3, // DESIGN: height of the habitat antenna / observer for line of sight.
    astronautEyeM: 1.8, // DESIGN: suited astronaut's helmet height for line of sight. Artemis traverse plans weigh line of sight to the lander. — NTRS 20230012314 https://ntrs.nasa.gov/api/citations/20230012314/downloads/EarlyArtemisSurfaceNavigation_v1-ION23-XXX-v3.docx
  },

  // ---------- Radiation ----------
  radiation: {
    // SOURCE: Hassler et al. (2014), Science 343, Curiosity RAD at Gale Crater:
    // dose equivalent ~0.64 mSv/day on the surface. Used as a Mars-surface proxy for Jezero.
    surfaceMSvPerDay: 0.64,
    walkLimitMSv: 1.0, // DESIGN: educational per-walk allocation, not a NASA exposure limit. — NASA-STD-3001 Vol. 1, 4.8 https://www.nasa.gov/reference/4-0-human-performance/
  },

  // ---------- Conditions the astronaut can toggle ----------
  conditions: {
    dustStorm: {
      speedFactor: 0.7, // ASSUMPTION: visibility scenario; no measured link to suited walking speed. — NASA Mars environment handbook, NTRS 20010046858 https://ntrs.nasa.gov/citations/20010046858
      metabolicFactor: 1.1, // ASSUMPTION: scenario factor. — NASA 2017 EVA risk report, NTRS 20170002574 https://ntrs.nasa.gov/citations/20170002574
      maxSlopeDeg: 20, // DESIGN: same as the suit limit; 15° cut off half the demo stops. — Coan 2021, NTRS 20210000827 https://ntrs.nasa.gov/citations/20210000827
    },
    solarEvent: {
      doseFactor: 10, // ASSUMPTION: stress-test multiplier, not a typical event; real events vary with spectrum and shielding. — Hassler et al. 2018 https://doi.org/10.1029/2018SW001959
    },
    heavyKit: {
      speedFactor: 0.85, // ASSUMPTION: load carriage slows walking; kit mass not specified. — Pandolf et al. 1977 https://doi.org/10.1152/jappl.1977.43.4.577
      metabolicFactor: 1.25, // ASSUMPTION: load carriage raises power; kit mass not specified. — Pandolf et al. 1977 https://doi.org/10.1152/jappl.1977.43.4.577
      maxSlopeDeg: 20, // DESIGN: same as the suit limit. — Coan 2021, NTRS 20210000827 https://ntrs.nasa.gov/citations/20210000827
    },
  },

  // ---------- Planner ----------
  planner: {
    bruteForceMaxStops: 7, // DESIGN: exact best order up to this many stops; heuristic above.
    subsetExactMaxStops: 10, // DESIGN: bestSubset tries every subset up to this many stops; greedy above.
    // turnBackLatest assumes these conditions could start at any moment of the walk.
    contingency: ['dustStorm'], // DESIGN: stress scenario for turnBackLatest: a dust storm starting mid-walk. — NASA Mars environment handbook, NTRS 20010046858 https://ntrs.nasa.gov/citations/20010046858
  },

  // ---------- Go/No-Go thresholds (read by js/conditions.js) ----------
  goNoGo: {
    dustTauStorm: 1.0, // DESIGN: team alert threshold on dust optical depth; not an EVA rule. — NASA Mars environment handbook, NTRS 20010046858 https://ntrs.nasa.gov/citations/20010046858
    o2MarginCaution: 0.10, // DESIGN: team UI policy: CAUTION under 10% usable O2 left. — Jeng et al. 2009, NTRS 20090013081 https://ntrs.nasa.gov/citations/20090013081
    doseCautionFraction: 0.8, // DESIGN: team UI policy: CAUTION above 80% of the walk allocation. — NASA-STD-3001 Vol. 1, 4.8 https://www.nasa.gov/reference/4-0-human-performance/
    sepAlertDays: 2, // DESIGN: Earth-catalogue recency policy; not a Mars all-clear. — NASA CCMC DONKI https://ccmc.gsfc.nasa.gov/tools/DONKI/
    sepWatchDays: 7, // DESIGN: Earth-catalogue recency policy. — NASA CCMC DONKI https://ccmc.gsfc.nasa.gov/tools/DONKI/
  },

  // ---------- Route options (js/routes.js) ----------
  // Paths and order are chosen with these preferences; time, O2 and dose are always measured with
  // the real model above, so the three options compare fairly.
  routeModes: {
    safe: {
      maxSlopeDeg: [15, 18], // DESIGN: avoid ground over 15°, relaxed to 18° then the suit limit if a stop becomes unreachable.
      gradeCostFactor: 3, // DESIGN: uphill and downhill surcharges x3, so the route prefers gentle ground.
      sandMetabolicFactor: 2.5, // DESIGN: treat loose sand as much costlier than the walking model does.
      roughnessSpeedPenalty: 0.9, // DESIGN: steer around rough ground.
    },
    short: {}, // DESIGN: every metre costs the same, so the path is the shortest walkable one.
  },
};
