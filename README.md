# s1gma_qiansign

适马（SIGMA）微信小程序 Loon 自动签到 + 转发文章刷积分插件。

## 功能

- **Token 自动捕获**：打开小程序时自动从请求头提取 token 和 UA 并持久化（token 约 2.5 小时过期，打开即续）
- **自动签到**：`POST /Api/Users/Signs`
- **转发刷分**：转发官方文章，自适应刷到每日积分上限（默认 120 分）
- **打开即跑**：cron 每 5 分钟检测，token 刷新后 5 分钟内完成当日全部任务
- **防画像伪装**：
  - UA 与登录设备指纹一致（捕获时自动记录）
  - 转发前先请求文章详情，模拟真实"点开→阅读→转发"流程
  - 全程随机延迟，无固定节奏
  - JWT exp 本地解析，过期 token 不发任何请求
  - 可选随机休息日

## 安装

> 需要 Loon **3.5.1 (983)+**（新版 Script v2 语法）

1. iPhone Safari 访问一键导入：
   `loon://import?plugin=https://raw.githubusercontent.com/horizone146/s1gma_qiansign/main/sigma.plugin`
   （或在 Loon → 配置 → 插件 → ➕ 粘贴该 raw 链接）
2. Loon → 配置 → MITM → 安装并信任 CA 证书（iOS：设置 → 通用 → VPN与设备管理 → 安装；关于本机 → 证书信任设置 → 完全信任）
3. 打开一次适马小程序，看到「Token 已更新」通知即部署成功；之后每天打开小程序，5 分钟内自动完成当日任务

## 插件参数

| 参数 | 默认 | 说明 |
|---|---|---|
| 每日积分上限 | 120 | 达到后当日停止 |
| 单轮最大转发 | 10 | 未达标时下个周期继续 |
| 随机休息日 | 关 | 约 10% 天数自动休息，降低行为画像 |
| 运行频率 | `*/5 * * * *` | 主任务 cron |
| 启用任务 | 开 | 关闭后仅捕获 token |

## 免责声明

本项目仅供学习研究 HTTP 协议与脚本自动化技术，自动化行为可能违反小程序用户协议，积分被清退或账号受限的风险由使用者自行承担。请勿用于商业用途。

## 相关接口

| 接口 | 用途 |
|---|---|
| `POST /Api/Users/Signs` | 每日签到 |
| `POST /Api/Users/GetUserInfo` | 用户信息/积分 |
| `POST /Api/Article/GetList` | 文章列表（`pageIndex`/`pageSize`） |
| `POST /Api/Article/GetDetails` | 文章详情（阅读上报） |
| `POST /Api/Article/Shares` | 转发上报 |

鉴权方式：`Authorization: Bearer <JWT>`（`GET /Api/Users/Info?code=<wx.login code>` 签发，有效期约 2.5 小时）
