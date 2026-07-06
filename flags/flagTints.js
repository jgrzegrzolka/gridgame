/**
 * Dominant colour per flag — the single most prominent, saturated, bright
 * colour, sampled by rasterizing each flag and scoring buckets by
 * area x saturation x brightness (so a black or white band never wins over a
 * real colour; near-white flags fall back to a visible light grey). Used as
 * the cheap per-country fill while the map is panned/zoomed: a solid colour
 * costs the browser the same as the old flat grey (no image to decode), so
 * motion stays smooth, but the map reads as a colourful world instead of a
 * grey one. Full flags snap back on settle. Regenerate with the sampler in
 * PERF.md if the flag set changes.
 * @type {Readonly<Record<string, string>>}
 */
export const FLAG_TINTS = {
  ad: "#d0103a",  ae: "#ff0000",  af: "#d8d8d8",  ag: "#ce1126",  ai: "#012169",  al: "#ff0000",
  am: "#f2a800",  ao: "#ff0000",  arab: "#006233",  as: "#000066",  asean: "#0039a6",  at: "#c8102e",
  au: "#00008b",  aw: "#3399cc",  ax: "#0053a5",  az: "#00b9e4",  ba: "#ffcc00",  bb: "#00267f",
  bd: "#006a4e",  be: "#ffd90c",  bf: "#de0000",  bg: "#d62612",  bh: "#ce1126",  bi: "#cf0921",
  bj: "#ffd600",  bl: "#e1000f",  bm: "#ce142b",  bn: "#f7e017",  bo: "#ffe000",  bq: "#003087",
  br: "#229e45",  bs: "#08ced6",  bt: "#ffd520",  bv: "#d72828",  bw: "#00cbff",  by: "#ce1720",
  bz: "#003f87",  ca: "#d52b1e",  cc: "#008000",  cd: "#007fff",  cefta: "#003399",  cf: "#ffff00",
  cg: "#ffff00",  ch: "#ff0000",  ci: "#ff9a00",  ck: "#000066",  cl: "#d52b1e",  cm: "#fcd116",
  cn: "#ee1c25",  co: "#ffe800",  cp: "#e1000f",  cr: "#d90000",  cu: "#002a8f",  cv: "#081873",
  cw: "#002b7f",  cx: "#0021ad",  cy: "#d47600",  cz: "#d7141a",  de: "#ffcc00",  dj: "#00cc00",
  dk: "#c8102e",  dm: "#108c00",  do: "#ce1126",  dz: "#006233",  eac: "#0087ff",  ec: "#ffe800",
  ee: "#1791ff",  eg: "#ce1126",  eh: "#c4111b",  er: "#be0027",  es: "#f1bf00",  "es-ct": "#fcdd09",
  "es-ga": "#0099cc",  "es-pv": "#d52b1e",  et: "#ef2118",  eu: "#003399",  fi: "#002f6c",  fj: "#68bfe5",
  fk: "#012169",  fm: "#6797d6",  fo: "#d72828",  fr: "#e1000f",  ga: "#ffe700",  gb: "#c8102e",
  "gb-eng": "#ce1124",  "gb-nir": "#cc0000",  "gb-sct": "#0065bd",  "gb-wls": "#00ab39",  gd: "#ce1126",  ge: "#ff0000",
  gf: "#e1000f",  gg: "#e8112d",  gh: "#ce1126",  gi: "#da000c",  gl: "#d00c33",  gm: "#ff0000",
  gn: "#ff0000",  gp: "#e1000f",  gq: "#e32118",  gr: "#0d5eaf",  gs: "#000066",  gt: "#4997d0",
  gu: "#3b5aa3",  gw: "#fcd116",  gy: "#399408",  hk: "#ec1b2e",  hm: "#00008b",  hn: "#18c3df",
  hr: "#ff0000",  ht: "#d21034",  hu: "#d43516",  ic: "#0768a9",  id: "#e70011",  ie: "#ff7900",
  il: "#0038b8",  im: "#ba0000",  in: "#ff9933",  io: "#010163",  iq: "#ce1126",  ir: "#da0000",
  is: "#003897",  it: "#ce2b37",  je: "#cf142b",  jm: "#ffcc00",  jo: "#ff0000",  jp: "#bc002d",
  ke: "#bb0000",  kg: "#ff0000",  kh: "#032ea1",  ki: "#e73e2d",  km: "#ffff00",  kn: "#c70100",
  kp: "#c60000",  kr: "#cd2e3a",  kw: "#f31830",  ky: "#000066",  kz: "#00abc2",  la: "#cd1126",
  lb: "#ee161f",  lc: "#65cfff",  li: "#ce1126",  lk: "#ffb700",  lr: "#cc0000",  ls: "#00209f",
  lt: "#fdb913",  lu: "#00a1de",  lv: "#981e32",  ly: "#e70013",  ma: "#c1272d",  mc: "#f31830",
  md: "#de2110",  me: "#c40308",  mf: "#e1000f",  mg: "#fc3d32",  mh: "#3b5aa3",  mk: "#d20000",
  ml: "#ff0000",  mm: "#fecb00",  mn: "#da2032",  mo: "#00785e",  mp: "#0071bc",  mq: "#00a650",
  mr: "#006233",  ms: "#012169",  mt: "#cf142b",  mu: "#ffcd00",  mv: "#d21034",  mw: "#f41408",
  mx: "#ce1126",  my: "#cc0000",  mz: "#ffca00",  na: "#c70000",  nc: "#0035ad",  ne: "#e05206",
  nf: "#198200",  ng: "#008753",  ni: "#0067c6",  nl: "#ae1c28",  no: "#ed2939",  np: "#ce0000",
  nr: "#002170",  nu: "#fedd00",  nz: "#00247d",  om: "#ef2d29",  pa: "#db0000",  pc: "#003da5",
  pe: "#d91023",  pf: "#de2010",  pg: "#ff0000",  ph: "#ce1126",  pk: "#0c590b",  pl: "#dc143c",
  pm: "#e1000f",  pn: "#00247d",  pr: "#ed0000",  ps: "#ed2e38",  pt: "#ff0000",  pw: "#4aadd6",
  py: "#d52b1e",  qa: "#8d1b3d",  re: "#e1000f",  ro: "#ffde00",  rs: "#c6363c",  ru: "#d52b1e",
  rw: "#00a1de",  sa: "#165d31",  sb: "#0000d6",  sc: "#d92223",  sd: "#ff0000",  se: "#005293",
  sg: "#df0000",  sh: "#c8102e",  "sh-ac": "#012169",  "sh-hl": "#000066",  "sh-ta": "#012169",  si: "#d50000",
  sj: "#ef2b2d",  sk: "#ee1c25",  sl: "#00cd00",  sm: "#19b6ef",  sn: "#ffff00",  so: "#40a6ff",
  sr: "#b40a2d",  ss: "#0f47af",  st: "#12ad2b",  sv: "#0f47af",  sx: "#ed2939",  sy: "#007a3d",
  sz: "#3e5eb9",  tc: "#002868",  td: "#fecb00",  tf: "#002395",  tg: "#fee300",  th: "#a51931",
  tj: "#cc0000",  tk: "#00247d",  tl: "#cb000f",  tm: "#00843d",  tn: "#e70013",  to: "#c10000",
  tr: "#e30a17",  tt: "#e00000",  tv: "#009fca",  tw: "#ff0000",  tz: "#0099ff",  ua: "#ffd700",
  ug: "#ffe700",  um: "#bd3d44",  un: "#4b92db",  us: "#bd3d44",  uy: "#0038a8",  uz: "#0099b5",
  va: "#ffe000",  vc: "#f4f100",  ve: "#ffcc00",  vg: "#000066",  vi: "#d4ab35",  vn: "#da251d",
  vu: "#d21034",  wf: "#e1000f",  ws: "#ce1126",  xk: "#244aa5",  ye: "#f10600",  yt: "#e1000f",
  za: "#007847",  zm: "#198a00",  zw: "#ffd200",
};
