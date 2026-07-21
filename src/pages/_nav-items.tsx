import AccountCircleRoundedIcon from '@mui/icons-material/AccountCircleRounded'
import CloudSyncRoundedIcon from '@mui/icons-material/CloudSyncRounded'
import EqualizerRoundedIcon from '@mui/icons-material/EqualizerRounded'
import HomeRoundedIcon from '@mui/icons-material/HomeRounded'
import HubRoundedIcon from '@mui/icons-material/HubRounded'
import LanguageRoundedIcon from '@mui/icons-material/LanguageRounded'
import LanRoundedIcon from '@mui/icons-material/LanRounded'
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded'
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded'
import ShoppingCartRoundedIcon from '@mui/icons-material/ShoppingCartRounded'
import SupportAgentRoundedIcon from '@mui/icons-material/SupportAgentRounded'

import ConnectionsPage from './connections'
import ProfilesPage from './profiles'
import ProxiesPage from './proxies'
import SettingsPage from './settings-entry'
import AccountPage from './xboard/account'
import AdvancedSettingsPage from './xboard/advanced-entry'
import ConnectPage from './xboard/connect'
import NodesPage from './xboard/nodes'
import OrdersPage from './xboard/orders'
import PlansPage from './xboard/plans'
import TicketsPage from './xboard/tickets'
import TrafficRecordsPage from './xboard/traffic-records'

export const navItems = [
  {
    label: '连接',
    path: '/',
    icon: [<HomeRoundedIcon key="mui" />],
    Component: ConnectPage,
  },
  // 离线模式（本地订阅）专用页面：仅在未登录且开启离线模式时显示，见 _layout.tsx
  {
    label: '订阅',
    path: '/profiles',
    icon: [<CloudSyncRoundedIcon key="mui" />],
    Component: ProfilesPage,
  },
  {
    label: '代理',
    path: '/proxies',
    icon: [<LanRoundedIcon key="mui" />],
    Component: ProxiesPage,
  },
  {
    label: '节点',
    path: '/nodes',
    icon: [<HubRoundedIcon key="mui" />],
    Component: NodesPage,
  },
  {
    label: '套餐',
    path: '/plans',
    icon: [<ShoppingCartRoundedIcon key="mui" />],
    Component: PlansPage,
  },
  {
    label: '订单',
    path: '/orders',
    icon: [<ReceiptLongRoundedIcon key="mui" />],
    Component: OrdersPage,
  },
  {
    label: '客服',
    path: '/tickets',
    icon: [<SupportAgentRoundedIcon key="mui" />],
    Component: TicketsPage,
  },
  {
    label: '记录',
    path: '/traffic-records',
    icon: [<EqualizerRoundedIcon key="mui" />],
    Component: TrafficRecordsPage,
  },
  {
    label: '连接',
    path: '/connections',
    icon: [<LanguageRoundedIcon key="mui" />],
    Component: ConnectionsPage,
  },
  {
    label: '账户',
    path: '/account',
    icon: [<AccountCircleRoundedIcon key="mui" />],
    Component: AccountPage,
  },
  {
    label: '设置',
    path: '/settings',
    icon: [<SettingsRoundedIcon key="mui" />],
    Component: SettingsPage,
  },
  {
    label: '高级',
    path: '/advanced',
    icon: [<SettingsRoundedIcon key="mui" />],
    Component: AdvancedSettingsPage,
  },
]
