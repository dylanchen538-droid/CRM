import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
export const records = sqliteTable('records', {id:text('id').primaryKey(),kind:text('kind').notNull(),data:text('data').notNull(),version:integer('version').notNull(),updatedAt:text('updated_at').notNull()});
export const audit = sqliteTable('audit', {id:integer('id').primaryKey({autoIncrement:true}),recordId:text('record_id').notNull(),action:text('action').notNull(),actor:text('actor').notNull(),at:text('at').notNull(),detail:text('detail').notNull()});
export const alibabaConnections = sqliteTable('alibaba_connections', {
 slot:text('slot').primaryKey(),appKey:text('app_key').notNull(),secret:text('secret').notNull(),expectedAccount:text('expected_account').notNull().default(''),version:integer('version').notNull().default(1),tokens:text('tokens'),pending:text('pending'),identity:text('identity'),expiresAt:integer('expires_at'),refreshUntil:integer('refresh_until'),diagnosis:text('diagnosis'),lockUntil:integer('lock_until').notNull().default(0),updatedAt:text('updated_at').notNull()
});
export const alibabaStates = sqliteTable('alibaba_states',{hash:text('hash').primaryKey(),slot:text('slot').notNull(),actor:text('actor').notNull(),configVersion:integer('config_version').notNull(),expiresAt:integer('expires_at').notNull()});
export const alibabaPreviews = sqliteTable('alibaba_previews',{id:text('id').primaryKey(),slot:text('slot').notNull(),actor:text('actor').notNull(),configVersion:integer('config_version').notNull(),accountId:text('account_id').notNull(),data:text('data').notNull(),expiresAt:integer('expires_at').notNull()});
export const inquiries = sqliteTable('inquiries', {
  id: text('id').primaryKey(),
  shop: text('shop').notNull(),
  createdAt: text('created_at').notNull(),
  data: text('data').notNull(),
}, table => [index('inquiries_shop_date').on(table.shop, table.createdAt)]);
export const mailMessages = sqliteTable('mail_messages', {
  id: text('id').primaryKey(),
  party: text('party').notNull(),
  customerId: text('customer_id'),
  label: text('label').notNull(),
  channel: text('channel').notNull(),
  evidence: text('evidence').notNull(),
  happenedAt: text('happened_at').notNull(),
  data: text('data').notNull(),
}, table => [
  index('mail_party_time').on(table.party, table.happenedAt),
  index('mail_customer_time').on(table.customerId, table.happenedAt),
]);
