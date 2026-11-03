const app = document.querySelector("#app");
const AI_BASE_URL = "https://vinda-knowledge-api.pages.dev";
const starters = [
  "为什么今天没有生成拜访计划？",
  "海外订单为什么一直是 ERP 处理中？",
  "经理为什么看不到员工日报？",
  "考勤为什么被判定为外勤？",
];

let encryptedBundle;
let knowledgeItems = [];
let aiToken = "";
let aiSessionPromise = null;
let conversationContext = {
  lastQuestion: "",
  lastDomain: "",
  lastTitle: "",
  lastAnswer: "",
};
let chatHistory = [];

function rememberChatTurn(question, answer) {
  const cleanQuestion = String(question || "").trim().slice(0, 300);
  const cleanAnswer = String(answer || "").trim().slice(0, 400);
  if (!cleanQuestion || !cleanAnswer) return;
  chatHistory = [...chatHistory.filter((turn) => turn.question !== cleanQuestion), {
    question: cleanQuestion,
    answer: cleanAnswer,
  }].slice(-4);
  conversationContext = {
    ...conversationContext,
    lastQuestion: cleanQuestion,
    lastAnswer: cleanAnswer,
  };
}

function historyPayload() {
  return chatHistory.slice(-4).map((turn) => ({
    question: turn.question,
    answer: turn.answer,
  }));
}

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
        <p class="privacy-note">知识内容已加密保存；邀请码仅用于建立安全会话，不会写入网页或 GitHub。</p>
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
      aiSessionPromise = startAiSession(code).catch(() => undefined);
      input.value = "";
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
        <div class="header-brand"><div class="brand-icon" aria-hidden="true">✣</div><div><strong>维达知识助手</strong><small id="connection-status">AI 增强连接中</small></div></div>
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
          <div class="media-preview" id="media-preview" hidden></div>
          <div class="input-row">
            <label class="attach-button" for="media-input" title="上传图片或视频" aria-label="上传图片或视频">＋</label>
            <input id="media-input" type="file" accept="image/jpeg,image/png,image/gif,image/webp,video/*" multiple hidden />
            <textarea class="question-input" id="question" rows="1" placeholder="可上传截图/视频，或直接描述：为什么看不到今天的拜访计划？"></textarea>
            <button class="send-button" id="send-button" type="submit" disabled aria-label="发送">↑</button>
          </div>
          <p class="baseline">${knowledgeItems.length} 条已蒸馏知识 · 支持图片/视频解析后自动问知识库</p>
        </form>
      </div>
    </section>`;

  const form = document.querySelector("#question-form");
  const input = document.querySelector("#question");
  const send = document.querySelector("#send-button");
  const mediaInput = document.querySelector("#media-input");
  const mediaPreview = document.querySelector("#media-preview");
  let pendingMedia = [];

  const syncSendState = () => {
    send.disabled = !(input.value.trim() || pendingMedia.length);
  };

  const renderMediaPreview = () => {
    if (!pendingMedia.length) {
      mediaPreview.hidden = true;
      mediaPreview.innerHTML = "";
      syncSendState();
      return;
    }
    mediaPreview.hidden = false;
    mediaPreview.innerHTML = pendingMedia.map((item, index) => `
      <div class="media-chip">
        <img src="${item.previewUrl}" alt="附件预览" />
        <span>${escapeHtml(item.label)}</span>
        <button type="button" data-remove="${index}" aria-label="移除附件">×</button>
      </div>`).join("");
    mediaPreview.querySelectorAll("[data-remove]").forEach((button) => {
      button.addEventListener("click", () => {
        const index = Number(button.getAttribute("data-remove"));
        const [removed] = pendingMedia.splice(index, 1);
        if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
        renderMediaPreview();
      });
    });
    syncSendState();
  };

  const ask = (question, media = []) => {
    input.value = "";
    pendingMedia.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl));
    pendingMedia = [];
    renderMediaPreview();
    send.disabled = true;
    showAnswer(question, media);
  };

  mediaInput.addEventListener("change", async () => {
    const files = [...(mediaInput.files || [])];
    mediaInput.value = "";
    for (const file of files) {
      if (pendingMedia.length >= 4) break;
      try {
        const prepared = await prepareMediaFile(file);
        pendingMedia.push(...prepared);
      } catch (error) {
        const status = document.querySelector("#connection-status");
        if (status) status.textContent = error.message || "附件处理失败";
      }
    }
    renderMediaPreview();
  });

  input.addEventListener("input", syncSendState);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (input.value.trim() || pendingMedia.length) ask(input.value.trim(), [...pendingMedia]);
    }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (input.value.trim() || pendingMedia.length) ask(input.value.trim(), [...pendingMedia]);
  });
  document.querySelectorAll(".starter").forEach((button) => button.addEventListener("click", () => ask(button.textContent.trim())));
  resumePendingTickets();
}

function normalize(value) {
  return value.toLowerCase().replace(/[\s，。？！、：；,.?!:;（）()\[\]【】_-]+/g, "");
}

function includesTerm(question, term) {
  return normalize(question).includes(normalize(term));
}

function detectDomains(question) {
  const domains = new Set();
  if (/OMS邀请码|OMS接口|返利确认函|返利达成|合同坎级|对账函|季度物料|物料查询|物料订单|经销商小程序|经销商门户小程序|经销商角色|收货确认|信用额度|超账期|满意度调查|首页红点|首页最新信息|产品介绍|推广指引|新品发布|促销政策审批|物料订单后台|未读弹窗|阅读人数|消息下架|重新发布.*版本|公告.*OA|政策.*OA/i.test(question)) domains.add("OMS经销商门户小程序");
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
  const explicitFollowUp = /^(那|这个|那个|我说的是|我想问的是|刚才|继续|还有|是不是|对了)/.test(question.trim());
  return explicitFollowUp;
}

function bigrams(value) {
  const clean = normalize(value);
  const result = new Set();
  for (let index = 0; index < clean.length - 1; index += 1) result.add(clean.slice(index, index + 2));
  return result;
}

const weakSignals = new Set(["活动", "数据", "任务", "同步", "接口", "报表", "订单", "门店", "消息", "通知", "账号", "审批", "流程", "状态", "图片", "用户", "权限"]);

function hasStrongSignal(question, item) {
  const query = normalize(question);
  const title = normalize(item.title);
  if (query.includes(title) || (query.length >= 6 && title.includes(query))) return true;
  if (detectDomains(question).has(item.domain)) return true;
  const terms = [...new Set([...(item.keywords || []), ...(item.aliases || [])])];
  return terms.some((term) => {
    const word = normalize(term);
    return word.length >= 2 && !weakSignals.has(word) && query.includes(word);
  });
}

function score(question, item) {
  const query = normalize(question);
  const queryPairs = bigrams(question);
  if (item.exclude?.some((term) => includesTerm(question, term))) return Number.NEGATIVE_INFINITY;
  if (item.mustAll?.length && !item.mustAll.every((term) => includesTerm(question, term))) return Number.NEGATIVE_INFINITY;
  if (item.mustAny?.length && !item.mustAny.some((term) => includesTerm(question, term))) return Number.NEGATIVE_INFINITY;
  if (!hasStrongSignal(question, item)) return Number.NEGATIVE_INFINITY;
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
  if (total > 0) total += Math.max(-50, Math.min(5, Math.floor((item.priority || 0) / 10)));
  return total;
}

function answerQuestion(question) {
  const effectiveQuestion = isFollowUp(question) && conversationContext.lastQuestion
    ? `${conversationContext.lastQuestion} ${conversationContext.lastAnswer} ${conversationContext.lastDomain} ${conversationContext.lastTitle} ${question}`
    : question;
  const ranked = knowledgeItems
    .map((item) => ({ item, score: score(effectiveQuestion, item) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const second = ranked[1];
  if (!best || best.score < 14) {
    return {
      answer: "这个问题知识库里没有直接结论。我去维达运维助手里查一下，请稍等片刻。",
      level: "已转维达运维助手",
      sources: [],
      related: ranked.slice(0, 3).map((entry) => entry.item.title),
      needsContext: "业务模块、页面名称和页面提示。",
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
    lastAnswer: best.item.answer || "",
  };
  return { ...best.item, related, matched: true, score: best.score, effectiveQuestion };
}

async function askAi(question) {
  if (aiSessionPromise) await aiSessionPromise;
  if (!aiToken) throw new Error("AI session unavailable");
  const response = await fetch(`${AI_BASE_URL}/ask`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${aiToken}`,
    },
    body: JSON.stringify({ question, history: historyPayload() }),
  });
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) throw new Error("AI service unavailable");
  const result = await response.json();
  if (!response.ok || !result.answer) throw new Error(result.error || "AI request failed");
  return result;
}

async function askAiWithMedia(note, mediaItems) {
  if (aiSessionPromise) await aiSessionPromise;
  if (!aiToken) throw new Error("AI session unavailable");
  const images = mediaItems.map((item) => ({
    mimeType: item.mimeType,
    dataBase64: item.dataBase64,
  }));
  const response = await fetch(`${AI_BASE_URL}/ask-media`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${aiToken}`,
    },
    body: JSON.stringify({ note, images, history: historyPayload() }),
  });
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) throw new Error("AI service unavailable");
  const result = await response.json();
  if (!response.ok || !result.answer) throw new Error(result.error || "媒体解析失败");
  return result;
}

function canvasToJpegBase64(canvas, quality = 0.72) {
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  const match = dataUrl.match(/^data:(image\/jpeg);base64,(.+)$/);
  if (!match) throw new Error("图片压缩失败");
  return { mimeType: match[1], dataBase64: match[2], previewUrl: dataUrl };
}

async function compressImageFile(file, maxEdge = 1280) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("无法读取图片"));
      element.src = objectUrl;
    });
    const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const compressed = canvasToJpegBase64(canvas);
    return [{
      ...compressed,
      label: file.name || "图片",
      sourceType: "image",
    }];
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function extractVideoFrames(file, frameCount = 3) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.src = objectUrl;
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("无法读取视频"));
    });
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const frames = [];
    for (let index = 0; index < frameCount; index += 1) {
      const at = duration * ((index + 1) / (frameCount + 1));
      await new Promise((resolve, reject) => {
        const onSeeked = () => {
          video.removeEventListener("seeked", onSeeked);
          resolve();
        };
        video.addEventListener("seeked", onSeeked);
        try {
          video.currentTime = Math.min(duration - 0.05, Math.max(0.05, at));
        } catch (error) {
          video.removeEventListener("seeked", onSeeked);
          reject(error);
        }
      });
      const scale = Math.min(1, 1280 / Math.max(video.videoWidth || 1, video.videoHeight || 1));
      canvas.width = Math.max(1, Math.round((video.videoWidth || 640) * scale));
      canvas.height = Math.max(1, Math.round((video.videoHeight || 360) * scale));
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frame = canvasToJpegBase64(canvas);
      frames.push({
        ...frame,
        label: `${file.name || "视频"} · 帧${index + 1}`,
        sourceType: "video-frame",
      });
    }
    return frames;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function prepareMediaFile(file) {
  if (file.type.startsWith("image/")) {
    if (file.size > 12 * 1024 * 1024) throw new Error("单张图片请小于 12MB");
    return compressImageFile(file);
  }
  if (file.type.startsWith("video/")) {
    if (file.size > 80 * 1024 * 1024) throw new Error("单个视频请小于 80MB");
    return extractVideoFrames(file);
  }
  throw new Error("仅支持图片或视频");
}

async function startAiSession(code) {
  try {
    const response = await fetch(`${AI_BASE_URL}/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) throw new Error("AI service unavailable");
    const result = await response.json();
    if (!response.ok || !result.token) throw new Error(result.error || "AI session failed");
    aiToken = result.token;
    const status = document.querySelector("#connection-status");
    if (status) status.textContent = "AI + 项目知识库";
  } catch (error) {
    aiToken = "";
    const status = document.querySelector("#connection-status");
    if (status) status.textContent = "项目知识库已连接 · AI 暂不可用";
    throw error;
  }
}

async function requestOpsLookup(question, result) {
  if (aiSessionPromise) await aiSessionPromise;
  if (!aiToken) throw new Error("登录已失效，请重新输入邀请码");
  const response = await fetch(`${AI_BASE_URL}/escalate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${aiToken}`,
    },
    body: JSON.stringify({
      question,
      priorAnswer: result.answer || "",
      phenomenon: result.phenomenon || "",
      derivedQuestion: result.derivedQuestion || result.searchQuestion || "",
      history: historyPayload(),
    }),
  });
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) throw new Error("运维助手暂未接通");
  const payload = await response.json();
  if (!response.ok || !payload.ticketId) throw new Error(payload.error || "运维助手暂未接通，请稍后再试");
  return payload;
}

async function fetchTicket(ticketId) {
  if (aiSessionPromise) await aiSessionPromise;
  if (!aiToken || !ticketId) throw new Error("no ticket");
  const response = await fetch(`${AI_BASE_URL}/ticket/${encodeURIComponent(ticketId)}`, {
    headers: { authorization: `Bearer ${aiToken}` },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "ticket fetch failed");
  return result;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PENDING_KEY = "vinda-ops-pending";

function readPending() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    const freshAfter = Date.now() - 24 * 60 * 60 * 1000;
    return parsed.filter((item) => item?.ticketId && item?.question && Number(item.at) > freshAfter);
  } catch {
    return [];
  }
}

function writePending(list) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(list.slice(-8)));
  } catch {
    /* private mode can reject storage */
  }
}

function rememberPending(ticketId, question) {
  const list = readPending().filter((item) => item.ticketId !== ticketId);
  list.push({ ticketId, question: String(question || "").slice(0, 500), at: Date.now() });
  writePending(list);
}

function forgetPending(ticketId) {
  writePending(readPending().filter((item) => item.ticketId !== ticketId));
}

function pauseWhileHidden() {
  if (!document.hidden) return Promise.resolve();
  return new Promise((resolve) => {
    const onShow = () => {
      if (document.hidden) return;
      document.removeEventListener("visibilitychange", onShow);
      resolve();
    };
    document.addEventListener("visibilitychange", onShow);
  });
}

async function waitForTicket(ticketId) {
  if (aiSessionPromise) await aiSessionPromise;
  if (!aiToken || !ticketId) throw new Error("no ticket");
  const response = await fetch(`${AI_BASE_URL}/ticket/${encodeURIComponent(ticketId)}/wait`, {
    headers: { authorization: `Bearer ${aiToken}` },
  });
  const result = await response.json().catch(() => ({}));
  if (response.status === 404 && result.error === "Not found") {
    await wait(2500);
    return fetchTicket(ticketId);
  }
  if (!response.ok) throw new Error(result.error || "ticket fetch failed");
  return result;
}

function showOpsWaiting(message, ticketId) {
  const card = message.querySelector(".answer-card");
  if (!card) return;
  card.innerHTML = `
    <div class="answer-level">◉ 已转维达运维助手</div>
    <p class="answer-text">已发出，回复会直接出现在这张卡片里。（工单 ${escapeHtml(ticketId)}）</p>`;
}

async function pollOpsTicket(message, question, ticketId) {
  const card = message.querySelector(".answer-card");
  if (!card || !ticketId) return;
  const generation = (Number(message.dataset.opsGen) || 0) + 1;
  message.dataset.opsGen = String(generation);
  rememberPending(ticketId, question);
  showOpsWaiting(message, ticketId);
  while (message.dataset.opsGen === String(generation)) {
    await pauseWhileHidden();
    if (message.dataset.opsGen !== String(generation)) return;
    try {
      const ticket = await waitForTicket(ticketId);
      if (message.dataset.opsGen !== String(generation)) return;
      if (ticket.status === "answered" && ticket.answer) {
        forgetPending(ticketId);
        rememberChatTurn(question, ticket.answer);
        renderAnswerCard(message, question, {
          answer: ticket.answer,
          level: ticket.level || "运维核查结论",
          sources: [],
          related: [],
          ticketId,
        });
        return;
      }
    } catch (error) {
      if (String(error?.message || "").includes("不存在")) {
        forgetPending(ticketId);
        card.innerHTML = `
          <div class="answer-level">◉ 工单已失效</div>
          <p class="answer-text">${escapeHtml(error.message)}（工单 ${escapeHtml(ticketId)}）</p>`;
        return;
      }
      await wait(2000);
    }
  }
}

function resumePendingTickets() {
  const pending = readPending();
  if (!pending.length) return;
  const welcome = document.querySelector("#welcome");
  if (welcome) welcome.remove();
  const conversation = document.querySelector("#conversation");
  for (const item of pending) {
    const message = document.createElement("article");
    message.className = "message";
    message.innerHTML = `
      <div class="question-bubble">${escapeHtml(item.question)}</div>
      <div class="answer-card"></div>`;
    conversation.appendChild(message);
    pollOpsTicket(message, item.question, item.ticketId);
  }
}

function renderAnswerCard(message, question, result) {
  if ((result.pending || result.level === "已转维达运维助手") && result.ticketId) {
    pollOpsTicket(message, question, result.ticketId);
    return;
  }
  if (result.answer && result.level !== "已转维达运维助手" && !result.pending) {
    rememberChatTurn(question, result.answer);
  }
  const businessAnswer = limitSentences(result.answer, 3);
  const followupHint = result.searchQuestion
    && result.searchQuestion !== question
    && result.searchQuestion !== result.derivedQuestion
    ? result.searchQuestion
    : "";
  message.querySelector(".answer-card").innerHTML = `
    <div class="answer-level">◉ ${escapeHtml(result.level)}</div>
    ${result.phenomenon ? `<div class="phenomenon-box"><strong>AI 识别到的现象</strong>${escapeHtml(result.phenomenon)}</div>` : ""}
    ${result.derivedQuestion ? `<div class="derived-question">转问知识库：${escapeHtml(result.derivedQuestion)}</div>` : ""}
    ${followupHint ? `<div class="derived-question">结合上文理解为：${escapeHtml(followupHint)}</div>` : ""}
    <p class="answer-text">${escapeHtml(businessAnswer)}</p>
    ${result.needsContext ? `<div class="context-box"><strong>继续确认需要</strong>${escapeHtml(result.needsContext)}</div>` : ""}
    ${result.related?.length ? `<div class="related-row"><span class="related-label">相关问题</span>${result.related.map((item) => `<button class="related-button" type="button">${escapeHtml(item)}</button>`).join("")}</div>` : ""}
    <div class="feedback-row">
      <button class="feedback-button" type="button">没有解决</button>
      <button class="ops-button" type="button">调用运维助手去查</button>
      <p class="ops-error"></p>
    </div>
    <div class="escalation-box" hidden>
      <strong>未解决时请补齐这些信息</strong>
      <p>环境、账号或订单号、发生时间、页面名称和截图。未命中知识库时会转维达运维助手核查，结论会回到本对话框。</p>
      <button class="copy-button" type="button">复制问题模板</button>
    </div>`;
  message.querySelectorAll(".related-button").forEach((button) => button.addEventListener("click", () => showAnswer(button.textContent.trim())));
  const escalation = message.querySelector(".escalation-box");
  message.querySelector(".feedback-button").addEventListener("click", () => {
    escalation.hidden = !escalation.hidden;
  });
  const opsButton = message.querySelector(".ops-button");
  const opsError = message.querySelector(".ops-error");
  opsButton.addEventListener("click", async () => {
    opsError.textContent = "";
    opsButton.disabled = true;
    opsButton.textContent = "正在转给运维助手…";
    try {
      const escalated = await requestOpsLookup(question, result);
      pollOpsTicket(message, question, escalated.ticketId);
    } catch (error) {
      opsButton.disabled = false;
      opsButton.textContent = "调用运维助手去查";
      opsError.textContent = error?.message || "调用失败，请稍后再试";
    }
  });
  message.querySelector(".copy-button").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const text = `维达助手未解决问题\n原问题：${question}\n现象描述：${result.phenomenon || ""}\n派生问题：${result.derivedQuestion || ""}\n助手匹配：${result.matchedTitle || result.title || "未匹配"}\n环境：\n账号/订单号：\n发生时间：\n页面现象：`;
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "已复制，可以发给负责人";
    } catch {
      button.textContent = "复制失败，请截屏反馈";
    }
  });
}

function limitSentences(value, limit) {
  const normalized = String(value || "").replace(/\s+/g, " ").replace(/•\s*/g, "").trim();
  const sentences = normalized.match(/[^。！？!?]+[。！？!?]?/g) || [];
  return sentences.slice(0, limit).join("").trim() || normalized;
}

async function showAnswer(question, mediaItems = []) {
  const welcome = document.querySelector("#welcome");
  if (welcome) welcome.remove();
  const conversation = document.querySelector("#conversation");
  const message = document.createElement("article");
  message.className = "message";
  const displayQuestion = question || (mediaItems.length ? "（已上传截图/视频，请根据现象分析）" : "");
  const mediaHtml = mediaItems.length
    ? `<div class="question-media">${mediaItems.slice(0, 4).map((item) => `<img src="${item.previewUrl || `data:${item.mimeType};base64,${item.dataBase64}`}" alt="${escapeHtml(item.label || "附件")}" />`).join("")}</div>`
    : "";
  message.innerHTML = `
    <div class="question-bubble">${escapeHtml(displayQuestion)}${mediaHtml}</div>
    <div class="answer-card">
      <div class="answer-level">◉ ${mediaItems.length ? "AI 正在解析图片/视频现象" : "AI 正在结合项目知识分析"}</div>
      <p class="answer-text">${mediaItems.length ? "先描述页面现象，再发给知识库助手，请稍候…" : "正在查找相关代码结论，请稍候…"}</p>
    </div>`;
  conversation.appendChild(message);
  requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }));

  let result;
  try {
    result = mediaItems.length
      ? await askAiWithMedia(question, mediaItems)
      : await askAi(question);
    const status = document.querySelector("#connection-status");
    if (status) status.textContent = "AI + 项目知识库";
  } catch (error) {
    if (mediaItems.length) {
      result = {
        answer: error?.message || "图片/视频解析失败，请改用文字描述，或稍后重试。",
        level: "媒体解析失败",
        sources: [],
        related: [],
      };
    } else {
      result = answerQuestion(question);
      result.level = `${result.level} · AI 暂不可用`;
    }
    const status = document.querySelector("#connection-status");
    if (status) status.textContent = mediaItems.length ? "媒体解析异常" : "项目知识库已连接 · AI 暂不可用";
  }
  renderAnswerCard(message, displayQuestion, result);
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
