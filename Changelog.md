## v2.5.3

### 🚀 优化改进

- API 请求优先使用远程配置中的 CDN 加速域名，并支持并行故障转移
- 登录完成鉴权后快速进入，账户与订阅数据转为后台同步
- 首次启动无订阅缓存时显示初始化页，后续登录优先使用本地缓存

## v2.5.2

### 🐞 修复问题

- macOS 托盘速率可能的样式错误
- 修复订阅 TLS 1.0/1.1 等过旧协议时显示更明确错误原因
- 修复 gzip 压缩订阅响应被当作无效 YAML 导致导入失败的问题
- 修复订阅 URL 使用空密码 Basic Auth 时未发送认证信息的问题
- Linux 托盘可能与其他 tauri 程序托盘冲突导致图标异常
- 修复前端连接页面导致的内存泄漏
- macOS 12(Monterey) 首页 IP 卡兼容性

<details>
<summary><strong> ✨ 新增功能 </strong></summary>

- 增加 TrustTunnel, OpenVPN, Tailscale, GostRelay 节点显示支持

</details>

<details>
<summary><strong> 🚀 优化改进 </strong></summary>

- 关闭 autofill 弹出窗口

</details>
