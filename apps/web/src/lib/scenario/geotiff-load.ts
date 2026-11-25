import { fromBlob } from "geotiff";
import type { Grid } from "./solver";

export type LoadedTerrain = {
  grid: Grid;
  /** Where the loaded window sits, in degrees (geographic files) or file units. */
  bbox: [number, number, number, number];
  geographic: boolean;
  originalCells: number;
  resampled: boolean;
  notes: string[];
};

export type LoadOptions = {
  /** Largest side of the grid to build, in cells. Larger windows are resampled down. */
  maxSide: number;
  /** Optional window centred on a point (degrees for geographic files). */
  centre?: { lon: number; lat: number; halfWidthKm: number };
};

const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LON_EQ = 111320;

/** Reads a GeoTIFF elevation file into a metre-based grid. Reads only the needed window. */
export async function loadElevationTiff(
  file: Blob,
  opts: LoadOptions,
): Promise<LoadedTerrain> {
  const tiff = await fromBlob(file);
  const image = await tiff.getImage();
  const W = image.getWidth();
  const H = image.getHeight();
  const [west, south, east, north] = image.getBoundingBox() as [
    number,
    number,
    number,
    number,
  ];
  const resX = (east - west) / W;
  const resY = (north - south) / H;
  const keys = image.getGeoKeys() as Record<string, number> | null;
  const projected =
    !!keys &&
    keys.ProjectedCSTypeGeoKey !== undefined &&
    keys.ProjectedCSTypeGeoKey !== 32767;
  const geographic = !projected;
  const notes: string[] = [];

  let x0 = 0;
  let y0 = 0;
  let x1 = W;
  let y1 = H;
  if (opts.centre) {
    const { lon, lat, halfWidthKm } = opts.centre;
    if (!geographic) {
      throw new Error(
        "Choosing a window by longitude and latitude needs a file in degrees. Leave the area blank to use the whole file.",
      );
    }
    if (lon < west || lon > east || lat < south || lat > north) {
      throw new Error("That longitude and latitude are outside this file.");
    }
    const halfLat = (halfWidthKm * 1000) / M_PER_DEG_LAT;
    const halfLon =
      (halfWidthKm * 1000) /
      (M_PER_DEG_LON_EQ * Math.cos((lat * Math.PI) / 180));
    x0 = Math.max(0, Math.floor((lon - halfLon - west) / resX));
    x1 = Math.min(W, Math.ceil((lon + halfLon - west) / resX));
    y0 = Math.max(0, Math.floor((north - (lat + halfLat)) / resY));
    y1 = Math.min(H, Math.ceil((north - (lat - halfLat)) / resY));
  }
  const winW = x1 - x0;
  const winH = y1 - y0;
  if (winW < 3 || winH < 3)
    throw new Error(
      "The chosen area is too small. Use at least 3 cells in each direction.",
    );

  const scale = Math.max(winW, winH) / opts.maxSide;
  const outW = scale > 1 ? Math.max(3, Math.round(winW / scale)) : winW;
  const outH = scale > 1 ? Math.max(3, Math.round(winH / scale)) : winH;
  const resampled = outW !== winW || outH !== winH;
  if (resampled) {
    notes.push(
      `The window was resampled from ${winW} x ${winH} to ${outW} x ${outH} cells to keep the run quick.`,
    );
  }

  const rasters = (await image.readRasters({
    window: [x0, y0, x1, y1],
    width: outW,
    height: outH,
    samples: [0],
    interleave: false,
    resampleMethod: "bilinear",
  })) as unknown as ArrayLike<number>[];
  const band = rasters[0]!;
  const nodata = image.getGDALNoData();
  const z = new Float32Array(outW * outH);
  for (let i = 0; i < z.length; i++) {
    const v = band[i]!;
    z[i] = nodata !== null && v === nodata ? Number.NaN : v;
  }

  const cellW = (Math.abs(resX) * winW) / outW;
  const cellH = (Math.abs(resY) * winH) / outH;
  let dxM: number;
  let dyM: number;
  if (geographic) {
    const midLat = north - (y0 + winH / 2) * Math.abs(resY);
    dxM = cellW * M_PER_DEG_LON_EQ * Math.cos((midLat * Math.PI) / 180);
    dyM = cellH * M_PER_DEG_LAT;
  } else {
    dxM = cellW;
    dyM = cellH;
    notes.push(
      "File is in a projected system. Its units are assumed to be metres.",
    );
  }
  if (Math.abs(dxM - dyM) / Math.max(dxM, dyM) > 0.15) {
    notes.push(
      "Cells are not square (more than 15% difference). An average size is used.",
    );
  }
  const cellSizeM = Math.sqrt(dxM * dyM);

  return {
    grid: { nx: outW, ny: outH, cellSizeM, z },
    bbox: [
      west + x0 * Math.abs(resX),
      north - y1 * Math.abs(resY),
      west + x1 * Math.abs(resX),
      north - y0 * Math.abs(resY),
    ],
    geographic,
    originalCells: W * H,
    resampled,
    notes,
  };
}
