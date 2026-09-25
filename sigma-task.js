// 适马小程序 - 每日签到 + 转发刷分（cron 驱动，伪装增强版）
// - 新鲜 token（刚打开过小程序）→ 快速模式：短暂随机延迟后跑完，5分钟内完成
// - 旧 token 续跑 → 正常模式
// - 转发前先 GetDetails（模拟点开文章/阅读上报），间隔随机
// - JWT exp 本地解析，过期 token 不发任何请求
// - 可选随机休息日，避免每天精确刷满 120 的行为画像
const BASE = "https://sigmaapi.mad-sea.com";
const PAGE_SIZE = 25;
const KEY_TOKEN = "sigma_token";
const KEY_STATE = "sigma_state";
const FALLBACK_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/144.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI " +
  "MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13) " +
  "UnifiedPCWindowsWechat(0xf2541d41) XWEB/25560";

const arg = $argument || {};
const DAILY_TARGET = parseInt(arg.daily_target, 10) || 120;
const MAX_SHARES_PER_RUN = parseInt(arg.max_shares, 10) || 10;
const REST_DAY = arg.rest_day === true || arg.rest_day === "true";

const today = new Date().toISOString().slice(0, 10);

function notify(sub, body) {
  $notification.post("适马签到", sub || "", body || "");
}
function finish(msg) {
  if (msg) notify("", msg);
  console.log("DONE: " + (msg || ""));
  $done();
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

// 极简 base64url 解码（不依赖 atob）
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function b64decode(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const bytes = [];
  let buf = 0, bits = 0;
  for (let i = 0; i < s.length; i++) {
    const v = B64.indexOf(s.charAt(i));
    if (v < 0) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buf >> bits) & 0xff);
    }
  }
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return decodeURIComponent(escape(out));
}
// 解析 JWT exp（毫秒），失败返回 0
function tokenExpMs(token) {
  try {
    const json = b64decode(token.split(".")[1]);
    return (JSON.parse(json).exp || 0) * 1000;
  } catch (e) {
    return 0;
  }
}
// 简单日期哈希，用于随机休息日
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
  return { date: today, done: false, baseline: null, shares: 0, lastIdx: 0 };
}

const tObj = readTokenObj();
if (!tObj) {
  finish("未捕获到 token，请先打开适马小程序");
} else {
  const st = getTodayState();
  const fresh = st.token !== tObj.token; // token 换新 = 刚打开过小程序
  const expMs = tokenExpMs(tObj.token);

  // 无网络快速退出：当日已完整跑过一轮 / token 已过期
  if (st.done) $done();
  if (expMs && Date.now() > expMs && !fresh) $done();
  // 休息日：约10%概率，什么都不做也不标记
  if (REST_DAY && !st.done && dateHash(today) % 10 === 0) $done();

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
          reject(new Error("bad json: " + status));
        }
      };
      if (method === "GET") $httpClient.get(opt, cb);
      else { opt.body = JSON.stringify(body || {}); $httpClient.post(opt, cb); }
    });

  (async () => {
    // 伪装：新鲜 token 模拟"打开小程序后先随便逛逛"
    if (fresh) await sleep(ri(10000, 45000));
    else await sleep(ri(3000, 15000));

    let user;
    try {
      user = (await api("GET", "/Api/Users/GetUserInfo")).data;
    } catch (e) {
      if (e.message === "token_expired") {
        st.token = tObj.token; // 记住，避免每5分钟重复提醒
        $persistentStore.write(JSON.stringify(st), KEY_STATE);
        return finish("Token 已过期，请打开适马小程序刷新");
      }
      return finish("网络异常: " + e.message);
    }

    if (st.baseline === null) st.baseline = user.points_total;
    let earned = user.points_total - st.baseline;
    if (st.done || earned >= DAILY_TARGET) {
      st.done = true;
      st.token = tObj.token;
      $persistentStore.write(JSON.stringify(st), KEY_STATE);
      return finish("今日已完成 ✅ 当前积分 " + user.points_total);
    }

    // ---- 签到 ----
    try {
      const sign = await api("POST", "/Api/Users/Signs", {});
      console.log("签到 code=" + sign.code + " msg=" + sign.msg);
    } catch (e) {
      console.log("签到请求失败: " + e.message);
    }
    await sleep(ri(4000, 9000));

    // ---- 拉文章列表 ----
    const articles = [];
    try {
      for (let p = 1; p <= 5; p++) {
        const d = (
          await api("POST", "/Api/Article/GetList",
            { pageIndex: p, pageSize: PAGE_SIZE })
        ).data;
        (d.item || []).forEach((it) => {
          if (it.id) articles.push([it.id, it.title]);
        });
        if (p >= (d.totalpage || 1)) break;
        await sleep(ri(2000, 4000));
      }
    } catch (e) {
      console.log("文章列表失败: " + e.message);
    }
    if (!articles.length) return finish("文章列表为空，中止");

    // ---- 转发 1 篇：先点开文章(GetDetails=阅读)再转发 ----
    // 实测：转发积分每日仅第一次有效(+20)，多转无效，故只转一篇
    let idx = st.lastIdx || 0;
    if (idx >= articles.length) idx = 0;
    const id = articles[idx][0];
    const title = articles[idx][1];
    st.lastIdx = (idx + 1) % articles.length;
    try {
      // 模拟点开文章（产生一次真实阅读上报）
      await api("POST", "/Api/Article/GetDetails", { id: id });
      await sleep(ri(6000, 16000)); // 模拟阅读
      const r = await api("POST", "/Api/Article/Shares", {
        WorkID: id,
        WorkTitle: title,
        nickname: user.nickname,
      });
      st.shares++;
      console.log("转发 " + title + " => code=" + r.code);
    } catch (e) {
      console.log("转发失败: " + e.message);
    }
    await sleep(ri(4000, 9000));

    st.token = tObj.token;
    // 每天只完整跑一轮：无论积分是否到手，跑完即标记完成
    st.done = true;
    $persistentStore.write(JSON.stringify(st), KEY_STATE);

    // 最终积分
    let gained = "?";
    try {
      const u3 = (await api("GET", "/Api/Users/GetUserInfo")).data;
      gained = "+" + (u3.points_total - st.baseline);
    } catch (e) {}
    finish("今日任务完成，积分 " + gained + "（签到5+转发20为满额25）");
  })();
}
