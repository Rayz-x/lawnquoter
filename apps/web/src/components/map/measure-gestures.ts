import type { Map as MlMap } from "maplibre-gl";
import {
  TerraDrawFreehandMode,
  TerraDrawLineStringMode,
  TerraDrawPolygonMode,
  TerraDrawSelectMode,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";

export type DrawMode = "static" | "polygon" | "linestring" | "freehand" | "select" | "cut";

/**
 * MapLibre starts a pan after about 3 pixels, and Terra Draw treats a press as a
 * drag after 1 pixel until a shape is already underway. A normal mouse click or
 * finger tap moves more than that, so the press pans the map and never places a
 * point. Count a short press as a click. A longer drag still starts the pencil.
 */
export const MEASURE_CLICK_SLOP_PX = 24;

export const FREEHAND_DRAW_INTERACTION = "click-drag" as const;

type TerraMode = "polygon" | "linestring" | "freehand" | "select";

export function measureToolUsesDraw(mode: DrawMode): boolean {
  return mode === "polygon" || mode === "linestring" || mode === "freehand" || mode === "cut";
}

export function terraDrawMode(mode: DrawMode): TerraMode {
  if (mode === "cut" || mode === "polygon") return "polygon";
  if (mode === "linestring") return "linestring";
  if (mode === "freehand") return "freehand";
  return "select";
}

type GestureMap = {
  dragPan: { enable(): void; disable(): void };
  boxZoom: { enable(): void; disable(): void };
  getCanvasContainer(): { style: { touchAction: string } };
};

export function syncMeasureGestures(map: GestureMap, drawing: boolean): void {
  const container = map.getCanvasContainer();
  if (drawing) {
    map.dragPan.disable();
    map.boxZoom.disable();
    // Turning drag-pan off drops MapLibre's touch-drag class, and the canvas
    // falls back to touch-action: pan-x pan-y. The browser then cancels the
    // pointer instead of delivering pointerup, so the tap never places a point.
    container.style.touchAction = "none";
    return;
  }
  map.dragPan.enable();
  map.boxZoom.enable();
  container.style.touchAction = "";
}

/**
 * Terra Draw calls setDraggability(true) on every pointerup, which turns pan
 * back on after the first press. While a draw tool is active, keep pan and
 * box zoom off so the next click still places a point.
 */
export class MeasureDrawAdapter extends TerraDrawMapLibreGLAdapter<MlMap> {
  private drawing = false;
  private readonly glMap: MlMap;

  constructor(map: MlMap) {
    super({
      map,
      minPixelDragDistance: MEASURE_CLICK_SLOP_PX,
      minPixelDragDistanceDrawing: MEASURE_CLICK_SLOP_PX,
    });
    this.glMap = map;
  }

  setDrawing(drawing: boolean): void {
    this.drawing = drawing;
    syncMeasureGestures(this.glMap, drawing);
  }

  override setDraggability(enabled: boolean): void {
    if (this.drawing) {
      syncMeasureGestures(this.glMap, true);
      return;
    }
    super.setDraggability(enabled);
  }
}

type MeasureDraw = {
  enabled: boolean;
  setMode(mode: string): void;
};

export function applyMeasureTool(draw: MeasureDraw, adapter: MeasureDrawAdapter, mode: DrawMode): void {
  if (!draw.enabled) return;
  adapter.setDrawing(measureToolUsesDraw(mode));
  draw.setMode(terraDrawMode(mode));
}

export function createMeasureDrawModes() {
  const snap = { toCoordinate: true, toLine: true } as const;
  return [
    new TerraDrawPolygonMode({ snapping: snap }),
    new TerraDrawLineStringMode({ snapping: snap }),
    new TerraDrawFreehandMode({ drawInteraction: FREEHAND_DRAW_INTERACTION }),
    new TerraDrawSelectMode({
      flags: {
        polygon: { feature: { draggable: true, coordinates: { midpoints: true, draggable: true, deletable: true } } },
        linestring: { feature: { draggable: true, coordinates: { midpoints: true, draggable: true, deletable: true } } },
      },
    }),
  ];
}
