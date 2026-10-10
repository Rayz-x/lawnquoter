import { z } from "zod";

export const positionSchema = z.tuple([z.number(), z.number()]);
export type Position = z.infer<typeof positionSchema>;

export const polygonSchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(z.array(positionSchema).min(4)).min(1),
});
export type Polygon = z.infer<typeof polygonSchema>;

export const multiPolygonSchema = z.object({
  type: z.literal("MultiPolygon"),
  coordinates: z.array(z.array(z.array(positionSchema).min(4)).min(1)).min(1),
});
export type MultiPolygon = z.infer<typeof multiPolygonSchema>;

export const lineStringSchema = z.object({
  type: z.literal("LineString"),
  coordinates: z.array(positionSchema).min(2),
});
export type LineString = z.infer<typeof lineStringSchema>;

export const pointSchema = z.object({
  type: z.literal("Point"),
  coordinates: positionSchema,
});
export type Point = z.infer<typeof pointSchema>;

export const geometrySchema = z.discriminatedUnion("type", [
  polygonSchema,
  multiPolygonSchema,
  lineStringSchema,
  pointSchema,
]);
export type Geometry = z.infer<typeof geometrySchema>;

export const SQFT_PER_SQM = 10.7639104167;
export const FT_PER_M = 3.28083989501;
