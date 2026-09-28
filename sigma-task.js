// 适马小程序 - 每日签到 + 转发6篇（cron 驱动，不计分数版）
// 新 token（刚打开过小程序）→ 短随机延迟 → 签到 + 转发6篇 → 当日完成
// 每天只执行一轮：跑完标记 done，之后所有 cron 触发直接退出
const BASE = "https://sigmaapi.mad-sea.com";
const KEY_TOKEN = "sigma_token";
const KEY_STATE = "sigma_state";
const FALLBACK_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/144.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI " +
  "MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13) " +
  "UnifiedPCWindowsWechat(0xf2541d41) XWEB/25560";

const arg = $argument || {};
const SHARE_COUNT = parseInt(arg.share_count, 10) || 6;   // 转发篇数
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
  return { date: today, done: false, shares: 0 };
}

const tObj = readTokenObj();
if (!tObj) {
  finish("未捕获到 token，请先打开适马小程序");
} else {
  const st = getTodayState();
  const expMs = tokenExpMs(tObj.token);

  // 当日已完成 / token 已过期：直接退出，不发请求
  if (st.done) $done();
  if (expMs && Date.now() > expMs) $done();
  if (REST_DAY && dateHash(today) % 10 === 0) $done();

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
    // 模拟打开小程序后先随便逛逛
    await sleep(ri(10000, 40000));

    let user;
    try {
      user = (await api("GET", "/Api/Users/GetUserInfo")).data;
    } catch (e) {
      if (e.message === "token_expired") {
        st.done = true; // 今天别再试了，等明天新 token
        $persistentStore.write(JSON.stringify(st), KEY_STATE);
        return finish("Token 已过期，明天打开小程序自动续");
      }
      return finish("网络异常: " + e.message);
    }

    // ---- 签到 ----
    try {
      const sign = await api("POST", "/Api/Users/Signs", {});
      console.log("签到 code=" + sign.code + " msg=" + sign.msg);
    } catch (e) {
      console.log("签到请求失败: " + e.message);
    }
    await sleep(ri(4000, 9000));

    // ---- 拉文章列表（一页25篇足够） ----
    let articles = [];
    try {
      const d = (
        await api("POST", "/Api/Article/GetList", { pageIndex: 1, pageSize: 25 })
      ).data;
      articles = (d.item || []).filter((it) => it.id).map((it) => [it.id, it.title]);
    } catch (e) {
      console.log("文章列表失败: " + e.message);
    }
    if (!articles.length) {
      st.done = true;
      $persistentStore.write(JSON.stringify(st), KEY_STATE);
      return finish("文章列表为空，仅完成签到");
    }

    // ---- 转发 SHARE_COUNT 篇：先点开(阅读)再转发 ----
    let ok = 0;
    for (let i = 0; i < Math.min(SHARE_COUNT, articles.length); i++) {
      const id = articles[i][0];
      const title = articles[i][1];
      try {
        await api("POST", "/Api/Article/GetDetails", { id: id });
        await sleep(ri(6000, 16000)); // 模拟阅读
        const r = await api("POST", "/Api/Article/Shares", {
          WorkID: id,
          WorkTitle: title,
          nickname: user.nickname,
        });
        st.shares++;
        console.log("转发[" + (i + 1) + "] " + title + " => code=" + r.code);
        if (r.code === 0) ok++;
      } catch (e) {
        console.log("转发失败: " + e.message);
        break;
      }
      await sleep(ri(8000, 20000));
    }

    st.done = true;
    $persistentStore.write(JSON.stringify(st), KEY_STATE);
    finish("今日完成 ✅ 签到 + 转发 " + ok + "/" + SHARE_COUNT + " 篇");
  })();
}
