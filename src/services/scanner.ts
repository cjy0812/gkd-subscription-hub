import type {Env,Project,DistFile,WorkflowInfo} from "../types";
import {gh,decode} from "./github";
export function parseRepo(input:string){let u:URL;try{u=new URL(input)}catch{throw Error("仓库 URL 无效")}if(u.hostname!=="github.com"||u.username||u.password)throw Error("仅支持 github.com 公开仓库");const a=u.pathname.split("/").filter(Boolean);if(a.length!==2)throw Error("请输入 https://github.com/owner/repo");return{owner:a[0],repo:a[1].replace(/\.git$/,"")}}
export function extractId(s:string){const m=s.match(/defineGkdSubscription\s*\(\s*\{[\s\S]*?\bid\s*:\s*(\d+)/);const n=Number(m?.[1]);if(!Number.isSafeInteger(n)||n<1)throw Error("无法提取有效订阅 ID");return n}
export async function digest(files:DistFile[]){const s=files.slice().sort((a,b)=>a.path.localeCompare(b.path)).map(f=>f.path+"\0"+f.sha+"\0"+f.size).join("\n");const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,"0")).join("")}
export async function scan(env:Env,owner:string,repo:string,branch?:string):Promise<Project>{
 const meta=await gh<any>(env,`/repos/${owner}/${repo}`);if(meta.private||meta.archived)throw Error("仅支持未归档公开仓库");const ref=branch||meta.default_branch;
 const sub=await gh<any>(env,`/repos/${owner}/${repo}/contents/src/subscription.ts?ref=${encodeURIComponent(ref)}`);const id=extractId(decode(sub));
 const tree=await gh<any>(env,`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`);if(tree.truncated)throw Error("Git Tree 被截断");
 const distFiles:DistFile[]=tree.tree.filter((x:any)=>x.type==="blob"&&x.path.startsWith("dist/")).map((x:any)=>({path:x.path.slice(5),sha:x.sha,size:x.size||0})).filter((x:DistFile)=>x.path&&!x.path.split("/").some(y=>y==="."||y===".."));if(!distFiles.length)throw Error("dist/ 不存在或为空");
 const ws=await gh<any>(env,`/repos/${owner}/${repo}/actions/workflows?per_page=100`);
 const workflows:WorkflowInfo[]=await Promise.all(ws.workflows.filter((w:any)=>w.state==="active").slice(0,8).map(async(w:any)=>{let yaml="";try{const f=await gh<any>(env,`/repos/${owner}/${repo}/contents/${w.path.split("/").map(encodeURIComponent).join("/")}`);yaml=decode(f)}catch{}const cron=[...yaml.matchAll(/^\s*-\s*cron:\s*['"]?([^'"\s]+(?:\s+[^'"\s]+){4})['"]?\s*$/gm)].map(x=>x[1]);return{id:w.id,name:w.name,path:w.path,cron,relevant:/dist|subscription|release|publish|deploy|build/i.test(w.name+" "+w.path+" "+yaml)}}));
 const now=new Date().toISOString();return{id,owner,repo,branch:ref,repoUrl:meta.html_url,distFiles,distHash:await digest(distFiles),workflows,registeredAt:now,lastCheckedAt:null,lastDistHash:null,lastDistChangedAt:null,lastRuns:[],prediction:{intervalHours:null,predictedAt:null,nextCheckAt:now,successfulRuns:0},lastError:null}
}
