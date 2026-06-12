/*
 * chromium/harness.mjs — page
 */
import { InnerHTMLSwap, KeyedReconcile, ServerIdReconcile } from "../src/models.mjs";
import { createReconstructionAuthority, createIdentityReconciler } from "../src/identity.mjs";
import * as S from "../src/scenarios.mjs";

const cell = {};

function parentEl() {
  return document.getElementById("parent");
}

function setup(model, scenario) {
  const p = parentEl();
  p.innerHTML = "";
  cell.authority = null;
  cell.reconciler = null;
  cell.dIds = null;
  cell.victimId = null;
  const doc = document;

  if (model === "A") {
    p.innerHTML = S.html();
  } else if (model === "B") {
    KeyedReconcile.apply(p, S.keyedTree(), doc);
  } else if (model === "D") {
    const ids =
      scenario === "R2"
        ? { user: "sid-user-v1", email: "e1", submit: "s1" }
        : { user: "sid-user", email: "sid-email", submit: "sid-submit" };
    cell.dIds = ids;
    cell.victimId = ids.user;
    ServerIdReconcile.apply(p, S.serverIdTree(ids), doc);
  } else if (model === "C") {
    const authority = createReconstructionAuthority();
    const reconciler = createIdentityReconciler(authority);
    const issued = authority.issue("form-A", S.shape());
    reconciler.mount(p, issued, doc);
    cell.authority = authority;
    cell.reconciler = reconciler;
    cell.cIssuedUserId = issued.children[0].id;         
  }
}

function apply(model, scenario) {
  const p = parentEl();
  const doc = document;
  let verdict = null;
  let rejected = null;

  if (model === "A") {
    if (scenario === "R1") InnerHTMLSwap.apply(p, S.html(S.R1_EXTRA));
    else if (scenario === "R2") InnerHTMLSwap.apply(p, S.html());
    else InnerHTMLSwap.apply(p, `<input type="text" name="${S.ATTACKER_NAME}">`);
  } else if (model === "B") {
    if (scenario === "R1") KeyedReconcile.apply(p, S.keyedTree(S.R1_EXTRA), doc);
    else if (scenario === "R2") KeyedReconcile.apply(p, S.keyedTree(), doc);
    else KeyedReconcile.apply(p, S.attackerKeyedTree(), doc);
  } else if (model === "D") {
    if (scenario === "R1") ServerIdReconcile.apply(p, S.serverIdTree(cell.dIds, S.R1_EXTRA), doc);
    else if (scenario === "R2") ServerIdReconcile.apply(p, S.serverIdTree({ user: "sid-user-v2", email: "e2", submit: "s2" }), doc);
    else ServerIdReconcile.apply(p, S.attackerServerIdTree(cell.victimId), doc);
  } else if (model === "C") {
    const { authority, reconciler } = cell;
    if (scenario === "R1") verdict = reconciler.reconstruct(p, authority.issue("form-A", S.shape(S.R1_EXTRA)), doc).status;
    else if (scenario === "R2") verdict = reconciler.reconstruct(p, authority.issue("form-B", S.shape()), doc).status;
    else if (scenario === "R3_FAB") {
      const v = reconciler.reconstruct(p, S.attackerForgedIdTree("auth:form-A:user#9999"), doc);
      verdict = v.status;
      rejected = v.rejected;
    } else {
      const replay = { children: [{ id: cell.cIssuedUserId, tag: "input",
        attrs: { type: "text", name: S.ATTACKER_NAME } }] };
      const v = reconciler.reconstruct(p, replay, doc);
      verdict = v.status; rejected = v.rejected;
    }
  }

  let res;
  if (scenario === "R1") res = S.judgePreserve(p);
  else if (scenario === "R2") res = S.judgeDiscard(p);
  else res = S.judgeForgery(p);
  return { ...res, verdict, rejected };
}

window.c4_setup = setup;
window.c4_apply = apply;
window.__c4Ready = true;
