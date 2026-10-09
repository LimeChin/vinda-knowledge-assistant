const app = document.querySelector("#app");
const starters = [
  "为什么今天没有生成拜访计划？",
  "海外订单为什么一直是 ERP 处理中？",
  "经理为什么看不到员工日报？",
  "考勤为什么被判定为外勤？",
];

let encryptedBundle;
let knowledgeItems = [];
let conversationContext = {
  lastQuestion: "",
  lastDomain: "",
  lastTitle: "",
};

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
          <p class="baseline">${knowledgeItems.length} 条已蒸馏知识 · 重要操作请带环境与单号复核</p>
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

function includesTerm(question, term) {
  return normalize(question).includes(normalize(term));
}

function detectDomains(question) {
  const domains = new Set();
  if (/海外|台湾|韩国|erp|税码|收单地址|收货地址/i.test(question)) domains.add("海外App与海外订单");
  if (/订单管理|已处理|未处理|待业务员|销管|订单页签/.test(question) && !/海外|台湾|韩国/i.test(question)) domains.add("国内订单与订单管理");
  if (/拜访|路线|轨迹|进店|离店|未访|非拜访/.test(question)) domains.add("拜访计划路线轨迹与进离店");
  if (/日报|排班|考勤|签到|签退|迟到|早退|请假|销量/.test(question)) domains.add("日报排班考勤请假与销量");
  if (/TPM|促销|预算|返利|核销|活动方案/i.test(question)) domains.add("TPM活动审批核销与报表");
  if (/MFA|主数据|门店编码|货架品牌|经销商关系/i.test(question)) domains.add("门店主数据与MFA");
  if (/报表|配置中心|流程中心|导出/.test(question)) domains.add("动态报表与配置功能");
  if (/审批人|审批节点|候选人|组织权限|数据权限/.test(question)) domains.add("审批与组织权限");
  if (/登录|LDAP|OpenID|账号|经销商门户/i.test(question)) domains.add("账号与登录");
  if (/积分|M947/.test(question)) domains.add("拜访与积分");
  if (/ClickHouse|Kafka|定时任务|XXL|实时同步|缓存/i.test(question)) domains.add("第三方接口任务调度与数据同步");
  if (/费用核销|ConfM891|活动反馈|图片上传/i.test(question)) domains.add("费用核销与活动反馈");
  if (/课程|考试|补考|成绩|试卷|题库|每周一测|课件|学习完成|内容库/.test(question)) domains.add("学习考试与内容库");
  if (/消息|通知|短信|邮件|验证码|模板|收件人|网易云信|微信|钉钉/.test(question)) domains.add("消息通知与渠道");
  return domains;
}

function isFollowUp(question) {
  const compact = normalize(question);
  const explicitFollowUp = /^(那|这个|那个|我说的是|我想问的是|刚才|继续|还有|是不是|对了)/.test(question.trim());
  const shortReference = compact.length <= 8 && !/(为什么|怎么|如何|哪里|什么|哪个|多少)/.test(question);
  return explicitFollowUp || shortReference;
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
  if (item.exclude?.some((term) => includesTerm(question, term))) return Number.NEGATIVE_INFINITY;
  if (item.mustAll?.length && !item.mustAll.every((term) => includesTerm(question, term))) return Number.NEGATIVE_INFINITY;
  if (item.mustAny?.length && !item.mustAny.some((term) => includesTerm(question, term))) return Number.NEGATIVE_INFINITY;
  let total = 0;
  const searchTerms = [...new Set([...(item.keywords || []), ...(item.aliases || [])])];
  for (const keyword of searchTerms) {
    const word = normalize(keyword);
    if (query.includes(word)) total += Math.max(9, word.length * 3);
    for (const pair of bigrams(word)) if (queryPairs.has(pair)) total += 1;
  }
  const title = normalize(item.title);
  if (query.includes(title) || title.includes(query)) total += 12;
  for (const pair of bigrams(title)) if (queryPairs.has(pair)) total += 1;
  const detectedDomains = detectDomains(question);
  if (detectedDomains.size && item.domain) {
    total += detectedDomains.has(item.domain) ? 14 : -10;
  }
  if (total > 0) total += Math.min(5, Math.floor((item.priority || 0) / 10));
  return total;
}

function answerQuestion(question) {
  const effectiveQuestion = isFollowUp(question) && conversationContext.lastQuestion
    ? `${conversationContext.lastQuestion} ${conversationContext.lastDomain} ${conversationContext.lastTitle} ${question}`
    : question;
  const ranked = knowledgeItems
    .map((item) => ({ item, score: score(effectiveQuestion, item) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const second = ranked[1];
  if (!best || best.score < 14) {
    return {
      answer: "目前没有定位到足够明确的知识条目。请补充业务域、环境、用户或单号和页面现象。",
      level: "待补充问题",
      sources: [],
      related: ranked.slice(0, 3).map((entry) => entry.item.title),
      needsContext: "业务域、环境、用户或单号、发生时间、页面提示。",
      matched: false,
      effectiveQuestion,
    };
  }
  if (second && best.item.domain !== second.item.domain && best.score - second.score < 3) {
    return {
      answer: `我找到了两个接近的方向：${best.item.domain}和${second.item.domain}，现在还不能安全地替你选择。请补充具体页面名称或业务入口。`,
      level: "需要确认业务范围",
      sources: [],
      related: ranked.slice(0, 3).map((entry) => entry.item.title),
      needsContext: "页面名称、PC/App 入口，以及你看到的页签或状态名称。",
      matched: false,
      effectiveQuestion,
    };
  }
  const related = [...(best.item.related || []), ...ranked.slice(1, 3).filter((entry) => entry.score >= 5).map((entry) => entry.item.title)]
    .filter((value, index, array) => array.indexOf(value) === index).slice(0, 3);
  conversationContext = {
    lastQuestion: question,
    lastDomain: best.item.domain || "",
    lastTitle: best.item.title,
  };
  return { ...best.item, related, matched: true, score: best.score, effectiveQuestion };
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
      <div class="feedback-row"><button class="feedback-button" type="button">没有解决</button></div>
      <div class="escalation-box" hidden>
        <strong>转人工前请补齐这些信息</strong>
        <p>环境、账号或订单号、发生时间、页面名称和截图。</p>
        <button class="copy-button" type="button">复制问题模板</button>
      </div>
    </div>`;
  conversation.appendChild(message);
  message.querySelectorAll(".related-button").forEach((button) => button.addEventListener("click", () => showAnswer(button.textContent.trim())));
  const escalation = message.querySelector(".escalation-box");
  message.querySelector(".feedback-button").addEventListener("click", () => {
    escalation.hidden = !escalation.hidden;
  });
  message.querySelector(".copy-button").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const text = `维达助手未解决问题\n原问题：${question}\n助手匹配：${result.title || "未匹配"}\n环境：\n账号/订单号：\n发生时间：\n页面现象：`;
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "已复制，可以发给负责人";
    } catch {
      button.textContent = "复制失败，请截屏反馈";
    }
  });
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
