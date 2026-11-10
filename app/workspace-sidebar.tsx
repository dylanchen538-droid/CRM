'use client';

import { useEffect, useState } from 'react';
import { CheckSquare, ChevronDown, LayoutDashboard, LogOut, MessagesSquare, Settings, ShieldCheck, Users } from 'lucide-react';

export type SidebarDestination = {
  view: string;
  tab?: string;
  source?: 'chat' | 'mail';
  quote?: 'quote' | 'order';
  section?: string;
};

type Entry = SidebarDestination & { label: string };
type Group = { id: string; label: string; icon: typeof Users; entries: Entry[] };

const groups: Group[] = [
  { id: 'workbench', label: '工作台', icon: LayoutDashboard, entries: [
    { label: '销售工作台', view: 'home' },
    { label: '销售报告', view: 'reports' },
    { label: '业务员推进记录', view: 'reports', section: 'sales-by-owner' },
    { label: '订单金额统计', view: 'reports', section: 'sales-by-currency' },
  ] },
  { id: 'customers', label: '客户 / 机会', icon: Users, entries: [
    { label: '全部客户', view: 'customers', tab: '全部客户' },
    { label: '重点客户', view: 'customers', tab: '重点客户' },
    { label: '共享待分配', view: 'customers', tab: '共享待分配' },
    { label: '待核实客户', view: 'customers', tab: '待核实' },
    { label: '商机看板', view: 'pipeline' },
    { label: '询盘记录', view: 'inquiries' },
    { label: '相似客户检查', view: 'settings', section: 'similar-customers' },
  ] },
  { id: 'communication', label: '沟通 / 话术', icon: MessagesSquare, entries: [
    { label: '国际站会话', view: 'messages', source: 'chat' },
    { label: '企业邮箱往来', view: 'messages', source: 'mail' },
    { label: '每日话术建议', view: 'scripts', section: 'daily-replies' },
    { label: '固定话术库', view: 'scripts', section: 'script-library' },
  ] },
  { id: 'activities', label: '活动 / 任务', icon: CheckSquare, entries: [
    { label: '全部跟进任务', view: 'tasks', tab: '全部任务' },
    { label: '今日到期', view: 'tasks', tab: '今日到期' },
    { label: '已逾期', view: 'tasks', tab: '已逾期' },
    { label: '待完成', view: 'tasks', tab: '待完成' },
    { label: '已完成', view: 'tasks', tab: '已完成' },
    { label: '寄样管理', view: 'samples' },
    { label: '报价记录', view: 'quotes', quote: 'quote' },
    { label: '订单记录', view: 'quotes', quote: 'order' },
  ] },
  { id: 'settings', label: '基础信息', icon: Settings, entries: [
    { label: '企业业务口径', view: 'settings', section: 'company-info' },
    { label: '客户导入与备份', view: 'settings', section: 'data-backup' },
    { label: '资料来源与接入状态', view: 'settings', section: 'data-sources' },
    { label: '已归档记录', view: 'settings', section: 'archived-records' },
    { label: '操作日志', view: 'settings', section: 'audit-log' },
    { label: '平台对接', view: 'integrations' },
  ] },
];

function matches(entry: Entry, current: SidebarDestination) {
  return entry.view === current.view && entry.tab === current.tab
    && entry.source === current.source && entry.quote === current.quote
    && entry.section === current.section;
}

export default function WorkspaceSidebar({ current, mobile, user, customers, pending, onSelect }: {
  current: SidebarDestination;
  mobile: boolean;
  user: string;
  customers: number;
  pending: number;
  onSelect: (destination: SidebarDestination) => void;
}) {
  const currentGroup = groups.find(group => group.entries.some(entry => matches(entry, current)))?.id;
  const [expanded, setExpanded] = useState(currentGroup);
  useEffect(() => { setExpanded(currentGroup); }, [currentGroup]);

  return <aside className={mobile ? 'sidebar visible' : 'sidebar'}>
    <div className="brand">
      <div className="brand-symbol">M<span>✦</span></div>
      <div><b>MELIASTAGE</b><small>客户管理工作台</small></div>
    </div>
    <div className="workspace-label">WORKSPACE <span>企业版</span></div>
    <nav aria-label="CRM 功能导航">
      {groups.map(({ id, label, icon: Icon, entries }) => {
        const open = expanded === id;
        const active = currentGroup === id;
        const count = id === 'customers' ? customers : id === 'activities' ? pending : 0;
        return <div className="nav-group" key={id}>
          <button type="button" className={`nav-item nav-group-toggle${active ? ' active' : ''}`}
            aria-expanded={open} aria-controls={`crm-nav-${id}`}
            onClick={() => setExpanded(open ? undefined : id)}>
            <Icon size={18} />
            <span className="nav-group-label">{label}</span>
            {count > 0 && <em>{count}</em>}
            <ChevronDown size={14} className="nav-group-chevron" aria-hidden="true" />
          </button>
          <ul className="nav-children" id={`crm-nav-${id}`} hidden={!open}>
            {entries.map(entry => <li key={entry.label}>
              <button type="button" className="nav-child" aria-current={matches(entry, current) ? 'page' : undefined}
                onClick={() => onSelect(entry)}>{entry.label}</button>
            </li>)}
          </ul>
        </div>;
      })}
    </nav>
    <div className="sidebar-bottom">
      <div className="secure"><ShieldCheck size={15} /><span>企业客户资料 · 私密工作区</span></div>
      <div className="user">
        <span className="avatar">颜</span>
        <div><b>美利雅 · 管理员</b><small title={user}>{user}</small></div>
        <a href="/signout-with-chatgpt?return_to=%2F" title="退出登录"><LogOut size={15} /></a>
      </div>
    </div>
  </aside>;
}
