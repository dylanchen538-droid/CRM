import type { RecordData } from '../model';
import customerRows from './customers.json';
import sessionRows from './sessions.json';
import messageRows from './messages.json';

type Session = {
  id: string;
  customerId: string;
  buyer: string;
  shop: string;
  owner: string;
  country: string;
  first: string;
  last: string;
  count: number;
  sourceRef: string;
};

type Message = { sender: string; time: string; text: string };

export const customers: RecordData[] = customerRows;
export const sessions: Session[] = sessionRows;
export const messages: Record<string, Message[]> = messageRows;
