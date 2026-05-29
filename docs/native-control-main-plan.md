# A. Native Control 主方案设计规范

本文档用于固定专属客户端的主 UI 方向。它只约束视觉、布局、页面层级和交互方式，不新增后端字段，不改变 `docs/CLIENT_CONTRACT.md` 中的接口契约。

可视化预览文件：`docs/ui-options/desktop-ui-options.html`

## 1. 方案结论

主方案选择 **A. Native Control**。

该方案定位为“原生桌面控制台风格”的商业代理客户端。它适合作为 Windows 和 macOS 双端的长期主界面，因为它足够稳定、专业、清晰，不像临时网页壳，也不会因为过度营销化影响代理工具的可信度。

最终组合策略：

- A. Native Control：作为主窗口骨架。
- B. Warm Consumer：用于登录、注册、套餐购买、活动弹窗和客服入口。
- C. Pro Ops：用于日志、连接列表、策略组、TUN、DNS 和诊断页面。
- D. Compact Native：用于托盘菜单、菜单栏窗口和快速连接小窗。

一句话原则：**A 做骨架，B 做商业转化，C 做高级能力，D 做托盘体验。**

## 2. 产品气质

界面应该像一个真正的商业桌面客户端，而不是网页后台、教程 Demo 或简单 Clash Verge 换皮。

关键词：

- 稳定
- 专业
- 可信
- 干净
- 易读
- 原生感
- 长期可维护

避免：

- 大面积营销落地页风格
- 过度渐变、过度发光、装饰性背景
- 信息散乱的卡片堆叠
- 像网页管理后台一样沉重
- 把套餐、节点、支付状态写死在前端

## 3. 技术承载建议

Windows 和 macOS 双端建议使用同一套前端工程：

- 桌面壳：Tauri
- UI：React + TypeScript
- 状态管理：轻量 store，例如 Zustand
- 本地核心：mihomo
- API：统一 XboardApiClient SDK
- 平台能力：由 Tauri command 分别适配 Windows/macOS

共用部分：

- 页面结构
- 组件库
- 主题变量
- API SDK
- 登录态管理
- 订阅配置流程
- mihomo 状态模型

平台分别适配：

- 窗口标题栏
- 托盘 / macOS 菜单栏
- 开机自启
- 通知
- 系统代理权限
- TUN 权限提示
- 日志路径
- 自动更新安装流程

## 4. 主窗口布局

主窗口采用三段式结构：

| 区域 | 作用 |
|---|---|
| 左侧导航 | 固定主功能入口 |
| 中间主内容 | 当前页面核心操作 |
| 右侧状态栏 | 公告、客服、版本、维护、账户摘要 |

推荐默认窗口尺寸：

- Windows：`1100 x 720`
- macOS：`1080 x 700`
- 最小尺寸：`960 x 640`

左侧导航建议宽度：

- 展开：`220px`
- 收起：`72px`

右侧状态栏建议宽度：

- 桌面宽屏显示：`280px`
- 小尺寸窗口自动折叠到页面内

## 5. 导航结构

MVP 主导航：

| 页面 | 作用 |
|---|---|
| 连接 | 一键连接、当前套餐、流量、推荐节点、系统代理状态 |
| 节点 | 节点列表、延迟测试、地区筛选、策略组切换 |
| 套餐 | 套餐购买、续费、重置流量 |
| 订单 | 订单记录、支付状态、继续支付 |
| 工单 | 客服工单、回复、关闭、状态提醒 |
| 日志 | mihomo 日志、连接日志、诊断信息 |
| 设置 | 代理模式、TUN、DNS、开机自启、更新、远程配置 |

增强导航：

| 页面 | 作用 |
|---|---|
| 邀请 | 邀请链接、返佣、提现入口 |
| 礼品卡 | 兑换码、礼品卡校验和兑换 |
| 设备 | 设备绑定、会话安全、重置订阅 |
| 知识库 | 公告、教程、常见问题 |

## 6. 首页连接页

首页是主方案最重要的页面，必须优先做好。

核心信息：

- 连接状态
- 当前节点
- 当前策略
- 当前套餐
- 已用流量
- 总流量
- 到期时间
- 可用节点数量
- 系统代理状态
- TUN 状态
- 当前上下行速度

核心操作：

- 连接 / 断开
- 切换推荐节点
- 测速
- 打开系统代理
- 打开 TUN
- 续费 / 购买
- 查看日志

数据来源必须遵守：

| 信息 | 来源 |
|---|---|
| 用户信息 | `/api/v1/user/info` |
| 套餐、流量、到期 | `/api/v1/user/getSubscribe` |
| 可用节点 | `/api/v1/user/server/fetch` |
| 订阅配置 | `/api/v1/client/subscribe?token={subscribe_token}&flag=clashmeta` |
| App 配置 | `/api/v2/client/app/getConfig?token={subscribe_token}` |
| 未登录启动配置 | `/api/v1/app/bootstrap` |
| 远程品牌配置 | 远程 `.env` 配置文件 |
| mihomo 状态 | 本地 mihomo API |

规则：

- `/user/server/fetch` 返回空数组时，禁止连接。
- 订阅接口返回 403 或空配置时，禁止连接。
- 不能使用旧缓存节点绕过后端权益验证。
- 不能用本地时间单独判断套餐是否有效。

## 7. 节点页

节点页采用工具型列表，而不是花哨卡片墙。

建议字段：

- 节点名称
- 国家/地区
- 协议类型
- 延迟
- 倍率
- 标签
- 在线状态
- 当前选中状态

建议操作：

- 全部测速
- 单节点测速
- 按地区筛选
- 按延迟排序
- 按倍率排序
- 收藏常用节点
- 切换策略组

注意：

- 节点可见性以后端 `/user/server/fetch` 为准。
- 协议配置以订阅接口生成的 mihomo 配置为准。
- 客户端可以做本地测速和排序，但不能自行拼接节点连接参数。

## 8. 套餐和支付页

套餐页可以吸收 B. Warm Consumer 的视觉温度，但仍放在 A 的主框架里。

必须做到：

- 套餐来自 `/api/v1/user/plan/fetch`
- 价格来自后端
- 支付方式来自 `/api/v1/user/order/getPaymentMethod`
- 下单使用 `/api/v1/user/order/save`
- 支付使用 `/api/v1/user/order/checkout`
- 支付完成必须轮询 `/api/v1/user/order/check`
- 订单状态为 `3` 后才能刷新权益

禁止：

- 前端硬编码套餐价格
- 支付页返回成功就直接发放权益
- 跳过优惠券校验
- 本地伪造订单成功状态

## 9. 工单和客服

工单页保持清晰、克制，像桌面应用里的消息/支持中心。

建议结构：

- 左侧工单列表
- 中间对话内容
- 底部回复框
- 右侧问题状态和客服入口

如果远程配置或 App 配置里开启客服入口：

- Crisp ID 从远程配置 `crisp_id` 或 `/api/v1/app/bootstrap` 读取。
- Telegram 频道从 `tg_channel` 读取。
- 官方网站从 `official_url` 或当前 active API domain 推导。

不要把客服 ID 写死在代码里，除非作为离线兜底默认值。

## 10. 日志和诊断

日志页吸收 C. Pro Ops 的信息密度。

建议分栏：

- 运行日志
- 连接日志
- 配置日志
- 诊断结果

建议能力：

- 搜索
- 复制
- 导出
- 按级别过滤
- 一键诊断
- 上传诊断包前二次确认

诊断内容建议包含：

- 当前 active API domain
- 远程配置源状态
- 最近一次 config_hash
- mihomo 版本
- mihomo 运行状态
- 系统代理状态
- TUN 状态
- 订阅下载状态
- 最近一次后端错误 message

## 11. 设置页

设置页不要做成杂乱表单，按模块分组。

推荐分组：

- 账户
- 代理
- TUN
- DNS
- 节点和策略
- 通知
- 启动和托盘
- 更新
- 远程配置
- 关于

关键设置：

- 系统代理开关
- TUN 模式
- DNS 模式
- 绕过局域网
- 开机自启
- 最小化到托盘
- 自动选择低延迟节点
- 启动时刷新订阅
- 配置缓存 TTL
- 当前 active API domain
- 手动刷新远程配置

功能入口必须受 `/api/v2/client/app/getConfig` 控制。后端关闭的功能，客户端必须隐藏或禁用。

## 12. 视觉规范

整体风格：

- 背景浅灰或浅绿色灰
- 主内容白色面板
- 线条克制
- 圆角不超过 `8px`
- 信息密度适中
- 状态颜色明确

建议色彩角色：

| 角色 | 用途 |
|---|---|
| 主色 | 连接按钮、选中状态、主要动作 |
| 成功色 | 已连接、支付成功、订阅有效 |
| 警告色 | 即将到期、流量不足、延迟偏高 |
| 危险色 | 连接失败、订阅失效、强制更新 |
| 中性色 | 文本、边框、背景、禁用状态 |

字体：

- Windows：Segoe UI + Microsoft YaHei
- macOS：SF Pro + PingFang SC
- 前端统一使用 system font stack

按钮：

- 主要按钮用于连接、购买、支付、保存
- 次要按钮用于测速、刷新、复制
- 危险按钮用于退出登录、重置订阅、删除缓存
- 图标按钮用于设置、复制、刷新、展开、关闭

## 13. 状态设计

必须设计以下状态：

- 未登录
- 登录中
- 已登录无套餐
- 已登录套餐有效
- 套餐过期
- 节点为空
- 连接中
- 已连接
- 连接失败
- mihomo 未启动
- 订阅下载失败
- API 不可达
- 远程配置不可达
- 维护模式
- 强制更新
- 离线兜底模式

这些状态不能只靠弹窗处理，首页和右侧状态栏都要能表达。

## 14. 托盘和小窗

托盘/菜单栏采用 D. Compact Native 的思路，但视觉风格跟随 A。

托盘菜单建议包含：

- 当前状态
- 连接 / 断开
- 当前节点
- 快速切换节点
- 系统代理开关
- TUN 开关
- 打开主窗口
- 查看日志
- 退出

小窗建议包含：

- 连接状态
- 当前节点
- 上下行速度
- 一键连接
- 节点切换

## 15. 远程配置和主题

UI 相关配置来源优先级：

1. 本地最后成功配置
2. `/api/v1/app/bootstrap`
3. 远程 `.env` 配置文件
4. `/api/v2/client/app/getConfig?token=...`
5. App 内置种子配置

需要支持的远程字段继续保持：

- `APP_NAME`
- `login_title`
- `APP_URL`
- `custom_ua`
- `app_logo`
- `oss_url`
- `api_domains`
- `backup_api_domains`
- `subscribe_path`
- `tg_channel`
- `official_url`
- `invite_domain`
- `crisp_id`
- `discount_delay_seconds`
- `delay_display_scale`
- `version`
- `update_notes`
- `force_update`
- `latest_client_url`
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

可以新增结构化主题字段，但不能删除或改变以上字段含义。

## 16. 给 AI 开发客户端的强约束

后续让 AI 写客户端时，必须把以下规则放进提示词：

1. UI 主方案采用 `A. Native Control`。
2. 不允许创造后端不存在的字段。
3. 不允许硬编码套餐、价格、支付方式、节点、权益。
4. 所有业务状态必须来自 Xboard API。
5. 所有 API 请求必须经过统一 SDK。
6. 首页连接能力必须先校验 `/user/getSubscribe` 和 `/user/server/fetch`。
7. 订阅配置必须来自 `/api/v1/client/subscribe?token=...&flag=clashmeta`。
8. 未登录首屏必须使用 `/api/v1/app/bootstrap` 或本地缓存配置。
9. API 不可达时先使用本地最后成功配置展示 UI，不清空用户数据。
10. Windows 和 macOS 共用 UI，平台能力通过 Tauri command 分别实现。

## 17. 第一版落地范围

第一版不要贪多，先做出完整闭环：

1. 启动配置和品牌加载
2. 登录 / 注册
3. 首页连接
4. 用户信息和订阅信息
5. 节点列表
6. 订阅下载和 mihomo 启动
7. 系统代理开关
8. 套餐购买
9. 订单支付确认
10. 设置
11. 日志
12. 托盘基础菜单

做到这里，就已经是一款可以商业闭环的专属桌面客户端。
