import {requireChatGPTUser} from './chatgpt-auth';
import CRM from './workspace';
export const dynamic='force-dynamic';
export default async function Page(){const user=await requireChatGPTUser('/');return <CRM user={user.displayName}/>;}
