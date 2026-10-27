import type { AgentAction } from './agentActions';
type Turn={role:'user'|'assistant';content:string;at?:string};
/** `display` is what the AI page shows; a reply's drafts and events ride with it. */
export type DashboardChatMemory={userId:string;id:string;createdAt:string;history:Turn[];display:(Turn & {actions?:AgentAction[]})[];ui:{role:string;text:string}[]};
let current:DashboardChatMemory|undefined;
export function dashboardChatFor(userId:string):DashboardChatMemory{
 if(current?.userId!==userId)current={userId,id:crypto.randomUUID(),createdAt:new Date().toISOString(),history:[],display:[],ui:[]};
 return current;
}
