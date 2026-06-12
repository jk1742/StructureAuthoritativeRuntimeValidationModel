/* src/scenarios.mjs */

export const TYPED = "user-typed-value";
export const ATTACKER_NAME = "attacker-controlled";

function slots(extra = {}) {
  return [
    { slot: "user",   tag: "input",  attrs: { type: "text",  name: "user",  ...(extra.user || {}) } },
    { slot: "email",  tag: "input",  attrs: { type: "email", name: "email", ...(extra.email || {}) } },
    { slot: "submit", tag: "button", attrs: { type: "submit" } },
  ];
}

// ---- Model C: id-less shape (client → authority) ----
export function shape(extra = {}) {
  return { children: slots(extra) };
}

// ---- Model B: keyed tree (key = slot name; developer hint) ----
export function keyedTree(extra = {}) {
  return { children: slots(extra).map((c) => ({ key: c.slot, tag: c.tag, attrs: c.attrs })) };
}

// ---- Model D: server-id tree (serverId = server issued id) ----
export function serverIdTree(idMap, extra = {}) {
  return { children: slots(extra).map((c) => ({ serverId: idMap[c.slot], tag: c.tag, attrs: c.attrs })) };
}

// ---- Model A: innerHTML String ----
export function html(extra = {}) {
  const ml = (a) => (a && a.maxlength ? ` maxlength="${a.maxlength}"` : "");
  return (
    `<input type="text" name="user"${ml(extra.user)}>` +
    `<input type="email" name="email"${ml(extra.email)}>` +
    `<button type="submit"></button>`
  );
}

export const R1_EXTRA = { user: { maxlength: "32" }, email: { maxlength: "64" } };

export function attackerKeyedTree() {
  const t = keyedTree();
  t.children[0] = { key: "user", tag: "input", attrs: { type: "text", name: ATTACKER_NAME } };
  return t;
}
export function attackerServerIdTree(victimUserServerId) {
  const t = serverIdTree({ user: victimUserServerId, email: "sid-email", submit: "sid-submit" });
  t.children[0] = { serverId: victimUserServerId, tag: "input", attrs: { type: "text", name: ATTACKER_NAME } };
  return t;
}
export function attackerForgedIdTree(forgedUserId) {
  return {
    children: [
      { id: forgedUserId, tag: "input", attrs: { type: "text", name: ATTACKER_NAME } },
    ],
  };
}

export function judgePreserve(parent) {
  const node = parent.querySelector('input[name="user"]');
  return { preserved: !!node && node.value === TYPED, value: node ? node.value : null };
}

export function judgeDiscard(parent) {
  const node = parent.querySelector('input[name="user"]');
  const value = node ? node.value : null;
  return { discarded: !node || node.value === "", value };
}


export function judgeForgery(parent) {
  const attackerNode = parent.querySelector(`[name="${ATTACKER_NAME}"]`);
  const attackerPresent = !!attackerNode;
  const attackerStoleValue = attackerPresent && attackerNode.value === TYPED;
  const domSummary =
    Array.from(parent.children)
      .map((n) => `${n.tagName.toLowerCase()}[name=${n.getAttribute("name")}]="${n.value || ""}"`)
      .join(", ") || "(empty)";
  return { forgerySucceeded: attackerPresent && attackerStoleValue, attackerPresent, attackerStoleValue, domSummary };
}
