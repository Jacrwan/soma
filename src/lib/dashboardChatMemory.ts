type Turn={role:'user'|'assistant';content:string};
export type DashboardChatMemory={userId:string;id:string;createdAt:string;history:Turn[];display:Turn[];ui:{role:string;text:string}[]};
let current:DashboardChatMemory|undefined;
export function dashboardChatFor(userId:string):DashboardChatMemory{
 if(current?.userId!==userId)current={userId,id:crypto.randomUUID(),createdAt:new Date().toISOString(),history:[],display:[],ui:[]};
 return current;
}
