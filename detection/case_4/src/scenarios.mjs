/* =====================================================================
 * src/scenarios.mjs — 시나리오 빌더 + 판정 함수
 * ---------------------------------------------------------------------
 * 논리적 form 1개(user/email/submit)를 각 모델 포맷으로 표현한다.
 * R3 에서는 공격자가 'user' 슬롯을 악성 정의로 위장 주입한다.
 *
 * 시나리오 정의 (HANDOFF case4-extension §2):
 *   R1 runtime state preservation       — 같은 entity, attr 변경 → 입력값 보존 기대
 *   R2 identity-aware reconstruction(naive) — 시각 동일·다른 lineage → 입력값 폐기 기대
 *   R3 adversarial identity forgery     — 공격자가 다른 entity 를 같은 식별자로 위장
 * ===================================================================== */

export const TYPED = "user-typed-value";
export const ATTACKER_NAME = "attacker-controlled";

// 슬롯 정의(권위 제출용 id-less shape의 기반). extra 로 attr 추가(R1 의 maxlength 등).
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

// ---- Model B: keyed tree (key = slot 이름; developer hint) ----
export function keyedTree(extra = {}) {
  return { children: slots(extra).map((c) => ({ key: c.slot, tag: c.tag, attrs: c.attrs })) };
}

// ---- Model D: server-id tree (serverId = 서버 발급 id 맵에서) ----
export function serverIdTree(idMap, extra = {}) {
  return { children: slots(extra).map((c) => ({ serverId: idMap[c.slot], tag: c.tag, attrs: c.attrs })) };
}

// ---- Model A: innerHTML 문자열 ----
export function html(extra = {}) {
  const ml = (a) => (a && a.maxlength ? ` maxlength="${a.maxlength}"` : "");
  return (
    `<input type="text" name="user"${ml(extra.user)}>` +
    `<input type="email" name="email"${ml(extra.email)}>` +
    `<button type="submit"></button>`
  );
}

// R1 의 attr 변경분(maxlength 추가)
export const R1_EXTRA = { user: { maxlength: "32" }, email: { maxlength: "64" } };

// ---- R3 공격 트리: 'user' 슬롯을 악성 정의로 바꾸되 식별자는 기존과 같게 위조 ----
// B: 같은 key="user" / D: 같은 serverId(=피해자 것) / C: 위조 id 문자열
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
  // 공격자는 권위를 거치지 않고 위조 id 를 직접 박는다(권위 대장에 없는 값).
  return {
    children: [
      { id: forgedUserId, tag: "input", attrs: { type: "text", name: ATTACKER_NAME } },
    ],
  };
}

/* =====================================================================
 * 판정 함수 — 모두 'user' 위치 노드를 본다.
 * ===================================================================== */

// R1: 사용자 입력값 보존 여부
export function judgePreserve(parent) {
  const node = parent.querySelector('input[name="user"]');
  return { preserved: !!node && node.value === TYPED, value: node ? node.value : null };
}

// R2: 사용자 입력값 폐기 여부 (= 새 노드라 빈 값)
export function judgeDiscard(parent) {
  const node = parent.querySelector('input[name="user"]');
  // 폐기 충족: user 노드가 없거나(완전 교체) 값이 비었을 때
  const value = node ? node.value : null;
  return { discarded: !node || node.value === "", value };
}

// R3: 위조 성공 여부
//   attackerPresent   := DOM 에 공격자 정의(name=ATTACKER) 노드가 존재
//   attackerStoleValue:= 그 공격자 노드가 이전 입력값을 탈취해 보유
//   forgerySucceeded  := 둘 다 참
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
