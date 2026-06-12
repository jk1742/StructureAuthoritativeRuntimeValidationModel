export const SnapshotBaseline = {
  snapshot(root) {
    const out = [];
    function walk(node, path) {
      if (node.nodeType !== 1) return;
      const tag = node.tagName.toLowerCase();
      const value = (tag === "input" || tag === "textarea") ? String(node.value ?? "") : null;
      out.push({ path: path.join("."), tag, value });
      const kids = node.children;
      for (let i = 0; i < kids.length; i++) walk(kids[i], path.concat(i));
    }
    walk(root, [0]);
    return out;
  },

  diff(prev, curr) {
    const mismatches = [];
    const prevMap = new Map(prev.map(e => [e.path, e]));
    const currMap = new Map(curr.map(e => [e.path, e]));
    for (const [path, p] of prevMap) {
      const c = currMap.get(path);
      if (!c) { mismatches.push({ type: "removed", path }); continue; }
      if (c.tag !== p.tag || c.value !== p.value) {
        mismatches.push({ type: "changed", path });
      }
    }
    for (const [path] of currMap) {
      if (!prevMap.has(path)) mismatches.push({ type: "added", path });
    }
    return mismatches;
  },

  validate(prevSnap, root) {
    const curr = this.snapshot(root);
    const m = this.diff(prevSnap, curr);
    return { valid: m.length === 0, mismatches: m };
  },
};
