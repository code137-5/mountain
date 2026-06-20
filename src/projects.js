// REAL per-project scene settings extracted from the original bundle.js.
// The original: a GRAYSCALE marble texture (base-grayscale) for the surface, coloured by the
// project's `fog` colour, on a heightmap chosen per project with its own UV offset + scale.

export const HEIGHTMAPS = [
  'textures/landscape-disp.jpg', // 0  landscape-displacement (most common)
  'textures/vertex-map.jpg',     // 1
  'textures/terrain005.jpg',     // 2  terrain0052k
  'textures/landscape.jpg',      // 3  landscape4kdisplacement
];

export const COLOR_TEXTURE = 'textures/base-grayscale.jpg'; // grayscale marble — surface detail

// disp = heightmap index, dispScale = mountain height, dispOff = heightmap uv offset,
// fog = the mood/atmosphere colour, texScale/texOff = surface uv, contrast = grayscale contrast.
export const PROJECTS = [
  { name: 'Victorinox',             disp: 0, dispScale: 77.2, dispOff: [0.283, 0.543], fog: '#E8664B', texScale: 1.0,  texOff: [0.283, 0.489], contrast: 2.29 },
  { name: 'Following Wildfire',     disp: 3, dispScale: 63.0, dispOff: [0.043, -0.283], fog: '#8a8f96', texScale: 1.0,  texOff: [0.0, 0.0],     contrast: 1.07 },
  { name: 'Coca-Cola x Marshmello', disp: 1, dispScale: 43.5, dispOff: [0.152, 0.0],   fog: '#6C6C6C', texScale: 1.3,  texOff: [0.0, 0.424],   contrast: 1.19 },
  { name: 'Deso',                   disp: 2, dispScale: 75.0, dispOff: [0.652, 1.0],   fog: '#cebb92', texScale: 1.0,  texOff: [0.0, 0.043],   contrast: 1.11 },
  { name: 'PolyAI Looped',          disp: 0, dispScale: 42.4, dispOff: [1.0, 0.75],    fog: '#8a8f96', texScale: 1.0,  texOff: [0.229, 0.0],   contrast: 1.15 },
  { name: 'Film Secession',         disp: 0, dispScale: 60.0, dispOff: [0.0, 0.0],     fog: '#d95a31', texScale: 1.0,  texOff: [0.674, 0.0],   contrast: 0.92 },
  { name: 'Hashgraph Ventures',     disp: 0, dispScale: 60.0, dispOff: [1.0, 0.087],   fog: '#ff0891', texScale: 3.16, texOff: [0.402, 0.576], contrast: 2.52 },
  { name: 'Ibicash',                disp: 1, dispScale: 60.0, dispOff: [0.0, 0.0],     fog: '#D61212', texScale: 1.0,  texOff: [0.0, 0.0],     contrast: 1.34 },
  { name: 'Sweetbeats',             disp: 0, dispScale: 76.1, dispOff: [-0.152, 0.13], fog: '#A04CE8', texScale: 1.52, texOff: [0.283, 0.543], contrast: 1.78 },
  { name: 'De Morgen 2020',         disp: 0, dispScale: 78.8, dispOff: [0.36, 0.359],  fog: '#a29700', texScale: 2.97, texOff: [0.821, 0.136], contrast: 1.08 },
  { name: 'Microsoft Original Build', disp: 0, dispScale: 75.0, dispOff: [0.043, 0.087], fog: '#917ef2', texScale: 2.28, texOff: [0.0, 1.0],   contrast: 3.28 },
];

// neutral grey default (shown before any hover)
export const DEFAULT = { name: '_', disp: 0, dispScale: 64, dispOff: [0.2, 0.4], fog: '#8a8f96', texScale: 1.0, texOff: [0.2, 0.4], contrast: 1.3 };
