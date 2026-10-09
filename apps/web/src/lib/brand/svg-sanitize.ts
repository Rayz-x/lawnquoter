import { DOMParser, XMLSerializer, type Element as XmlElement } from "@xmldom/xmldom";

const MAX_SVG_BYTES = 200 * 1024;
const DROP_TAGS = new Set([
  "script",
  "foreignobject",
  "iframe",
  "embed",
  "object",
  "audio",
  "video",
  "handler",
  "animate",
  "set",
]);

export type SanitizeResult = { ok: true; svg: string } | { ok: false; error: string };

function localName(el: XmlElement): string {
  return (el.localName || el.nodeName || "").toLowerCase().replace(/^.*:/, "");
}

function walk(root: XmlElement, visit: (el: XmlElement) => void) {
  visit(root);
  const kids = root.childNodes;
  for (let i = 0; i < kids.length; i += 1) {
    const node = kids.item(i);
    if (node && node.nodeType === 1) walk(node as XmlElement, visit);
  }
}

function isSafeFragment(value: string, ids: Set<string>): boolean {
  const trimmed = value.trim();
  if (!trimmed.startsWith("#") || trimmed.length < 2) return false;
  if (/[\s<>"'`]/.test(trimmed)) return false;
  const id = decodeURIComponent(trimmed.slice(1).split("?")[0] ?? "");
  return ids.has(id);
}

function stripCss(value: string): string {
  return value
    .replace(/@import[^;]*/gi, "")
    .replace(/url\s*\([^)]*\)/gi, "none");
}

/**
 * Server-side SVG cleanup. Drops scripts, event handlers, foreignObject,
 * external references, and CSS url()/@import. Requires a viewBox.
 */
export function sanitizeSvg(input: string): SanitizeResult {
  if (/<!DOCTYPE|<!ENTITY/i.test(input)) {
    return { ok: false, error: "This SVG isn't safe to upload." };
  }
  const doc = new DOMParser({
    onError: () => {
      /* collected below via parsererror */
    },
  }).parseFromString(input, "image/svg+xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    return { ok: false, error: "That SVG could not be read." };
  }
  const root = doc.documentElement;
  if (!root || localName(root) !== "svg") {
    return { ok: false, error: "Upload an SVG file." };
  }
  const viewBox = root.getAttribute("viewBox");
  if (!viewBox || !/^[\s,0-9.+-]+$/.test(viewBox.trim()) || viewBox.trim().split(/[\s,]+/).length < 4) {
    return { ok: false, error: "SVG logos need a viewBox." };
  }

  const ids = new Set<string>();
  walk(root, (el) => {
    const id = el.getAttribute("id");
    if (id) ids.add(id);
  });

  const drop: XmlElement[] = [];
  walk(root, (el) => {
    if (DROP_TAGS.has(localName(el))) drop.push(el);
  });
  for (const el of drop) el.parentNode?.removeChild(el);

  walk(root, (el) => {
    const names: string[] = [];
    for (let i = 0; i < el.attributes.length; i += 1) {
      const attr = el.attributes.item(i);
      if (attr) names.push(attr.name);
    }
    for (const name of names) {
      const lower = name.toLowerCase();
      const value = el.getAttribute(name) ?? "";
      if (lower.startsWith("on")) {
        el.removeAttribute(name);
        continue;
      }
      if (lower === "href" || lower.endsWith(":href")) {
        if (!isSafeFragment(value, ids)) el.removeAttribute(name);
        continue;
      }
      if (lower === "style" && /url\s*\(|@import|expression\s*\(/i.test(value)) {
        el.setAttribute(name, stripCss(value));
      }
    }
    if (localName(el) === "style" && el.textContent && /url\s*\(|@import|expression\s*\(/i.test(el.textContent)) {
      el.textContent = stripCss(el.textContent);
    }
  });

  const svg = new XMLSerializer().serializeToString(doc);
  if (new TextEncoder().encode(svg).length > MAX_SVG_BYTES) {
    return { ok: false, error: "SVG logos must be 200 KB or smaller after sanitizing." };
  }
  if (/<script[\s>]|foreignobject|\son[a-z]+\s*=|url\s*\(|@import|javascript:/i.test(svg)) {
    return { ok: false, error: "This SVG isn't safe to upload." };
  }
  return { ok: true, svg };
}
