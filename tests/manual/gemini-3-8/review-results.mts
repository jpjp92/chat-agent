/** Re-evaluate captured synthetic outputs with current fixture assertions, without API calls.
 * Retains original status/source. Later inputs supersede earlier repeated cases explicitly.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { assess, scenarios, routing } from './scenarios.mjs';
const paths=process.argv.slice(2);
if(!paths.length) throw new Error('Pass captured graph/routing JSON paths in chronological order');
const rows=new Map<string,any>();
for(const path of paths) {
    const report=JSON.parse(readFileSync(path,'utf8'));
    for(const row of report.results) {
        const id=row.id==='sports' && report.suite==='routing'?'sports-history':row.id;
        let checks:Record<string,boolean>;
        if(report.suite==='graph') {
            const [scenario,index]=id.split('/');
            const turn=scenarios.find(s=>s.id===scenario)?.turns[Number(index)-1];
            if(!turn || typeof row.text!=='string') continue;
            checks=assess(turn,row.intent,row.text);
            if(row.checks?.noSilentFallback===false)checks.noSilentFallback=false;
            checks.verified38=row.verified38===true;
        } else {
            const c=routing.find(c=>c.id===id);
            if(!c)continue;
            checks={intent:c.intents.includes(row.intent)};
            if(c.noFollowup)checks.noFollowup=!row.followup;
            if(row.checks?.noRouterFallback===false)checks.noRouterFallback=false;
        }
        rows.set(`${report.suite}/${id}`,{suite:report.suite,id,source:path,originalStatus:row.status,
            intent:row.intent,elapsedMs:row.elapsedMs,checks,
            status:row.reason?'BLOCKED':Object.values(checks).every(Boolean)?'PASS':'FAIL'});
    }
}
const result={reviewedAt:new Date().toISOString(),note:'Offline reassessment, not new model executions. sports renamed to sports-history to reflect existing year-query policy. Later captured cases supersede earlier duplicates.',
    rows:[...rows.values()]};
writeFileSync('/tmp/gemini-3-8-reviewed.json',JSON.stringify(result,null,2)+'\n');
for(const suite of ['graph','routing']) {
    const list=result.rows.filter(r=>r.suite===suite);
    console.log(JSON.stringify({suite,assessed:list.length,pass:list.filter(r=>r.status==='PASS').length,fail:list.filter(r=>r.status!=='PASS')}));
}
if(result.rows.some(r=>r.status!=='PASS'))process.exitCode=1;
