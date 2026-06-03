// benchmark-paired.mjs — browser wrapper for paired ratio measurement (any case)
import { runPaired } from "./bench-core-paired.mjs";
window.__runPaired = async (opts = {}) =>
  runPaired({ makeDoc: () => document.implementation.createHTMLDocument("p"), now: () => performance.now(), ...opts });
