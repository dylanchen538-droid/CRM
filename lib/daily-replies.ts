export type ReplyEvidence = {
  time: string; direction: 'buyer' | 'seller' | 'unknown'; text: string;
  source: string; thread: string; inquiryId?: string;
};
export type ReplySuggestion = {
  category: string; status: string; next: string; zh: string; en: string;
  evidence: ReplyEvidence;
};

const responses = [
  {
    pattern: /质量问题|色差|掉色|投诉|不合格|\b(?:defect|defective|complaint|color mismatch|colour mismatch|color bleeding|damaged)\b/i,
    category: '质量反馈', next: '核对款号、批次、问题照片和受影响数量。',
    zh: '谢谢您反馈。请发一下款号、批次、问题照片和受影响数量。我们核对样品与批次后，会回复检查结果和处理建议。',
    en: 'Thank you for flagging this. Could you share the article number, batch number, photos, and affected quantity? We will check the sample and batch and follow up with our findings and proposed next steps.',
  },
  {
    pattern: /付款|订单号|已下单|发票|合同|采购单|\b(?:purchase order|proforma invoice|order confirmation|order number|payment|deposit|balance payment|invoice|PO)\b/i,
    category: '订单或付款', next: '核对订单号、当前确认项和所需文件。按实核实付款及订单状态。',
    zh: '收到。请发一下订单号或相关文件，并告诉我您目前需要确认哪一项。我会核对款号、数量、交期及付款记录后逐项回复。',
    en: 'Thanks for the update. Could you share the order number or relevant document and let me know what you need confirmed? I will check the article, quantity, timing, and payment records before getting back to you.',
  },
  {
    pattern: /样品|寄样|色卡|\b(?:samples?|swatches?|sample cards?|échantillons?|muestras?|campioni|muster)\b/i,
    category: '寄样与试样', next: '确认款号、颜色、厚度、样品数量和目的地。',
    zh: '您好，可以先核对样品方案。请告诉我您要测试的款号、颜色、厚度和样品数量，并发一下收件国家及邮编。我会确认可寄样品、样品费用和运费。',
    en: 'Happy to check sample options. Could you confirm the article, color, thickness, and sample quantity, along with the destination country and postcode? I will verify sample availability, cost, and shipping.',
  },
  {
    pattern: /报价|价格|多少钱|起订量|最低订购|\b(?:prices?|quote|quotation|pricing|MOQ|minimum order|cost per|precios?|prix|prezzo)\b/i,
    category: '报价与起订量', next: '核对款号、颜色、厚度、预计用量、计价单位和目的地。',
    zh: '您好，请确认所需款号、颜色、厚度、预计用量和目的地，数量请注明计价单位。我核对后给您对应的起订量、报价和交期。',
    en: 'Could you confirm the article, color, thickness, expected quantity with its unit, and destination? I will check the applicable MOQ, quotation, and lead time for those specifications.',
  },
  {
    pattern: /交期|发货|物流|库存|运输|\b(?:lead time|delivery|shipping|shipment|tracking|stock|available now|freight)\b/i,
    category: '库存与交付', next: '核对款号、用量、目的地和希望到货日期，再确认库存与交期。',
    zh: '您好，请确认款号、颜色、所需数量、收货地点和希望到货日期。我会核对库存、生产及运输安排后回复。',
    en: 'Could you confirm the article, color, quantity, delivery destination, and required arrival date? I will check stock, production, and shipping options and get back to you.',
  },
  {
    pattern: /牛皮|二层|超纤|厚度|纹理|变色|\b(?:leather|cowhide|microfiber|full.grain|pull.up|thickness|texture|suede|buffalo|cuero|cuir|pelle)\b/i,
    category: '选料与规格', next: '确认用途、皮种、表面效果、颜色、厚度和预计用量。',
    zh: '您好，收到您的皮革需求。请确认用于鞋、箱包还是其他产品，以及期望的皮种、颜色、表面效果和预计用量。有参考图或色卡的话，发给我会更方便核对合适的材料。',
    en: 'Thanks for sharing your leather requirements. Could you confirm the end use, leather type, color, finish, and estimated quantity? A reference photo or color swatch would help us check suitable options.',
  },
];
const general = {
  category: '需求确认', next: '请业务员先核对客户原话，再确认用途、款号和下一步。',
  zh: '您好，感谢您的来信。请问您主要想了解哪款材料，以及用于什么产品？如果方便，请发一下参考图片和预计数量，我好进一步核对。',
  en: 'Thank you for reaching out. Which material are you interested in, and what is the intended end product? If available, please share a reference photo and estimated quantity so I can check the details.',
};

export function suggestReply(events: ReplyEvidence[]): ReplySuggestion {
  const ordered = [...events].sort((a, b) => a.time.localeCompare(b.time));
  const incoming = ordered.filter(event => event.direction === 'buyer' && /\p{L}/u.test(event.text));
  const buyer = incoming.at(-1);
  if (!buyer) {
    const evidence = ordered.at(-1)!;
    return {
      category: '核对上下文', status: '待确认发言方或客户需求', zh: '', en: '',
      next: '打开当天原文核对发言方和客户是否已提出具体需求，再决定是否回复。', evidence,
    };
  }
  const text = incoming.slice(-4).map(row => row.text).join('\n');
  const entry = responses.find(rule => rule.pattern.test(text)) ?? general;
  const answered = ordered.some(row => row.direction === 'seller' && row.thread === buyer.thread && row.time > buyer.time);
  const thickness = text.match(/\b(\d{1,2}(?:[.,]\d+)?)\s*(?:mm\b|毫米)/i)?.[1];
  const spec = thickness && entry.category === '选料与规格' ? thickness.replace(',', '.') : '';
  return {
    category: entry.category,
    status: answered ? '会话已有卖家回复' : buyer.inquiryId ? '核对是否已回复' : '检查后回复',
    next: answered ? '先看卖家已经答复的内容，再决定是否补充。' : entry.next,
    zh: entry.zh + (spec ? ` 我看到您提到 ${spec} mm，也请确认这个厚度是否必须精确。` : ''),
    en: entry.en + (spec ? ` I noted the ${spec} mm thickness. Could you confirm whether it must be exact?` : ''),
    evidence: buyer,
  };
}
