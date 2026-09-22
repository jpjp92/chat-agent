/** Aggregate captured paired measurements, preserving failures and incomplete pairs. No network. */
import { readFileSync,writeFileSync } from 'node:fs';
const path=process.argv[2]??'/tmp/gemini-3-7-vs-3-8.json';
const report=JSON.parse(readFileSync(path,'utf8'));
const median=(values:number[])=>{const v=[...values].sort((a,b)=>a-b);return !v.length?null:v.length%2?v[(v.length-1)/2]:(v[v.length/2-1]+v[v.length/2])/2;};
const sum=(rows:any[],key:string)=>rows.reduce((a:number,r:any)=>a+(r.usage?.[key]??0),0);
const byModel=report.models.map((model:string)=>{
    const rows=report.results.filter((r:any)=>r.model===model);
    const good=rows.filter((r:any)=>r.status==='PASS');
    return {model,total:rows.length,pass:good.length,failed:rows.filter((r:any)=>r.status!=='PASS').map((r:any)=>({case:r.case,round:r.round,status:r.status,checks:r.checks})),
        successfulTotalMs:good.reduce((total:number,r:any)=>total+r.elapsedMs,0),
        successfulMeanMs:good.length?Math.round(good.reduce((total:number,r:any)=>total+r.elapsedMs,0)/good.length):null,
        successfulMedianMs:median(good.map((r:any)=>r.elapsedMs)),successfulMaxMs:good.length?Math.max(...good.map((r:any)=>r.elapsedMs)):null,
        successfulFirstTextMedianMs:median(good.map((r:any)=>r.firstTextMs).filter((v:any)=>v!==null)),
        usageReported:rows.filter((r:any)=>!!r.usage).length,inputTokens:sum(rows,'promptTokenCount'),outputTokens:sum(rows,'candidatesTokenCount'),
        thoughtTokens:sum(rows,'thoughtsTokenCount'),totalTokens:sum(rows,'totalTokenCount')};
});
const pairs=[];
for(const first of report.results.filter((r:any)=>r.model===report.models[0])){
    const second=report.results.find((r:any)=>r.round===first.round&&r.case===first.case&&r.model===report.models[1]);
    if(!second)continue;
    if(first.inputHash!==second.inputHash)throw new Error('Pair inputs differ');
    if(first.status==='PASS'&&second.status==='PASS')pairs.push({case:first.case,round:first.round,ratio:second.elapsedMs/first.elapsedMs,faster38:second.elapsedMs<first.elapsedMs});
}
const perCase=[...new Set(report.results.map((r:any)=>r.case))].map(id=>({case:id,models:report.models.map((model:string)=>{
    const rows=report.results.filter((r:any)=>r.case===id&&r.model===model);
    return {model,pass:rows.filter((r:any)=>r.status==='PASS').length,total:rows.length,
        medianMs:median(rows.filter((r:any)=>r.status==='PASS').map((r:any)=>r.elapsedMs))};
})}));
const summary={source:path,complete:report.complete,byModel,pairedSuccessful:pairs.length,
    faster38:pairs.filter(p=>p.faster38).length,medianPairedTimeRatio38over37:median(pairs.map(p=>p.ratio)),perCase,
    limitation:'Three repetitions per case at most; structural/value checks, not broad quality or statistically established superiority. Fixed canonical histories, explicit LOW; excludes router/tools/grounding/media/browser.'};
writeFileSync('/tmp/gemini-3-7-vs-3-8-summary.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
