import config from './crm-config.json';

export type RecordData = {id:string;kind:string;version:number; [key:string]:any};
export const MAIL_PENDING_SHOP='邮箱 / 渠道待确认';
export const CANTON_FAIR='广交会';
export const SHOPS=['美利雅国际站','美欣国际站','1688内贸','展会 / 待分配',CANTON_FAIR,MAIL_PENDING_SHOP];
export function isCantonFair(customer?: RecordData) {
 return !!customer && (customer.shop===CANTON_FAIR || /广交会|canton fair|china import and export fair/i.test(`${customer.source||''} ${customer.sourceRef||''}`));
}
export const STAGES=['待核实','需求确认','选料推荐','寄样试样','报价议价','成交','复购','暂缓 / 关闭'];
export const OWNERS=config.owners;
export const KIND_NAMES:Record<string,string>={integration:'平台对接',customer:'客户',task:'任务',activity:'跟进',sample:'寄样',quote:'报价',order:'订单',script:'话术'};
export const scriptSeeds:RecordData[]=[
{id:'script-1',kind:'script',version:0,title:'首次询盘 · 确认选料方向',category:'需求确认',cn:'感谢您联系 MELIASTAGE。请问皮革用于包袋、鞋履还是其他产品？您偏好头层牛皮、二层牛皮还是超纤？方便提供参考图片、颜色、厚度和预计用量吗？我们据此推荐适合的材料。',en:'Thank you for contacting MELIASTAGE. Is the material for bags, footwear or another application? Do you prefer top-grain cowhide, split cowhide or microfiber? Please share a reference image, color, thickness and estimated quantity so we can recommend suitable options.'},
{id:'script-2',kind:'script',version:0,title:'寄样前 · 地址与样品确认',category:'寄样试样',cn:'我们可以先安排样品供您评估。请确认款号、颜色、厚度、样品数量，以及收件国家、邮编和联系电话。样品费用、运费与发出时间在核实后另行确认。',en:'We can arrange samples for your evaluation. Please confirm the article number, color, thickness, sample quantity, destination country, postal code and contact number. Sample cost, shipping cost and dispatch time will be confirmed after checking.'},
{id:'script-3',kind:'script',version:0,title:'报价说明 · 保留有效边界',category:'报价议价',cn:'报价将基于您确认的款号、颜色、厚度及数量（平方英尺）。请同时告知目的地和贸易条款；库存、MOQ、交期、价格及运费均以本次书面确认为准。',en:'Our quotation will be based on the confirmed article, color, thickness and quantity in square feet. Please also advise the destination and trade terms. Stock, MOQ, lead time, price and freight are subject to our written confirmation for this quotation.'},
{id:'script-4',kind:'script',version:0,title:'样品到达 · 收集试样反馈',category:'反馈跟进',cn:'请问样品是否已收到？期待了解您对颜色、手感、厚度及加工适配性的反馈。如需调整，请告诉我们具体要求，我们会与生产合作方核实可行方案。',en:'Have you received the samples? We would appreciate your feedback on color, handfeel, thickness and processing suitability. If adjustments are needed, please share the details and we will check feasible options with our production partners.'},
{id:'script-5',kind:'script',version:0,title:'广交会后 · 建立识别与下一步',category:'展会跟进',cn:'您好，我们是广交会上与您交流过的 MELIASTAGE 美利雅皮革团队。想继续了解您当时关注的材料需求。方便确认应用产品和意向款号吗？我们可以整理相应选料信息供您参考。',en:'Hello, this is the MELIASTAGE leather team you met at the Canton Fair. We would like to follow up on the materials you were interested in. Could you confirm the application and article numbers? We can prepare relevant material options for your review.'}
];
