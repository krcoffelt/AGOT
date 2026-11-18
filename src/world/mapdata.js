// Westeros map data. Map coordinates: x 0..100 (west→east), y 0..200 (north→south).
// One map unit = 400 m. World: X east, Z south, Y up. Sea level = 0.
//
// The game world is one square REGION of that map, not the whole continent: King's Landing, Blackwater Bay, Dragonstone and
// the Crownlands round them (with Harrenhal, Duskendale, Storm's End and Tarth). Narrowing it lets the same texture budget
// carry about three times the terrain detail. The land fades into open sea within EDGE map units of the region's border,
// and the dragon is turned back before it gets there. Everything is still authored in whole-map coordinates below.
export const REGION = { x0: 46, x1: 98, y0: 104, y1: 156, EDGE: 2.2 };
export const MAP = {
  W: (REGION.x1 - REGION.x0) * 400, H: (REGION.y1 - REGION.y0) * 400, UNIT: 400,
  TEX_W: 3072, TEX_H: 3072,      // final heightmap (~6.8 m / texel)
  MASK_W: 1536, MASK_H: 1536,    // authored masks (~13.5 m / texel)
  PX_SCALE: (40000 / 1024) / ((REGION.x1 - REGION.x0) * 400 / 1536),      // how much finer a mask pixel is than on the whole-continent map
};
const CX = (REGION.x0 + REGION.x1) / 2, CY = (REGION.y0 + REGION.y1) / 2;
export const toWorld = (x, y) => [(x - CX) * MAP.UNIT, (y - CY) * MAP.UNIT];
export const toMap = (wx, wz) => [wx / MAP.UNIT + CX, wz / MAP.UNIT + CY];
// 0 at the top of the continent (beyond the Wall) → 1 at Dorne's south coast: drives climate (snow, trees, weather)
export const mapLat = (wz) => (wz / MAP.UNIT + CY) / 200;
export const inRegion = (x, y, m = 0) => x > REGION.x0 + m && x < REGION.x1 - m && y > REGION.y0 + m && y < REGION.y1 - m;

// ---------------------------------------------------------------- coastline
export const MAINLAND = [
  // far north ice coast (west → east)
  [22, 6], [30, 4.5], [42, 5.5], [55, 4.5], [66, 6], [72, 10],
  // east coast beyond the Wall, Storrold's Point
  [71, 14], [73, 17], [80, 17], [88, 18.5], [90.5, 20.5], [85, 23], [77, 24], [72.5, 25.5], [70, 28], [69.3, 31],
  // Bay of Seals → Karhold
  [70, 34], [73, 37], [77, 39.5], [82, 42], [85.5, 45.5], [84, 49], [79.5, 48.5], [75.5, 50.5], [73, 54],
  // Widow's Watch, Ramsgate, the Bite
  [74, 58], [77, 61], [82.5, 63.5], [84.5, 65.5], [80, 67.5], [75.5, 66.5], [72.5, 68.5], [70.5, 70],
  [67, 71.5], [63.5, 73.2], [60.5, 74.2], [58.5, 77], [57.2, 81], [58, 84.5],
  // the Fingers
  [60.5, 86.6], [64, 86.6], [68.5, 84.4], [74.5, 81.2], [76.3, 82.4], [71.5, 86], [69.5, 88.2],
  [74.5, 87.2], [80.2, 85.2], [81.6, 87], [76.5, 90], [73.5, 91.6],
  [79.2, 91.2], [84.5, 90], [85.8, 92], [80.8, 94.2], [78.5, 95.6],
  // Vale east coast, Gulltown
  [82.5, 97.5], [85.3, 100.5], [86.3, 104], [90.2, 106], [92.2, 108.2], [88.6, 110.2], [84.5, 109.4],
  // Bay of Crabs
  [80, 109.6], [75, 110.6], [70.5, 111.6], [66.6, 112.2], [65.4, 113.4], [68, 115], [73, 116],
  // Crackclaw Point
  [78, 116], [83.4, 117], [85.4, 119.2], [81.4, 121.2], [76.2, 121.4], [72.4, 122.2],
  // Blackwater Bay, King's Landing
  [69.6, 124.2], [67.6, 127], [66.6, 130.2], [66.9, 132.6], [66.4, 133.5], [68.6, 134.6], [72, 134.4],
  // Massey's Hook
  [76, 132.4], [80, 131], [81.4, 133], [77.6, 136], [74.6, 138],
  // Shipbreaker Bay, Storm's End, Cape Wrath
  [72.6, 141], [71.6, 144.5], [72.6, 147], [74.6, 149], [78.4, 150.6], [82.4, 152.4], [84.4, 155.4],
  [80.4, 157.6], [75, 156.8], [70, 156.6],
  // Sea of Dorne
  [64.4, 157.4], [60.6, 158.6], [63.4, 161.4], [68, 162.4], [74, 163.2], [80, 164.2], [86, 165.2],
  // Broken Arm, Sunspear
  [91.2, 166], [94.4, 167.4], [93.4, 170.2], [91, 171.6], [88.6, 174.4],
  // Dorne south coast
  [84.6, 177.2], [78, 180.4], [70, 182.4], [62, 183.2], [54, 182.4], [47, 180.4], [41.6, 177.6], [38.6, 175.6], [36.4, 172.6],
  // Whispering Sound, Oldtown
  [33.4, 173.4], [30.4, 176.2], [27.2, 178.2], [25, 175.4], [26.6, 171.8], [27.9, 169.6], [27.2, 168.3], [25, 168.6], [22.8, 170.2], [21, 167],
  // west coast north to Lannisport
  [21, 162], [22, 157], [23, 152.6], [22.4, 147.6], [23, 142.6], [24, 137.6], [23, 132.6], [22.2, 127.6],
  [22.8, 123.8], [21.2, 121.4], [21, 117.6], [22, 113.6], [24, 109.6], [25, 105.6], [26, 101.4],
  // Ironman's Bay
  [30, 99.2], [35, 98.4], [39, 97.4], [41.4, 95.4], [42.6, 92.2], [40.6, 89.2], [36.6, 88],
  // Cape Kraken, Blazewater Bay, Saltspear
  [31.6, 87.6], [26.6, 88.8], [23.2, 88.2], [23.8, 86], [28, 84.6], [32, 83.6], [36, 82.4], [40, 81.8], [43, 80.6],
  [41.6, 78.6], [37.4, 78.8], [33, 78],
  // Stony Shore, the Rills, Sea Dragon Point
  [28, 77], [24, 75], [21, 72], [20, 68], [22, 64], [24, 61], [23, 57.4],
  [19.4, 55.4], [17, 52.4], [19, 49.4], [23, 49.2], [26, 47.2],
  // Bay of Ice, west end of the Wall
  [27.4, 44.4], [29.4, 41.2], [31.2, 38.2], [29.6, 35.2], [27.6, 33.2], [27, 31],
  // Frozen Shore
  [25, 28], [20, 26], [16, 23], [15, 19], [18, 14.6], [20, 10],
];

// islands: c center, r radii, rot degrees, seed for wobble
export const ISLANDS = [
  { name: 'Bear Island', c: [22, 38.2], r: [2.3, 1.5], rot: 20, seed: 1 },
  { name: 'Skagos', c: [85, 33], r: [2.6, 4.0], rot: -15, seed: 2 },
  { name: 'Skane', c: [80.5, 28.6], r: [0.9, 0.7], rot: 0, seed: 3 },
  { name: 'Great Wyk', c: [27.6, 93], r: [2.2, 1.5], rot: 10, seed: 4 },
  { name: 'Old Wyk', c: [24.3, 91.6], r: [1.0, 0.9], rot: 0, seed: 5 },
  { name: 'Harlaw', c: [33.2, 93.6], r: [1.5, 1.8], rot: 0, seed: 6 },
  { name: 'Orkmont', c: [30.6, 90.8], r: [1.2, 0.8], rot: 30, seed: 7 },
  { name: 'Pyke', c: [30.2, 96.2], r: [1.7, 0.85], rot: -12, seed: 8 },
  { name: 'Saltcliffe', c: [26.6, 96.2], r: [0.8, 0.6], rot: 0, seed: 9 },
  { name: 'Blacktyde', c: [34.4, 90.4], r: [0.8, 0.6], rot: 0, seed: 10 },
  { name: 'Fair Isle', c: [18.2, 116], r: [1.2, 2.2], rot: 8, seed: 11 },
  { name: 'Dragonstone', c: [87.2, 125.2], r: [2.1, 1.7], rot: 25, seed: 12 },
  { name: 'Driftmark', c: [80.6, 126.4], r: [1.9, 1.0], rot: -10, seed: 13 },
  { name: 'Claw Isle', c: [88.4, 119.6], r: [0.8, 0.6], rot: 0, seed: 14 },
  { name: 'Tarth', c: [83.4, 141.4], r: [1.5, 3.0], rot: -8, seed: 15 },
  { name: 'Estermont', c: [88.6, 152.6], r: [1.6, 1.2], rot: 0, seed: 16 },
  { name: 'Bloodstone', c: [97.2, 166.4], r: [1.0, 0.7], rot: 30, seed: 17 },
  { name: 'Grey Gallows', c: [98.2, 169.6], r: [0.7, 0.9], rot: 0, seed: 18 },
  { name: 'Stepstone', c: [96.4, 172.6], r: [0.8, 0.6], rot: 0, seed: 19 },
  { name: 'The Arbor', c: [17.4, 177.4], r: [3.2, 1.7], rot: -8, seed: 20 },
  { name: 'Greenshield', c: [20, 149], r: [0.7, 0.55], rot: 0, seed: 21 },
  { name: 'Greyshield', c: [19.4, 151.6], r: [0.6, 0.6], rot: 0, seed: 22 },
  { name: 'Southshield', c: [20.4, 153.8], r: [0.6, 0.5], rot: 0, seed: 23 },
  { name: 'Oakenshield', c: [19, 146.8], r: [0.6, 0.6], rot: 0, seed: 24 },
  { name: 'Battle Isle', c: [27.0, 170.5], r: [0.42, 0.42], rot: 0, seed: 25 },
  { name: 'Isle of Faces', c: [58.3, 121.3], r: [0.55, 0.5], rot: 0, seed: 26, inLake: true },
];

export const LAKES = [
  { name: "Gods Eye", c: [58, 121], r: [2.5, 2.7], rot: 10, seed: 31 },
  { name: 'Long Lake', c: [58, 44.5], r: [1.1, 2.6], rot: 12, seed: 32 },
  { name: 'Ironwood mere', c: [44, 20], r: [1.3, 0.8], rot: 0, seed: 33 },
];

// ------------------------------------------------------------- mountains
// pts polyline, w width (map units), s strength 0..1 (relative height)
export const MOUNTAINS = [
  { pts: [[24, 8], [25, 14], [26, 20], [27.5, 27]], w: 5.5, s: 1.0 },         // Frostfangs
  { pts: [[26, 9], [31, 9], [36, 7]], w: 4, s: 0.8 },
  { pts: [[42, 6.5], [52, 6], [62, 7.5]], w: 3, s: 0.55 },                    // Land of Always Winter
  { pts: [[33, 34], [36, 40], [38.5, 46], [39.5, 52]], w: 4, s: 0.72 },       // northern mountains
  { pts: [[66, 40], [70, 46]], w: 2.6, s: 0.32 },                             // Lonely Hills
  { pts: [[84.5, 30.5], [85.5, 35.5]], w: 2.0, s: 0.5 },                      // Skagos
  { pts: [[66, 60], [70, 64]], w: 2.2, s: 0.22 },                             // Sheepshead Hills
  { pts: [[34, 66], [40, 70]], w: 3, s: 0.1 },                                // Barrowlands
  { pts: [[61, 89.5], [66, 94], [72, 98], [78, 102], [82.5, 105]], w: 6, s: 0.95 }, // Mountains of the Moon
  { pts: [[64, 97], [65.5, 104], [69, 108.5]], w: 3.6, s: 0.7 },
  { pts: [[66, 86.8], [74, 82.6]], w: 1.3, s: 0.4 },
  { pts: [[71, 89.2], [79.5, 86.6]], w: 1.3, s: 0.4 },
  { pts: [[76.5, 93], [83.5, 91.4]], w: 1.3, s: 0.4 },
  { pts: [[27.5, 103], [30, 110], [33, 116], [34.5, 123], [33.5, 130]], w: 4.2, s: 0.5 }, // Westerlands
  { pts: [[23.5, 118], [25, 122]], w: 1.6, s: 0.3 },
  { pts: [[37.5, 170.5], [44, 165.5], [52, 161.5], [60, 160.4]], w: 4.2, s: 0.8 }, // Red Mountains
  { pts: [[52, 161.5], [58, 155.5], [62, 152.5]], w: 2.6, s: 0.5 },
  { pts: [[60, 160.4], [68, 163.6], [76, 165]], w: 2.0, s: 0.36 },
  { pts: [[72, 118.4], [82, 118.8]], w: 1.6, s: 0.22 },                       // Crackclaw
  { pts: [[34, 163], [38, 168]], w: 2.2, s: 0.28 },                           // Horn Hill
  { pts: [[72, 152.6], [80, 153.6]], w: 2.2, s: 0.2 },                        // Cape Wrath
  { pts: [[27, 92.8], [28.4, 93.4]], w: 1.4, s: 0.3 },                        // Iron Islands
  { pts: [[29.4, 96.3], [31, 96.1]], w: 0.9, s: 0.3 },
  { pts: [[33, 93], [33.4, 94.4]], w: 1.0, s: 0.25 },
  { pts: [[83.2, 140], [83.6, 143]], w: 1.2, s: 0.25 },                       // Tarth
  { pts: [[18, 14], [17, 20]], w: 2, s: 0.4 },
];

// gentle hills mask
export const HILLS = [
  { c: [45, 62], r: [14, 10], s: 0.35 },   // the North rolling
  { c: [32, 70], r: [8, 5], s: 0.5 },      // Rills / Barrowlands
  { c: [62, 62], r: [8, 7], s: 0.5 },
  { c: [50, 20], r: [18, 8], s: 0.45 },    // beyond the Wall
  { c: [50, 112], r: [10, 8], s: 0.25 },   // Riverlands
  { c: [68, 150], r: [8, 6], s: 0.6 },     // Stormlands
  { c: [28, 126], r: [5, 9], s: 0.6 },     // Westerlands
  { c: [36, 156], r: [10, 10], s: 0.2 },   // the Reach
  { c: [66, 172], r: [20, 8], s: 0.5 },    // Dorne dunes
  { c: [72, 104], r: [6, 4], s: 0.3 },
];

// ---------------------------------------------------------------- rivers
export const RIVERS = [
  // the last five points lead the river down the west side of White Harbor's walls (the town stands on its east bank)
  { name: 'White Knife', pts: [[58.2, 47], [57.4, 52], [58, 58], [60, 64], [60.45, 69.8], [60.4, 71.05], [60.4, 72.3], [60.5, 73.5], [60.7, 74.55]], w: 1.0 },
  { name: 'Last River', pts: [[53, 36.5], [59, 39.5], [66, 43.5], [72, 48], [75.4, 50.6]], w: 0.8 },
  { name: 'Milkwater', pts: [[31, 12], [32.4, 18], [31.6, 24], [29, 29.6], [27.6, 32.6]], w: 0.8 },
  { name: 'Antler', pts: [[47, 13], [54, 18], [62, 22.4], [69, 26.6], [70.2, 28]], w: 0.8 },
  { name: 'Fever', pts: [[47.4, 79.2], [44.6, 80.2], [43, 80.6]], w: 0.9 },
  { name: 'Green Fork', pts: [[50.6, 85], [48.6, 90], [47, 95], [48.6, 101], [52.4, 107], [57, 112.4]], w: 1.1 },
  { name: 'Blue Fork', pts: [[43.4, 100.6], [47.6, 104.6], [52.6, 109], [57, 112.4]], w: 0.8 },
  { name: 'Tumblestone', pts: [[33.6, 106.4], [37.4, 108.6], [41, 110.6]], w: 0.8 },
  { name: 'Red Fork', pts: [[35.6, 118.4], [38.4, 114], [41, 110.6], [46, 111.2], [51.6, 112.6], [57, 112.4]], w: 1.1 },
  { name: 'Trident', pts: [[57, 112.4], [61, 113.2], [65.6, 113.2]], w: 1.5 },
  { name: 'Gods Eye River', pts: [[59, 123.4], [60.6, 127.4], [62.4, 131.6], [63, 133.4]], w: 0.8 },
  { name: 'Blackwater Rush', pts: [[38, 129.4], [45, 131.2], [52, 132.6], [59, 133.5], [63, 133.6], [66.5, 133.4]], w: 1.5 },
  { name: 'Mander', pts: [[52, 140.4], [46, 144.4], [40, 148.4], [34, 151.8], [28, 151.6], [23.2, 151.8]], w: 1.5 },
  // the last five points lead the river round the east and south of Oldtown's walls to its mouth by Battle Isle
  { name: 'Honeywine', pts: [[36, 160.4], [32.4, 164.8], [30.45, 167.2], [30.25, 168.35], [29.5, 169.2], [28.45, 169.6], [27.6, 169.9]], w: 1.0 },
  { name: 'Greenblood', pts: [[62, 170.4], [70, 172.4], [78, 174.2], [85.2, 176.4]], w: 1.1 },
  { name: 'Torentine', pts: [[40.4, 166.4], [39.2, 171], [38.8, 175.4]], w: 0.8 },
  { name: 'Wendwater', pts: [[62, 139], [66, 137], [70, 135.6], [72, 134.6]], w: 0.7 },
  { name: 'Weeping Water', pts: [[64, 50], [68, 52.4], [73, 54.2]], w: 0.7 },
];

// ---------------------------------------------------------------- biomes
export const FORESTS = [
  { poly: [[31, 9], [68, 8], [72, 25], [67, 29.4], [31, 29.4], [29, 20]], d: 0.9 },   // Haunted Forest
  { c: [33.5, 50], r: [8.5, 6.5], d: 1.0 },      // Wolfswood
  { c: [42, 55], r: [5, 4], d: 0.85 },
  { c: [66, 56.5], r: [5.5, 4.5], d: 0.8 },      // Hornwood
  { c: [56, 35.5], r: [10, 2.6], d: 0.45 },      // the Gift
  { c: [49.5, 84], r: [5.5, 5], d: 0.55 },       // the Neck
  { c: [45, 105.5], r: [3, 2.6], d: 0.8 },       // Whispering Wood
  { c: [52, 118], r: [3.6, 3], d: 0.7 },
  { c: [68.5, 106], r: [3.6, 2.6], d: 0.75 },    // Vale
  { c: [74, 100], r: [5, 3], d: 0.4 },
  { c: [68.5, 138.6], r: [5.6, 4.2], d: 1.0 },   // Kingswood
  { c: [76.5, 153.4], r: [6, 2.8], d: 1.0 },     // Rainwood
  { c: [27.5, 129], r: [3, 4], d: 0.7 },
  { c: [30, 110], r: [3, 5], d: 0.45 },
  { c: [78, 118.8], r: [6, 1.8], d: 0.75 },      // Crackclaw
  { c: [36, 152], r: [11, 10], d: 0.16 },        // the Reach, scattered
  { c: [52, 110], r: [10, 8], d: 0.18 },         // Riverlands, scattered
  { c: [48, 66], r: [14, 10], d: 0.2 },          // the North, scattered
  { c: [83.4, 141.4], r: [1.2, 2.6], d: 0.7 },   // Tarth
  { c: [22, 38.2], r: [1.8, 1.1], d: 0.8 },      // Bear Island
  { c: [58.3, 121.3], r: [0.5, 0.45], d: 1.0 },  // Isle of Faces
  { c: [62, 146], r: [6, 5], d: 0.35 },          // Stormlands
  { c: [17.4, 177.4], r: [2.4, 1.1], d: 0.3 },   // Arbor
];
export const DESERT = [
  { poly: [[38, 172], [46, 166], [58, 162.4], [70, 163.4], [94, 166], [93, 177], [72, 184], [50, 184], [40, 179]], d: 1.0 },
  { c: [97, 169], r: [3, 5], d: 0.8 },
];
export const SWAMP = [{ c: [49.5, 83.5], r: [7, 5.5], d: 1.0 }];
export const FARMS = [
  { c: [35, 152], r: [11, 8], d: 1.0 },      // the Reach
  { c: [28, 160], r: [5, 6], d: 0.8 },
  { c: [50, 112], r: [8, 5.5], d: 0.8 },     // Riverlands
  { c: [61.6, 128.4], r: [4, 3.2], d: 0.9 }, // Crownlands
  { c: [26, 120], r: [3, 5], d: 0.6 },       // Westerlands
  { c: [74.5, 104.6], r: [3.2, 2], d: 0.7 }, // Vale of Arryn
  { c: [60, 70.5], r: [3, 2], d: 0.5 },      // White Harbor
  { c: [69, 143], r: [2.5, 3], d: 0.4 },
  { c: [17.4, 177.4], r: [2.8, 1.3], d: 0.8 }, // Arbor vineyards
];

// the Wall (west → east)
export const WALL = [[27.3, 31.2], [32, 30.9], [38, 31.3], [44, 31.0], [48, 31.2], [54, 30.9], [60, 31.2], [65, 30.9], [69.2, 31.1]];

// -------------------------------------------------------------- landmarks
// r: site pad radius (m). minH: minimum pad height. kind selects the builder.
const ALL_LANDMARKS = [
  { id: 'kingslanding', name: "King's Landing", sub: 'Capital of the Seven Kingdoms', region: 'The Crownlands', pos: [65.25, 130.5], r: 700, minH: 14, kind: 'kingslanding', major: true },
  { id: 'winterfell', name: 'Winterfell', sub: 'Seat of House Stark', region: 'The North', pos: [47, 58], r: 420, minH: 60, kind: 'winterfell', major: true },
  { id: 'castleblack', name: 'Castle Black', sub: "The Night's Watch", region: 'The Wall', pos: [48, 31.75], r: 220, minH: 40, kind: 'castleblack', major: true },
  { id: 'dragonstone', name: 'Dragonstone', sub: 'Ancestral seat of House Targaryen', region: 'Blackwater Bay', pos: [86.5, 124.7], r: 340, minH: 90, kind: 'dragonstone', major: true },
  { id: 'eyrie', name: 'The Eyrie', sub: 'Seat of House Arryn', region: 'The Vale', pos: [70, 101], r: 120, minH: 0, kind: 'eyrie', major: true },
  { id: 'casterlyrock', name: 'Casterly Rock', sub: 'Seat of House Lannister', region: 'The Westerlands', pos: [21.9, 120.6], r: 330, minH: 0, kind: 'casterlyrock', major: true },
  { id: 'harrenhal', name: 'Harrenhal', sub: "Harren the Black's folly", region: 'The Riverlands', pos: [59.3, 117.3], r: 430, minH: 14, kind: 'harrenhal', major: true },
  { id: 'stormsend', name: "Storm's End", sub: 'Seat of House Baratheon', region: 'The Stormlands', pos: [72.95, 146.2], r: 300, minH: 70, kind: 'stormsend', major: true },
  { id: 'highgarden', name: 'Highgarden', sub: 'Seat of House Tyrell', region: 'The Reach', pos: [34, 150.2], r: 420, minH: 40, kind: 'highgarden', major: true },
  { id: 'sunspear', name: 'Sunspear', sub: 'Seat of House Martell', region: 'Dorne', pos: [91.2, 170.8], r: 380, minH: 12, kind: 'sunspear', major: true },
  { id: 'pyke', name: 'Pyke', sub: 'Seat of House Greyjoy', region: 'The Iron Islands', pos: [30.3, 96.9], r: 200, minH: 0, kind: 'pyke', major: true },
  { id: 'oldtown', name: 'Oldtown', sub: 'The Hightower and the Citadel', region: 'The Reach', pos: [28.5, 167.6], r: 520, minH: 10, kind: 'oldtown', major: true },
  { id: 'riverrun', name: 'Riverrun', sub: 'Seat of House Tully', region: 'The Riverlands', pos: [41.3, 110.0], r: 240, minH: 8, kind: 'riverrun', major: true },
  { id: 'twins', name: 'The Twins', sub: 'Seat of House Frey', region: 'The Riverlands', pos: [47, 95], r: 300, minH: 8, kind: 'twins', major: true },
  { id: 'moatcailin', name: 'Moat Cailin', sub: 'Gateway to the North', region: 'The Neck', pos: [50.4, 83.2], r: 220, minH: 8, kind: 'moatcailin' },
  { id: 'whiteharbor', name: 'White Harbor', sub: 'Seat of House Manderly', region: 'The North', pos: [62.0, 72.3], r: 420, minH: 12, kind: 'town', style: 'white' },
  { id: 'lannisport', name: 'Lannisport', sub: 'Golden city of the west', region: 'The Westerlands', pos: [23.6, 123.6], r: 420, minH: 10, kind: 'town', style: 'gold' },
  { id: 'gulltown', name: 'Gulltown', sub: 'Port of the Vale', region: 'The Vale', pos: [87.6, 108.4], r: 340, minH: 10, kind: 'town', style: 'grey' },
  { id: 'dreadfort', name: 'The Dreadfort', sub: 'Seat of House Bolton', region: 'The North', pos: [70, 52.6], r: 240, minH: 40, kind: 'castle', style: 'dread' },
  { id: 'karhold', name: 'Karhold', sub: 'Seat of House Karstark', region: 'The North', pos: [81.4, 45.4], r: 220, minH: 30, kind: 'castle', style: 'north' },
  { id: 'lasthearth', name: 'Last Hearth', sub: 'Seat of House Umber', region: 'The North', pos: [60.4, 38.6], r: 200, minH: 40, kind: 'castle', style: 'north' },
  { id: 'deepwood', name: 'Deepwood Motte', sub: 'Seat of House Glover', region: 'The North', pos: [28, 46.6], r: 180, minH: 30, kind: 'castle', style: 'wood' },
  { id: 'eastwatch', name: 'Eastwatch-by-the-Sea', sub: "The Night's Watch", region: 'The Wall', pos: [68.6, 31.8], r: 170, minH: 12, kind: 'castle', style: 'watch' },
  { id: 'shadowtower', name: 'The Shadow Tower', sub: "The Night's Watch", region: 'The Wall', pos: [28.6, 31.9], r: 160, minH: 40, kind: 'castle', style: 'watch' },
  { id: 'seagard', name: 'Seagard', sub: 'Seat of House Mallister', region: 'The Riverlands', pos: [43.4, 93.2], r: 220, minH: 14, kind: 'castle', style: 'river' },
  { id: 'starfall', name: 'Starfall', sub: 'Seat of House Dayne', region: 'Dorne', pos: [38.9, 174.2], r: 200, minH: 20, kind: 'castle', style: 'pale' },
  { id: 'evenfall', name: 'Evenfall Hall', sub: 'Seat of House Tarth', region: 'The Stormlands', pos: [82.9, 141.2], r: 190, minH: 40, kind: 'castle', style: 'pale' },
  { id: 'duskendale', name: 'Duskendale', sub: 'Port of the Crownlands', region: 'The Crownlands', pos: [70.3, 123.0], r: 260, minH: 12, kind: 'town', style: 'grey' },
  { id: 'hardhome', name: 'Hardhome', sub: 'Ruined wildling haven', region: 'Beyond the Wall', pos: [86.4, 20.8], r: 200, minH: 8, kind: 'ruin' },
  { id: 'fist', name: 'Fist of the First Men', sub: 'Ancient ringfort', region: 'Beyond the Wall', pos: [36, 17], r: 200, minH: 0, kind: 'fist' },
];

// only what stands inside the playable region (clear of the faded border) is built; within it every seat is a fast-travel stop
export const LANDMARKS = ALL_LANDMARKS.filter((l) => inRegion(l.pos[0], l.pos[1], REGION.EDGE + 1)).map((l) => ({ ...l, major: true }));

// villages and holdfasts: [name, x, y]. Built where the ground allows; skipped if the spot turns out to be water or cliff.
export const VILLAGES = ALL_VILLAGES().filter(([, x, y]) => inRegion(x, y, REGION.EDGE + 1));
function ALL_VILLAGES() { return [
  ["Mole's Town", 48.7, 33.9], ['Queenscrown', 53.4, 35.4], ['Whitetree', 41, 22.5], ['Cerwyn', 48.6, 62.2], ["Torrhen's Square", 33, 62.4], ['Barrowton', 36, 70.6], ['Hornwood', 67, 58.4],
  ['Fairmarket', 49.6, 104.2], ["Lord Harroway's Town", 58.2, 111.2], ['Darry', 60.6, 115.2], ['Stoney Sept', 43, 122.4], ['Pennytree', 46.2, 114.8], ['Raventree', 47.4, 107.4], ['Saltpans', 64, 111.9], ['Maidenpool', 70.4, 114.2],
  ['Rosby', 67.2, 126.4], ["Sow's Horn", 61.6, 125.4], ["Tumbler's Falls", 55, 131.4], ['Hayford', 61.4, 128.9],
  ['Bitterbridge', 46.2, 143.4], ['Longtable', 41.2, 146.4], ['Cider Hall', 38.6, 148.2], ['Ashford', 43.2, 153.4], ['Goldengrove', 30.4, 145.2], ['Tumbleton', 50.2, 138.6], ['Grassy Vale', 48.4, 147.6], ['Horn Hill', 36.2, 164.4], ['Brightwater', 31.6, 161.6],
  ['Oxcross', 25.6, 118.2], ['Sarsfield', 27.2, 113.6], ['Cornfield', 27, 126.4],
  ['Bronzegate', 69.6, 141.2], ['Felwood', 67.4, 144.4], ['Summerhall', 61.6, 152.2], ["Griffin's Roost", 74.6, 151.6],
  ['Ironoaks', 76.2, 98.8], ['Redfort', 74.4, 105.2], ['Runestone', 84.2, 103.6],
  ['Planky Town', 85.2, 174.9], ['Godsgrace', 74.2, 172.8], ['Lemonwood', 88.4, 172.8], ['Yronwood', 58.6, 163.4], ['Hellholt', 56.4, 174.2], ['Vaith', 66.4, 174.6],
]; }

// named regions for HUD (first match wins; fallbacks by latitude)
export const REGIONS = [
  { name: 'Beyond the Wall', test: (x, y) => y < 30.6 },
  { name: 'The Iron Islands', test: (x, y) => x > 23 && x < 36 && y > 89 && y < 98 },
  { name: 'The North', test: (x, y) => y < 79 },
  { name: 'The Neck', test: (x, y) => y < 89 && x > 40 && x < 59 },
  { name: 'The North', test: (x, y) => y < 89 && x <= 40 },
  { name: 'The Vale of Arryn', test: (x, y) => y < 111 && x > 60 },
  { name: 'Dorne', test: (x, y) => (y > 161 && x > 46) || (y > 158.6 && x > 60) || (y > 166 && x > 37) },
  { name: 'The Stormlands', test: (x, y) => y > 134.5 && x > 58 },
  { name: 'The Crownlands', test: (x, y) => y > 111 && y <= 137 && x > 60 },
  { name: 'The Westerlands', test: (x, y) => y > 99 && y < 134 && x < 36 },
  { name: 'The Reach', test: (x, y) => y >= 134 && x <= 58 },
  { name: 'The Riverlands', test: (x, y) => y >= 89 && y < 137 },
];
export function regionAt(wx, wz) {
  const [x, y] = toMap(wx, wz);
  for (const r of REGIONS) if (r.test(x, y)) return r.name;
  return 'Westeros';
}
