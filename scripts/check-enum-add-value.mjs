import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ADD_VALUE =
  /alter\s+type\s+([\w.]+)\s+add\s+value\s+(?:if\s+not\s+exists\s+)?'([^']+)'(?:\s+(?:before|after)\s+'[^']+')?/gi;

// Comments can mention a new label without using it. Dollar-quoted function
// bodies stay, because a literal inside them is a use in this file.
function stripComments(sql) {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    if (sql.startsWith("--", i)) {
      const newline = sql.indexOf("\n", i);
      i = newline === -1 ? sql.length : newline;
      continue;
    }
    if (sql.startsWith("/*", i)) {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      out += " ";
      continue;
    }
    if (sql[i] === "'") {
      const start = i;
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      out += sql.slice(start, i);
      continue;
    }
    const dollar = /^\$([A-Za-z0-9_]*)\$/.exec(sql.slice(i));
    if (dollar) {
      const tag = dollar[0];
      const end = sql.indexOf(tag, i + tag.length);
      if (end === -1) {
        out += sql.slice(i);
        break;
      }
      const close = end + tag.length;
      out += sql.slice(i, close);
      i = close;
      continue;
    }
    out += sql[i];
    i += 1;
  }
  return out;
}

export function unsafeEnumValueUses(sql) {
  const stripped = stripComments(sql);
  const additions = [];
  for (const match of stripped.matchAll(ADD_VALUE)) {
    additions.push({
      typeName: match[1],
      label: match[2],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  const violations = [];
  const seen = new Set();
  for (const added of additions) {
    const key = `${added.typeName}\0${added.label}`;
    if (seen.has(key)) continue;
    const literal = `'${added.label}'`;
    let from = 0;
    let used = false;
    while (from < stripped.length) {
      const at = stripped.indexOf(literal, from);
      if (at === -1) break;
      const insideAdd = additions.some(
        (other) => other.label === added.label && at >= other.start && at < other.end,
      );
      if (!insideAdd) {
        used = true;
        break;
      }
      from = at + literal.length;
    }
    if (used) {
      seen.add(key);
      violations.push({ typeName: added.typeName, label: added.label });
    }
  }
  return violations;
}

export function migrationViolations(dir) {
  const violations = [];
  for (const name of readdirSync(dir).filter((file) => file.endsWith(".sql")).sort()) {
    const sql = readFileSync(path.join(dir, name), "utf8");
    for (const hit of unsafeEnumValueUses(sql)) {
      violations.push(`${name}: ${hit.typeName} '${hit.label}'`);
    }
  }
  return violations;
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../supabase/migrations");
  const violations = migrationViolations(dir);
  if (violations.length > 0) {
    console.error("Enum value added and used in the same migration file:");
    for (const violation of violations) console.error(`  ${violation}`);
    process.exit(1);
  }
}
