import { Typography } from '@mui/material'

import { XboardEmpty, XboardPanel } from '@/components/xboard/xboard-primitives'

const XboardAdvancedPage = () => (
  <XboardPanel title="高级设置">
    <XboardEmpty
      title="桌面端可用"
      description="系统代理、服务模式、配置编辑器等高级能力需要在 Tauri 桌面运行时中打开。"
      action={
        <Typography variant="caption" color="text.secondary">
          当前浏览器预览已隐藏这些原生控制项。
        </Typography>
      }
    />
  </XboardPanel>
)

export default XboardAdvancedPage
