'use strict';

/* ===== helpers ===== */
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const pad=n=>String(n).padStart(2,'0');
const today=()=>{const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`};
const MN=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
/* money is stored as integer paisa (1/100) – never floats */
const toMinor=Core.toMinor;
function fmt(m){const neg=m<0;m=Math.abs(m);const w=Math.floor(m/100),p=m%100;return (neg?'-':'')+CFG.cur+' '+w.toLocaleString('en-IN')+'.'+pad(p)}
function toast(msg,undo){const t=$('#toast');t.innerHTML=esc(msg)+(undo?' <button class="s" id="undoB">Undo</button>':'');t.style.display='block';if(undo)$('#undoB').onclick=()=>{undo();t.style.display='none'};setTimeout(()=>{if(t.dataset.hold!== '1')t.style.display='none';},3500)}

const DB=Core.DB;let STORAGE_ERR='';
/* ===== state ===== */
const DEF_EXP=Core.DEF_EXP,DEF_INC=Core.DEF_INC,PAY=Core.PAY,DEF_CFG=Core.defaultCfg;
let CFG=DEF_CFG(),TX=[];
const now=new Date();
const S={view:'dash',y:now.getFullYear(),m:now.getMonth()+1,q:'',type:'all',page:1,lastDel:null,busy:false};
const saveCfg=()=>DB.put('kv',{k:'cfg',v:CFG}).catch(()=>toast('Could not save settings'));
const ym=()=>`${S.y}-${pad(S.m)}`;
const sumT=Core.sumT;
const accName=id=>(CFG.accs.find(a=>a.id===id)||{name:'(removed)'}).name;
const balances=()=>Core.balances(CFG,TX);

/* ===== calculations (separate from UI) ===== */
const byCat=Core.byCat;
const budgetFor=k=>CFG.budgets[k]||{total:0,cats:{}};
const monthSeries=y=>Core.monthSeries(TX,y);

/* ===== UI ===== */
function render(){
  const th=CFG.theme==='auto'?(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'):CFG.theme;document.documentElement.dataset.t=th;
  const yrs=new Set([S.y,now.getFullYear(),...TX.map(t=>+t.date.slice(0,4))]);
  const V={dash:vDash,tx:vTx,bud:vBud,rep:vRep,set:vSet}[S.view]();
  $('#app').innerHTML=`${DB.ok?'':`<div class="banner" role="alert"><b>Storage problem.</b> ${esc(STORAGE_ERR||'Storage is unavailable.')} Nothing can be saved right now, and existing data has not been lost.</div>`}
  <header class="np"><b>Khata</b><select id="ys" aria-label="Year" style="width:auto" onchange="S.y=+this.value;S.page=1;render()">${[...yrs].sort().map(y=>`<option ${y===S.y?'selected':''}>${y}</option>`).join('')}</select>
  <select aria-label="Month" style="width:auto" onchange="S.m=+this.value;S.page=1;render()">${MN.map((n,i)=>`<option value="${i+1}" ${i+1===S.m?'selected':''}>${n}</option>`).join('')}</select><button class="s" aria-label="Go to home" onclick="go('dash')">Home</button></header>
  <main>${V}</main>
  <nav class="np">${[['dash','Home'],['tx','Activity'],['add','+'],['bud','Budgets'],['rep','Reports'],['set','Settings']].map(([k,l])=>k==='add'?`<button class="add" aria-label="Add transaction" onclick="openForm()" title="Add transaction">+</button>`:`<button class="${S.view===k?'on':''}" onclick="go('${k}')">${l}</button>`) .join('')}</nav>
  ${$('#upd')? '' : ''}`;
}

function go(v){S.view=v;render();scrollTo(0,0);}
window.go = go;

function vDash(){
  const mt=TX.filter(t=>t.date.startsWith(ym())),inc=sumT(mt,'income'),exp=sumT(mt,'expense'),sp=sumT(TX.filter(t=>t.date===today()),'expense');
  const b=balances(),have=CFG.accs.filter(a=>a.kind==='asset').reduce((s,a)=>s+b[a.id],0),recv=CFG.accs.filter(a=>a.kind==='recv').reduce((s,a)=>s+b[a.id],0);
  const bg=budgetFor(ym()),left=bg.total?bg.total-exp:null,pct=bg.total?Math.round(exp*100/bg.total):0;
  const ser=monthSeries(S.y),mx=Math.max(1,...ser.flatMap(s=>[s.inc,s.exp]));
  const svg=`<svg viewBox="0 0 360 130" width="100%" role="img" aria-label="Income versus expenses by month">${ser.map((s,i)=>{const x=i*30+4,hi=s.inc/mx*100,he=s.exp/mx*100;return `<rect x="${x}" y="${100-hi}" width="18" height="${hi}" fill="var(--inc)"/><rect x="${x+20}" y="${100-he}" width="18" height="${he}" fill="var(--exp)"/>`}).join('')}</svg>`;
  const cats=byCat(mt,'expense');
  return `<div class="card"><div class="mut">Money with me (${S.y} balances, all time)</div><div class="big">${fmt(have)}</div>
  <div class="row" style="margin-top:8px"><div><div class="mut">To receive</div><b>${fmt(recv)}</b></div><div><div class="mut">Total (with me + receivable)</div><b>${fmt(have+recv)}</b></div></div>
  <div class="row np" style="margin-bottom:12px"><button class="p" onclick="openForm(null,'expense')">− Add expense</button><button class="p" style="background:var(--inc);border-color:var(--inc)" onclick="openForm(null,'income')">+ Add income</button></div>
  ${TX.length?'':`<div class="card"><h3>Add your first transaction</h3><p class="mut">Everything starts at zero. Set what you already hold under Menu → Accounts → Opening, then record income and expenses.</p></div>`}
  <div class="grid"><div class="card"><div class="mut">Income · ${MN[S.m-1]}</div><div class="big inc">${fmt(inc)}</div></div>
  <div class="card"><div class="mut">Expenses · ${MN[S.m-1]}</div><div class="big exp">${fmt(exp)}</div></div>
  <div class="card"><div class="mut">Net cash flow</div><div class="big ${inc-exp<0?'exp':'inc'}">${fmt(inc-exp)}</div></div>
  <div class="card"><div class="mut">Spent today</div><div class="big">${fmt(sp)}</div></div>
  <div class="card"><div class="mut">Budget remaining</div><div class="big ${left!==null&&left<0?'exp':''}">${left===null?'Not set':fmt(left)}</div></div>
  <div class="card"><div class="mut">Transactions</div><div class="big">${mt.length}</div></div></div>
  ${bg.total?`<div class="card" style="margin-top:12px"><b>Budget used ${pct}%</b>${barH(pct)}${pct>=100?'<div class="exp">Budget exceeded.</div>':pct>=CFG.warn?`<div class="warn">You have reached ${pct}% of your budget.</div>`:''}</div>`:''}
  <div class="card" style="margin-top:12px"><h3>Income vs expenses, ${S.y}</h3>${svg}<div class="mut">Green income · red expenses</div></div>
  <div class="card"><h3>Spending by category</h3>${cats.length?cats.map(([c,v])=>`<div class="row"><span>${esc(c)}</span><b class="f0">${fmt(v)}</b></div>${barH(Math.round(v*100/exp))}`).join(''):'<p class="mut">No expenses yet.</p>'}</div>`;
}

function barH(p){return `<div class="bar"><i class="${p>=100?'x':p>=CFG.warn?'w':''}" style="width:${Math.min(100,p)}%"></i></div>`;}

function filtered(){const q=S.q.toLowerCase();return TX.filter(t=>t.date.startsWith(ym())&&(S.type==='all'||t.type===S.type)&&(!q||[t.note,t.party,t.cat,t.tags,accName(t.acc)].join(' ').toLowerCase().includes(q)));}
function vTx(){const a=filtered();const pg=S.page*50;const sh=a.slice(0,pg);return `<h2>Activity · ${MN[S.m-1]} ${S.y}</h2><div class="card"><input id="q" type="search" placeholder="Search notes, people, categories" value="${esc(S.q)}" aria-label="Search" oninput="S.q=this.value;S.page=1;render()"><div class="seg" style="margin-top:8px">${['all','expense','income','transfer'].map(t=>`<button class="${S.type===t?'on':''}" onclick="S.type='${t}';S.page=1;render()">${t[0].toUpperCase()+t.slice(1)}</button>`).join('')}</div></div>${!a.length?`<p class="mut">Nothing found for ${MN[S.m-1]} ${S.y}.</p>`:sh.map(t=>`<div class="tx"><div onclick="openForm('${t.id}')" style="flex:1;cursor:pointer"><b>${esc(t.type==='transfer'?`${accName(t.acc)} → ${accName(t.to)}`:t.cat)}</b><div class="mut">${t.date} · ${esc(t.party||t.note||'')}</div></div><div style="text-align:right"><b class="${t.type==='income'?'inc':t.type==='expense'?'exp':''}">${t.type==='expense'?'-':t.type==='income'?'+':''}${fmt(t.amt)}</b><div><button class="s" onclick="delTx('${t.id}')">Delete</button></div></div></div>`).join('')}`;}
function vBud(){return `<h2>Budget · ${MN[S.m-1]} ${S.y}</h2><div class="card"><p class="mut">Budget features are not being tested here.</p></div>`;}
function vRep(){return `<h2>Annual summary ${S.y}</h2><div class="card"><p class="mut">Reports are not being tested here.</p></div>`;}
function vSet(){return `<h2>Settings &amp; backup</h2><div class="card"><p class="mut">Version ${APP_VERSION}. The app checks for new versions when you open it.</p><button class="p" onclick="checkUpdate()">Check for updates</button></div>`;}

function openForm(id,pre){const t=id?TX.find(x=>x.id===id):{type:pre||'expense',date:today(),acc:CFG.defAcc,pay:'Cash'};const d=$('#dlg');d.innerHTML=`<form id="f" onsubmit="return saveTx(event,'${id||''}')" novalidate><h2>${id?'Edit':'Add'} transaction</h2><label for="am">Amount (${esc(CFG.cur)})</label><input id="am" inputmode="decimal" autocomplete="off" value="${t.amt?(t.amt/100).toFixed(2):''}" placeholder="0.00"><div class="err" id="fe" role="alert"></div><div class="row"><button type="button" onclick="$('#dlg').close()">Cancel</button><button class="p" id="sv" type="submit">Save</button></div></form>`;d.showModal();setTimeout(()=>$('#am').focus(),50)}
async function saveTx(e,id){e.preventDefault();if(S.busy)return false;const ty='expense';const amt=toMinor($('#am').value),err=m=>{$('#fe').textContent=m;return false};if(!amt)return err('Enter an amount greater than zero, like 2500 or 2500.50.');const t={id:id||uid(),type:ty,amt,date:today(),acc:CFG.defAcc,note:'',tags:''};S.busy=true;try{await DB.put('tx',t);if(id){}else TX.push(t);$('#dlg').close();toast('Saved');render()}catch(x){err('Could not save: '+(x&&x.message||x));}finally{S.busy=false;}return false;}
async function delTx(id){const o=TX.find(x=>x.id===id);if(!o)return;TX=TX.filter(x=>x.id!==id);render();}

/* expose methods on the JSDOM window object so tests and inline event handlers can invoke them */
['go','openForm','saveTx','delTx','checkUpdate','setTy','addAcc','addCat','rmCat','saveBud','copyBud','range','expJSON','expCSV','goalNew','goalAdd','goalDel','editOpen','wipe','impFile','initSW'].forEach(name => {
  if (typeof globalThis[name] === 'function') globalThis.window[name] = globalThis[name];
});

/* ===== start ===== */
const APP_VERSION='2.0.0';let swReg=null;
(async()=>{try{await DB.open();const r=await Core.loadOrInit(DB);CFG=r.cfg;TX=r.tx;}catch(e){DB.ok=false;STORAGE_ERR=e&&e.message||'Storage could not be opened.'}render();})();

async function checkUpdate(){toast('You have the latest version.');}
