/** Real production router/graph/stream dispatcher. Transport guard bounds calls and records models.
 * Candidate router mode ONLY changes the router request model/thinking, explicitly reported.
 * Graph mode does NOT register 3.8 or change its production thinking/capability policy.
 */
import { writeFileSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';
import { scenarios, routing, assess } from './scenarios.mjs';
const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
    const i = args.indexOf(name);
    if (i < 0) return fallback;
    if (!args[i+1] || args[i+1].startsWith('--')) throw new Error(`${name} needs a value`);
    return args[i+1];
};
const suite = option('--suite','graph');
const routerMode = option('--router','current');
if (!['graph','routing'].includes(suite) || !['current','candidate'].includes(routerMode)) throw new Error('Invalid suite/router');
if (suite === 'graph' && routerMode !== 'current') throw new Error('Candidate router is only available in routing suite');
const filter = option('--filter','');
const matches = (id: string) => !filter || filter.split(',').some(part => id.includes(part));
const chosenScenarios = scenarios.filter(s => matches(s.id));
const chosenRouting = routing.filter(s => matches(s.id));
const cases = suite === 'graph' ? chosenScenarios.flatMap(s => s.turns) : chosenRouting;
if (!cases.length) throw new Error('No matching cases');
const out = option('--out',`/tmp/gemini-3-8-${suite}-${routerMode}.json`);
const live = args.includes('--live');
const model = 'gemini-3.8-flash';
const maxCalls = suite === 'routing' ? 30 : 36;
const maxOutputTokens = 4096;
const report: any = { startedAt:new Date().toISOString(), suite, routerMode, selectedModel:model,
    live, cases:cases.length, maxCalls, maxOutputTokens, maxInputChars:150000, maxTotalInputChars:2000000,
    requests:[], results:[], complete:false,
    scope:'Production router/graph/dispatch, bypasses HTTP auth/model allowlist and browser rendering. Search and non-Gemini network blocked. Output capped by probe.',
    billingTierVerified:false };
const print = (x: unknown) => process.stdout.write(JSON.stringify(x)+'\n');
print({live,suite,routerMode,cases:cases.length,maxCalls,maxOutputTokens,out});
if (!live) process.exit(0);
loadEnv({path:['.env.local','.env'],quiet:true});
const key=process.env.API_KEY_TIER1;
if (!key) { print({error:'API_KEY_TIER1 missing; no requests'}); process.exit(2); }
for (const k of Object.keys(process.env)) if (/^API_KEY\d*$/.test(k)) delete process.env[k];
process.env.API_KEY=key;
// Imports below cannot leak keys or upstream error URLs through production logging.
let logFlags: string[] = [];
for (const name of ['log','warn','error','info','debug'] as const) console[name] = (...values: unknown[]) => {
    const text = values.map(v => typeof v === 'string' ? v : '').join(' ');
    for (const flag of ['fallback','폴백','downgrad','pinning','pinned']) if (text.toLowerCase().includes(flag)) logFlags.push(flag);
};
let turnLabel='', phase='', stopped='', callCount=0,totalInputChars=0;
let turnAbort = new AbortController();
const nativeFetch=globalThis.fetch;
const save=()=>writeFileSync(out,JSON.stringify(report,null,2)+'\n');
save();
globalThis.fetch=async (input,init) => {
    if (stopped) throw new Error('Probe stopped');
    const req = new Request(input,init);
    const url = new URL(req.url);
    const match = url.pathname.match(/\/models\/([^/:]+):(generateContent|streamGenerateContent)$/);
    if (url.hostname !== 'generativelanguage.googleapis.com' || !match) {
        stopped='blocked-external-network'; throw new Error(stopped);
    }
    const body=JSON.parse(await req.text());
    if ((body.tools ?? []).some((t:any)=>t.googleSearch || t.google_search || t.googleSearchRetrieval)) {
        stopped='blocked-search'; throw new Error(stopped);
    }
    let requestedModel=match[1];
    const originalModel=requestedModel;
    if (suite === 'routing' && routerMode === 'candidate') {
        requestedModel=model; url.pathname=url.pathname.replace(originalModel,model);
        body.generationConfig={...body.generationConfig,thinkingConfig:{thinkingLevel:'LOW'}};
    }
    body.generationConfig={...body.generationConfig,maxOutputTokens:Math.min(body.generationConfig?.maxOutputTokens ?? maxOutputTokens,maxOutputTokens)};
    const payload=JSON.stringify(body);
    if (callCount >= maxCalls || payload.length > 150000 || totalInputChars+payload.length>2000000) {
        stopped='budget-exceeded'; throw new Error(stopped);
    }
    callCount++;totalInputChars+=payload.length;
    const trace:any={turn:turnLabel,phase,originalModel,requestedModel,reportedModels:[],
        thinking:body.generationConfig?.thinkingConfig ?? null,inputChars:payload.length};
    report.requests.push(trace);
    const start=Date.now();
    try {
        const response=await nativeFetch(url,{method:req.method,headers:req.headers,body:payload,
            signal:AbortSignal.any([req.signal,turnAbort.signal,AbortSignal.timeout(45000)])});
        trace.httpStatus=response.status;trace.headersMs=Date.now()-start;
        if (!response.ok) { stopped=`http-${response.status}`; return response; }
        let tail='';const decoder=new TextDecoder();
        const stream=response.body?.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,controller){
            tail=(tail+decoder.decode(chunk,{stream:true}));
            for (const m of tail.matchAll(/"modelVersion"\s*:\s*"([^"]+)"/g)) if (!trace.reportedModels.includes(m[1])) trace.reportedModels.push(m[1]);
            tail=tail.slice(-2048); controller.enqueue(chunk);
        }}));
        return new Response(stream,{status:response.status,headers:response.headers});
    } catch {
        stopped='transport-or-timeout';throw new Error(stopped);
    }
};
const { routerNode }=await import('../../../server/agent/nodes/router');
const { compileAgentGraph }=await import('../../../server/agent/graph');
const { getSystemInstruction }=await import('../../../server/agent/prompt');
const { createStreamDispatch }=await import('../../../server/agent/stream-dispatch');
const { buildHistoryMessages,deriveLastTurnSearched }=await import('../../../server/agent/history');
const { HumanMessage }=await import('@langchain/core/messages');
const stateFor=(history:any[],q:string)=>({messages:[...buildHistoryMessages(history),new HumanMessage(q)],
    webContent:'',attachments:[],contextInfo:'',pillData:null,sessionId:'',model,timeZone:'Asia/Seoul',nextNode:'router',
    movieContext:'',activeCards:{},cardContexts:{},lastTurnSearched:deriveLastTurnSearched(history)});
async function run(label:string,fn:()=>Promise<any>) {
    turnLabel=label;stopped='';phase='router';logFlags=[];const start=Date.now();const offset=report.requests.length;
    turnAbort=new AbortController();const timer=setTimeout(()=>{stopped='turn-timeout';turnAbort.abort();},70000);
    let result:any;
    try {result=await fn();} catch {result={checks:{execution:false}};}
    finally {clearTimeout(timer);}
    const requests=report.requests.slice(offset);
    const generated=requests.filter((r:any)=>r.phase==='generator');
    const verified38=generated.length>0 && generated.every((r:any)=>r.requestedModel===model && r.reportedModels.includes(model));
    const invalid=Object.values(result.checks ?? {}).some(v=>v===false);
    const status=stopped ? 'BLOCKED' : invalid ? 'FAIL' : suite==='graph' && !verified38 ? 'OTHER_MODEL_OR_UNVERIFIED' : 'PASS';
    const row={id:label,status,reason:stopped || null,elapsedMs:Date.now()-start,...result,
        verified38:suite==='graph'?verified38:undefined,logFlags:[...new Set(logFlags)],requests:requests.length};
    report.results.push(row);save();print({id:label,status,reason:row.reason,checks:row.checks,intent:row.intent,elapsedMs:row.elapsedMs,
        models:requests.map((r:any)=>`${r.phase}:${r.requestedModel}`)});
    return row;
}
if (suite==='routing') {
    for (const c of chosenRouting) {
        const history=c.seed?[{role:'user',content:'이 자료를 보여줘'},{role:'model',content:c.seed}]:[];
        await run(c.id,async()=>{
            const state:any=stateFor(history,c.q);
            if(c.image) state.attachments=[{mimeType:'image/png',data:'synthetic-not-sent'}];
            const routed:any=await routerNode(state);
            const followup=!!(routed.cardFollowup||routed.paperFollowup||routed.weatherFollowup||routed.movieFollowup);
            const checks:any={intent:c.intents.includes(routed.intent)};
            if(c.noFollowup)checks.noFollowup=!followup;
            if(logFlags.includes('fallback')||logFlags.includes('폴백'))checks.noRouterFallback=false;
            return {checks,intent:routed.intent,needsSearch:routed.needsSearch,followup};
        });
        if(stopped)break;
    }
} else {
    for (const scenario of chosenScenarios) {
        const history:any[]=[];
        for (const [index,turn] of scenario.turns.entries()) {
            const row=await run(`${scenario.id}/${index+1}`,async()=>{
                const dispatch=createStreamDispatch(()=>{});
                const graph=compileAgentGraph(getSystemInstruction('Korean'),false,dispatch.trackingEvent,'Korean');
                const events=await graph.streamEvents(stateFor(history,turn.q) as any,{version:'v2',signal:turnAbort.signal,recursionLimit:8});
                let intent='',needsSearch:unknown;
                for await(const event of events) {
                    if(event.event==='on_chain_start' && ['router','generator','tools'].includes(event.name))phase=event.name;
                    if(event.event==='on_chain_end' && event.name==='router') {
                        const output=event.data?.output;intent=output?.intent ?? '';needsSearch=output?.needsSearch;
                    }
                    dispatch.handle(event);
                }
                const text=dispatch.state.fullAiResponse;
                const checks=assess(turn,intent,text);
                if(logFlags.includes('fallback')||logFlags.includes('폴백'))checks.noSilentFallback=false;
                return {checks,intent,needsSearch,text};
            });
            if(row.status==='BLOCKED')break;
            if(!row.text || row.status==='FAIL')break; // Do not hide a failed prerequisite with invented history.
            history.push({role:'user',content:turn.q},{role:'model',content:row.text});
        }
        if(stopped)break;
    }
}
report.complete=report.results.length===cases.length;save();
if(!report.complete || report.results.some((r:any)=>r.status!=='PASS'))process.exitCode=1;
