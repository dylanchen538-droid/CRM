import { SHOPS, type RecordData } from './model';

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      row.push(value);
      value = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(value);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }
  if (quoted) throw new Error('CSV 引号不完整，请重新导出表格');
  row.push(value);
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

const columns = {
  company: ['公司名称', '公司'],
  contact: ['联系人'],
  phone: ['号码', '电话'],
  email: ['邮箱'],
  country: ['国家'],
  owner: ['业务员'],
  source: ['来源'],
  material: ['材料需求'],
  type: ['公司类型'],
  products: ['主营产品'],
  texture: ['版纹需求'],
  style: ['风格'],
  research: ['背调'],
  other: ['其它备注'],
  address: ['公司地址'],
  website: ['网站'],
  brand: ['品牌'],
  channel: ['沟通方式'],
  notes: ['备注'],
  sourceRef: ['来源文件'],
};

export function prepareCustomerCsv(
  text: string, fileName: string, shop: string, current: RecordData[], date: string,
) {
  const [headers = [], ...rows] = parseCsv(text.replace(/^\uFEFF/, ''));
  if (rows.length > 1000) throw new Error('单次最多导入 1000 条，请拆分文件');
  const names = headers.map(x => x.trim());
  const get = (row: string[], labels: string[]) => {
    const index = names.findIndex(name => labels.includes(name));
    return (row[index] || '').trim();
  };
  const byId = new Map(current.map(record => [record.id, record]));
  const seen = new Set<string>();
  const result: RecordData[] = [];

  for (const [i, row] of rows.entries()) {
    const fail = (message: string): never => {
      throw new Error(`CSV 第 ${i + 2} 条记录：${message}`);
    };
    const id = get(row, ['档案ID']);
    const existing = id ? byId.get(id) : undefined;
    if (id && seen.has(id)) fail('档案 ID 重复');
    if (id) seen.add(id);
    if (existing && (existing.kind !== 'customer' || existing.archived)) fail('该客户档案不可更新');
    if (id && !existing && !/^csv-[a-f0-9]{24}$/.test(id)) fail('找不到该客户档案');

    const values = Object.fromEntries(
      Object.entries(columns).map(([key, labels]) => [key, get(row, labels)] as const).filter(([, value]) => value),
    );
    if (Object.values(values).some(value => value.length > 20000)) fail('文本超过长度限制');
    const requestedTrade = get(row, ['贸易类型']);
    if (requestedTrade && !['内贸', '外贸', '待核实'].includes(requestedTrade)) fail('贸易类型无效');

    if (existing) {
      const changes = { ...values, ...(requestedTrade ? { trade: requestedTrade } : {}) };
      if (Object.entries(changes).every(([key, value]) => existing[key] === value)) continue;
      const version = get(row, ['档案版本']);
      if (version !== String(existing.version)) fail('档案版本已变化，请先刷新并核对');
      result.push({ ...existing, ...changes });
      continue;
    }
    if (!values.company && !values.contact) continue;

    const requestedShop = get(row, ['所属店铺']);
    const targetShop = SHOPS.includes(requestedShop) ? requestedShop : shop;
    if (!SHOPS.includes(targetShop)) fail('请选择所属业务，或填写有效的所属店铺');
    result.push({
      id: id || crypto.randomUUID(), kind: 'customer', version: 0,
      company: '', contact: '', phone: '', email: '', country: '', material: '',
      shop: targetShop, owner: '待分配', source: targetShop === '1688内贸' ? '1688' : 'CSV导入',
      trade: requestedTrade || (targetShop === '展会 / 待分配' ? '待核实' : targetShop === '1688内贸' ? '内贸' : '外贸'),
      stage: '待核实', grade: '未分级', verification: '待核实',
      sourceRef: fileName, createdAt: date,
      ...values,
    });
  }
  return result;
}
