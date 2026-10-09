const app = document.querySelector("#app");
const starters = [
  "为什么今天没有生成拜访计划？",
  "海外订单为什么一直是 ERP 处理中？",
  "经理为什么看不到员工日报？",
  "考勤为什么被判定为外勤？",
];

let encryptedBundle;
let knowledgeItems = [];

const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
}[char]));

const fromBase64 = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

async function decryptKnowledge(code) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(code.trim()),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: fromBase64(encryptedBundle.salt), iterations: encryptedBundle.iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(encryptedBundle.iv) },
    key,
    fromBase64(encryptedBundle.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

function renderUnlock() {
  app.innerHTML = `
    <section class="unlock-shell">
      <form class="unlock-card" id="unlock-form">
        <div class="brand-row"><div class="brand-icon" aria-hidden="true">✣</div><span>维达知识助手</span></div>
        <span class="eyebrow">内部业务知识</span>
        <h1>先验证邀请码</h1>
        <p class="lead">验证后即可查询门店、拜访、审批、TPM、报表、海外订单等项目逻辑。</p>
        <label class="field-label" for="access-code">邀请码</label>
        <input class="code-input" id="access-code" autocomplete="off" autocapitalize="characters" placeholder="请输入邀请码" />
        <button class="primary-button" id="unlock-button" type="submit">进入助手</button>
        <p class="error" id="unlock-error" role="alert"></p>
        <p class="privacy-note">知识内容已加密保存；验证只在当前手机浏览器中完成，不会上传邀请码。</p>
      </form>
    </section>`;

  const form = document.querySelector("#unlock-form");
  const input = document.querySelector("#access-code");
  const button = document.querySelector("#unlock-button");
  const error = document.querySelector("#unlock-error");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = input.value.trim();
    if (!code) return;
    button.disabled = true;
    button.textContent = "正在验证…";
    error.textContent = "";
    try {
      knowledgeItems = await decryptKnowledge(code);
      renderChat();
    } catch {
      error.textContent = "邀请码不正确，请重新输入。";
      input.select();
      button.disabled = false;
      button.textContent = "进入助手";
    }
  });
}

function renderChat() {
  app.innerHTML = `
    <section class="chat-shell">
      <header class="chat-header">
        <div class="header-brand"><div class="brand-icon" aria-hidden="true">✣</div><div><strong>维达知识助手</strong><small>代码知识已连接</small></div></div>
        <span class="internal-badge">内部使用</span>
      </header>
      <div class="conversation" id="conversation">
        <section class="welcome" id="welcome">
          <h1>今天想确认什么业务逻辑？</h1>
          <p class="lead">直接描述现象即可。助手会先给结论，再说明条件和依据。</p>
          <div class="starter-grid">${starters.map((item) => `<button class="starter" type="button">${escapeHtml(item)}</button>`).join("")}</div>
        </section>
      </div>
      <div class="composer-wrap">
        <form class="composer" id="question-form">
          <div class="input-row"><textarea class="question-input" id="question" rows="1" placeholder="例如：为什么这个员工看不到今天的拜访计划？"></textarea><button class="send-button" id="send-button" type="submit" disabled aria-label="发送">↑</button></div>
          <p class="baseline">知识基线 2026-10-09 · 重要操作请带环境与单号复核</p>
        </form>
      </div>
    </section>`;

  const form = document.querySelector("#question-form");
  const input = document.querySelector("#question");
  const send = document.querySelector("#send-button");
  const ask = (question) => {
    input.value = "";
    send.disabled = true;
    showAnswer(question);
  };
  input.addEventListener("input", () => { send.disabled = !input.value.trim(); });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (input.value.trim()) ask(input.value.trim());
    }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (input.value.trim()) ask(input.value.trim());
  });
  document.querySelectorAll(".starter").forEach((button) => button.addEventListener("click", () => ask(button.textContent.trim())));
}

function normalize(value) {
  return value.toLowerCase().replace(/[\s，。？！、：；,.?!:;（）()\[\]【】_-]+/g, "");
}

function bigrams(value) {
  const clean = normalize(value);
  const result = new Set();
  for (let index = 0; index < clean.length - 1; index += 1) result.add(clean.slice(index, index + 2));
  return result;
}

function score(question, item) {
  const query = normalize(question);
  const queryPairs = bigrams(question);
  let total = 0;
  for (const keyword of item.keywords) {
    const word = normalize(keyword);
    if (query.includes(word)) total += Math.max(9, word.length * 3);
    for (const pair of bigrams(word)) if (queryPairs.has(pair)) total += 1;
  }
  const title = normalize(item.title);
  if (query.includes(title) || title.includes(query)) total += 12;
  for (const pair of bigrams(title)) if (queryPairs.has(pair)) total += 1;
  return total;
}

function answerQuestion(question) {
  const ranked = knowledgeItems.map((item) => ({ item, score: score(question, item) })).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best || best.score < 5) {
    return {
      answer: "目前没有定位到足够明确的知识条目。请补充业务域、环境、用户或单号和页面现象。",
      level: "待补充问题",
      sources: [],
      related: starters.slice(0, 3),
      needsContext: "业务域、环境、用户或单号、发生时间、页面提示。",
    };
  }
  const related = [...(best.item.related || []), ...ranked.slice(1, 3).filter((entry) => entry.score >= 5).map((entry) => entry.item.title)]
    .filter((value, index, array) => array.indexOf(value) === index).slice(0, 3);
  return { ...best.item, related };
}

function showAnswer(question) {
  const welcome = document.querySelector("#welcome");
  if (welcome) welcome.remove();
  const result = answerQuestion(question);
  const conversation = document.querySelector("#conversation");
  const message = document.createElement("article");
  message.className = "message";
  message.innerHTML = `
    <div class="question-bubble">${escapeHtml(question)}</div>
    <div class="answer-card">
      <div class="answer-level">◉ ${escapeHtml(result.level)}</div>
      <p class="answer-text">${escapeHtml(result.answer)}</p>
      ${result.needsContext ? `<div class="context-box"><strong>继续确认需要</strong>${escapeHtml(result.needsContext)}</div>` : ""}
      ${result.sources?.length ? `<details><summary>查看依据</summary><ul>${result.sources.map((source) => `<li>${escapeHtml(source)}</li>`).join("")}</ul></details>` : ""}
      ${result.related?.length ? `<div class="related-row"><span class="related-label">相关问题</span>${result.related.map((item) => `<button class="related-button" type="button">${escapeHtml(item)}</button>`).join("")}</div>` : ""}
    </div>`;
  conversation.appendChild(message);
  message.querySelectorAll(".related-button").forEach((button) => button.addEventListener("click", () => showAnswer(button.textContent.trim())));
  requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }));
}

fetch("./knowledge.enc.json", { cache: "no-store" })
  .then((response) => {
    if (!response.ok) throw new Error("load failed");
    return response.json();
  })
  .then((bundle) => { encryptedBundle = bundle; renderUnlock(); })
  .catch(() => {
    app.innerHTML = `<section class="loading-screen"><div class="brand-icon">!</div><p>知识库加载失败，请稍后重试。</p></section>`;
  });
