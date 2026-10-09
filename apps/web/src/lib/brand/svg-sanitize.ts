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
  "animatemotion",
  "animatetransform",
  "set",
]);

export type SanitizeResult = { ok: true; svg: string } | { ok: false; error: string };

type ParentNode = {
  childNodes: { length: number; item(index: number): { nodeType: number } | null };
  removeChild(node: { nodeType: number }): void;
};

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

function dropNoise(parent: ParentNode) {
  const drop: { nodeType: number }[] = [];
  for (let i = 0; i < parent.childNodes.length; i += 1) {
    const node = parent.childNodes.item(i);
    if (!node) continue;
    // Processing instructions (xml-stylesheet) and comments.
    if (node.nodeType === 7 || node.nodeType === 8) drop.push(node);
    else if (node.nodeType === 1) dropNoise(node as unknown as ParentNode);
  }
  for (const node of drop) parent.removeChild(node);
}

function isSafeFragment(value: string, ids: Set<string>): boolean {
  const trimmed = value.trim();
  if (!trimmed.startsWith("#") || trimmed.length < 2) return false;
  if (/[\s<>"'`]/.test(trimmed)) return false;
  try {
    const id = decodeURIComponent(trimmed.slice(1).split("?")[0] ?? "");
    return ids.has(id);
  } catch {
    return false;
  }
}

function localUrlTarget(value: string): string | null {
  const match = value.trim().match(/^url\(\s*(['"]?)(#[^)'"]+)\1\s*\)$/i);
  return match?.[2] ?? null;
}

function replaceUrls(value: string, ids: Set<string>): string {
  return value.replace(/url\s*\(\s*(['"]?)([^)'"]*)\1\s*\)/gi, (full, _quote: string, target: string) => {
    const fragment = target.trim();
    return fragment.startsWith("#") && isSafeFragment(fragment, ids) ? `url(${fragment})` : "none";
  });
}

function stripCss(value: string, ids: Set<string>): string {
  return replaceUrls(value.replace(/@import[^;]*/gi, ""), ids);
}

/**
 * Server-side SVG cleanup. Drops scripts, event handlers, foreignObject,
 * external references, and CSS url()/@import. Local url(#id) references stay
 * when that id exists. Requires a viewBox.
 */
export function sanitizeSvg(input: string): SanitizeResult {
  if (new TextEncoder().encode(input).length > MAX_SVG_BYTES) {
    return { ok: false, error: "SVG logos must be 200 KB or smaller after sanitizing." };
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(input)) {
    return { ok: false, error: "This SVG isn't safe to upload." };
  }
  let doc;
  try {
    doc = new DOMParser({
      onError: () => {
        /* collected below via parsererror */
      },
    }).parseFromString(input, "image/svg+xml");
  } catch {
    return { ok: false, error: "That SVG could not be read." };
  }
  if (doc.getElementsByTagName("parsererror").length > 0) {
    return { ok: false, error: "That SVG could not be read." };
  }
  dropNoise(doc as unknown as ParentNode);
  const root = doc.documentElement;
  if (!root || localName(root) !== "svg") {
    return { ok: false, error: "Upload an SVG file." };
  }
  const viewBox = root.getAttribute("viewBox");
  if (!viewBox || !/^[\s,0-9.+-]+$/.test(viewBox.trim()) || viewBox.trim().split(/[\s,]+/).length < 4) {
    return { ok: false, error: "SVG logos need a viewBox." };
  }

  const drop: XmlElement[] = [];
  walk(root, (el) => {
    if (DROP_TAGS.has(localName(el))) drop.push(el);
  });
  for (const el of drop) el.parentNode?.removeChild(el);

  const ids = new Set<string>();
  walk(root, (el) => {
    const id = el.getAttribute("id");
    if (id) ids.add(id);
  });

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
      if (/url\s*\(|@import|expression\s*\(/i.test(value)) {
        const next = stripCss(value, ids);
        if (next.trim() && !/^none$/i.test(next.trim())) el.setAttribute(name, next);
        else el.removeAttribute(name);
      }
    }
    if (localName(el) === "style" && el.textContent && /url\s*\(|@import|expression\s*\(/i.test(el.textContent)) {
      el.textContent = stripCss(el.textContent, ids);
    }
  });

  const svg = new XMLSerializer().serializeToString(doc);
  if (new TextEncoder().encode(svg).length > MAX_SVG_BYTES) {
    return { ok: false, error: "SVG logos must be 200 KB or smaller after sanitizing." };
  }
  const urls = svg.match(/url\s*\([^)]*\)/gi) ?? [];
  const unsafeUrl = urls.some((url) => {
    const target = localUrlTarget(url);
    return !target || !isSafeFragment(target, ids);
  });
  if (unsafeUrl || /<script[\s>]|foreignobject|\son[a-z]+\s*=|@import|javascript:|data:/i.test(svg)) {
    return { ok: false, error: "This SVG isn't safe to upload." };
  }
  return { ok: true, svg };
}
