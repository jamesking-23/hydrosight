import type { Grid } from "./solver";

/**
 * Invented terrain for trying the tool: a main valley with two side valleys and a low
 * floodplain. It is not a real place and says so wherever it is shown.
 */
export const DEMO_TERRAIN_LABEL = "Synthetic demo terrain. Not a real place.";

export function demoTerrain(): Grid {
  const nx = 240;
  const ny = 240;
  const cellSizeM = 30;
  const z = new Float32Array(nx * ny);
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      // Main valley axis meanders slowly down the grid.
      const axisX = 120 + 14 * Math.sin(y / 38);
      const dMain = Math.abs(x - axisX);
      // Two side valleys joining from the left and right.
      const axisL = 60 + (y - 70) * 0.55;
      const dLeft = y > 70 && y < 170 && x < axisX ? Math.abs(x - axisL) : 99;
      const axisR = 190 - (y - 110) * 0.5;
      const dRight = y > 110 && y < 200 && x > axisX ? Math.abs(x - axisR) : 99;
      const sideValley = Math.min(dLeft, dRight);
      const valleyWall = Math.min(dMain * 2.6, 6 + sideValley * 2.2);
      // Gentle fall along the main valley and some texture.
      const base = 1800 - y * 0.55;
      const floodplain = dMain < 10 ? -1.5 * (1 - dMain / 10) : 0;
      const texture = 2.2 * Math.sin(x / 7) * Math.cos(y / 9);
      z[y * nx + x] = base + valleyWall + floodplain + texture;
    }
  }
  return { nx, ny, cellSizeM, z };
}
