// 适马小程序 - Token 捕获（http-request 钩子）
// 连同 UA 一起存（保持指纹一致：token 从哪个设备发，请求就用哪个设备的心跳）
const KEY = "sigma_token";

if ($request && $request.headers) {
  const h = $request.headers;
  const auth = h["Authorization"] || h["authorization"] || "";
  if (auth.indexOf("Bearer ") === 0) {
    const token = auth.slice(7);
    const ua = h["User-Agent"] || h["user-agent"] || "";
    const old = $persistentStore.read(KEY);
    let oldToken = "";
    try { oldToken = JSON.parse(old).token || ""; } catch (e) { oldToken = old || ""; }
    if (oldToken !== token) {
      $persistentStore.write(JSON.stringify({ token: token, ua: ua }), KEY);
      $notification.post("适马", "", "Token 已更新 ✅ 任务将在几分钟内自动执行");
    }
  }
}
$done({});
