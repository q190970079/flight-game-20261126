// Alpine Courier — configuration: world scale, course rings, runway, tuning.
// One unit is one metre. The whole course is hand-placed, not copied.

export const WORLD = {
  size: 4200, // terrain spans -2100..2100 on x and z
  grid: 110, // heightfield cells per side
  maxHeight: 300,
  lakeLevel: 26,
  seed: 20261126,
};

export const RUNWAY = {
  // Flat valley floor, runway along +x, threshold at x=-260.
  x: 0,
  z: 420,
  heading: 90, // degrees, flying east (+x) on final
  length: 560,
  width: 46,
  groundY: 34,
};

export const RINGS = [
  // A tour of the valley: climb out, lake, ridge, canyon, then back for landing.
  { x: 620, y: 150, z: 420, r: 26 },
  { x: 1180, y: 190, z: 60, r: 26 },
  { x: 1420, y: 230, z: -720, r: 26 },
  { x: 760, y: 210, z: -1320, r: 24 },
  { x: -120, y: 240, z: -1480, r: 24 },
  { x: -980, y: 200, z: -980, r: 26 },
  { x: -1420, y: 170, z: -220, r: 26 },
  { x: -900, y: 140, z: 300, r: 26 },
];

export const PLANE = {
  cruiseSpeed: 78, // m/s at full throttle
  minSpeed: 26,
  maxSpeed: 118,
  climbRate: 26,
  turnRate: 42, // deg/s at full bank
  stallSpeed: 34,
  fuelDrain: 0.55, // per second at cruise throttle
  boostDrain: 2.4,
};

export const COLOURS = {
  skyTop: '#2f6fb8',
  skyMid: '#7db4e4',
  skyLow: '#cfe6f5',
  sun: '#fff3c4',
  grassLow: '#5d9b4a',
  grassHigh: '#7fae62',
  rock: '#8a7f72',
  snow: '#eef3f6',
  sand: '#cbb98a',
  lake: '#2f7fb8',
  lakeDeep: '#1d5c8a',
  asphalt: '#3a3d42',
  ringNext: '#ffc233',
  ringFar: '#9fd8ff',
  ringDone: '#58d68d',
};
