// 适马小程序 - Token 捕获（http-request 钩子）
// 小程序一次会话会重新登录多次：相隔 5 分钟内的连续捕获视为同一"波"，
// 波内 token 静默更新（始终用最新），波起点只记录第一次捕获时间。
// 任务脚本检测到"新波"即执行一轮。
const KEY = "sigma_token";
const KEY_NOTIFY_DATE = "sigma_notify_date";
const BURST_GAP_MS = 5 * 60 * 1000; // 距上次捕获超过5分钟 = 新的一波

if ($request && $request.headers) {
  const h = $request.headers;
  const auth = h["Authorization"] || h["authorization"] || "";
  if (auth.indexOf("Bearer ") === 0) {
    const token = auth.slice(7);
    const ua = h["User-Agent"] || h["user-agent"] || "";
    const now = Date.now();
    const today = new Date().toISOString().slice(0, 10);

    let old = null;
    try { old = JSON.parse($persistentStore.read(KEY) || ""); } catch (e) {}
    const lastTs = (old && old.ts) || 0;
    const burstStart = (old && old.ts && now - lastTs < BURST_GAP_MS) ? (old.burstStart || lastTs) : now;

    if (!old || old.token !== token) {
      $persistentStore.write(JSON.stringify({
        token: token,
        ua: ua,
        ts: now,
        burstStart: burstStart,
      }), KEY);
      if ($persistentStore.read(KEY_NOTIFY_DATE) !== today) {
        $persistentStore.write(today, KEY_NOTIFY_DATE);
        $notification.post("适马", "", "Token 已捕获 ✅ 任务将自动执行");
      }
    } else {
      // token 没变但时间推进，更新时间戳/波起点（静默）
      $persistentStore.write(JSON.stringify({
        token: token,
        ua: ua,
        ts: now,
        burstStart: burstStart,
      }), KEY);
    }
  }
}
$done({});
