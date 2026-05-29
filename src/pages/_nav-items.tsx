import AccountCircleRoundedIcon from '@mui/icons-material/AccountCircleRounded'
import EqualizerRoundedIcon from '@mui/icons-material/EqualizerRounded'
import HomeRoundedIcon from '@mui/icons-material/HomeRounded'
import HubRoundedIcon from '@mui/icons-material/HubRounded'
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded'
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded'
import ShoppingCartRoundedIcon from '@mui/icons-material/ShoppingCartRounded'
import SupportAgentRoundedIcon from '@mui/icons-material/SupportAgentRounded'

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
    label: '杩炴帴',
    path: '/',
    icon: [<HomeRoundedIcon key="mui" />],
    Component: ConnectPage,
  },
  {
    label: '鑺傜偣',
    path: '/nodes',
    icon: [<HubRoundedIcon key="mui" />],
    Component: NodesPage,
  },
  {
    label: '濂楅',
    path: '/plans',
    icon: [<ShoppingCartRoundedIcon key="mui" />],
    Component: PlansPage,
  },
  {
    label: '璁㈠崟',
    path: '/orders',
    icon: [<ReceiptLongRoundedIcon key="mui" />],
    Component: OrdersPage,
  },
  {
    label: '瀹㈡湇',
    path: '/tickets',
    icon: [<SupportAgentRoundedIcon key="mui" />],
    Component: TicketsPage,
  },
  {
    label: '璁板綍',
    path: '/traffic-records',
    icon: [<EqualizerRoundedIcon key="mui" />],
    Component: TrafficRecordsPage,
  },
  {
    label: '璐︽埛',
    path: '/account',
    icon: [<AccountCircleRoundedIcon key="mui" />],
    Component: AccountPage,
  },
  {
    label: '璁剧疆',
    path: '/settings',
    icon: [<SettingsRoundedIcon key="mui" />],
    Component: SettingsPage,
  },
  {
    label: '楂樼骇',
    path: '/advanced',
    icon: [<SettingsRoundedIcon key="mui" />],
    Component: AdvancedSettingsPage,
  },
]
