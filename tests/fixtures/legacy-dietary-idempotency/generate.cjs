const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const legacy = process.argv[2] && path.resolve(process.argv[2]);
if (!legacy) throw new Error('Pass the legacy SeeFood checkout path.');
const revision = require('node:child_process').execFileSync('git', ['-C', legacy, 'rev-parse', 'HEAD'], {encoding:'utf8'}).trim();
assert.equal(revision, '0bfeca12850d9f8337aae91a9a926cceec38201b');
const output = __dirname;
(async () => {
  const { createService } = await import(pathToFileURL(path.join(legacy, 'server/service.ts')).href);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'seefood-legacy-'));
  const now = Date.UTC(2026, 9, 6, 0, 0, 0);
  const service = createService({dataDir:directory, enableDevSession:true, devIdentities:['demo-owner-a'], now:() => now});
  let closed = false;
  try {
    await new Promise(resolve => service.server.listen(0,'127.0.0.1',resolve));
    const url = `http://127.0.0.1:${service.server.address().port}`;
    let token;
    async function call(method, route, body, key) {
      const response = await fetch(url + route,{method,headers:{'Content-Type':'application/json', ...(token?{Authorization:`Bearer ${token}`} : {}), ...(key?{'Idempotency-Key':key}:{})},body:body===undefined?undefined:JSON.stringify(body)});
      return {status:response.status, body:await response.json()};
    }
    token=(await call('POST','/v1/dev/session',{identity:'demo-owner-a'})).body.accessToken;
    const contextId='legacy-dietary-context', recordId='legacy-dietary-record';
    const cards=['z-card','a-card'].map(id=>({id,recordId,sourceImageIds:['saved-image'],nameZh:'示例炒饭',localizedName:'Example fried rice',contentLanguage:'en',price:{rawText:null,amount:null,currency:null,unit:null,variant:null},summary:'Saved local example',details:[],uncertainty:['Ingredients need confirmation.']}));
    const preferences={version:2,allergies:['egg'],restrictions:[],tastes:[],notes:''};
    const snapshot={purpose:'record',localScopeId:recordId,recordId,snapshotVersion:1,snapshot:{images:[{imageId:'saved-image',kind:'menu',order:0,assetId:null}],cards,messages:[],preferences}};
    const saved=await call('PUT','/v1/contexts/'+contextId,snapshot); assert.equal(saved.status,200,JSON.stringify(saved));
    const request={contextId,kind:'dietary_review',target:{cardIds:cards.map(c=>c.id),preferencesVersion:2},input:{contextSnapshotVersion:1,cards,preferences}};
    const key='legacy-unsorted-review'; const accepted=await call('POST','/v1/jobs',request,key); assert.equal(accepted.status,202,JSON.stringify(accepted));
    let job;
    for(let i=0;i<100;i++){job=(await call('GET','/v1/jobs/'+accepted.body.jobId)).body;if(job.state==='succeeded') break; await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal(job.state,'succeeded');
    assert.equal((await call('POST','/v1/jobs',request,key)).status,202);
    await service.close(); closed=true;
    fs.writeFileSync(path.join(output,'metadata.sqlite.gz'),zlib.gzipSync(fs.readFileSync(path.join(directory,'metadata.sqlite'))));
    fs.writeFileSync(path.join(output,'request.json'),JSON.stringify({sourceRevision:revision,now,key,request,jobId:job.jobId},null,2)+'\n');
  } finally { if(!closed)await service.close(); fs.rmSync(directory,{recursive:true,force:true}); }
})().catch(error=>{console.error(error);process.exitCode=1});
