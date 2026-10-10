import type { Map as MlMap } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import {
  FREEHAND_DRAW_INTERACTION,
  MEASURE_CLICK_SLOP_PX,
  MeasureDrawAdapter,
  applyMeasureTool,
  createMeasureDrawModes,
  measureToolUsesDraw,
  terraDrawMode,
} from "./measure-gestures";

function fakeMap() {
  const state = { pan: true, box: true, rotate: true, touchAction: "" };
  const map = {
    getContainer: () => ({}),
    getCanvasContainer: () => ({ style: state }),
    dragPan: {
      isEnabled: () => state.pan,
      enable: () => {
        state.pan = true;
      },
      disable: () => {
        state.pan = false;
      },
    },
    dragRotate: {
      isEnabled: () => state.rotate,
      enable: () => {
        state.rotate = true;
      },
      disable: () => {
        state.rotate = false;
      },
    },
    boxZoom: {
      isEnabled: () => state.box,
      enable: () => {
        state.box = true;
      },
      disable: () => {
        state.box = false;
      },
    },
  };
  return { state, map: map as unknown as MlMap };
}

describe("measure draw gestures", () => {
  it("maps cut onto the polygon tool and leaves select able to pan", () => {
    expect(terraDrawMode("cut")).toBe("polygon");
    expect(terraDrawMode("static")).toBe("select");
    expect(measureToolUsesDraw("polygon")).toBe(true);
    expect(measureToolUsesDraw("select")).toBe(false);
    expect(measureToolUsesDraw("static")).toBe(false);
  });

  it("keeps pan and box zoom off for the whole draw, including after pointerup", () => {
    const { state, map } = fakeMap();
    const adapter = new MeasureDrawAdapter(map);
    const modes: string[] = [];
    const draw = {
      enabled: true,
      setMode: (mode: string) => {
        modes.push(mode);
      },
    };

    applyMeasureTool(draw, adapter, "polygon");
    expect(modes).toEqual(["polygon"]);
    expect(state.pan).toBe(false);
    expect(state.box).toBe(false);
    expect(state.touchAction).toBe("none");

    // Terra Draw asks to turn dragging back on when the button comes up.
    adapter.setDraggability(true);
    expect(state.pan).toBe(false);
    expect(state.box).toBe(false);
    expect(state.touchAction).toBe("none");

    applyMeasureTool(draw, adapter, "select");
    expect(state.pan).toBe(true);
    expect(state.box).toBe(true);
    expect(state.touchAction).toBe("");

    adapter.setDraggability(false);
    expect(state.pan).toBe(false);
    adapter.setDraggability(true);
    expect(state.pan).toBe(true);
  });

  it("does not change the tool until Terra Draw has started", () => {
    const { state, map } = fakeMap();
    const adapter = new MeasureDrawAdapter(map);
    const draw = { enabled: false, setMode: () => { throw new Error("should not set mode"); } };
    applyMeasureTool(draw, adapter, "linestring");
    expect(state.pan).toBe(true);
  });

  it("treats a short press as a click and lets the pencil draw by dragging", () => {
    const { map } = fakeMap();
    const adapter = new MeasureDrawAdapter(map) as unknown as {
      _minPixelDragDistance: number;
      _minPixelDragDistanceDrawing: number;
      _minPixelDragDistanceSelecting: number;
    };
    expect(adapter._minPixelDragDistance).toBe(MEASURE_CLICK_SLOP_PX);
    expect(adapter._minPixelDragDistanceDrawing).toBe(MEASURE_CLICK_SLOP_PX);
    expect(adapter._minPixelDragDistanceSelecting).toBe(1);

    const freehand = createMeasureDrawModes().find((mode) => mode.mode === "freehand");
    expect(freehand).toBeDefined();
    expect((freehand as { drawInteraction?: string }).drawInteraction).toBe(FREEHAND_DRAW_INTERACTION);
  });
});
