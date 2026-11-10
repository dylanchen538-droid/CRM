import { z } from 'zod';
import config from './crm-config.json';
import { CANTON_FAIR, isCantonFair, MAIL_PENDING_SHOP, type RecordData } from './model';

export const MAIL_ACCOUNT = config.mailbox.trim().toLowerCase();
const mailboxDomain = MAIL_ACCOUNT.slice(MAIL_ACCOUNT.lastIndexOf('@'));
export const MAIL_FORMAT = 'meliastage-mail-v1';
const ALIBABA = new Set(['美利雅国际站', '美欣国际站']);
// Accept RFC 5322 dot-atom mailbox names, including addresses with a slash.
const dotAtomMailbox = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]+$/;
const mailAddress = z.string().trim().toLowerCase().max(254).regex(dotAtomMailbox).refine(email => !email.endsWith(mailboxDomain));
const emailSchema = mailAddress.refine(email => /\.[a-z]{2,}$/.test(email));
// Python's export limits count Unicode characters, including emoji, once.
const mailText = (max: number) => z.string().refine(value => value.length <= max || Array.from(value).length <= max);
export const partySchema = z.object({ email: mailAddress, name: mailText(160) });
export const partiesSchema = z.array(partySchema).min(1).max(25);
export const mailSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  direction: z.enum(['received', 'sent']),
  contacts: partiesSchema,
  at: z.string().datetime().or(z.literal('')),
  folder: mailText(240), uid: z.string().regex(/^\d{1,20}$/),
  subject: mailText(500), body: mailText(18000),
  truncated: z.boolean(), messageId: mailText(500),
});
export const partyKey = (contacts: { email: string }[]) => [...new Set(contacts.map(c => c.email))].sort().join(', ');
export type Mail = z.infer<typeof mailSchema>;
export type MailInquiry = { email: string; shop: string; buyerId: string; name?: string; company?: string };
export type Match = { party: string; customerId: string; channel: string; evidence: string; disposition: 'existing' | 'new' | 'review'; shop: string; name: string; company: string };

function add<T>(index: Map<string, T[]>, key: string, value: T) {
  if (!key) return;
  const rows = index.get(key);
  if (rows) rows.push(value);
  else index.set(key, [value]);
}

function emailKey(value: unknown) {
  const result = emailSchema.safeParse(value);
  return result.success ? result.data : '';
}

function customerChannel(customer: RecordData) {
  if (ALIBABA.has(customer.shop) || customer.shop === '1688内贸') return customer.shop as string;
  if (isCantonFair(customer)) return CANTON_FAIR;
  if (customer.shop === '展会 / 待分配' || /展会/.test(customer.source || '')) return '展会';
  return '';
}

export function mailMatcher(customers: RecordData[], inquiries: MailInquiry[]) {
  const byEmail = new Map<string, RecordData[]>();
  const byBuyer = new Map<string, RecordData[]>();
  const byInquiryEmail = new Map<string, MailInquiry[]>();
  for (const customer of customers) {
    const emails = String(customer.email || '').split(/[;,，；\s]+/).map(emailKey);
    for (const key of new Set([...emails, emailKey(customer.loginId)])) add(byEmail, key, customer);
    if (ALIBABA.has(customer.shop) && customer.buyerId) add(byBuyer, `${customer.shop}:${customer.buyerId.toLowerCase()}`, customer);
  }
  for (const inquiry of inquiries) if (ALIBABA.has(inquiry.shop)) add(byInquiryEmail, emailKey(inquiry.email), inquiry);

  return (contacts: z.infer<typeof partiesSchema>): Match => {
    const party = partyKey(contacts);
    const pending: Match = { party, customerId: '', channel: '渠道待确认', evidence: '暂无匹配的渠道证据', disposition: 'new', shop: MAIL_PENDING_SHOP, name: contacts[0].name || party, company: '' };
    const review = (evidence: string): Match => ({ ...pending, disposition: 'review', evidence });
    if (contacts.some(contact => !emailKey(contact.email))) return review('原邮件地址格式异常，需核对归属');
    if (party.includes(', ')) return review('邮件有多个外部收件人，需核对归属');

    const inquiryRows = byInquiryEmail.get(party) ?? [];
    const candidates = new Map((byEmail.get(party) ?? []).map(row => [row.id, row]));
    for (const row of inquiryRows) {
      if (!row.buyerId) continue;
      for (const customer of byBuyer.get(`${row.shop}:${row.buyerId.toLowerCase()}`) ?? []) candidates.set(customer.id, customer);
    }
    if (candidates.size > 1) {
      const options = [...new Set([...candidates.values()].map(customerChannel).filter(Boolean))];
      return review(`同一邮箱对应多个客户档案${options.length ? `（${options.join('、')}）` : ''}`);
    }
    const customer = candidates.values().next().value;
    if (customer?.archived) return review('邮箱对应的客户档案已归档');

    const channels = new Set(inquiryRows.map(row => row.shop));
    const customerSource = customer && customerChannel(customer);
    if (customerSource) channels.add(customerSource);
    if (channels.size > 1) return review(`有多个来源证据（${[...channels].join('、')}）`);
    const channel = [...channels][0] || pending.channel;
    const inquiry = inquiryRows[0];
    const evidence = inquiry ? '国际站询盘邮箱一致' : customer ? 'CRM 客户邮箱一致' : pending.evidence;
    if (customer) return { ...pending, customerId: customer.id, disposition: 'existing', channel, evidence, shop: customer.shop, name: customer.contact || customer.company || pending.name, company: customer.company || '' };
    if (inquiry) return { ...pending, channel, evidence, shop: inquiry.shop, name: inquiry.name || pending.name, company: inquiry.company || '' };
    return pending;
  };
}
