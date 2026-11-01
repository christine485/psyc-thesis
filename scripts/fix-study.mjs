import fs from 'node:fs';
let text=fs.readFileSync('docs/app.js','utf8');
text=text.replace("const r=await fetch(API_BASE+route,", "const r=await fetch(API_BASE+route,").replace("body:JSON.stringify(body)});let value;","body:JSON.stringify(body)}).catch(()=>{throw Error('暫時無法連接研究服務。你的未提交答案仍在本頁，請稍後重試，勿重新整理。');});let value;");
fs.writeFileSync('docs/app.js',text);
let server=fs.readFileSync('lib/server.ts','utf8');server=server.replace("SELECT submitted FROM slots WHERE token_hash=? AND mode=?","SELECT submitted,payload FROM slots WHERE token_hash=? AND mode=?").replace("if(!r?.submitted)throw Error('分配名額已逾時，無法提交。');","if(!r?.submitted)throw Error('分配名額已逾時，無法提交。');valid=JSON.parse(r.payload).validQuestionnaire;");
fs.writeFileSync('lib/server.ts',server);
