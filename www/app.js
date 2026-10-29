'use strict';

/* ===== helpers ===== */
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad=n=>String(n).padStart(2,'0');
const today=()=>{const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`};
const MN=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
/* money is stored as integer paisa (1/100) – never floats */
const toMinor=Core.toMinor;
function fmt(m){const neg=m<0;m=Math.abs(m);const w=Math.floor(m/100),p=m%100;return (neg?'-':'')+CFG.cur+' '+w.toLocaleString('en-IN')+'.'+pad(p)}
function toast(msg,undo){const t=$('#toast');t.innerHTML=esc(msg)+(undo?' <button class="s" id="undoB">Undo</button>':'');t.style.display='block';if(undo)$('#undoB').onclick=()=>{undo();t.style.display='none'};clearTimeout(toast.h);toast.h=setTimeout(()=>t.style.display='none',undo?7000:2500)}

const DB=Core.DB;let STORAGE_ERR='';
/* ===== state ===== */
const DEF_EXP=Core.DEF_EXP,DEF_INC=Core.DEF_INC,PAY=Core.PAY,DEF_CFG=Core.defaultCfg;
let CFG=DEF_CFG(),TX=[],IMPORTS=[],REVIEW_KEY=null;
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
 const V={dash:vDash,tx:vTx,bud:vBud,rep:vRep,set:vSet,auto:vAuto}[S.view]();
 $('#app').innerHTML=`${DB.ok?'':`<div class="banner" role="alert"><b>Storage problem.</b> ${esc(STORAGE_ERR||'Storage is unavailable.')} Nothing can be saved right now, and existing data has not been changed. Use a current browser at an https address (or the installed app) and keep a JSON backup.</div>`}
 <header class="np"><b>Khata</b><select id="ys" aria-label="Year" style="width:auto" onchange="S.y=+this.value;S.page=1;render()">${[...yrs].sort().map(y=>`<option ${y===S.y?'selected':''}>${y}</option>`)}</select>
 <select aria-label="Month" style="width:auto" onchange="S.m=+this.value;S.page=1;render()">${MN.map((n,i)=>`<option value="${i+1}" ${i+1===S.m?'selected':''}>${n}</option>`)}</select><button class="s" aria-label="Menu: accounts, categories, backup, settings" onclick="go('set')">☰</button></header>
 <main>${V}</main>
 <nav class="np">${[['dash','Home'],['tx','Activity'],['add','+'],['bud','Budgets'],['rep','Reports']].map(([k,l])=>k==='add'?`<button class="add" aria-label="Add transaction" onclick="openForm()">+</button>`:`<button class="${S.view===k?'on':''}" onclick="go('${k}')">${l}</button>`).join('')}</nav>`;
}
const go=v=>{S.view=v;render();scrollTo(0,0)};

function vDash(){
 const mt=TX.filter(t=>t.date.startsWith(ym())),inc=sumT(mt,'income'),exp=sumT(mt,'expense'),sp=sumT(TX.filter(t=>t.date===today()),'expense');
 const b=balances(),have=CFG.accs.filter(a=>a.kind==='asset').reduce((s,a)=>s+b[a.id],0),recv=CFG.accs.filter(a=>a.kind==='recv').reduce((s,a)=>s+b[a.id],0);
 const bg=budgetFor(ym()),left=bg.total?bg.total-exp:null,pct=bg.total?Math.round(exp*100/bg.total):0;
 const ser=monthSeries(S.y),mx=Math.max(1,...ser.flatMap(s=>[s.inc,s.exp]));
 const svg=`<svg viewBox="0 0 360 130" width="100%" role="img" aria-label="Income versus expenses by month">${ser.map((s,i)=>{const x=i*30+4,hi=s.inc/mx*100,he=s.exp/mx*100;return `<rect x="${x}" y="${105-hi}" width="11" height="${hi}" fill="var(--inc)" rx="2"/><rect x="${x+12}" y="${105-he}" width="11" height="${he}" fill="var(--exp)" rx="2"/><text x="${x+12}" y="123" font-size="9" text-anchor="middle" fill="var(--mut)">${MN[i][0]}</text>`}).join('')}</svg>`;
 const cats=byCat(mt,'expense');
 return `<div class="card"><div class="mut">Money with me (${S.y} balances, all time)</div><div class="big">${fmt(have)}</div>
 <div class="row" style="margin-top:8px"><div><div class="mut">To receive</div><b>${fmt(recv)}</b></div><div><div class="mut">Total (with me + receivable)</div><b>${fmt(have+recv)}</b></div></div></div>
 <div class="row np" style="margin-bottom:12px"><button class="p" onclick="openForm(null,'expense')">− Add expense</button><button class="p" style="background:var(--inc);border-color:var(--inc)" onclick="openForm(null,'income')">+ Add income</button></div>
 ${pendingRecs().length?`<div class="card np"><b>${pendingRecs().length} detected transaction${pendingRecs().length>1?'s':''} waiting</b><div class="mut">Check them before they are added.</div><button class="p" style="margin-top:6px" onclick="go('auto')">Review now</button></div>`:''}
 ${TX.length?'':`<div class="card"><h3>Add your first transaction</h3><p class="mut">Everything starts at zero. Set what you already hold under Menu → Accounts → Opening, then record income and expenses.</p><button class="p" onclick="openForm()">Add transaction</button></div>`}
 <div class="grid"><div class="card"><div class="mut">Income · ${MN[S.m-1]}</div><div class="big inc">${fmt(inc)}</div></div>
 <div class="card"><div class="mut">Expenses · ${MN[S.m-1]}</div><div class="big exp">${fmt(exp)}</div></div>
 <div class="card"><div class="mut">Net cash flow</div><div class="big ${inc-exp<0?'exp':'inc'}">${fmt(inc-exp)}</div></div>
 <div class="card"><div class="mut">Spent today</div><div class="big">${fmt(sp)}</div></div>
 <div class="card"><div class="mut">Budget remaining</div><div class="big ${left!==null&&left<0?'exp':''}">${left===null?'Not set':fmt(left)}</div></div>
 <div class="card"><div class="mut">Transactions</div><div class="big">${mt.length}</div></div></div>
 ${bg.total?`<div class="card" style="margin-top:12px"><b>Budget used ${pct}%</b>${barH(pct)}${pct>=100?'<div class="exp">Budget exceeded.</div>':pct>=CFG.warn?`<div class="warn">You have reached ${CFG.warn}% of this month's budget.</div>`:''}</div>`:''}
 <div class="card" style="margin-top:12px"><h3>Income vs expenses, ${S.y}</h3>${svg}<div class="mut">Green income · red expenses</div></div>
 <div class="card"><h3>Spending by category</h3>${cats.length?cats.map(([c,v])=>`<div class="row"><span>${esc(c)}</span><b class="f0">${fmt(v)}</b></div>${barH(Math.round(v*100/exp))}`).join(''):'<p class="mut">No expenses this month.</p>'}</div>
 <p class="mut">Method: cash basis. Income and expenses count when recorded. Transfers between your own accounts (including receipts of money owed to you) change balances only, never income or expenses. Record a refund as income under "Refunds &amp; reimbursements".</p>`}
const barH=p=>`<div class="bar"><i class="${p>=100?'x':p>=CFG.warn?'w':''}" style="width:${Math.min(100,p)}%"></i></div>`;

function filtered(){const q=S.q.toLowerCase();return TX.filter(t=>t.date.startsWith(ym())&&(S.type==='all'||t.type===S.type)&&(!q||[t.note,t.party,t.cat,t.tags,accName(t.acc)].join(' ').toLowerCase().includes(q))).sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id))}
function listHTML(){const a=filtered(),pg=S.page*50,sh=a.slice(0,pg);
 if(!a.length)return `<p class="mut">Nothing found for ${MN[S.m-1]} ${S.y}.</p>`;
 return sh.map(t=>`<div class="tx"><div onclick="openForm('${t.id}')" style="flex:1;cursor:pointer"><b>${esc(t.type==='transfer'?`${accName(t.acc)} → ${accName(t.to)}`:t.cat)}</b><div class="mut">${t.date} · ${esc(t.type==='transfer'?'Transfer':accName(t.acc))}${t.pay?' · '+esc(t.pay):''}${t.party?' · '+esc(t.party):''}</div>${t.note?`<div class="mut">${esc(t.note)}</div>`:''}</div>
 <div style="text-align:right"><b class="${t.type==='income'?'inc':t.type==='expense'?'exp':''}">${t.type==='expense'?'-':t.type==='income'?'+':''}${fmt(t.amt)}</b><div><button class="s" onclick="dup('${t.id}')" aria-label="Duplicate">⧉</button> <button class="s d" onclick="delTx('${t.id}')" aria-label="Delete">🗑</button></div></div></div>`).join('')+(a.length>pg?`<button style="width:100%;margin-top:8px" onclick="S.page++;render()">Show more (${a.length-pg})</button>`:'')}
function vTx(){return `<h2>Activity · ${MN[S.m-1]} ${S.y}</h2><div class="card"><input id="q" type="search" placeholder="Search notes, people, categories" value="${esc(S.q)}" aria-label="Search" oninput="S.q=this.value;S.page=1;$('#list').innerHTML=listHTML()">
 <div class="seg" style="margin-top:8px">${['all','expense','income','transfer'].map(t=>`<button class="${S.type===t?'on':''}" onclick="S.type='${t}';S.page=1;render()">${t[0].toUpperCase()+t.slice(1)}</button>`).join('')}</div></div><div class="card" id="list">${listHTML()}</div>`}

function vBud(){const k=ym(),bg=budgetFor(k),mt=TX.filter(t=>t.date.startsWith(k)),sp=Object.fromEntries(byCat(mt,'expense')),tot=sumT(mt,'expense');
 const yb=Object.entries(CFG.budgets).filter(([k2,v])=>k2.startsWith(S.y)).reduce((s,[,v])=>s+v.total,0);
 const row=(c)=>{const b=bg.cats[c]||0,u=sp[c]||0,p=b?Math.round(u*100/b):0;return `<div style="margin:10px 0"><div class="row"><label style="margin:0" for="b_${esc(c)}">${esc(c)}</label><input id="b_${esc(c)}" data-c="${esc(c)}" inputmode="decimal" placeholder="0" value="${b?b/100:''}" style="max-width:130px;flex:0 0 130px"></div><div class="mut">Spent ${fmt(u)}${b?` · ${p}% used · ${b-u<0?'over by '+fmt(u-b):fmt(b-u)+' left'}`:''}</div>${b?barH(p):''}${b&&p>=100?'<div class="exp">Over budget</div>':b&&p>=CFG.warn?`<div class="warn">${p}% used</div>`:''}</div>`};
 return `<h2>Budget · ${MN[S.m-1]} ${S.y}</h2><div class="card"><label for="bt">Total monthly spending budget</label><input id="bt" inputmode="decimal" value="${bg.total?bg.total/100:''}" placeholder="0"><div class="mut">Spent ${fmt(tot)}${bg.total?` · ${bg.total-tot<0?'over by '+fmt(tot-bg.total):fmt(bg.total-tot)+' left'}`:''}</div>${bg.total?barH(Math.round(tot*100/bg.total)):''}
 <div class="mut" style="margin-top:6px">Annual budget (sum of ${S.y} months): ${fmt(yb)}</div></div>
 <div class="card"><h3>Category budgets</h3>${CFG.exp.map(row).join('')}<div class="err" id="be"></div><div class="row"><button class="p" onclick="saveBud()">Save budget</button><button onclick="copyBud()">Copy from previous month</button></div></div>${goalsHTML()}`}
function saveBud(){const t=toMinor($('#bt').value||'0');let ok=t!==null;const cats={};document.querySelectorAll('[data-c]').forEach(i=>{if(!i.value.trim())return;const v=toMinor(i.value);if(v===null)ok=false;else if(v>0)cats[i.dataset.c]=v});
 if(!ok){$('#be').textContent='Enter amounts as numbers, like 5000 or 5000.50.';return}CFG.budgets[ym()]={total:t,cats};saveCfg();toast('Budget saved');render()}
function copyBud(){let y=S.y,m=S.m-1;if(!m){m=12;y--}const p=CFG.budgets[`${y}-${pad(m)}`];if(!p)return toast('No budget set for the previous month');CFG.budgets[ym()]=JSON.parse(JSON.stringify(p));saveCfg();toast('Copied');render()}

function vRep(){const ser=monthSeries(S.y),yt=TX.filter(t=>t.date.startsWith(S.y)),ie=sumT(yt,'income'),ee=sumT(yt,'expense'),act=ser.filter(s=>s.exp).length||1;
 const top=yt.filter(t=>t.type==='expense').sort((a,b)=>b.amt-a.amt).slice(0,5);
 return `<h2>Annual summary ${S.y}</h2><div class="card"><table><tr><th>Month</th><th>Income</th><th>Expense</th><th>Net</th></tr>${ser.map(s=>`<tr><td>${MN[s.m-1]}</td><td>${fmt(s.inc)}</td><td>${fmt(s.exp)}</td><td class="${s.inc-s.exp<0?'exp':''}">${fmt(s.inc-s.exp)}</td></tr>`).join('')}<tr><th>Total</th><th>${fmt(ie)}</th><th>${fmt(ee)}</th><th>${fmt(ie-ee)}</th></tr></table>
 <p class="mut">Average monthly spending (months with expenses): ${fmt(Math.round(ee/act))}</p></div>
 <div class="card"><h3>Spending by category</h3>${byCat(yt,'expense').map(([c,v])=>`<div class="row"><span>${esc(c)}</span><b class="f0">${fmt(v)}</b></div>`).join('')||'<p class="mut">None</p>'}<h3>Income by category</h3>${byCat(yt,'income').map(([c,v])=>`<div class="row"><span>${esc(c)}</span><b class="f0">${fmt(v)}</b></div>`).join('')||'<p class="mut">None</p>'}</div>
 <div class="card"><h3>Largest expenses</h3>${top.map(t=>`<div class="row"><span>${t.date} ${esc(t.cat)}</span><b class="f0">${fmt(t.amt)}</b></div>`).join('')||'<p class="mut">None</p>'}</div>
 <div class="card np"><h3>Custom date range</h3><div class="row"><input type="date" id="r1" aria-label="From"><input type="date" id="r2" aria-label="To"></div><button style="margin-top:8px" onclick="range()">Calculate</button><div id="rr"></div></div>
 <button class="np p" onclick="print()" style="width:100%">Print / Save as PDF</button>`}
function range(){const a=$('#r1').value,b=$('#r2').value;if(!a||!b||a>b)return $('#rr').innerHTML='<div class="err">Pick a valid start and end date.</div>';const r=TX.filter(t=>t.date>=a&&t.date<=b);$('#rr').innerHTML=`<p>Income <b class="inc">${fmt(sumT(r,'income'))}</b><br>Expenses <b class="exp">${fmt(sumT(r,'expense'))}</b><br>Net <b>${fmt(sumT(r,'income')-sumT(r,'expense'))}</b> · ${r.length} transactions</p>`}

function vSet(){const b=balances();
 return `<h2>Settings &amp; backup</h2><div class="banner">Export a backup regularly${CFG.lastBackup?` (last: ${new Date(CFG.lastBackup).toLocaleString()})`:' – you have not made one yet'}. Browser data can be cleared, and the HTML file itself is not a backup.</div>
 <div class="card"><label for="cur">Currency symbol</label><input id="cur" value="${esc(CFG.cur)}" maxlength="6" onchange="CFG.cur=this.value||'रु';saveCfg();render()">
 <label for="th">Theme</label><select id="th" onchange="CFG.theme=this.value;saveCfg();render()">${['auto','light','dark'].map(t=>`<option ${CFG.theme===t?'selected':''}>${t}</option>`)}</select>
 <label for="wn">Budget warning at (%)</label><input id="wn" type="number" min="1" max="100" value="${CFG.warn}" onchange="CFG.warn=Math.min(100,Math.max(1,+this.value||80));saveCfg();render()">
 <label for="da">Default account</label><select id="da" onchange="CFG.defAcc=this.value;saveCfg()">${CFG.accs.map(a=>`<option value="${a.id}" ${CFG.defAcc===a.id?'selected':''}>${esc(a.name)}</option>`)}</select></div>
 <div class="card"><h3>Accounts</h3>${CFG.accs.map(a=>`<div class="row"><span>${esc(a.name)} <span class="mut">${a.kind==='recv'?'(receivable)':''}</span></span><b class="f0">${fmt(b[a.id])}</b><button class="s f0" onclick="editOpen('${a.id}')" aria-label="Edit opening balance">Opening</button></div>`).join('')}
 <p class="mut">To record money received from a receivable, add a Transfer from that account to EBL, Nabil or Cash. It reduces what is owed without counting as income.</p>
 <label for="an">New account</label><div class="row"><input id="an" placeholder="Name"><input id="ao" inputmode="decimal" placeholder="Opening balance"></div><div class="row" style="margin-top:6px"><select id="ak"><option value="asset">Money I hold</option><option value="recv">Money owed to me</option></select><button onclick="addAcc()">Add account</button></div></div>
 <div class="card"><h3>Categories</h3><div class="row"><input id="cn" placeholder="New category name"><select id="ct"><option value="exp">Expense</option><option value="inc">Income</option></select><button class="f0" onclick="addCat()">Add</button></div><div class="mut" style="margin-top:6px">Tap to remove a custom category (existing transactions keep their label):</div><div>${[...CFG.exp.filter(c=>!DEF_EXP.includes(c)).map(c=>['exp',c]),...CFG.inc.filter(c=>!DEF_INC.includes(c)).map(c=>['inc',c])].map(([t,c])=>`<button class="s" onclick="rmCat('${t}',this.dataset.c)" data-c="${esc(c)}">${esc(c)} ✕</button> `).join('')||'<span class="mut">No custom categories.</span>'}</div></div>
 <div class="card"><h3>Backup &amp; restore</h3><div class="row"><button class="p" onclick="expJSON()">Export JSON</button><button onclick="expCSV()">Export CSV</button></div><label for="imp">Import JSON backup</label><input type="file" id="imp" accept=".json,application/json" onchange="impFile(this.files[0])"><div class="err" id="ie"></div></div>
 <div class="card"><h3>Auto transaction detection</h3><p class="mut">Mode: ${CFG.auto.mode==='auto'?'save confident ones automatically':CFG.auto.mode==='manual'?'manual only':'review before saving'}. ${pendingRecs().length} waiting for review.</p><button class="p" onclick="go('auto')">Open</button></div>
 <div class="card"><h3>App updates</h3><p class="mut">Version ${isDev()?'(dev build)':APP_VERSION}. The app checks for new versions when you open it. Updates download quietly and you choose when to apply them. Your records are never touched.</p><button class="p" onclick="checkUpdate()">Check for updates</button></div>
 <div class="card"><h3>Privacy &amp; storage</h3><p class="mut">All data stays on this device in your browser's IndexedDB; nothing is sent anywhere. This is not an encrypted vault: anyone with access to your phone or browser profile may read it. Clearing browser data, some "private" modes, or opening the file through certain file managers can lose or block storage. Back up often.</p><button class="d" onclick="wipe()">Clear all data…</button></div>`}
function addAcc(){const n=$('#an').value.trim(),o=toMinor($('#ao').value||'0');if(!n||o===null)return toast('Enter a name and a valid opening balance');CFG.accs.push({id:uid(),name:n,kind:$('#ak').value,open:o});saveCfg();render()}
function addCat(){const n=$('#cn').value.trim(),t=$('#ct').value;if(!n)return;if(CFG[t].includes(n))return toast('That category exists');CFG[t].push(n);saveCfg();render()}
function rmCat(t,c){if(confirm(`Remove category "${c}"?`)){CFG[t]=CFG[t].filter(x=>x!==c);saveCfg();render()}}

/* ===== transaction form ===== */
function openForm(id,pre){const po=pre&&typeof pre==='object'?pre:null;REVIEW_KEY=po?po.importKey:null;const t=id?TX.find(x=>x.id===id):{type:po?po.type:(pre||'expense'),date:today(),acc:CFG.defAcc,pay:'Cash',...(po?{amt:po.amt,date:po.date,acc:po.acc||'',cat:po.cat,party:po.party,note:po.note}:{})};
 const d=$('#dlg');d.innerHTML=`<form id="f" onsubmit="return saveTx(event,'${id||''}')" novalidate><h2>${id?'Edit':'Add'} transaction</h2>
 <div class="seg" role="group" aria-label="Type">${['expense','income','transfer'].map(x=>`<button type="button" data-ty="${x}" class="${t.type===x?'on':''}" onclick="setTy('${x}')">${x[0].toUpperCase()+x.slice(1)}</button>`).join('')}</div><input type="hidden" id="ty" value="${t.type}">
 <label for="am">Amount (${esc(CFG.cur)})</label><input id="am" inputmode="decimal" autocomplete="off" value="${t.amt?(t.amt/100).toFixed(2):''}" placeholder="0.00">
 <div id="catw"></div>
 <label for="dt">Date</label><input id="dt" type="date" value="${t.date}">
 <label for="ac" id="aclab">Account</label><select id="ac">${t.acc===''?'<option value="">Choose account…</option>':''}${CFG.accs.map(a=>`<option value="${a.id}" ${t.acc===a.id?'selected':''}>${esc(a.name)}</option>`)}</select>
 <div id="tow" hidden><label for="to">To account</label><select id="to">${CFG.accs.map(a=>`<option value="${a.id}" ${t.to===a.id?'selected':''}>${esc(a.name)}</option>`)}</select></div>
 <div id="opt"><label for="pm">Payment method</label><select id="pm">${PAY.map(p=>`<option ${t.pay===p?'selected':''}>${p}</option>`)}</select>
 <label for="pt">Merchant / person / source (optional)</label><input id="pt" value="${esc(t.party||'')}"></div>
 <label for="nt">Notes (optional)</label><textarea id="nt" rows="2">${esc(t.note||'')}</textarea>
 <label for="tg">Tags (optional, comma separated)</label><input id="tg" value="${esc(t.tags||'')}">
 <div class="err" id="fe" role="alert"></div>
 <div class="row"><button type="button" onclick="$('#dlg').close()">Cancel</button><button class="p" id="sv" type="submit">Save</button></div></form>`;
 d.dataset.cat=t.cat||'';setTy(t.type);d.showModal();setTimeout(()=>$('#am').focus(),50)}
function setTy(x){$('#ty').value=x;document.querySelectorAll('[data-ty]').forEach(b=>b.classList.toggle('on',b.dataset.ty===x));
 const tr=x==='transfer';$('#tow').hidden=!tr;$('#opt').hidden=tr;$('#aclab').textContent=tr?'From account':'Account';
 const l=x==='income'?CFG.inc:CFG.exp,cur=$('#dlg').dataset.cat;$('#catw').innerHTML=tr?'':`<label for="ct2">Category</label><select id="ct2">${l.map(c=>`<option ${c===cur?'selected':''}>${esc(c)}</option>`)}</select>`}
async function saveTx(e,id){e.preventDefault();if(S.busy)return false;const ty=$('#ty').value,amt=toMinor($('#am').value),dt=$('#dt').value,err=m=>{$('#fe').textContent=m;return false};
 if(!amt)return err('Enter an amount greater than zero, like 2500 or 2500.50.');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(dt)||!Core.validDate(dt))return err('Choose a valid date.');
 const ac=$('#ac').value;if(!ac)return err('Choose an account.');if(ty==='transfer'&&ac===$('#to').value)return err('Choose two different accounts for a transfer.');
 const old=id?TX.find(x=>x.id===id):null;
 const t={id:id||uid(),type:ty,amt,date:dt,acc:ac,note:$('#nt').value.trim(),tags:$('#tg').value.trim()};
 if(ty==='transfer')t.to=$('#to').value;else{t.cat=$('#ct2').value;t.pay=$('#pm').value;t.party=$('#pt').value.trim()}
 S.busy=true;try{const rk=REVIEW_KEY,rec=rk&&IMPORTS.find(x=>x.key===rk);
  if(rec){const n={...rec,status:'saved',txId:t.id,text:'',parsed:{...rec.parsed,amt:t.amt,type:t.type,date:t.date,acc:t.acc}};await DB.commit({putTx:[t],putImports:[n]});IMPORTS=IMPORTS.map(x=>x.key===rk?n:x);REVIEW_KEY=null}
  else await DB.put('tx',t);
  if(old)Object.assign(old,t);else TX.push(t);$('#dlg').close();const[y,m]=dt.split('-');S.y=+y;S.m=+m;toast('Saved');render()}catch(x){err('Could not save: '+x.message)}finally{S.busy=false}return false}
async function dup(id){try{const o=TX.find(x=>x.id===id),t={...o,id:uid(),date:today()};await DB.put('tx',t);TX.push(t);toast("Duplicated with today's date");render()}catch(x){toast('Could not duplicate: '+x.message)}}
async function delTx(id){if(!confirm('Delete this transaction?'))return;const o=TX.find(x=>x.id===id);try{await DB.del('tx',id);TX=TX.filter(x=>x.id!==id);render();toast('Deleted',async()=>{try{await DB.put('tx',o);TX.push(o);render()}catch(x){toast('Undo failed: '+x.message)}})}catch(x){toast('Could not delete: '+x.message)}}

/* ===== backup / restore ===== */
async function dl(name,text,type){
 if(window.Capacitor&&Capacitor.isNativePlatform&&Capacitor.isNativePlatform()){
  try{const FS=Capacitor.registerPlugin('Filesystem'),SH=Capacitor.registerPlugin('Share');
   const r=await FS.writeFile({path:name,data:text,directory:'CACHE',encoding:'utf8'});
   await SH.share({title:name,url:r.uri,dialogTitle:'Save or send backup'});return}
  catch(e){toast('Could not export: '+(e.message||e));return}}
 const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000)}
function backupJSON(){return JSON.stringify({app:'khata',version:3,exported:new Date().toISOString(),cfg:CFG,tx:TX,imports:IMPORTS.map(r=>({...r,text:''}))},null,1)}
function expJSON(){dl(`khata-backup-${today()}.json`,backupJSON(),'application/json');CFG.lastBackup=Date.now();saveCfg();toast('Backup downloaded');render()}
/* ===== savings goals (kept separate from expenses) ===== */
function goalsHTML(){const g=CFG.goals;return `<div class="card"><h3>Savings goals</h3><p class="mut">Goals are tracked separately. Money added to a goal is not counted as an expense.</p>${g.map(x=>{const p=x.target?Math.min(100,Math.round(x.saved*100/x.target)):0;return `<div style="margin:10px 0"><div class="row"><b>${esc(x.name)}</b><span class="f0">${p}%</span></div><div class="bar"><i style="width:${p}%"></i></div><div class="mut">${fmt(x.saved)} of ${fmt(x.target)} · ${fmt(Math.max(0,x.target-x.saved))} left${x.date?' · by '+esc(x.date):''}</div><button class="s" onclick="goalAdd('${x.id}')">Add or remove money</button> <button class="s d" onclick="goalDel('${x.id}')">Delete</button></div>`}).join('')||'<p class="mut">No goals yet.</p>'}<label for="gn">New goal</label><input id="gn" placeholder="e.g. Emergency fund" maxlength="60"><div class="row" style="margin-top:6px"><input id="gt" inputmode="decimal" placeholder="Target" aria-label="Target amount"><input id="gs" inputmode="decimal" placeholder="Saved so far" aria-label="Saved so far"></div><label for="gd">Target date (optional)</label><input id="gd" type="date"><div class="err" id="ge" role="alert"></div><button class="p" onclick="goalNew()" style="margin-top:6px">Add goal</button></div>`}
async function goalNew(){const n=$('#gn').value.trim(),t=toMinor($('#gt').value),s=toMinor($('#gs').value||'0'),d=$('#gd').value;if(!n||!t||s===null)return $('#ge').textContent='Enter a name and a target amount, like 100000.';if(d&&!Core.validDate(d))return $('#ge').textContent='Choose a valid date.';CFG.goals.push({id:uid(),name:n.slice(0,60),target:t,saved:s,date:d||''});await saveCfg();render()}
async function goalAdd(id){const g=CFG.goals.find(x=>x.id===id),v=prompt('Amount to add (use a minus sign to remove)');if(v===null)return;const neg=v.trim().startsWith('-'),m=toMinor(v.replace('-',''));if(!m)return toast('Enter a valid amount');g.saved=Math.max(0,g.saved+(neg?-m:m));await saveCfg();render()}
async function goalDel(id){if(!confirm('Delete this goal?'))return;CFG.goals=CFG.goals.filter(x=>x.id!==id);await saveCfg();render()}
async function editOpen(id){const a=CFG.accs.find(x=>x.id===id),v=prompt(`Opening balance for ${a.name} (${CFG.cur}). This is the money you already had before you started tracking.`,(a.open/100).toFixed(2));if(v===null)return;const neg=v.trim().startsWith('-'),m=toMinor(v.replace('-',''));if(m===null)return toast('Enter a valid amount');a.open=neg?-m:m;await saveCfg();render()}
function expCSV(){dl(`khata-transactions-${today()}.csv`,Core.toCsv(TX,accName),'text/csv')}
const MAX_BYTES=10*1024*1024;
async function impFile(f){const e=$('#ie');e.textContent='';if(!f)return;
 if(f.size>MAX_BYTES)return e.textContent='This file is larger than 10 MB. Nothing was changed.';
 if(!/\.json$/i.test(f.name))return e.textContent='Choose a .json backup file. Nothing was changed.';
 let d;try{d=JSON.parse(await f.text())}catch{return e.textContent='This file is not valid JSON. Nothing was changed.'}
 const p=Core.planImport(CFG,TX,d,IMPORTS);if(!p.ok)return e.textContent=p.error+' Nothing was changed.';
 const msg=`Backup has ${p.good.length} valid transactions${p.bad?` (${p.bad} invalid will be skipped)`:''}. ${p.dups} look like duplicates.\n\nOK = MERGE (add ${p.fresh.length} new, keep everything else)\nCancel = more options`;
 try{
  if(confirm(msg)){const cfg=Core.mergeCfg(CFG,p.cfg);await DB.commit({putTx:p.fresh,putImports:p.newImports,cfg});TX.push(...p.fresh);IMPORTS.push(...p.newImports);CFG=cfg;toast(`Merged ${p.fresh.length} transactions`);render();return}
  if(confirm(`REPLACE all current data (${TX.length} transactions) with this backup (${p.good.length})?\nA safety backup of your current data downloads first.`)){
   await dl(`khata-before-restore-${today()}.json`,backupJSON(),'application/json');
   await DB.commit({clearTx:true,clearImports:true,putTx:p.good,putImports:p.imports,cfg:p.cfg});
   const n=(await DB.all('tx')).length;if(n!==p.good.length)throw new Error(`Verification failed (${n} of ${p.good.length} records stored)`);
   TX=p.good;IMPORTS=p.imports;CFG=p.cfg;toast('Restore complete');render()}
  else e.textContent='Import cancelled. Nothing was changed.'
 }catch(x){e.textContent='Import failed and was rolled back: '+x.message}}
async function wipe(){if(!confirm('This deletes ALL transactions, accounts, goals and budgets on this device. Export a backup first. Continue?'))return;if(prompt('Type DELETE to confirm')!=='DELETE')return toast('Cancelled');
 try{await dl(`khata-before-clear-${today()}.json`,backupJSON(),'application/json');const c=DEF_CFG();await DB.commit({clearTx:true,clearImports:true,cfg:c});TX=[];IMPORTS=[];CFG=c;toast('All data cleared');render()}catch(x){toast('Could not clear data: '+x.message)}}

/* ===== start ===== */
/* ===== auto transaction detection (UI + glue; parsing lives in sms.js) ===== */
const SAMPLES=[['Debit',"Dear Customer, Rs. 1,500.00 has been debited from your account on 29 Oct 2026. Ref No: TX123456",'NABIL'],['Credit',"You have received Rs. 2,000 from Ram. Txn ID 998877",'eSewa'],['Refund',"Refund of Rs 800 has been credited to your account. Ref 424242",'Khalti'],['OTP (ignored)',"Your OTP is 123456 for payment of Rs 500. Do not share.",'NABIL'],['Failed (ignored)',"Transaction of Rs 500 failed. Amount not debited.",'EBL'],['Nepali',"तपाईंको खाताबाट रु. १,५०० निकालिएको छ। Ref 123456",'Nabil']];
const AUTO={draft:'',sender:'',note:'',preview:null};const IGN={otp:'an OTP',failed:'a failed payment',pending:'a pending payment',reminder:'a payment reminder',promotional:'a promotion','no-direction':'not a debit or credit','no-amount':'no amount found',empty:'empty'};
let nativePlugin=null;const nativeOn=()=>isApk()&&CFG.auto.mode!=='manual'&&!CFG.auto.paused;
const plug=()=>nativePlugin||(isApk()?(nativePlugin=Capacitor.registerPlugin('KhataSms')):null);
const pendingRecs=()=>IMPORTS.filter(r=>r.status==='pending').sort((a,b)=>b.at-a.at);
const flagTxt=f=>({'direction-ambiguous':'Could not tell debit from credit','multiple-amounts':'Several amounts found','link':'Contains a link (be careful)','date-ambiguous':'Date format unclear','date-future':'Date is in the future','date-invalid':'Date is invalid'}[f]||f);
async function processIncoming(msg){
 const ctx={imports:new Map(IMPORTS.map(r=>[r.key,r])),accs:CFG.accs,mode:CFG.auto.mode==='auto'?'auto':'review',minConf:CFG.auto.minConf};
 const r=Sms.processMessage(msg,ctx);
 if(r.outcome==='saved'){await DB.commit({putTx:[r.tx],putImports:[r.rec]});TX.push(r.tx);IMPORTS.push(r.rec)}
 else if(r.outcome==='pending'){await DB.commit({putImports:[r.rec]});IMPORTS=IMPORTS.filter(x=>x.key!==r.rec.key);IMPORTS.push(r.rec)}
 return r}
function accOpts(sel){return `<option value="">Choose account…</option>`+CFG.accs.filter(a=>a.kind==='asset').map(a=>`<option value="${esc(a.id)}" ${a.id===sel?'selected':''}>${esc(a.name)}</option>`).join('')}
function recCard(r,hist){const p=r.parsed,tag=p.type==='income'?'inc':p.type==='expense'?'exp':'warn';
 return `<div class="tx"><div style="flex:1"><b class="${tag}">${p.type?(p.type==='income'?'+':'−'):'?'}${fmt(p.amt)}</b> <span class="mut">${esc(p.date)}${p.party?' · '+esc(p.party):''}${p.acc?' · '+esc(accName(p.acc)):''}${p.refund?' · refund':''}</span>
 <div class="mut">${esc(r.src)} · ${Math.round(r.conf*100)}% sure${r.status==='pending'&&!p.acc?' · choose an account':''}</div>${(r.flags||[]).map(f=>`<div class="warn">${esc(flagTxt(f))}</div>`).join('')}</div>
 <div style="text-align:right">${r.status==='pending'?`<button class="s p" data-k="${esc(r.key)}" onclick="reviewRec(this.dataset.k)">Review</button> <button class="s d" data-k="${esc(r.key)}" onclick="rejectRec(this.dataset.k)">Reject</button>`
 :r.status==='saved'&&TX.some(t=>t.id===r.txId)?`<button class="s d" data-k="${esc(r.key)}" onclick="removeAuto(this.dataset.k)">Remove entry</button>`:`<span class="mut">${esc(r.status)}</span>`}</div></div>`}
function vAuto(){const a=CFG.auto,pend=pendingRecs(),hist=IMPORTS.filter(r=>r.status!=='pending').sort((x,y)=>y.at-x.at).slice(0,30),pv=AUTO.preview;
 const pvH=pv?(pv.kind==='ignored'?`<div class="card"><b>Ignored</b><div class="mut">This looks like ${esc(IGN[pv.reason]||pv.reason)}, so nothing would be recorded.</div></div>`
  :`<div class="card"><b>Detected</b><div class="big ${pv.type==='income'?'inc':'exp'}">${pv.type==='income'?'+':pv.type==='expense'?'−':'?'}${fmt(pv.amt)}</div><div class="mut">${esc(pv.date)}${pv.party?' · '+esc(pv.party):''}${pv.bank?' · '+esc(pv.bank):''}${pv.ref?' · ref '+esc(pv.ref):''} · ${Math.round(pv.conf*100)}% sure</div>${pv.flags.map(f=>`<div class="warn">${esc(flagTxt(f))}</div>`).join('')}</div>`):'';
 return `<h2>Auto transaction detection</h2>
 <div class="card"><h3>How it saves</h3>${[['review','Review before saving (recommended)'],['auto','Save confident ones automatically'],['manual','Manual only: detect nothing in the background']].map(([v,l])=>`<label style="display:flex;gap:10px;align-items:center;font-weight:400"><input type="radio" name="am" style="width:auto;min-height:0" value="${v}" ${a.mode===v?'checked':''} onchange="setAutoMode(this.value)"> ${l}</label>`).join('')}
 <p class="mut">Automatic saving only applies to messages from known banks and wallets that match exactly one of your accounts, with no warnings. Everything else waits for your review.</p></div>
 <div class="card"><h3>Phone notifications</h3>${isApk()?`<p class="mut" id="nstat">Checking access…</p><p class="mut">If Android shows a "Restricted setting" message, open Android Settings → Apps → Khata → ⋮ → <b>Allow restricted settings</b>, then try again.</p><div class="row"><button class="p" onclick="openNotifSettings()">Open notification access</button><button onclick="togglePause()">${a.paused?'Resume detection':'Pause detection'}</button></div>`
  :`<p class="mut">Reading messages automatically needs the Android APK app, because a web app cannot see other apps' notifications. In the web app, paste or share a message below.</p>`}
 <p class="mut"><b>What is accessed:</b> only notification text that contains an amount and a debit/credit word. OTPs and promotions are dropped. Nothing is uploaded. Original text is kept only while an item waits for review, and is deleted once you save or reject it.</p></div>
 <div class="card"><h3>Paste a message</h3><label for="ad">Message text</label><textarea id="ad" rows="4" maxlength="1000" oninput="AUTO.draft=this.value">${esc(AUTO.draft)}</textarea>
 <label for="as">Sender (optional, e.g. NABIL)</label><input id="as" maxlength="40" value="${esc(AUTO.sender)}" oninput="AUTO.sender=this.value">
 <div class="row" style="margin-top:8px"><button onclick="autoPreview()">Preview only</button><button class="p" onclick="autoImport()">Detect &amp; add</button></div><div class="err" id="ae" role="alert"></div>${pvH}
 <div class="mut" style="margin-top:8px">Try a sample (no real data):</div><div>${SAMPLES.map((s,i)=>`<button class="s" onclick="useSample(${i})">${esc(s[0])}</button> `).join('')}</div></div>
 <div class="card"><h3>Waiting for review (${pend.length})</h3>${pend.map(r=>recCard(r)).join('')||'<p class="mut">Nothing waiting.</p>'}</div>
 <div class="card"><h3>Imported history</h3>${hist.map(r=>recCard(r,1)).join('')||'<p class="mut">No imports yet.</p>'}
 <button class="d" style="margin-top:8px" onclick="clearImports()">Delete imported message data</button><p class="mut">This removes the detection history and duplicate memory only. Your transactions are not touched.</p></div>`}
function setAutoMode(v){CFG.auto.mode=v;saveCfg();render()}
async function togglePause(){CFG.auto.paused=!CFG.auto.paused;try{await plug().setPaused({paused:CFG.auto.paused})}catch{}saveCfg();render()}
async function openNotifSettings(){try{await plug().openSettings()}catch(e){toast('Could not open settings: '+e.message)}}
async function refreshNative(){const el=$('#nstat');if(!el||!isApk())return;try{const s=await plug().status();el.textContent=s.enabled?(CFG.auto.paused||CFG.auto.mode==='manual'?'Access is on, but detection is paused.':'Notification access is on. Detection is active.'):'Notification access is off. Tap the button and allow Khata.'}catch{el.textContent='Notification reader is not available in this build.'}}
function autoPreview(){const t=AUTO.draft.trim();if(!t)return $('#ae').textContent='Paste a message first.';AUTO.preview=Sms.parseSms(t,{sender:AUTO.sender,now:Date.now()});render()}
async function autoImport(){const t=AUTO.draft.trim();if(!t)return $('#ae').textContent='Paste a message first.';
 try{const r=await processIncoming({text:t,sender:AUTO.sender.trim(),at:Date.now(),src:'paste'});AUTO.preview=null;
  if(r.outcome==='duplicate'){if(confirm('This message was already imported. Import it again as a separate entry?')){await processIncoming({text:t,sender:AUTO.sender.trim(),at:Date.now(),src:'paste',force:true});toast('Added for review')}}
  else if(r.outcome==='ignored')toast('Ignored: '+(IGN[r.reason]||r.reason));else toast(r.outcome==='saved'?'Saved to Khata':'Added to the review list');
  AUTO.draft='';render()}catch(e){$('#ae').textContent='Could not save: '+e.message}}
function useSample(i){AUTO.draft=SAMPLES[i][1];AUTO.sender=SAMPLES[i][2];AUTO.preview=Sms.parseSms(AUTO.draft,{sender:AUTO.sender,now:Date.now()});render()}
function reviewRec(k){const r=IMPORTS.find(x=>x.key===k);if(!r)return;const p=r.parsed;openForm(null,{type:p.type||'expense',amt:p.amt,date:p.date||today(),acc:p.acc||'',cat:p.refund?'Refunds & reimbursements':'',party:p.party,note:'',importKey:k})}
async function rejectRec(k){const r=IMPORTS.find(x=>x.key===k);if(!r||!confirm('Reject this detected transaction? Nothing will be added to Khata.'))return;
 try{const n={...r,status:'rejected',text:''};await DB.commit({putImports:[n]});IMPORTS=IMPORTS.map(x=>x.key===k?n:x);render()}catch(e){toast('Could not reject: '+e.message)}}
async function removeAuto(k){const r=IMPORTS.find(x=>x.key===k);if(!r||!confirm('Remove the transaction that was created from this message?'))return;
 try{const n={...r,status:'rejected',txId:'',text:''};await DB.commit({delTx:[r.txId],putImports:[n]});TX=TX.filter(t=>t.id!==r.txId);IMPORTS=IMPORTS.map(x=>x.key===k?n:x);render();toast('Entry removed')}catch(e){toast('Could not remove: '+e.message)}}
async function clearImports(){if(!confirm('Delete all detection history and duplicate memory? Your transactions stay.'))return;try{await DB.commit({clearImports:true});IMPORTS=[];render();toast('Deleted')}catch(e){toast('Could not delete: '+e.message)}}
let draining=false;
async function drainNative(){if(!nativeOn()||draining||!DB.ok)return;draining=true;
 try{const {events}=await plug().drain();const done=[];
  for(const ev of events||[]){try{await processIncoming({text:String(ev.text||''),sender:String(ev.sender||''),id:String(ev.id||''),at:+ev.at||Date.now(),src:'notification'});done.push(ev.id)}catch{break}}
  if(done.length)await plug().ack({ids:done});if(done.length&&['auto','dash'].includes(S.view))render()}catch{}finally{draining=false}}
function startNative(){if(!isApk())return;const go2=()=>{drainNative();refreshNative()};go2();setInterval(go2,8000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)go2()})}

/* ===== updates (installed web app) =====
   version.json (published by CI together with the new files) tells us the latest version.
   "Update now" downloads the new service worker, waits until it is fully installed, then activates it and reloads once. */
let APP_VERSION='__VERSION__';const isDev=()=>APP_VERSION.startsWith('__');
let swReg=null,UPD_TIMEOUT=45000,updRel=null,updBusy=false,hadCtl=false;const memS={};
const store={get(k){try{return localStorage.getItem(k)}catch{return memS[k]||null}},set(k,v){try{localStorage.setItem(k,v)}catch{memS[k]=v}}};
const isApk=()=>!!(window.Capacitor&&Capacitor.isNativePlatform&&Capacitor.isNativePlatform());
function setUpd(msg,o={}){const s=$('#updS');s.textContent=msg;s.className=o.err?'err':'mut';$('#updB').disabled=!!o.busy;$('#updL').disabled=!!o.busy;$('#updB').textContent=o.retry?'Retry':'Update now';$('#upd').classList.toggle('busy',!!o.busy)}
function showUpdate(rel){updRel=rel;const req=!!rel.minVersion&&Core.cmpVer(APP_VERSION,rel.minVersion)<0;
 $('#updV').textContent=`Version ${rel.version} is available (you have ${APP_VERSION}).`;
 const ul=$('#updN');ul.textContent='';rel.notes.forEach(n=>{const li=document.createElement('li');li.textContent=n;ul.appendChild(li)});
 $('#updL').hidden=req;setUpd(req?'This update is required to keep the app working. Your records are not changed.':'Your records stay on this phone and are not changed.');
 $('#upd').hidden=false;$('#updB').focus()}
async function checkRelease(manual){
 if(isDev())return manual?toast('Development build: update checks are off.'):0;
 if(updBusy||(!manual&&!$('#upd').hidden))return;
 try{const r=await fetch('version.json',{cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);
  const t=await r.text();if(t.length>20000)throw new Error('Update information is too large');
  const rel=Core.validateRelease(JSON.parse(t));if(!rel)throw new Error('Update information is invalid');
  if(Core.cmpVer(rel.version,APP_VERSION)>0){
   const req=rel.minVersion&&Core.cmpVer(APP_VERSION,rel.minVersion)<0;
   if(manual||req||store.get('khata.later')!==rel.version)showUpdate(rel);
   return 'newer'}
  if(manual)toast(`You have the latest version (${APP_VERSION}).`)
 }catch(e){if(manual)toast(navigator.onLine?'Could not check for updates: '+e.message:'You are offline. Try again when connected.')}}
function waitForWaiting(reg,ms){return new Promise((res,rej)=>{
 if(reg.waiting)return res(reg.waiting);
 const t=setTimeout(()=>rej(new Error('The new version is not available yet. Wait a minute, then tap Retry.')),ms);
 const watch=w=>w&&w.addEventListener('statechange',()=>{
  if(w.state==='installed'){clearTimeout(t);res(reg.waiting||w)}
  else if(w.state==='redundant'){clearTimeout(t);rej(new Error('The update could not be installed. Tap Retry.'))}});
 watch(reg.installing);reg.addEventListener&&reg.addEventListener('updatefound',()=>watch(reg.installing))})}
async function applyUpdate(){
 if(updBusy)return;
 if($('#dlg').open||S.busy)return setUpd('Finish or cancel the open entry first, then tap Update now.',{err:1});
 if(isApk())return setUpd('This APK cannot update itself. Install the newer APK, or use the installed web app, which updates itself.',{err:1});
 if(!navigator.onLine)return setUpd('You are offline. Connect to the internet, then tap Retry.',{err:1,retry:1});
 if(!swReg)return setUpd('Updates work in the installed web app. Open it from your home screen.',{err:1});
 updBusy=true;setUpd('Downloading the update…',{busy:1});
 try{await swReg.update();const w=await waitForWaiting(swReg,UPD_TIMEOUT);
  setUpd('Installing…',{busy:1});store.set('khata.later','');w.postMessage('SKIP_WAITING');
  setTimeout(()=>{if(updBusy){updBusy=false;setUpd('The update did not finish. Close and reopen the app, then try again.',{err:1,retry:1})}},15000)}
 catch(e){updBusy=false;setUpd(e.message||'Update failed.',{err:1,retry:1})}}
function laterUpdate(){if(updRel)store.set('khata.later',updRel.version);$('#upd').hidden=true}
function initSW(){
 $('#updB').onclick=applyUpdate;$('#updL').onclick=laterUpdate;
 if(!('serviceWorker' in navigator)||isApk())return;
 hadCtl=!!navigator.serviceWorker.controller;
 navigator.serviceWorker.register('sw.js').then(reg=>{
  swReg=reg;const poll=()=>{reg.update().catch(()=>{});checkRelease(false)};
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll()});setInterval(poll,3600000);
  reg.addEventListener('updatefound',()=>{const w=reg.installing;if(w)w.addEventListener('statechange',()=>{if(w.state==='installed'&&navigator.serviceWorker.controller)checkRelease(false)})})
 }).catch(()=>{});
 navigator.serviceWorker.addEventListener('controllerchange',()=>{if(!hadCtl)return;let last=0;try{last=+sessionStorage.getItem('khata.rl')||0}catch{}
  if(Date.now()-last<10000)return;try{sessionStorage.setItem('khata.rl',String(Date.now()))}catch{}location.reload()})}
async function checkUpdate(){
 if(isApk())return toast('This APK only changes when you install a new APK. The installed web app updates itself.');
 if(!isDev()&&!swReg)return toast('Updates work in the installed web app. Open it from your home screen.');
 if(swReg)swReg.update().catch(()=>{});
 return checkRelease(true)}
(async()=>{
 try{await DB.open();const r=await Core.loadOrInit(DB);CFG=r.cfg;TX=r.tx;IMPORTS=r.imports}
 catch(e){DB.ok=false;STORAGE_ERR=e&&e.message||'Storage could not be opened.'}
 if(navigator.storage&&navigator.storage.persist)navigator.storage.persist().catch(()=>{});
 render();initSW();checkRelease(false);startNative()})();

