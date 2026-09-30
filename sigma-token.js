// 适马小程序 - Token 捕获（http-request 钩子）
// 小程序一次会话会重新登录多次：每次变化都静默更新 token 并记录时间戳，
// 任务脚本依据"最后一次捕获时间 + 2分钟防抖"决定何时执行
const KEY = "sigma_token";
const KEY_NOTIFY_DATE = "sigma_notify_date";

if ($request && $request.headers) {
  const h = $request.headers;
  const auth = h["Authorization"] || h["authorization"] || "";
  if (auth.indexOf("Bearer ") === 0) {
    const token = auth.slice(7);
    const ua = h["User-Agent"] || h["user-agent"] || "";
    const today = new Date().toISOString().slice(0, 10);
    let oldToken = "";
    try { oldToken = JSON.parse($persistentStore.read(KEY) || "").token || ""; }
    catch (e) { oldToken = $persistentStore.read(KEY) || ""; }

    if (oldToken !== token) {
      $persistentStore.write(JSON.stringify({
        token: token,
        ua: ua,
        ts: Date.now(),
      }), KEY);
      if ($persistentStore.read(KEY_NOTIFY_DATE) !== today) {
        $persistentStore.write(today, KEY_NOTIFY_DATE);
        $notification.post("适马", "", "Token 已捕获 ✅ 任务将在稳定后自动执行");
      }
    }
  }
}
$done({});
