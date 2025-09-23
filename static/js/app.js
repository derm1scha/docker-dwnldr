// docker-dwnldr with Windows/Linux tabs and per-OS command files
const BASE_PATH_DEFAULT_RAW = (document.body.dataset.basePath || "/");
const BASE_PATH_DEFAULT = BASE_PATH_DEFAULT_RAW.endsWith("/") ? BASE_PATH_DEFAULT_RAW : (BASE_PATH_DEFAULT_RAW + "/");
const APP_PORT = parseInt(document.body.dataset.appPort || "3000", 10);
const LS_KEY = 'manualIpOverride';

const ipText = document.getElementById('ipText');
const refreshIpBtn = document.getElementById('refreshIpBtn');
const editBtn = document.getElementById('editBtn');
const ipEditRow = document.getElementById('ipEditRow');
const ipInput = document.getElementById('ipInput');
const saveIpBtn = document.getElementById('saveIpBtn');
const clearManualBtn = document.getElementById('clearManualBtn');
const manualNotice = document.getElementById('manualNotice');

const fileSelect = document.getElementById('fileSelect');
const refreshFilesBtn = document.getElementById('refreshFilesBtn');
const autoRefreshFiles = document.getElementById('autoRefreshFiles');

const filenameEl = document.getElementById('filename');
const fallbackPortEl = document.getElementById('fallbackPort');

const filePortEl = document.getElementById('filePort');
const startFileBtn = document.getElementById('startFileBtn');
const stopFileBtn = document.getElementById('stopFileBtn');
const fileSrvStatusEl = document.getElementById('fileSrvStatus');
const portsInfoEl = document.getElementById('portsInfo');

const refreshLogsBtn = document.getElementById('refreshLogsBtn');
const autoRefreshLogs = document.getElementById('autoRefreshLogs');
const clearLogsBtn = document.getElementById('clearLogsBtn');
const logsTbody = document.getElementById('logsTbody');

const reloadCmdBtn = document.getElementById('reloadCmdBtn');
const commandsColumn = document.getElementById('commandsColumn');
const tabButtons = document.querySelectorAll('.tab-btn');

let manualOverride = localStorage.getItem(LS_KEY) || '';
let filesTimer = null;
let logsTimer = null;
let fileSrv = { running: false, port: null };
let commandsData = { groups: [] };
let currentOS = localStorage.getItem('osTab') || 'windows';

function setManualIndicator(on){ manualNotice.style.display = on ? 'block' : 'none'; if (on) ipText.textContent = manualOverride; }
function copyTextUniversal(text){
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  return new Promise((resolve,reject)=>{ try{ const ta=document.createElement('textarea'); ta.value=text; ta.setAttribute('readonly',''); ta.style.position='fixed'; ta.style.top='-1000px'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); resolve(); } catch(e){ reject(e); } });
}
async function detectIP(){
  if (manualOverride){ setManualIndicator(true); render(); return; }
  ipText.textContent='detecting…';
  try{ const r=await fetch('/api/ip',{cache:'no-store'}); const j=await r.json(); if(j&&j.ip){ ipText.textContent=j.ip; ipText.dataset.detectedIp=j.ip; ipInput.value=j.ip; } else { ipText.textContent='not found'; ipText.dataset.detectedIp=''; } }
  catch{ ipText.textContent='error'; ipText.dataset.detectedIp=''; }
  setManualIndicator(false); render();
}
async function loadFiles(){
  try{ const r=await fetch('/api/files',{cache:'no-store'}); const j=await r.json(); const files=Array.isArray(j.files)?j.files:[];
    fileSelect.innerHTML=''; const ph=document.createElement('option'); ph.value=''; ph.textContent=files.length?'— select file —':'(no files found)'; fileSelect.appendChild(ph);
    for (const f of files){ const o=document.createElement('option'); o.value=f; o.textContent=f; fileSelect.appendChild(o); } }
  catch{ fileSelect.innerHTML='<option value="">(error loading)</option>'; }
}
function startFilesAutoRefresh(){ if (filesTimer) clearInterval(filesTimer); if (autoRefreshFiles.checked) filesTimer=setInterval(loadFiles,5000); }
async function updateFileSrvStatus(){
  try{ const r=await fetch('/api/file-listener',{cache:'no-store'}); const j=await r.json(); fileSrv={running:!!j.running, port:j.port||null}; }
  catch{ fileSrv={running:false, port:null}; }
  if (!filePortEl.value) filePortEl.value = fileSrv.port || 8443;
  fileSrvStatusEl.textContent = fileSrv.running ? `Running on :${fileSrv.port}` : 'Stopped';
  const parts=[`UI:${document.body.dataset.appPort}`]; if(fileSrv.running) parts.push(`Files:${fileSrv.port}`); portsInfoEl.textContent=parts.join('  |  ');
  render();
}
async function startFileSrv(){ const p=parseInt(filePortEl.value||"8443",10); const res=await fetch(`/api/file-listener/start?port=${encodeURIComponent(p)}`,{method:'POST'}); const j=await res.json(); if(!res.ok){ fileSrvStatusEl.textContent=`Error: ${j.error||'failed'}`; } await updateFileSrvStatus(); await loadLogs(); }
async function stopFileSrv(){ await fetch('/api/file-listener/stop',{method:'POST'}); await updateFileSrvStatus(); }

function getState(){
  const ip=(manualOverride||ipText.textContent||'').trim();
  const filename=(filenameEl.value||'').trim()||fileSelect.value||'';
  const fallbackPortRaw=(fallbackPortEl.value||'').trim();
  const fallbackPort=fallbackPortRaw===''?'':String(Math.max(1,Math.min(65535,Number(fallbackPortRaw)||0)));
  return { ip, filename, fallbackPort };
}
function buildURL(ip, effectivePort, basePath, filename){
  if(!ip||!filename) return '';
  const enc=encodeURIComponent(filename);
  const portSeg=effectivePort && effectivePort!=='80'?':'+effectivePort:'';
  const base=basePath.endsWith("/")?basePath:(basePath+"/");
  return `http://${ip}${portSeg}${base}${enc}`;
}

// SAFE template substitution (no $-magic)
function safeReplaceAll(haystack, needle, replacement) {
  const h = String(haystack ?? '');
  const n = String(needle ?? '');
  if (!n) return h;
  return h.split(n).join(String(replacement ?? ''));
}
function substituteTemplate(tpl, vars){
  let s = String(tpl ?? '');
  s = safeReplaceAll(s, '{{url}}', vars.url);
  s = safeReplaceAll(s, '{{filename}}', vars.filename);
  s = safeReplaceAll(s, '{{ip}}', vars.ip);
  s = safeReplaceAll(s, '{{port}}', vars.port);
  s = safeReplaceAll(s, '{{base}}', vars.base);
  return s;
}

async function loadCommands(){
  const r=await fetch(`/api/commands?os=${encodeURIComponent(currentOS)}&ts=${Date.now()}`,{cache:'no-store'});
  commandsData=await r.json();
  renderCommandsSkeleton();
  render();
}
function renderCommandsSkeleton(){
  commandsColumn.innerHTML='';
  (commandsData.groups||[]).forEach((g,gi)=>{
    const sec=document.createElement('div'); sec.className='section';
    const h=document.createElement('h3'); h.innerHTML=`${escapeHtml(g.title||'Commands')}${g.tag?` <span class="tag">${escapeHtml(g.tag)}</span>`:''}`; sec.appendChild(h);
    (g.items||[]).forEach((item,ii)=>{
      const id=`cmd_${gi}_${ii}`;
      const pre=document.createElement('pre');
      const btn=document.createElement('button'); btn.className='btn copy'; btn.setAttribute('data-copy', id); btn.textContent='Copy';
      const code=document.createElement('code'); code.id=id; code.textContent=item.template||'';
      pre.appendChild(btn); pre.appendChild(code); sec.appendChild(pre);
    });
    commandsColumn.appendChild(sec);
  });
}
function escapeHtml(s){ return (s||'').toString().replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'); }
function render(){
  const { ip, filename, fallbackPort } = getState();
  const effectivePort = fileSrv.running ? String(fileSrv.port) : (fallbackPort || document.body.dataset.appPort);
  const basePath = fileSrv.running ? "/" : BASE_PATH_DEFAULT;
  const url = buildURL(ip, effectivePort, basePath, filename);
  const vars = { ip, filename, port: effectivePort || '', base: basePath, url };
  (commandsData.groups||[]).forEach((g,gi)=>{ (g.items||[]).forEach((item,ii)=>{ const codeEl=document.getElementById(`cmd_${gi}_${ii}`); if(!codeEl) return; codeEl.textContent = substituteTemplate(item.template||'', vars); }); });
}

async function loadLogs(){
  try{ const r=await fetch('/api/file-listener/logs?limit=200&ts='+Date.now(),{cache:'no-store'}); const j=await r.json(); const logs=Array.isArray(j.logs)?j.logs:[];
    if(!logs.length){ logsTbody.innerHTML='<tr><td colspan="5" class="muted">No data</td></tr>'; return; }
    logsTbody.innerHTML=logs.map(e=>{ const esc=s=>(s||'').toString().replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'); const n=parseInt(e.code||'',10); const cc=isNaN(n)?'':(n>=500?'code-5xx':n>=400?'code-4xx':n>=300?'code-3xx':'code-2xx'); return `<tr><td>${esc(e.time)}</td><td>${esc(e.client)}</td><td>${esc(e.method)}</td><td style="word-break:break-all;">${esc(e.path)}</td><td class="${cc}">${esc(e.code)}</td></tr>`; }).join(''); }
  catch{ logsTbody.innerHTML='<tr><td colspan="5" class="muted">Error loading</td></tr>'; }
}
function startFilesAutoRefresh(){ if (filesTimer) clearInterval(filesTimer); if (autoRefreshFiles.checked) filesTimer=setInterval(loadFiles,5000); }
function startLogsAutoRefresh(){ if (logsTimer) clearInterval(logsTimer); if (autoRefreshLogs.checked) logsTimer=setInterval(loadLogs,2000); }
async function clearLogs(){ await fetch('/api/file-listener/logs/clear',{method:'POST'}); await loadLogs(); }

// Tab handling
function setActiveTab(osName){
  currentOS = osName;
  localStorage.setItem('osTab', currentOS);
  tabButtons.forEach(b=> b.classList.toggle('active', b.dataset.os === osName));
  loadCommands();
}

document.addEventListener('input', render);
document.body.addEventListener('click', (e)=>{ const btn=e.target.closest('button.copy'); if(!btn) return; const id=btn.getAttribute('data-copy'); const codeEl=document.getElementById(id); if(!codeEl) return; copyTextUniversal(codeEl.textContent).then(()=>{ const old=btn.textContent; btn.textContent='Copied!'; setTimeout(()=>btn.textContent=old,900); }).catch(()=>{}); });
refreshIpBtn.addEventListener('click', ()=>{ manualOverride=localStorage.getItem(LS_KEY)||''; detectIP(); });
editBtn.addEventListener('click', ()=>{ const cur=ipText.textContent.trim(); ipEditRow.style.display=(ipEditRow.style.display==='none'||!ipEditRow.style.display)?'block':'none'; ipInput.value=manualOverride||(cur&&cur!=='not found'&&cur!=='detecting…'&&cur!=='error'?cur:''); ipInput.focus(); });
saveIpBtn.addEventListener('click', ()=>{ const val=ipInput.value.trim(); if(val){ manualOverride=val; localStorage.setItem(LS_KEY,val); ipText.textContent=val; setManualIndicator(true); ipEditRow.style.display='none'; render(); } });
clearManualBtn.addEventListener('click', ()=>{ localStorage.removeItem(LS_KEY); manualOverride=''; setManualIndicator(false); detectIP(); });

fileSelect.addEventListener('change', ()=>{ if (fileSelect.value){ filenameEl.value=fileSelect.value; render(); } });
refreshFilesBtn.addEventListener('click', loadFiles);
autoRefreshFiles.addEventListener('change', startFilesAutoRefresh);

startFileBtn.addEventListener('click', startFileSrv);
stopFileBtn.addEventListener('click', stopFileSrv);

refreshLogsBtn.addEventListener('click', loadLogs);
autoRefreshLogs.addEventListener('change', startLogsAutoRefresh);
clearLogsBtn.addEventListener('click', clearLogs);

reloadCmdBtn.addEventListener('click', loadCommands);
tabButtons.forEach(btn => btn.addEventListener('click', ()=> setActiveTab(btn.dataset.os)));

// init
detectIP(); loadFiles(); startFilesAutoRefresh(); updateFileSrvStatus(); loadLogs(); startLogsAutoRefresh();
setActiveTab(currentOS);
