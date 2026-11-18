// Playable dragons and Targaryen riders.

export const DRAGONS = [
  {
    id: 'drogon', name: 'Drogon', title: 'The Winged Shadow',
    lore: 'Black as night with scales shot through with scarlet. The largest and fiercest of Daenerys’s children.',
    scale: 1.3, bulk: 1.0, neck: 1.0, tail: 1.0, wing: 1.0, head: 1.0, hornLen: 1.0, spike: 1.0,
    body: '#1b1614', belly: '#3d1a16', accent: '#8c1c14', membrane: '#3a1310', glow: '#d2401f', eye: '#ff4a1c',
    flame: ['#fff0c2', '#ff6a14', '#a8140a'], stats: { speed: 0.85, agility: 0.8, fire: 0.95 },
  },
  {
    id: 'rhaegal', name: 'Rhaegal', title: 'The Green Flame',
    lore: 'Jade scales and bronze wings, named for Prince Rhaegar. Swift, wary and loyal.',
    scale: 1.12, bulk: 0.95, neck: 1.05, tail: 1.05, wing: 1.02, head: 0.95, hornLen: 0.9, spike: 0.85,
    body: '#2c4a2a', belly: '#8a7a3a', accent: '#b08a3c', membrane: '#6a5424', glow: '#e0b040', eye: '#ffb030',
    flame: ['#fff6c8', '#ffa620', '#6c9a1c'], stats: { speed: 0.9, agility: 0.9, fire: 0.75 },
  },
  {
    id: 'viserion', name: 'Viserion', title: 'The White Dragon',
    lore: 'Cream and gold, with wings like pale parchment and flame the colour of molten gold.',
    scale: 1.12, bulk: 0.95, neck: 1.0, tail: 1.0, wing: 1.04, head: 0.95, hornLen: 1.1, spike: 0.9,
    body: '#cfc3a2', belly: '#efe6cc', accent: '#c9a03c', membrane: '#d8c79a', glow: '#ffdf90', eye: '#ffc94a',
    flame: ['#ffffff', '#ffd860', '#ff9a20'], stats: { speed: 0.9, agility: 0.95, fire: 0.75 },
  },
  {
    id: 'balerion', name: 'Balerion', title: 'The Black Dread',
    lore: 'Mount of Aegon the Conqueror. His wings could shadow whole towns; his fire was black as his scales.',
    scale: 2.05, bulk: 1.18, neck: 0.95, tail: 1.0, wing: 1.06, head: 1.15, hornLen: 1.35, spike: 1.3,
    body: '#0d0c0d', belly: '#1c1a1c', accent: '#2a2628', membrane: '#141012', glow: '#7a1c10', eye: '#ff2a10',
    flame: ['#ffd9a0', '#c0300c', '#1a0604'], stats: { speed: 0.7, agility: 0.45, fire: 1.0 },
  },
  {
    id: 'vhagar', name: 'Vhagar', title: 'Queen of All Dragons',
    lore: 'Hoary, battle-scarred and vast. Bronze hide gone green with age, the last of the Conquest’s dragons.',
    scale: 1.85, bulk: 1.22, neck: 0.92, tail: 0.95, wing: 1.0, head: 1.1, hornLen: 0.8, spike: 0.8,
    body: '#4b4a32', belly: '#6c6648', accent: '#7c6a3c', membrane: '#5a4c34', glow: '#c9a060', eye: '#b8e04a',
    flame: ['#f4ffd0', '#b4e040', '#4a8c20'], stats: { speed: 0.72, agility: 0.5, fire: 0.98 },
  },
  {
    id: 'caraxes', name: 'Caraxes', title: 'The Blood Wyrm',
    lore: 'Lean, long-necked and blood red. Formidable, fearsome and battle-tested.',
    scale: 1.3, bulk: 0.82, neck: 1.5, tail: 1.25, wing: 1.05, head: 0.9, hornLen: 0.7, spike: 0.7,
    body: '#7a1612', belly: '#b83a24', accent: '#2a0c0c', membrane: '#8a2a1c', glow: '#ff6030', eye: '#ffd24a',
    flame: ['#fff4c0', '#ff5a10', '#c01808'], stats: { speed: 0.92, agility: 0.85, fire: 0.85 },
  },
  {
    id: 'syrax', name: 'Syrax', title: 'The Golden Lady',
    lore: 'Rhaenyra’s she-dragon, with scales of burnished yellow. Sleek, proud and quick on the wing.',
    scale: 1.0, bulk: 0.95, neck: 1.0, tail: 1.0, wing: 1.0, head: 0.95, hornLen: 1.0, spike: 0.8,
    body: '#b8962c', belly: '#e0c468', accent: '#7a5a18', membrane: '#c8a040', glow: '#ffd060', eye: '#ff8a20',
    flame: ['#ffffe0', '#ffc030', '#ff7010'], stats: { speed: 0.95, agility: 0.95, fire: 0.65 },
  },
  {
    id: 'meleys', name: 'Meleys', title: 'The Red Queen',
    lore: 'Scarlet scales, pink wing membranes and a crest of bright copper. Once the swiftest dragon in Westeros.',
    scale: 1.2, bulk: 0.92, neck: 1.05, tail: 1.05, wing: 1.08, head: 0.95, hornLen: 1.25, spike: 1.0,
    body: '#9a1a1a', belly: '#c04a3a', accent: '#c87a3c', membrane: '#c86a6a', glow: '#ff9a90', eye: '#ffd060',
    flame: ['#fff0d0', '#ff5028', '#d01020'], stats: { speed: 1.0, agility: 0.9, fire: 0.8 },
  },
  {
    id: 'sunfyre', name: 'Sunfyre', title: 'The Golden',
    lore: 'Gleaming gold scales and pale pink wings. Called the most beautiful dragon ever seen in the world.',
    scale: 1.05, bulk: 0.95, neck: 1.0, tail: 1.05, wing: 1.06, head: 0.95, hornLen: 1.0, spike: 0.9,
    body: '#d4a72c', belly: '#f2dc8a', accent: '#f0c860', membrane: '#e8a8a0', glow: '#ffc8b8', eye: '#ffe060',
    flame: ['#ffffff', '#ffe080', '#ffb030'], stats: { speed: 0.95, agility: 0.92, fire: 0.7 },
  },
  {
    id: 'dreamfyre', name: 'Dreamfyre', title: 'The Pale Blue',
    lore: 'Slender and pale blue with silver markings. A graceful she-dragon of the Dragonpit.',
    scale: 1.15, bulk: 0.92, neck: 1.1, tail: 1.1, wing: 1.05, head: 0.92, hornLen: 0.95, spike: 0.75,
    body: '#6f8fb0', belly: '#c4d2de', accent: '#d6dee6', membrane: '#9cb2c8', glow: '#d0e8ff', eye: '#a8e0ff',
    flame: ['#ffffff', '#b8dcff', '#5a9cf0'], stats: { speed: 0.93, agility: 0.93, fire: 0.72 },
  },
];

export const RIDERS = [
  {     // the user's own scanned knight (src/dragon/rider.js loadKnight); the colours below only matter if the model fails to load
    id: 'knight', name: 'The Dragon Knight', title: 'Sworn Sword of the Dragon', dragon: 'drogon', female: false, model: 'knight',
    lore: 'A knight in mail and surcoat who rides to war on dragonback, cloak streaming behind him and sword raised.',
    hair: '#2a211a', hairStyle: 'tied', skin: '#d9b496', outfit: '#3b3a38', trim: '#6b5a3a', cloak: '#3a1d14', armor: true,
  },
  {
    id: 'daenerys', name: 'Daenerys Targaryen', title: 'The Mother of Dragons', dragon: 'drogon', female: true,
    lore: 'Stormborn, the Unburnt, Breaker of Chains. She crossed the Narrow Sea to take what is hers with fire and blood.',
    hair: '#e9e4d6', hairStyle: 'braid', skin: '#e8c9b0', outfit: '#23262e', trim: '#8c1c14', cloak: '#7a1410', armor: false,
  },
  {
    id: 'jon', name: 'Jon Snow', title: 'Aegon Targaryen, the White Wolf', dragon: 'rhaegal', female: false,
    lore: 'Raised a bastard of Winterfell, born the son of Rhaegar Targaryen and Lyanna Stark.',
    hair: '#1c1714', hairStyle: 'tied', skin: '#dcb898', outfit: '#1a1a1c', trim: '#3a332c', cloak: '#2a2622', armor: true, fur: true,
  },
  {
    id: 'rhaenyra', name: 'Rhaenyra Targaryen', title: 'The Realm’s Delight', dragon: 'syrax', female: true,
    lore: 'Named heir to the Iron Throne by King Viserys. Her claim set dragon against dragon.',
    hair: '#ece6d2', hairStyle: 'long', skin: '#ecd2ba', outfit: '#5a0f14', trim: '#c8a04a', cloak: '#16121a', armor: false,
  },
  {
    id: 'daemon', name: 'Daemon Targaryen', title: 'The Rogue Prince', dragon: 'caraxes', female: false,
    lore: 'Prince of the City, wielder of Dark Sister. The most daring dragonrider of his age.',
    hair: '#e6e0cc', hairStyle: 'long', skin: '#e4c4a8', outfit: '#15151a', trim: '#7a1612', cloak: '#5a0f10', armor: true,
  },
  {
    id: 'aegon', name: 'Aegon the Conqueror', title: 'First of His Name', dragon: 'balerion', female: false,
    lore: 'With three dragons and Blackfyre in hand he forged seven kingdoms into one.',
    hair: '#e4dece', hairStyle: 'short', skin: '#e0c0a2', outfit: '#101012', trim: '#b01c14', cloak: '#8a1410', armor: true, crown: true,
  },
  {
    id: 'visenya', name: 'Visenya Targaryen', title: 'The Warrior Queen', dragon: 'vhagar', female: true,
    lore: 'Elder sister-wife of the Conqueror. Stern, unforgiving, and deadly with Dark Sister.',
    hair: '#eeeadc', hairStyle: 'braid', skin: '#e6c8ae', outfit: '#2a2c30', trim: '#b8a070', cloak: '#3a1014', armor: true,
  },
  {
    id: 'aemond', name: 'Aemond Targaryen', title: 'The One-Eyed Prince', dragon: 'vhagar', female: false,
    lore: 'He lost an eye and gained the greatest dragon alive. A sapphire glints where the eye once was.',
    hair: '#ebe6d4', hairStyle: 'long', skin: '#e2c4aa', outfit: '#0e1410', trim: '#2c5a3a', cloak: '#0c100e', armor: false, eyepatch: true,
  },
  {
    id: 'rhaenys', name: 'Rhaenys Targaryen', title: 'The Queen Who Never Was', dragon: 'meleys', female: true,
    lore: 'Passed over by the Great Council, never by her dragon. She rode the Red Queen into legend.',
    hair: '#dcd6c6', hairStyle: 'braid', skin: '#e2c2a6', outfit: '#1c2a3a', trim: '#b8b8c0', cloak: '#7a1418', armor: true,
  },
];
