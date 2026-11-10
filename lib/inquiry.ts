import { z } from 'zod';
import config from './crm-config.json';

export const INQUIRY_SHOPS = ['美利雅国际站', '美欣国际站'] as const;
export const INQUIRY_ACCOUNTS = config.inquiryAccounts;
const short = z.string().max(512);
const required = short.min(1);
export const inquirySchema = z.object({
  shop: z.enum(INQUIRY_SHOPS),
  createdAt: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
  receiverId: required,
  account: required,
  buyerId: short,
  companyId: short,
  subject: required,
  body: z.string().max(20000),
  name: short,
  company: short,
  country: z.string().max(24),
  email: short,
  address: short,
  phone: short,
  postalCode: short,
  status: short,
  deleteStatus: short,
  sourceFile: required,
  sourceRow: z.number().int().min(2),
}).refine(row => row.account === INQUIRY_ACCOUNTS[row.shop], { message: '询盘所属账号与店铺不符' });

export type Inquiry = z.infer<typeof inquirySchema>;
export type InquirySummary = { shop: string; count: number; first: string; last: string };
export type InquiryListItem = Pick<Inquiry, 'shop' | 'createdAt' | 'buyerId' | 'name' | 'company' | 'country' | 'subject'> & {id: string};

export function inquiryKey(row: Inquiry) {
  return JSON.stringify([row.shop, row.createdAt, row.receiverId, row.buyerId || row.companyId, row.subject]);
}

const channels: Record<string, string> = {
  'Inquiry from TM': '即时沟通',
  'Inquiry from Product Details Page': '商品详情页',
  'Inquiry from Store Homepage': '店铺首页',
  'Inquiry from Search List': '搜索列表',
  'Inquiry from AI Mode': 'AI Mode',
  'Inquiry from WhatsApp': 'WhatsApp',
};
export const inquiryChannel = (subject: string) => channels[subject] || subject;
