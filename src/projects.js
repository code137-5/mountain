// Each project maps to: a heightmap "morph target" (dispIndex 0..3),
// a colormap mood (low/high grade colors), and a fog color.
// Colors borrowed from the site's palette (colors.png) + the mood shifts
// seen in the screen recording (grey -> ember -> violet -> blue -> green).

export const HEIGHTMAPS = [
  'textures/landscape.jpg',   // 0
  'textures/terrain003.jpg',  // 1
  'textures/terrain005.jpg',  // 2
  'textures/aztec_disp.png',  // 3
];

export const COLOR_TEXTURE = 'textures/kleur4.jpg';

// Atmospheric, DESATURATED palettes (the original reads like misty mountains, not a color photo).
// a = shadowed valley, b = lit ridge, haze = horizon/fog (where terrain melts into sky),
// sky = zenith color. Keep saturation low so it stays "weather", not "paint".
const MOODS = {
  mist:   { a: '#10151a', b: '#3c454c', haze: '#c6cbce', sky: '#9aa8b4' },
  ember:  { a: '#1d0e07', b: '#7c4a2a', haze: '#d2a276', sky: '#74513a' },
  violet: { a: '#15101f', b: '#564465', haze: '#c1b3d0', sky: '#52456a' },
  blue:   { a: '#0c1420', b: '#3a4f66', haze: '#aebfce', sky: '#42587a' },
  canopy: { a: '#121a0c', b: '#4c5e34', haze: '#bcc7a2', sky: '#4a5c34' },
};

export const PROJECTS = [
  { name: 'Victorinox',             dispIndex: 0, mood: 'mist' },
  { name: 'Following Wildfire',     dispIndex: 2, mood: 'ember' },
  { name: 'Coca-Cola x Marshmello', dispIndex: 1, mood: 'ember' },
  { name: 'Deso',                   dispIndex: 3, mood: 'violet' },
  { name: 'PolyAI Looped',          dispIndex: 0, mood: 'canopy' },
  { name: 'Film Secession',         dispIndex: 2, mood: 'mist' },
  { name: 'Hashgraph Ventures',     dispIndex: 1, mood: 'blue' },
  { name: 'Ibicash',                dispIndex: 3, mood: 'canopy' },
  { name: 'Sweetbeats',             dispIndex: 0, mood: 'violet' },
  { name: 'De Morgen 2020',         dispIndex: 2, mood: 'blue' },
  { name: 'Microsoft Original Build', dispIndex: 1, mood: 'mist' },
].map((p) => ({ ...p, ...MOODS[p.mood] }));

export const DEFAULT_MOOD = MOODS.mist;
export { MOODS };
