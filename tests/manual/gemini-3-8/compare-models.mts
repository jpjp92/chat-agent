/** Paired streaming comparison. Identical canonical replay inputs, explicit LOW for both models.
 * Uses production prompt helpers and existing semantic/JSON assertions; does not execute router/graph.
 */
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { config as loadEnv } from 'dotenv';
import { GoogleGenAI, ThinkingLevel, type Content } from '@google/genai';
import { getSystemInstruction, getRendererSections, getIntentPolicy } from '../../../server/agent/prompt';
import { stripCitationLinksForHistory } from '../../../server/agent/history';
import { scenarios, assess, type Turn } from './scenarios.mjs';
const args=process.argv.slice(2);
const opt=(name:string,fallback:string)=>{
    const i=args.indexOf(name);if(i<0)return fallback;
    if(!args[i+1]||args[i+1].startsWith('--'))throw new Error(`${name} requires a value`);
    return args[i+1];
};
const rounds=Number(opt('--rounds','3'));
if(!Number.isInteger(rounds)||rounds<1||rounds>3)throw new Error('--rounds must be 1..3');
const out=opt('--out','/tmp/gemini-3-7-vs-3-8.json');
const live=args.includes('--live');
const models=['gemini-3.7-flash','gemini-3.8-flash'];
const chart=(values:number[])=>'```json:chart\n'+JSON.stringify({type:'bar',title:'항목 비교',data:{categories:['A','B','C'],series:[{name:'값',data:values}]}})+'\n```';
// Model-neutral synthetic history, not either model's sampled answer. Freeze for every paired replay.
const canonical:Record<string,string[]>={
    'memory-correction':['보관 코드 ALPHA_731, 담당자 민수를 기억했습니다.','보관 코드 ALPHA_731, 담당자 지수.'],
    'chart-edit-topic-switch':[chart([10,20,30]),chart([10,25,30])],
    'chemistry-followup':['에탄올의 분자 구조입니다.\n```json:smiles\n{"smiles":"CCO","name":"에탄올"}\n```'],
};
type Case={id:string;turn:Turn;contents:Content[];systemInstruction:string;inputHash:string};
const cases:Case[]=[];
for(const scenario of scenarios){
    for(const [index,turn]of scenario.turns.entries()){
        const contents:Content[]=[];
        for(let previous=0;previous<index;previous++){
            const reply=canonical[scenario.id]?.[previous];
            if(!reply)throw new Error('Missing canonical history');
            contents.push({role:'user',parts:[{text:scenario.turns[previous].q}]},
                {role:'model',parts:[{text:stripCitationLinksForHistory(reply)}]});
        }
        contents.push({role:'user',parts:[{text:turn.q}]});
        const intent=turn.intents[0];
        const systemInstruction=[getSystemInstruction('Korean'),getRendererSections(intent,'Korean'),getIntentPolicy(intent)].filter(Boolean).join('\n\n');
        const input=JSON.stringify({contents,systemInstruction});
        if(input.length>100000)throw new Error('Input too large');
        cases.push({id:`${scenario.id}/${index+1}`,turn,contents,systemInstruction,inputHash:createHash('sha256').update(input).digest('hex')});
    }
}
const maxCalls=cases.length*models.length*rounds;
if(maxCalls>72)throw new Error('Too many calls');
const report:any={startedAt:new Date().toISOString(),models,rounds,maxCalls,maxOutputTokens:4096,timeoutMs:45000,
    thinking:'LOW',scope:'Paired direct SDK streaming, production prompt sections, fixed canonical multi-turn replay; no router, tools, search, app graph, media or browser.',
    keySelection:'API_KEY_TIER1',billingTierVerified:false,results:[],complete:false};
console.log(JSON.stringify({live,rounds,cases:cases.length,maxCalls,out}));
if(!live)process.exit(0);
loadEnv({path:['.env.local','.env'],quiet:true});
if(!process.env.API_KEY_TIER1){console.error('API_KEY_TIER1 missing; no calls');process.exit(2);}
const ai=new GoogleGenAI({apiKey:process.env.API_KEY_TIER1,httpOptions:{timeout:45000}});
const save=()=>writeFileSync(out,JSON.stringify(report,null,2)+'\n');
save();
let stop=false;
for(let round=0;round<rounds&&!stop;round++){
    // Rotate case order across rounds, reverse model order per pair to reduce order confounding.
    const ordered=round%2===0?cases:[...cases].reverse();
    for(const [caseIndex,c]of ordered.entries()){
        const order=(round+caseIndex)%2===0?models:[...models].reverse();
        for(const model of order){
            const start=performance.now();let text='',firstTextMs:number|null=null;let usage:any=null;
            const reportedModels=new Set<string>();let finishReason:unknown=null;
            let row:any;
            try{
                const stream=await ai.models.generateContentStream({model,contents:c.contents,config:{
                    systemInstruction:c.systemInstruction,thinkingConfig:{thinkingLevel:ThinkingLevel.LOW},
                    maxOutputTokens:4096,abortSignal:AbortSignal.timeout(45000),
                }});
                for await(const chunk of stream){
                    if(chunk.modelVersion)reportedModels.add(chunk.modelVersion);
                    if(chunk.usageMetadata)usage=chunk.usageMetadata;
                    if(chunk.candidates?.[0]?.finishReason)finishReason=chunk.candidates[0].finishReason;
                    const delta=(chunk.candidates?.[0]?.content?.parts??[]).filter(p=>!p.thought).map(p=>p.text??'').join('');
                    if(delta&&firstTextMs===null)firstTextMs=performance.now()-start;
                    text+=delta;
                }
                const checks=assess(c.turn,c.turn.intents[0],text);
                delete checks.intent; // Intent is controlled, not classified in this comparison.
                checks.actualModel=reportedModels.has(model)&&reportedModels.size===1;
                checks.notTruncated=finishReason==='STOP';
                row={status:Object.values(checks).every(Boolean)?'PASS':'FAIL',checks,finishReason};
            }catch(e:any){
                const status=Number(e?.status??0);
                row={status:'ERROR',httpStatus:status,errorCategory:status===429?'quota':status===0?'transport-or-timeout':'provider'};
                stop=true; // Do not rotate keys or retry; preserve the failed/incomplete comparison.
            }
            row={round:round+1,case:c.id,model,inputHash:c.inputHash,intentFixed:c.turn.intents[0],
                ...row,firstTextMs:firstTextMs===null?null:Math.round(firstTextMs),elapsedMs:Math.round(performance.now()-start),
                reportedModels:[...reportedModels],usage,text};
            report.results.push(row);save();
            console.log(JSON.stringify({round:row.round,case:row.case,model,status:row.status,
                firstTextMs:row.firstTextMs,elapsedMs:row.elapsedMs,tokens:usage?.totalTokenCount??null}));
            if(stop)break;
        }
        if(stop)break;
    }
}
report.complete=report.results.length===maxCalls;report.finishedAt=new Date().toISOString();save();
if(!report.complete||report.results.some((r:any)=>r.status!=='PASS'))process.exitCode=1;
