// 适马小程序 - 签到(每日一次) + 转发6篇(每轮) 详细报错版
// 触发条件：token 刷新（打开小程序）或上一轮异常结束待重试
// 每一步的结果都记录在通知里；静默跳过不发通知，发通知必有执行内容
const BASE = "https://sigmaapi.mad-sea.com";
const KEY_TOKEN = "sigma_token";
const KEY_STATE = "sigma_state";
const FALLBACK_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/144.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI " +
  "MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13) " +
  "UnifiedPCWindowsWechat(0xf2541d41) XWEB/25560";

const arg = $argument || {};
const SHARE_COUNT = parseInt(arg.share_count, 10) || 6;   // 每轮转发篇数
const REST_DAY = arg.rest_day === true || arg.rest_day === "true";

const today = new Date().toISOString().slice(0, 10);

function notify(sub, body) {
  $notification.post("适马任务", sub || "", body || "");
}
function ri(min, max) { return min + Math.floor(Math.random() * (max - min)); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readTokenObj() {
  try {
    const o = JSON.parse($persistentStore.read(KEY_TOKEN) || "");
    if (o && o.token) return { token: o.token, ua: o.ua || FALLBACK_UA };
  } catch (e) {}
  const legacy = $persistentStore.read(KEY_TOKEN);
  return legacy ? { token: legacy, ua: FALLBACK_UA } : null;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function tokenExpMs(token) {
  try {
    let s = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
    const bytes = [];
    let buf = 0, bits = 0;
    for (let i = 0; i < s.length; i++) {
      const v = B64.indexOf(s.charAt(i));
      if (v < 0) continue;
      buf = (buf << 6) | v;
      bits += 6;
      if (bits >= 8) { bits -= 8; bytes.push((buf >> bits) & 0xff); }
    }
    let out = "";
    for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return (JSON.parse(decodeURIComponent(escape(out))).exp || 0) * 1000;
  } catch (e) {
    return 0;
  }
}
function dateHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
function getTodayState() {
  try {
    const st = JSON.parse($persistentStore.read(KEY_STATE) || "{}");
    if (st.date === today) return st;
  } catch (e) {}
  // 每日重置：签到机会刷新
  return { date: today, signed: false, runs: 0, shares_total: 0, lastIdx: 0, token: "", retry: false, expired_notified: "" };
}

const tObj = readTokenObj();
if (!tObj) {
  // 没有 token：静默退出（连小程序都没打开过，无需打扰）
  $done();
} else {
  const st = getTodayState();
  const fresh = st.token !== tObj.token; // token 换新 = 刚打开过小程序
  const expMs = tokenExpMs(tObj.token);

  // ---- 无动作退出（全部静默，不发通知不标完成）----
  if (REST_DAY && dateHash(today) % 10 === 0) $done();
  // token 过期：若上次没提醒过这个 token，提醒一次然后记住
  if (expMs && Date.now() > expMs) {
    if (st.expired_notified !== tObj.token) {
      st.expired_notified = tObj.token;
      $persistentStore.write(JSON.stringify(st), KEY_STATE);
      notify("Token 已过期", "请打开适马小程序刷新，之后任务自动继续");
    }
    $done();
  }
  // ---- 一波只执行一次 ----
  // token 脚本把相隔5分钟内的连续捕获归为同一"波"（burstStart 为波起点）。
  // 检测到新波（burstStart 变化）→ 执行一轮；同一波内后续 token 变化全部忽略。
  if (st.last_burst_start === tObj.burstStart && !st.retry) $done();

  const headers = {
    "Authorization": "Bearer " + tObj.token,
    "Content-Type": "application/json",
    "User-Agent": tObj.ua,
    "Referer": "https://servicewechat.com/wx5e5a712fbcb0682e/93/page-frame.html",
  };

  const api = (method, path, body) =>
    new Promise((resolve, reject) => {
      const opt = { url: BASE + path, headers: headers, timeout: 15000 };
      const cb = (status, _h, data) => {
        if (status === "401") return reject(new Error("token_expired"));
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error("HTTP " + status + " 响应异常"));
        }
      };
      if (method === "GET") $httpClient.get(opt, cb);
      else { opt.body = JSON.stringify(body || {}); $httpClient.post(opt, cb); }
    });

  (async () => {
    const lines = [];          // 每步结果记录
    let stopReason = "";       // 中止原因（空 = 全部执行完）
    let retryable = false;     // 异常结束 → 下个周期自动重试
    let endedFatal = false;    // 不可重试的致命错误（token过期等）

    // 模拟打开小程序后先随便逛逛
    await sleep(fresh ? ri(10000, 40000) : ri(3000, 15000));

    // ---- 步骤1：用户信息（拿昵称，兼做 token 有效性检查）----
    let user;
    try {
      user = (await api("GET", "/Api/Users/GetUserInfo")).data;
      lines.push("1.用户信息 OK（当前积分" + user.points_total + "）");
    } catch (e) {
      if (e.message === "token_expired") {
        endedFatal = true;
        stopReason = "Token 已过期，请打开小程序刷新后自动重试";
      } else {
        stopReason = "步骤1(用户信息)失败: " + e.message;
        retryable = true;
      }
      return end();
    }

    // ---- 步骤2：签到（每日只尝试一次）----
    if (!st.signed) {
      try {
        const sign = await api("POST", "/Api/Users/Signs", {});
        if (sign.code === 0) {
          lines.push("2.签到 成功(+5)");
        } else if ((sign.msg || "").indexOf("已完成") >= 0) {
          lines.push("2.签到 今日已签过(跳过)");
        } else {
          lines.push("2.签到 异常: code=" + sign.code + " " + sign.msg);
        }
        st.signed = true; // 无论结果，今日不再尝试
      } catch (e) {
        if (e.message === "token_expired") { endedFatal = true; stopReason = "签到时 Token 过期"; return end(); }
        lines.push("2.签到 网络失败: " + e.message);
        retryable = true;   // 网络问题，下轮补签
        // 签到失败不标记，下轮重试
      }
      await sleep(ri(4000, 9000));
    } else {
      lines.push("2.签到 今日已尝试过(跳过)");
    }

    // ---- 步骤3：文章列表 ----
    let articles = [];
    try {
      const d = (
        await api("POST", "/Api/Article/GetList", { pageIndex: 1, pageSize: 25 })
      ).data;
      articles = (d.item || []).filter((it) => it.id).map((it) => [it.id, it.title]);
      lines.push("3.文章列表 OK（" + articles.length + " 篇）");
    } catch (e) {
      if (e.message === "token_expired") { endedFatal = true; stopReason = "拉列表时 Token 过期"; return end(); }
      lines.push("3.文章列表 失败: " + e.message);
      stopReason = "步骤3(文章列表)失败";
      retryable = true;
      return end();
    }
    if (!articles.length) {
      lines.push("3.文章列表为空（接口返回0篇）");
      stopReason = "无文章可转发";
      return end();
    }

    // ---- 步骤4：转发 SHARE_COUNT 篇 ----
    let ok = 0, done = 0, idx = st.lastIdx || 0;
    if (idx >= articles.length) idx = 0;
    for (let i = 0; i < SHARE_COUNT; i++) {
      if (idx >= articles.length) idx = 0;
      const id = articles[idx][0];
      const title = articles[idx][1];
      idx++; done++;
      try {
        await api("POST", "/Api/Article/GetDetails", { id: id }); // 模拟点开阅读
        await sleep(ri(6000, 16000));
        const r = await api("POST", "/Api/Article/Shares", {
          WorkID: id,
          WorkTitle: title,
          nickname: user.nickname,
        });
        st.shares_total++;
        if (r.code === 0) {
          ok++;
          lines.push("4." + done + " 转发OK「" + title + "」");
        } else {
          lines.push("4." + done + " 转发被拒[" + title + "]: " + (r.msg || "code=" + r.code));
          // 积分已满/已完成类拒绝 → 今日没意义了，停止
          if ((r.msg || "").indexOf("满") >= 0 || (r.msg || "").indexOf("完成") >= 0) {
            stopReason = "第" + done + "篇被拒: " + r.msg;
            break;
          }
        }
      } catch (e) {
        lines.push("4." + done + " 转发失败[" + title + "]: " + e.message);
        if (e.message === "token_expired") {
          stopReason = "转发中 Token 过期";
          endedFatal = true;
        } else {
          stopReason = "第" + done + "篇转发网络失败";
          retryable = true;
        }
        break;
      }
      await sleep(ri(8000, 20000));
    }
    st.lastIdx = idx % articles.length;

    if (!stopReason) stopReason = "全部执行完毕";

    function end() {
      st.runs++;
      st.token = tObj.token;
      st.last_burst_start = tObj.burstStart; // 标记这波已处理
      st.retry = retryable;      // 异常结束 → 下个周期重试；正常结束 → false
      $persistentStore.write(JSON.stringify(st), KEY_STATE);
      const body = lines.join("\n") + "\n——\n结束: " + stopReason
        + (retryable ? "（下个周期自动重试）" : "");
      notify("第" + st.runs + "轮 · 转发成功" + ok + "/" + done, body);
      console.log("DONE: " + stopReason + "\n" + lines.join("\n"));
      $done();
    }
  })();
}
