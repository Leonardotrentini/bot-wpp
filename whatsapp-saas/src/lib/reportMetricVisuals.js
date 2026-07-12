import {
  LayoutGrid,
  UserPlus,
  DollarSign,
  Megaphone,
  TrendingUp,
  BarChart3,
  Users,
  Target,
  PieChart,
  LineChart,
  FileText,
  ShoppingCart,
  MousePointerClick,
} from 'lucide-react'

const CATEGORY_STYLES = {
  groups: {
    icon: LayoutGrid,
    accent: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/20',
  },
  crm: {
    icon: UserPlus,
    accent: 'text-sky-400',
    bg: 'bg-sky-500/10',
    border: 'border-sky-500/20',
  },
  meta: {
    icon: Megaphone,
    accent: 'text-violet-400',
    bg: 'bg-violet-500/10',
    border: 'border-violet-500/20',
  },
  attr: {
    icon: Target,
    accent: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/20',
  },
}

const METRIC_ICONS = {
  'groups.active': LayoutGrid,
  'groups.new_leads': Users,
  'crm.conversations_started': UserPlus,
  'crm.sales_revenue': DollarSign,
  'crm.sales_count': ShoppingCart,
  'crm.quotes_count': FileText,
  'crm.quotes_value': FileText,
  'crm.roas': TrendingUp,
  'crm.funnel_stages': PieChart,
  'groups.messages_series': LineChart,
  'crm.sales_series': BarChart3,
  'meta.spend': Megaphone,
  'meta.top_ads_clicks': MousePointerClick,
  'meta.conversions': Target,
  'attr.cost_per_lead': Target,
  'attr.cost_per_qualified_lead': Target,
  'attr.cost_per_sale': Target,
}

export function getMetricVisual(metricId, category) {
  const cat = CATEGORY_STYLES[category] || CATEGORY_STYLES.crm
  const Icon = METRIC_ICONS[metricId] || cat.icon
  return { ...cat, Icon }
}

export function getCategoryStyle(category) {
  return CATEGORY_STYLES[category] || CATEGORY_STYLES.crm
}
