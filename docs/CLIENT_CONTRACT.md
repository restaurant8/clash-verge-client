# Xboard 专属客户端接口契约

本文档用于约束基于 Xboard 的专属三端客户端开发。客户端可以做漂亮 UI、本地代理核心控制、测速、通知和系统集成，但业务真相必须来自 Xboard 后端，不允许在客户端硬编码套餐、价格、权限、节点、支付状态或用户权益。

## 1. 总原则

- Xboard 后端是唯一真相源。
- 客户端只保存必要的登录态、订阅 token、本地配置缓存和本地代理状态。
- 客户端不能自行判定用户是否有套餐、节点是否可用、订单是否支付成功、优惠券是否有效。
- 所有商业闭环能力必须通过 Xboard 现有接口验证。
- 所有新增客户端功能都必须先写入本契约，再开发 UI 和本地逻辑。

## 2. 基础地址

| 类型 | 地址 |
|---|---|
| 用户端 API | `{BASE_URL}/api/v1` |
| App 配置 API | `{BASE_URL}/api/v2` |
| 公开启动配置 API | `{BASE_URL}/api/v1/app/bootstrap` |
| 传统订阅 API | `{BASE_URL}/api/v1/client/subscribe?token={subscribe_token}` |
| Web 兼容订阅地址 | `{BASE_URL}/{subscribe_path}/{subscribe_token}` |

`subscribe_path` 默认值通常是 `s`，以后台配置为准。

## 3. 认证模型

登录或注册成功后，后端返回两类 token：

| 字段 | 来源 | 用途 | 客户端存储 |
|---|---|---|---|
| `auth_data` | 登录/注册响应 | 访问 `/api/v1/user/*` 用户接口 | 安全存储 |
| `token` | 登录/注册响应，也可从 `/user/getSubscribe` 获取 | 访问 `/api/v1/client/*` 订阅接口 | 安全存储 |

用户接口认证方式：

```http
Authorization: Bearer xxxxx
```

订阅接口认证方式：

```http
GET /api/v1/client/subscribe?token={subscribe_token}&flag=clashmeta
```

客户端必须区分 `auth_data` 和 `token`。二者不能混用。

## 4. 通用响应格式

大多数接口成功响应：

```json
{
  "status": "success",
  "message": "请求成功",
  "data": {},
  "error": null
}
```

失败响应：

```json
{
  "status": "fail",
  "message": "错误原因",
  "data": null,
  "error": null
}
```

部分历史接口直接返回：

```json
{
  "data": [],
  "total": 0
}
```

实测还存在以下特殊响应：

| 接口 | 响应形态 | 客户端处理 |
|---|---|---|
| `GET /api/v2/client/app/getConfig` | `{ "data": { ... } }`，无 `status/message/error` | 直接读取 `data` |
| `GET /api/v1/user/notice/fetch` | `{ "data": [], "total": 0 }`，无 `status/message/error` | 按历史分页接口处理 |
| `POST /api/v1/user/order/checkout` | `{ "type": number, "data": mixed }` | 按支付类型处理，不套用通用成功响应 |
| `GET /api/v1/client/subscribe` | 成功返回 YAML/文本，失败可能 403 且空 body | 按配置文件下载处理 |

客户端 SDK 必须兼容这两种响应结构。

## 5. App 启动流程

### 5.1 冷启动

1. 读取本地 `BASE_URL`、`auth_data`、`subscribe_token`。
2. 先请求 `/api/v1/app/bootstrap`，获取未登录也可使用的品牌、主题、安全、下载、维护和强更配置。
3. 如果存在 `subscribe_token`，请求 `/api/v2/client/app/getConfig?token={subscribe_token}`。
4. 如果本地存在 `auth_data`，请求 `/api/v1/user/checkLogin`。
5. 如果登录有效，请求 `/api/v1/user/info`、`/api/v1/user/getSubscribe`、`/api/v1/user/server/fetch`。
6. 如果登录有效且存在 `subscribe_token` 与可用节点，客户端每次启动都必须请求 `/api/v1/client/subscribe?token={subscribe_token}&flag=clashmeta` 拉取最新 mihomo 配置，写入并切换到客户端自动生成的 Xboard profile。
7. 最新订阅 profile 写入并通过本地配置校验后，客户端必须清理旧的自动生成 Xboard profile；用户手动创建的本地/远程 profile 不得被自动删除。
8. 如果登录失效，清理本地登录态，只保留未登录首页和登录入口。
9. 如果后端配置哈希 `config_hash` 变化，刷新 UI 配置、功能开关和业务规则缓存。

`/api/v2/client/app/getConfig` 当前走 `client` middleware。实测无 `token` 时返回 403：

```json
{
  "status": "fail",
  "message": "token is null",
  "data": null,
  "error": null
}
```

### 5.2 不允许本地伪造的状态

| 状态 | 后端来源 |
|---|---|
| 是否登录 | `/user/checkLogin` |
| 是否管理员 | `/user/checkLogin` 或登录响应 `is_admin` |
| 套餐是否有效 | `/user/getSubscribe` + `/user/server/fetch` |
| 剩余流量 | `/user/getSubscribe` |
| 到期时间 | `/user/getSubscribe` |
| 设备限制 | `/user/getSubscribe` |
| 速度限制 | `/user/getSubscribe` |
| 可用节点 | `/user/server/fetch` |
| 订单状态 | `/user/order/check` |
| 优惠券可用性 | `/user/coupon/check` |
| 礼品卡可用性 | `/user/gift-card/check` |

## 6. 页面与接口契约

### 6.1 未登录首页

用途：展示品牌、服务说明、可售套餐、登录注册入口。

| 功能 | 接口 | 认证 | 说明 |
|---|---|---|---|
| 获取站点配置 | `GET /api/v1/guest/comm/config` | 否 | 获取 logo、服务条款、验证码、邮箱验证、邀请限制等 |
| 获取 App 启动配置 | `GET /api/v1/app/bootstrap` | 否 | 获取品牌、主题、下载、维护、强更、客服等公开配置 |
| 获取游客套餐 | `GET /api/v1/guest/plan/fetch` | 否 | 用于未登录价格展示 |
| PV 上报 | `POST /api/v1/passport/comm/pv` | 否 | 传 `invite_code`，用于邀请访问统计 |

未登录首屏不要调用 `/api/v2/client/app/getConfig`，因为该接口需要订阅 token。未登录品牌配置优先使用 `/app/bootstrap`，`/guest/comm/config` 只作为兼容接口或安全配置补充。

`/api/v1/app/bootstrap` 已新增，涉及文件：

- `app/Http/Routes/V1/AppRoute.php`
- `app/Http/Controllers/V1/App/BootstrapController.php`

### 6.2 登录 / 注册 / 找回密码

| 功能 | 接口 | 方法 | 参数 |
|---|---|---|---|
| 发送邮箱验证码 | `/api/v1/passport/comm/sendEmailVerify` | POST | `email`，以及后端要求的验证码字段 |
| 注册 | `/api/v1/passport/auth/register` | POST | `email`, `password`, 可选邀请码/验证码字段 |
| 登录 | `/api/v1/passport/auth/login` | POST | `email`, `password` |
| 忘记密码 | `/api/v1/passport/auth/forget` | POST | `email`, `password`, `email_code` |
| 邮件链接登录 | `/api/v1/passport/auth/loginWithMailLink` | POST | `email`, `redirect` |
| token 登录 | `/api/v1/passport/auth/token2Login` | GET | `token` 或 `verify` |

客户端要求：

- 密码最小长度以后端校验为准，当前请求类要求至少 8 位。
- 如果 `/guest/comm/config` 返回 `is_captcha=1`，客户端必须显示并提交对应验证码。
- 如果返回 `is_invite_force=1`，注册页必须要求邀请码。
- 登录成功后必须同时保存 `auth_data` 和 `token`。

### 6.3 首页 / 连接页

用途：一键连接、当前套餐、流量、到期、推荐节点、公告。

| 功能 | 接口 | 认证 |
|---|---|---|
| 用户信息 | `GET /api/v1/user/info` | Bearer |
| 订阅信息 | `GET /api/v1/user/getSubscribe` | Bearer |
| 可用节点 | `GET /api/v1/user/server/fetch` | Bearer |
| 用户统计 | `GET /api/v1/user/getStat` | Bearer |
| 公告 | `GET /api/v1/user/notice/fetch` | Bearer |
| App 配置 | `GET /api/v2/client/app/getConfig?token={subscribe_token}` | subscribe token |

首页必须展示：

- 连接状态，本地 mihomo 状态提供。
- 当前套餐名，从 `getSubscribe.plan.name` 来。
- 已用流量：`u + d`。
- 总流量：`transfer_enable`。
- 到期时间：`expired_at`。
- 设备限制：`device_limit`。
- 速度限制：`speed_limit`。
- 可用节点数量：`server/fetch.data.length`。

如果 `/user/server/fetch` 返回空数组，客户端必须显示购买/续费/联系客服入口，不能允许连接。

### 6.4 节点页

| 功能 | 接口 | 说明 |
|---|---|---|
| 节点列表 | `GET /api/v1/user/server/fetch` | 返回可用节点摘要 |
| 订阅配置 | `GET /api/v1/client/subscribe?token={subscribe_token}&flag=clashmeta` | 生成 mihomo/Clash Meta 配置 |
| 按协议过滤订阅 | `GET /api/v1/client/subscribe?token={token}&flag=clashmeta&types=vmess,trojan` | 可选 |
| 按关键词过滤订阅 | `GET /api/v1/client/subscribe?token={token}&flag=clashmeta&filter=香港` | 可选 |

节点列表字段：

| 字段 | 说明 |
|---|---|
| `id` | 节点 ID |
| `type` | 协议类型 |
| `version` | 协议版本，可为空 |
| `name` | 节点名 |
| `rate` | 流量倍率 |
| `tags` | 标签 |
| `is_online` | 后端节点在线状态 |
| `cache_key` | 节点缓存标识 |
| `last_check_at` | 最近检查时间 |

客户端本地可以做延迟测试和排序，但节点可见性、协议内容和可用性必须以后端返回为准。

### 6.5 本地代理核心页

后端不负责本地代理状态。本页由客户端本地控制：

| 功能 | 来源 |
|---|---|
| mihomo 启动/停止 | 本地 |
| 系统代理开关 | 本地 |
| TUN 模式 | 本地 |
| DNS 模式 | 本地 |
| 日志 | mihomo API/本地日志 |
| 当前上下行速度 | mihomo API |
| 当前连接数 | mihomo API |
| 策略组切换 | mihomo external-controller |

后端参与点：

- 配置来源必须是 `/api/v1/client/subscribe?token={token}&flag=clashmeta`。
- 登录、注册、账号刷新和冷启动恢复登录态后，客户端都必须重新拉取订阅并载入当前 Xboard profile，成功载入新配置后再删除旧的自动生成 Xboard profile。
- App 默认核心、自动切换、测速开关、UI 开关可从 `/api/v2/client/app/getConfig` 读取。
- 如果用户订阅无效或节点为空，客户端必须停止连接或禁止启动。
- 不要把 `/api/v1/client/app/getConfig` 作为权益校验依据。实测该接口在无有效套餐时仍可能返回基础 YAML 配置，但 `/api/v1/client/subscribe` 会返回 403。

### 6.6 套餐 / 商城页

| 功能 | 接口 | 认证 |
|---|---|---|
| 获取套餐 | `GET /api/v1/user/plan/fetch` | Bearer |
| 获取单个套餐 | `GET /api/v1/user/plan/fetch?id={plan_id}` | Bearer |
| 校验优惠券 | `POST /api/v1/user/coupon/check` | Bearer |
| 创建订单 | `POST /api/v1/user/order/save` | Bearer |
| 获取支付方式 | `GET /api/v1/user/order/getPaymentMethod` | Bearer |
| 支付订单 | `POST /api/v1/user/order/checkout` | Bearer |
| 查询订单状态 | `GET /api/v1/user/order/check?trade_no={trade_no}` | Bearer |
| 订单详情 | `GET /api/v1/user/order/detail?trade_no={trade_no}` | Bearer |
| 订单列表 | `GET /api/v1/user/order/fetch` | Bearer |
| 取消订单 | `POST /api/v1/user/order/cancel` | Bearer |

下单参数：

```json
{
  "plan_id": 1,
  "period": "month_price",
  "coupon_code": "OPTIONAL"
}
```

余额抵扣沿用 Xboard 默认行为：客户端不传余额开关，后台在 `order/save` 阶段按站点规则自动使用用户可用余额抵扣。客户端必须在下单设置中提示用户“账户余额会自动抵扣，最终应付以订单详情为准”。

创建订单时后端按以下顺序计算：

1. 优惠码抵扣。
2. 用户专属折扣。
3. 更换套餐时的套餐折抵，取决于后台 `surplus_enable` 和套餐更换开关。
4. 用户余额自动抵扣。

因此客户端只负责传递合法的 `plan_id`、`period`、`coupon_code`。创建订单成功拿到 `trade_no` 后，必须优先读取 `/api/v1/user/order/detail?trade_no={trade_no}`，用订单详情里的后端金额字段展示最终结果：

| 字段 | 含义 |
|---|---|
| `discount_amount` | 优惠码和用户专属折扣产生的抵扣金额 |
| `surplus_amount` | 后台套餐折抵金额 |
| `balance_amount` | 后台实际使用的用户余额 |
| `refund_amount` | 套餐折抵超过新订单金额时返还到余额的金额 |
| `total_amount` | 折扣、套餐折抵和余额抵扣后的剩余应付金额 |

如果 `total_amount <= 0`，客户端仍然调用 `/order/checkout` 让后端完成免费订单开通流程；此时 `method` 可以省略。客户端不能用本地估算结果直接判定订单完成，仍必须以 `/order/check` 返回状态 `3` 为准。

合法 `period`：

- `month_price`
- `quarter_price`
- `half_year_price`
- `year_price`
- `two_year_price`
- `three_year_price`
- `onetime_price`
- `reset_price`

订单状态必须以 `/order/check` 和 `/order/detail` 为准。客户端不能因为支付页返回成功就直接发放权益。

订单状态常量：

| 状态 | 含义 |
|---:|---|
| `0` | 待支付 |
| `1` | 开通中 |
| `2` | 已取消 |
| `3` | 已完成 |
| `4` | 已折抵 |

`/order/checkout` 实测返回结构：

```json
{
  "type": 1,
  "data": "https://example.com/pay-url"
}
```

`type=1` 时 `data` 是支付跳转 URL。客户端应打开该 URL 或内嵌支付页，然后轮询 `/order/check?trade_no=...`，直到状态变为 `3` 才更新用户权益并重新拉取 `/user/getSubscribe`、`/user/server/fetch` 和订阅配置。

### 6.7 钱包 / 佣金 / 邀请页

| 功能 | 接口 | 认证 |
|---|---|---|
| 邀请码和统计 | `GET /api/v1/user/invite/fetch` | Bearer |
| 创建邀请码 | `GET /api/v1/user/invite/save` | Bearer |
| 佣金明细 | `GET /api/v1/user/invite/details` | Bearer |
| 佣金转余额 | `POST /api/v1/user/transfer` | Bearer |
| 发起提现工单 | `POST /api/v1/user/ticket/withdraw` | Bearer |
| 用户端配置 | `GET /api/v1/user/comm/config` | Bearer |

提现方式、提现开关、币种、佣金分销配置从 `/user/comm/config` 获取，不允许客户端硬编码。

### 6.8 礼品卡 / 兑换码页

| 功能 | 接口 | 认证 |
|---|---|---|
| 查询兑换码 | `POST /api/v1/user/gift-card/check` | Bearer |
| 兑换 | `POST /api/v1/user/gift-card/redeem` | Bearer |
| 兑换历史 | `GET /api/v1/user/gift-card/history` | Bearer |
| 兑换详情 | `GET /api/v1/user/gift-card/detail?id={id}` | Bearer |
| 可用类型 | `GET /api/v1/user/gift-card/types` | Bearer |

客户端必须先 `check`，展示 `reward_preview` 和 `can_redeem`，用户确认后再调用 `redeem`。

### 6.9 工单 / 客服页

| 功能 | 接口 | 认证 |
|---|---|---|
| 工单列表 | `GET /api/v1/user/ticket/fetch` | Bearer |
| 工单详情 | `GET /api/v1/user/ticket/fetch?id={id}` | Bearer |
| 新建工单 | `POST /api/v1/user/ticket/save` | Bearer |
| 回复工单 | `POST /api/v1/user/ticket/reply` | Bearer |
| 关闭工单 | `POST /api/v1/user/ticket/close` | Bearer |

新建工单参数：

```json
{
  "subject": "标题",
  "level": 1,
  "message": "内容"
}
```

如果 `/api/v2/client/app/getConfig` 返回 `features.ticket_must_wait_reply=true`，客户端必须在用户连续回复前提示等待客服回复。

### 6.10 公告 / 知识库页

| 功能 | 接口 | 认证 |
|---|---|---|
| 公告分页 | `GET /api/v1/user/notice/fetch?current=1` | Bearer |
| 知识库列表 | `GET /api/v1/user/knowledge/fetch?language=zh-CN` | Bearer |
| 知识库搜索 | `GET /api/v1/user/knowledge/fetch?language=zh-CN&keyword=xxx` | Bearer |
| 知识库详情 | `GET /api/v1/user/knowledge/fetch?id={id}` | Bearer |

知识库内容中可能包含订阅占位符，后端已经处理替换，客户端直接渲染后端返回内容。

注意：路由中存在 `GET /api/v1/user/knowledge/getCategory`，但当前实测该接口返回 500。客户端暂时不要依赖这个接口，分类信息应从 `/knowledge/fetch` 的分组结果中生成，或先修复后端控制器方法。

### 6.11 设备 / 会话安全页

| 功能 | 接口 | 认证 |
|---|---|---|
| 活跃会话 | `GET /api/v1/user/getActiveSession` | Bearer |
| 移除会话 | `POST /api/v1/user/removeActiveSession` | Bearer |
| 修改密码 | `POST /api/v1/user/changePassword` | Bearer |
| 重置订阅安全 | `GET /api/v1/user/resetSecurity` | Bearer |
| 修改提醒设置 | `POST /api/v1/user/update` | Bearer |

重置订阅安全会更换用户 `uuid` 和订阅 `token`。客户端调用成功后必须：

1. 更新本地 `subscribe_token`。
2. 重新拉取订阅配置。
3. 重启或热更新 mihomo 配置。

### 6.12 流量统计页

| 功能 | 接口 | 认证 |
|---|---|---|
| 当月流量日志 | `GET /api/v1/user/stat/getTrafficLog` | Bearer |

返回字段：

| 字段 | 说明 |
|---|---|
| `u` | 上传流量 |
| `d` | 下载流量 |
| `record_at` | 记录时间 |
| `server_rate` | 节点倍率 |

客户端可以做图表，但数据源必须来自该接口。

### 6.13 版本更新页

| 功能 | 接口 | 认证 |
|---|---|---|
| 获取版本 | `GET /api/v1/client/app/getVersion?token={subscribe_token}` | subscribe token |
| 获取版本 | `GET /api/v2/client/app/getVersion?token={subscribe_token}` | subscribe token |

响应包含：

- `windows_version`
- `windows_download_url`
- `windows_update_notes`
- `windows_force_update`
- `macos_version`
- `macos_download_url`
- `macos_update_notes`
- `macos_force_update`
- `android_version`
- `android_download_url`
- `android_update_notes`
- `android_force_update`

客户端必须按当前平台读取对应字段。

## 7. 订阅与 mihomo 配置契约

### 7.1 推荐订阅请求

```http
GET /api/v1/client/subscribe?token={subscribe_token}&flag=clashmeta
User-Agent: YourClient/1.0.0 clashmeta
```

Xboard 会根据 `flag` 或 `User-Agent` 匹配协议处理器。推荐使用 `clashmeta` 或 `verge` 触发 Clash Meta 配置。

### 7.2 支持的协议输出

后端已有协议处理器：

- Clash
- ClashMeta
- General
- Loon
- QuantumultX
- Shadowrocket
- Shadowsocks
- SingBox
- Stash
- Surfboard
- Surge

专属客户端如果以 mihomo 为核心，应优先使用 ClashMeta 输出。

### 7.3 本地配置生成

客户端本地流程：

1. 下载 ClashMeta YAML。
2. 校验 YAML 可解析。
3. 写入本地 profile。
4. 启动或热重载 mihomo。
5. 调用 mihomo external-controller 查询代理组。
6. UI 展示策略组和节点。

客户端不得自行拼接服务器密码、端口、Reality/TLS 参数等敏感协议配置。

## 8. 功能开关契约

推荐客户端启动后读取：

```http
GET /api/v2/client/app/getConfig?token={subscribe_token}
```

该接口需要订阅 token，且响应为 `{ "data": config }`，不是标准 `status/message/data/error` 包装。

重点字段：

| 字段 | 客户端用途 |
|---|---|
| `app_info` | 品牌名、描述、官网、logo、版本 |
| `features.enable_register` | 是否显示注册入口 |
| `features.enable_invite_system` | 是否显示邀请页 |
| `features.enable_ticket_system` | 是否显示工单页 |
| `features.enable_commission_system` | 是否显示佣金页 |
| `features.enable_traffic_log` | 是否显示流量日志 |
| `features.enable_knowledge_base` | 是否显示知识库 |
| `features.enable_announcements` | 是否显示公告 |
| `features.enable_coupon_system` | 是否显示优惠券 |
| `features.enable_speed_test` | 是否显示测速 |
| `features.enable_server_ping` | 是否显示节点延迟 |
| `ui_config` | 主题色、首页展示、节点列表展示 |
| `business_rules` | 密码、会话、自动断开、告警阈值 |
| `server_config` | 默认核心、自动选择、自动切换配置 |
| `security_config` | 服务条款、隐私政策、验证码配置 |
| `payment_config` | 币种、提现方式、提现限制 |
| `notification_config` | 通知开关 |
| `cache_config` | 本地缓存时长 |
| `config_hash` | 配置变更检测 |

如果后端关闭某功能，客户端必须隐藏或禁用对应入口。

## 9. 客户端本地模块边界

### 9.1 可以本地实现

- UI 排版、主题、动画。
- mihomo 进程管理。
- 系统代理、TUN、DNS、开机自启。
- 节点延迟测试。
- 连接日志。
- 代理组切换。
- 本地通知。
- 配置缓存。
- 崩溃恢复。

### 9.2 必须后端验证

- 登录状态。
- 套餐状态。
- 节点可用性。
- 订阅配置内容。
- 价格。
- 支付方式。
- 优惠券。
- 订单结果。
- 礼品卡权益。
- 邀请佣金。
- 提现开关和方式。
- 工单状态。

## 10. 必须补齐或增强的后端接口

当前 Xboard 已能支撑大部分客户端功能，但专属客户端商业化建议新增以下接口或字段。

### 10.1 设备绑定接口

用途：限制多设备、展示设备列表、踢下线。

建议新增：

| 接口 | 方法 |
|---|---|
| `/api/v1/user/device/list` | GET |
| `/api/v1/user/device/bind` | POST |
| `/api/v1/user/device/remove` | POST |
| `/api/v1/user/device/heartbeat` | POST |

建议字段：

- `device_id`
- `device_name`
- `platform`
- `app_version`
- `last_seen_at`
- `ip`
- `status`

### 10.2 客户端埋点接口

用途：商业分析、漏斗分析、崩溃排查。

建议新增：

| 接口 | 方法 |
|---|---|
| `/api/v1/client/event/report` | POST |
| `/api/v1/client/crash/report` | POST |

事件类型：

- `app_start`
- `login_success`
- `connect_start`
- `connect_success`
- `connect_failed`
- `purchase_click`
- `checkout_start`
- `checkout_success`
- `subscription_refresh_failed`

### 10.3 远程配置增强

用途：灰度、强更、弹窗、活动、默认模式。

建议新增到 `/api/v2/client/app/getConfig`：

- `force_update`
- `min_supported_version`
- `maintenance_mode`
- `maintenance_message`
- `promotion_banner`
- `default_proxy_mode`
- `default_tun_enabled`
- `support_url`
- `status_page_url`

### 10.4 节点详情增强

当前 `/user/server/fetch` 返回节点摘要，不返回地区图标、负载、推荐等级等适合 UI 展示的字段。

建议新增字段：

- `country`
- `city`
- `flag`
- `region_code`
- `recommend_level`
- `load`
- `latency_hint`
- `tags`
- `maintenance`
- `maintenance_message`

### 10.5 专属客户端订阅标识

建议增加专属 flag，例如：

```http
flag=yourbrand
User-Agent: YourBrand/1.0.0 mihomo
```

然后在后端新增协议类或扩展 ClashMeta 输出，便于：

- 区分官方客户端流量。
- 对专属客户端输出定制策略组。
- 灰度新规则。
- 增加客户端专属提示节点。

### 10.6 公开启动配置接口

当前未登录用户无法访问 `/api/v2/client/app/getConfig`，而 `/api/v1/guest/comm/config` 又不包含完整 UI 主题、功能开关和强更策略。因此新增公开启动配置接口：

| 接口 | 方法 | 认证 |
|---|---|---|
| `/api/v1/app/bootstrap` | GET | 否 |

返回结构为标准成功响应：

```json
{
  "status": "success",
  "message": "操作成功",
  "data": {
    "app_info": {},
    "features": {},
    "public_ui_config": {},
    "security_config": {},
    "download_urls": {},
    "update_policy": {},
    "maintenance": {},
    "support": {},
    "cache_config": {},
    "last_updated": 0,
    "config_hash": "md5"
  },
  "error": null
}
```

当前返回：

- `app_info`
- `features`
- `public_ui_config`
- `security_config`
- `download_urls`
- `update_policy`
- `maintenance`
- `support`
- `cache_config`
- `last_updated`
- `config_hash`

登录后的私有配置仍使用 `/api/v2/client/app/getConfig?token={subscribe_token}`。

该接口只返回公开配置，不能返回用户信息、订阅 token、节点列表、订单信息或支付私密配置。

### 10.7 配置策略

配置分三层，不要混在一起：

| 层级 | 接口 | 认证 | 用途 |
|---|---|---|---|
| 公开启动配置 | `/api/v1/app/bootstrap` | 无 | App 首屏、品牌、主题、下载、维护、强更、客服、验证码公开参数 |
| 登录后客户端配置 | `/api/v2/client/app/getConfig?token=...` | 订阅 token | 功能开关、业务规则、私有 UI 配置、连接策略 |
| 用户权益配置 | `/api/v1/user/getSubscribe`、`/api/v1/user/server/fetch` | Bearer | 套餐、流量、到期、节点、订阅权益 |

短期落地：

- `/app/bootstrap` 复用现有后台字段：`app_name`、`app_description`、`app_url`、`logo`、`tos_url`、`email_verify`、`invite_force`、`captcha_*`、`windows_*`、`macos_*`、`android_*`、`telegram_discuss_link`。
- 新增但后台暂未可视化的字段统一使用 `app_*` key，并提供默认值或 `null`，例如 `app_primary_color`、`app_force_update`、`app_maintenance_mode`、`app_support_url`。
- 客户端以 `config_hash` 判断配置是否变化，以 `cache_config.bootstrap_cache_duration` 控制缓存时间。

中期后台化：

- 在 `app/Http/Controllers/V2/Admin/ConfigController.php` 的 `app` 分组中加入这些 `app_*` key，方便后台读取。
- 在 `app/Http/Requests/Admin/ConfigSave.php` 加入对应校验规则，方便后台保存。
- 前端后台增加 “专属客户端配置” 页面，配置品牌色、强更、维护公告、客服链接、状态页、下载地址。

推荐新增后台配置 key：

| key | 类型 | 默认值 | 用途 |
|---|---|---|---|
| `app_version` | string | `1.0.0` | 当前 App 配置版本 |
| `app_primary_color` | color | `#00C851` | 主色 |
| `app_secondary_color` | color | `#007E33` | 辅助色 |
| `app_accent_color` | color | `#FF6B35` | 强调色 |
| `app_background_color` | color | `#F5F5F5` | 背景色 |
| `app_text_color` | color | `#333333` | 文本色 |
| `app_privacy_policy_url` | url | `null` | 隐私政策 |
| `app_force_update` | boolean | `false` | 是否强制更新 |
| `app_min_supported_version` | string | `null` | 最低可用版本 |
| `app_maintenance_mode` | boolean | `false` | 是否维护中 |
| `app_maintenance_message` | string | `null` | 维护提示 |
| `app_support_url` | url | `null` | 客服/帮助链接 |
| `app_status_page_url` | url | `null` | 状态页 |
| `app_bootstrap_cache_duration` | integer | `300` | 启动配置缓存秒数 |

长期产品化：

- 后台配置应区分 “公开配置” 和 “登录后配置”，避免误把敏感信息暴露给未登录用户。
- 客户端每次启动先读 `/app/bootstrap`，如果 `maintenance.enabled=true` 或 `update_policy.force_update=true`，先处理维护/强更，再进入登录流程。
- 私有功能开关仍以 `/api/v2/client/app/getConfig` 为准，避免未登录接口暴露过多业务策略。

### 10.8 网站访问、API 故障切换和灾备

客户端不要只依赖单个 `APP_URL`。访问策略分为三层：

| 层级 | 用途 | 来源 |
|---|---|---|
| 内置启动域名 | App 首次安装、完全无缓存时使用 | 客户端包内置 `api_domains` |
| 远程 API 域名 | App 正常运行时使用 | `/api/v1/app/bootstrap` 或远程配置 |
| 本地缓存域名 | 所有远程配置都不可达时兜底 | 客户端本地上次成功配置 |

客户端启动访问流程：

1. 读取本地缓存的 `active_api_domain` 和 `remote_config`。
2. 如果缓存域名存在，先用它请求 `/api/v1/app/bootstrap`，超时时间建议 2-3 秒。
3. 如果失败，按 `api_domains + backup_api_domains` 顺序并发或串行探活。
4. 探活接口优先使用 `/api/v1/app/bootstrap`；如果后端后续新增轻量健康检查，可使用 `/api/v1/app/health`。
5. 选取首个 HTTPS 可达且返回合法 JSON 的域名作为本次 `active_api_domain`。
6. 成功后保存 `active_api_domain`、完整远程配置、`config_hash` 和成功时间。
7. 如果全部失败，使用本地缓存进入降级模式：允许查看账号缓存、日志、帮助和上次状态，但不要放行新的付费权益、订单确认或新订阅拉取。

客户端故障切换规则：

- 单个域名连续失败 2 次进入短暂熔断，5 分钟后再尝试。
- 登录、下单、支付确认、订阅拉取失败时，可以自动切换域名重试 1 次。
- 非幂等请求如 `order/save`、`order/checkout` 不要盲目多次重试；必须带请求状态提示，避免重复订单。
- 订阅 YAML 下载失败时，可尝试其他 API 域名的同一路径。
- 如果已连接代理，本地 mihomo 不应因 API 暂时不可达立即断开；只禁止刷新订阅和购买动作。

服务端灾备建议：

- `api_domains` 至少包含 3 个不同域名，解析到同一套或多套入口。
- 域名 DNS 不要全托管在单点账号；至少准备一个备用 DNS 服务商。
- API 入口前面可放 CDN/WAF，但支付回调和管理后台要明确回源策略，避免缓存误伤。
- 数据库每日全量备份 + 高频增量备份，备份落到异地对象存储。
- `.env`、支付插件配置、节点配置、证书、上传资源和数据库备份要一起纳入灾备清单。
- 支付回调域名要稳定，建议和客户端 API 域名解耦；客户端 API 可多域名，支付 notify 域名尽量少变。
- 静态资源、安装包、远程配置镜像可以放到 `oss_url`，客户端在 API 不可达时仍能拿到公告、下载包和基础配置。

### 10.9 远程配置兼容格式

客户端必须兼容以下远程配置字段。字段名保持原样，不要改名；可以在此基础上增加结构化字段，但不能删除或改变这些字段含义。

```env
APP_NAME=muacloud
login_title=欢迎使用
APP_URL=
custom_ua=muacloud/1.0
app_logo=
oss_url=
api_domains=https://5.muacloud.xyz;https://5.12o.ooo;https://muacloud.vip;https://5.muacloud.vip
# Optional extra API fallbacks; merged after api_domains.
backup_api_domains=
subscribe_path=link
tg_channel=
official_url=
invite_domain=
# Remote crisp_id overrides the bundled DEFAULT_CRISP_ID.
crisp_id=4010755c-2d1e-42a1-8380-8f4c20fe01c4
imgbb_api_key=
discount_delay_seconds=0
delay_display_scale=0.5
version=1.0.0
update_notes=
force_update=false
latest_client_url=
windows_version=
windows_download_url=
windows_update_notes=
windows_force_update=
macos_version=
macos_download_url=
macos_update_notes=
macos_force_update=
android_version=
android_download_url=
android_update_notes=
android_force_update=
```

字段说明：

| 字段 | 类型 | 用途 |
|---|---|---|
| `APP_NAME` | string | App 品牌名，兼容 `app_info.app_name` |
| `login_title` | string | 登录页标题 |
| `APP_URL` | url/string | 主站地址，可为空 |
| `custom_ua` | string | 客户端请求 API 和订阅时使用的 User-Agent，例如 `muacloud/1.0` |
| `app_logo` | url/string | App Logo 地址，兼容 `app_info.logo` |
| `oss_url` | url/string | OSS/CDN 静态资源和远程配置镜像地址 |
| `api_domains` | semicolon-list | 主 API 域名列表，按分号 `;` 分隔 |
| `backup_api_domains` | semicolon-list | 备用 API 域名列表，追加到 `api_domains` 后 |
| `subscribe_path` | string | Web 兼容订阅路径，例如 `link` |
| `tg_channel` | url/string | Telegram 频道或群入口 |
| `official_url` | url/string | 官网/官方公告页 |
| `invite_domain` | url/string | 邀请链接专用域名，可为空 |
| `crisp_id` | string | Crisp 客服 ID，远程值覆盖客户端内置默认值 |
| `imgbb_api_key` | string | 图片上传服务 key；如暴露风险较高，生产建议改为服务端代理 |
| `discount_delay_seconds` | integer | 优惠/弹窗延迟展示秒数 |
| `delay_display_scale` | decimal-string | 节点延迟展示倍率，只影响 UI 展示，不改变真实测速、排序、超时判断；客户端默认 `0.5`，建议范围 `0.1`-`1` |
| `version` | string | 远程配置版本或客户端最新版本 |
| `update_notes` | string | 更新说明 |
| `force_update` | boolean-string | 是否强制更新，`true/false` |
| `latest_client_url` | url/string | 最新客户端下载地址 |
| `windows_version` | string | Windows 客户端最新版本；为空时回退到 `version` |
| `windows_download_url` | url/string | Windows 客户端下载地址；为空时回退到 `latest_client_url` |
| `windows_update_notes` | string | Windows 更新说明；为空时回退到 `update_notes` |
| `windows_force_update` | boolean-string | Windows 是否强制更新；为空时回退到 `force_update` |
| `macos_version` | string | macOS 客户端最新版本；为空时回退到 `version` |
| `macos_download_url` | url/string | macOS 客户端下载地址；为空时回退到 `latest_client_url` |
| `macos_update_notes` | string | macOS 更新说明；为空时回退到 `update_notes` |
| `macos_force_update` | boolean-string | macOS 是否强制更新；为空时回退到 `force_update` |
| `android_version` | string | Android 客户端最新版本；为空时回退到 `version` |
| `android_download_url` | url/string | Android 客户端下载地址；为空时回退到 `latest_client_url` |
| `android_update_notes` | string | Android 更新说明；为空时回退到 `update_notes` |
| `android_force_update` | boolean-string | Android 是否强制更新；为空时回退到 `force_update` |

推荐在 `/api/v1/app/bootstrap` 中增加一个兼容块，保持现有结构不变：

```json
{
  "data": {
    "app_info": {},
    "features": {},
    "public_ui_config": {},
    "remote_config": {
      "APP_NAME": "muacloud",
      "login_title": "欢迎使用",
      "APP_URL": "",
      "custom_ua": "muacloud/1.0",
      "app_logo": "",
      "oss_url": "",
      "api_domains": "https://5.muacloud.xyz;https://5.12o.ooo;https://muacloud.vip;https://5.muacloud.vip",
      "backup_api_domains": "",
      "subscribe_path": "link",
      "tg_channel": "",
      "official_url": "",
      "invite_domain": "",
      "crisp_id": "4010755c-2d1e-42a1-8380-8f4c20fe01c4",
      "imgbb_api_key": "",
      "discount_delay_seconds": 0,
      "delay_display_scale": 0.5,
      "version": "1.0.0",
      "update_notes": "",
      "force_update": false,
      "latest_client_url": "",
      "windows_version": "",
      "windows_download_url": "",
      "windows_update_notes": "",
      "windows_force_update": false,
      "macos_version": "",
      "macos_download_url": "",
      "macos_update_notes": "",
      "macos_force_update": false,
      "android_version": "",
      "android_download_url": "",
      "android_update_notes": "",
      "android_force_update": false
    }
  }
}
```

客户端解析规则：

- `api_domains` 和 `backup_api_domains` 用 `;` 拆分，去空、去重、去尾部 `/`。
- `backup_api_domains` 永远排在 `api_domains` 后面。
- `custom_ua` 必须用于后续 API、订阅和版本请求，便于服务端识别专属客户端。
- `subscribe_path=link` 时，Web 兼容订阅地址为 `{active_api_domain}/link/{subscribe_token}`。
- `APP_URL` 为空时，客户端可使用当前选中的 `active_api_domain` 作为打开官网/登录跳转的基础域名。
- `force_update=true` 时，必须优先展示强更页面；`latest_client_url` 为空时使用 `download_urls` 当前平台地址兜底。
- 平台字段优先级高于通用字段。例如 Windows 端优先读取 `windows_version`、`windows_download_url`、`windows_update_notes`、`windows_force_update`，为空时再回退到 `version`、`latest_client_url`、`update_notes`、`force_update`。
- `delay_display_scale` 只用于压缩节点延迟展示值，客户端必须限制在 `0.1`-`1` 之间；超时、错误和真实测速结果不得被该字段改写。
- `oss_url` 可作为图片、公告、安装包、远程配置镜像的兜底源，不参与用户 API 请求。
- `imgbb_api_key` 属于公开配置风险字段。若用于用户上传截图，建议后续改为后端上传代理，避免 key 被客户端逆向提取。

推荐后续增加的结构化字段：

- `api_health_path`：默认 `/api/v1/app/bootstrap`
- `api_timeout_ms`：默认 `2500`
- `api_failover_cooldown_seconds`：默认 `300`
- `config_signature`：远程配置签名，防止配置被篡改
- `config_public_key_id`：签名公钥 ID，便于轮换

### 10.10 远程配置文件访问与缓存策略

这里的“远程配置文件”是客户端启动时可读取的公开配置。它可以来自：

| 来源 | 示例 | 用途 |
|---|---|---|
| API bootstrap | `{api_domain}/api/v1/app/bootstrap` | 首选，结构化 JSON，能直接参与后端能力协商 |
| OSS/CDN 配置文件 | `{oss_url}/muacloud.remote.env` 或 `{oss_url}/remote-config.json` | API 不可达时兜底 |
| App 内置种子配置 | 打包在客户端内 | 首次安装、完全离线、所有远程源失效时兜底 |
| 本地最后成功配置 | 客户端安全存储/本地文件 | 减少启动请求，提升可用性 |

推荐远程文件格式：

- 兼容 `.env` 文本格式，保留 `APP_NAME=muacloud` 这类字段。
- 也可以额外提供 JSON 镜像，但客户端必须继续兼容 `.env`。
- 文件应通过 HTTPS 访问。
- 生产环境建议增加签名字段或旁路签名文件，例如 `remote.env.sig`。

客户端启动时不要阻塞等待远程文件。推荐流程：

1. 立即读取本地最后成功配置，先渲染启动页和登录页。
2. 如果本地配置不存在，使用 App 内置种子配置。
3. 判断缓存是否过期：`now - fetched_at > bootstrap_cache_duration`。
4. 未过期时不阻塞访问远程配置，只在后台静默刷新。
5. 已过期时也先展示缓存，再后台拉取；除非是首次安装且无缓存。
6. 后台优先请求 `{active_api_domain}/api/v1/app/bootstrap`。
7. 如果失败，再尝试内置 `api_domains`、远程 `api_domains`、`backup_api_domains`。
8. 如果所有 API 都失败，再尝试 `oss_url` 下的远程配置文件。
9. 拉到新配置后校验格式、版本、签名、域名列表。
10. 校验通过才覆盖本地缓存；校验失败继续使用旧配置。

访问频率建议：

| 场景 | 是否访问远程配置 | 说明 |
|---|---|---|
| 首次安装且无缓存 | 必须访问 | 访问失败则使用内置种子配置 |
| 普通启动，缓存未过期 | 不阻塞访问 | 直接用缓存，后台可静默刷新 |
| 普通启动，缓存已过期 | 后台访问 | UI 先用缓存，刷新成功后更新 |
| 用户手动点击刷新 | 访问 | 显示刷新状态 |
| 登录、下单、订阅失败 | 可触发域名重探 | 只重探域名，不重复提交非幂等请求 |
| App 从后台回到前台 | 视 TTL 决定 | 距离上次刷新超过 TTL 才访问 |

默认频率：

- `bootstrap_cache_duration=300` 秒时，最多 5 分钟主动刷新一次。
- 如果远程连续失败，使用指数退避：1 分钟、5 分钟、15 分钟、30 分钟。
- 强更、维护、公告类配置可以保持 5 分钟 TTL。
- 普通主题、Logo、客服链接可以 30-60 分钟刷新一次；如果仍用同一个 bootstrap，则以最短 TTL 为准。

减少访问次数的机制：

- 使用 `config_hash`：新 hash 与本地一致时，不触发 UI 重建和二次请求。
- 如果后端支持 `ETag`，客户端发送 `If-None-Match`，返回 304 时沿用本地配置。
- 如果后端支持 `Last-Modified`，客户端发送 `If-Modified-Since`。
- 客户端保存 `fetched_at`、`config_hash`、`active_api_domain`、`failed_domains`。
- 启动页优先读本地缓存，不等待网络。

远程配置失效处理：

- 单个远程文件 404/超时，不清空本地配置。
- 配置格式解析失败，不覆盖本地配置。
- 签名校验失败，不覆盖本地配置，并记录安全日志。
- 所有源不可达时，继续使用本地最后成功配置。
- 如果本地也没有配置，使用 App 内置种子配置。
- 如果强更配置不可达，不应强制阻断用户；只有明确拿到 `force_update=true` 且版本判断命中时才强更。

客户端内置种子配置至少包含：

```env
APP_NAME=muacloud
login_title=欢迎使用
custom_ua=muacloud/1.0
api_domains=https://5.muacloud.xyz;https://5.12o.ooo;https://muacloud.vip;https://5.muacloud.vip
backup_api_domains=
subscribe_path=link
delay_display_scale=0.5
version=1.0.0
force_update=false
```

远程文件推荐部署位置：

- 主 API：`https://5.muacloud.xyz/api/v1/app/bootstrap`
- 备用 API：`https://5.12o.ooo/api/v1/app/bootstrap`
- 主站：`https://muacloud.vip/api/v1/app/bootstrap`
- 备用主站：`https://5.muacloud.vip/api/v1/app/bootstrap`
- OSS/CDN：`{oss_url}/remote/muacloud.env`
- OSS/CDN 签名：`{oss_url}/remote/muacloud.env.sig`

客户端要把“远程配置源”和“业务 API 源”分开理解：

- 远程配置源用来发现域名、品牌、强更、维护、下载地址。
- 业务 API 源用来登录、获取套餐、下单、支付确认、拉订阅。
- `oss_url` 不能替代业务 API，只能做静态配置和资源兜底。

## 11. 客户端页面清单

### 11.1 UI 方向选择

可直接打开预览文件：`docs/ui-options/desktop-ui-options.html`。

该预览只约束视觉方向、信息层级和桌面交互方式，不新增后端字段，不改变前文 API 契约。客户端实现时仍必须从 Xboard 后端读取套餐、节点、支付、用户权益、公告、工单和功能开关。

| 方案 | 定位 | 适合场景 | 建议 |
|---|---|---|---|
| A. Native Control | 原生控制台风格 | 作为正式主方案，适合长期商业化维护 | 推荐优先采用 |
| B. Warm Consumer | 更亲和的消费级界面 | 面向普通用户、弱化技术感、突出购买和客服 | 可作为品牌化版本 |
| C. Pro Ops | 高密度专业工具界面 | 面向高级用户、诊断、日志、策略组、连接列表 | 作为高级模式 |
| D. Compact Native | 小窗/托盘优先 | 快速连接、节点切换、状态查看 | 作为迷你窗口或菜单栏窗口 |

Windows 和 macOS 双端建议使用同一套前端工程实现，例如 Tauri + React/TypeScript。窗口标题栏、系统代理权限、开机自启、托盘、通知、证书/TUN 权限提示等由桌面层按平台适配；页面、组件、主题变量和业务 SDK 保持共用。

推荐落地方式：

- 主窗口采用 A 方案，确保首页连接、节点、套餐、账户、设置和诊断都清晰稳定。
- 登录/注册、套餐购买、活动弹窗和客服入口可吸收 B 方案的视觉温度。
- 日志、连接列表、策略组、TUN/DNS 和故障诊断采用 C 方案的信息密度。
- 托盘菜单、悬浮小窗、快速切换节点采用 D 方案。
- UI 配色、logo、登录标题、客服 ID、下载地址和强更状态从 `/api/v1/app/bootstrap`、远程配置文件和 `/api/v2/client/app/getConfig` 读取，不在客户端硬编码。

### 11.2 页面范围

MVP 必做：

- 登录/注册/找回密码
- 首页连接
- 节点列表
- 套餐购买
- 订单支付
- 我的账户
- 设置
- 日志/诊断
- 公告
- 工单

商业闭环增强：

- 礼品卡
- 邀请返佣
- 流量图表
- 知识库
- 设备管理
- 活动弹窗
- 自动续费
- 企业/团队入口

高级代理功能：

- TUN 模式
- DNS 模式
- 系统代理
- PAC / 绕过局域网
- 策略组切换
- 节点延迟测试
- 连接列表
- 规则命中日志
- 配置备份和恢复

## 12. AI 开发约束

给 AI 开发客户端时，必须附带本节规则：

1. 不允许创造不存在的后端字段。
2. 不允许硬编码套餐价格、套餐名、支付方式、节点列表。
3. 不允许绕过 `/user/server/fetch` 直接连接旧缓存节点。
4. 不允许用本地时间单独判断套餐有效性，必须以后端订阅信息为准。
5. 所有 API 请求必须走统一 SDK。
6. 所有后端错误必须展示 `message`。
7. 所有购买结果必须通过 `/order/check` 二次确认。
8. 所有订阅配置必须来自 Xboard 订阅接口。
9. 功能入口必须受 `/api/v2/client/app/getConfig` 控制。
10. 新增页面前必须先补本契约。

## 13. 推荐开发顺序

1. 实现 Xboard API SDK。
2. 实现登录态和 token 安全存储。
3. 实现 `/app/getConfig` 功能开关和主题读取。
4. 实现用户信息、订阅信息、节点列表。
5. 实现订阅下载和 mihomo 启动。
6. 实现首页一键连接。
7. 实现套餐购买和订单支付。
8. 实现工单、公告、知识库。
9. 实现礼品卡、邀请、佣金。
10. 实现设备绑定、埋点、远程配置增强。

## 14. 验收清单

- 登录成功后能拿到 `auth_data` 和 `token`。
- `/user/info` 能正常返回用户资料。
- `/user/getSubscribe` 能返回套餐、流量、到期和订阅链接。
- `/user/server/fetch` 空数组时客户端禁止连接。
- `/api/v2/client/app/getConfig` 无 token 时返回 403，客户端必须走游客启动配置。
- `/client/subscribe?flag=clashmeta` 返回 YAML 且 mihomo 能加载。
- 套餐价格来自 `/user/plan/fetch`。
- 支付方式来自 `/user/order/getPaymentMethod`。
- `/user/order/checkout` 返回支付 URL 后，必须完成支付跳转并通过 `/user/order/check` 确认状态为 `3`。
- 优惠券先 `/coupon/check` 再下单。
- 礼品卡先 `/gift-card/check` 再 `/gift-card/redeem`。
- 工单创建、回复、关闭均以后端状态为准。
- App 功能入口受 `/api/v2/client/app/getConfig` 控制。
- 重置订阅安全后本地订阅 token 被更新。
- 断网时显示本地缓存，但不能放行过期或无效订阅的新连接。

## 15. 本地 Docker 冒烟测试记录

测试实例：

- 地址：`http://127.0.0.1:7001`
- 容器：`xboard-compose-xboard-1`
- 镜像：`ghcr.io/cedar2025/xboard:latest`
- 镜像 revision：`bb77df9a578f8c20b3987b21752b457b3cf12050`

已验证：

- `/api/v1/guest/comm/config` 成功，返回游客配置。
- `/api/v1/guest/plan/fetch` 成功，测试实例返回 2 个套餐。
- `/api/v1/passport/auth/register` 成功，返回 `token/auth_data/is_admin`。
- `/api/v1/passport/auth/login` 成功，返回 `token/auth_data/is_admin`。
- `/api/v1/user/checkLogin` 使用 Bearer 成功。
- `/api/v1/user/info` 成功。
- 新用户无套餐时 `/api/v1/user/server/fetch` 返回空数组。
- 新用户无套餐时 `/api/v1/client/subscribe?flag=clashmeta` 返回 403 空响应。
- `/api/v2/client/app/getConfig` 无 token 返回 403 `token is null`。
- `/api/v2/client/app/getConfig?token=...` 成功，返回 `{ data: ... }`。
- `/api/v1/client/app/getConfig?token=...` 成功返回基础 Clash YAML，但不能作为权益校验依据。
- `/api/v1/user/order/save` 成功返回 `trade_no`。
- `/api/v1/user/order/checkout` 返回 `type=1` 和支付 URL。
- 访问测试支付成功动作后，`/api/v1/user/order/check` 返回 `3`。
- 支付完成后 `/api/v1/user/getSubscribe` 返回套餐、流量和到期时间。
- 支付完成后 `/api/v1/user/server/fetch` 返回可用节点。
- 支付完成后 `/api/v1/client/subscribe?flag=clashmeta` 返回 `text/yaml` 配置。
- `/api/v1/user/ticket/save` 和 `/api/v1/user/ticket/fetch` 成功。
- `/api/v1/user/knowledge/getCategory` 当前返回 500，不建议客户端使用。
