/* 
 * bench/builders.mjs — overhead 
 */
export const NODE_COUNTS = [10, 50, 100, 500, 1000, 2000];

function attrsOf(i, variant) {
  const a = { type: "text", name: `f${i}` };
  if (variant != null) a["data-rev"] = variant;
  return a;
}

export function htmlN(n, variant) {
  let s = "";
  const rev = variant != null ? ` data-rev="${variant}"` : "";
  for (let i = 0; i < n; i++) s += `<input type="text" name="f${i}"${rev}>`;
  return s;
}
export function keyedTreeN(n, variant) {
  const children = [];
  for (let i = 0; i < n; i++) children.push({ key: `k${i}`, tag: "input", attrs: attrsOf(i, variant) });
  return { children };
}
export function serverIdTreeN(n, variant) {
  const children = [];
  for (let i = 0; i < n; i++) children.push({ serverId: `s${i}`, tag: "input", attrs: attrsOf(i, variant) });
  return { children };
}
export function shapeN(n, variant) {
  const children = [];
  for (let i = 0; i < n; i++) children.push({ slot: `f${i}`, tag: "input", attrs: attrsOf(i, variant) });
  return { children };
}

export function reactPropsN(n, variant) {
  const items = [];
  for (let i = 0; i < n; i++) items.push({ key: `k${i}`, name: `f${i}`, value: "", rev: variant != null ? variant : 0 });
  return { items };
}
