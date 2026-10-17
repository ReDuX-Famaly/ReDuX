const buttons = document.querySelectorAll('.nav-item[data-page]');
const pages = document.querySelectorAll('.page');
const title = document.getElementById('pageTitle');
const titles = {home:'Главная',mods:'Redux',settings:'Настройки',profile:'Профиль'};
const USER_KEY='reduxUser', USERS_KEY='reduxUsers', MODS_KEY='reduxMods', UPDATES_KEY='reduxUpdates', SESSION_KEY='reduxSession', SETTINGS_KEY='reduxSettings';
const defaultUser={name:'Гость',login:'guest',nickname:'Гость',bio:'Гостевой аккаунт.',role:'Гость',admin:false,guest:true,avatar:''};
let user=load(USER_KEY)||defaultUser;
let pendingModIcon=null,pendingModVideo=null,pendingModFile=null,currentDetail=null;
let remoteMods=[];

// Optional realtime backend: only the chat uses Supabase. If config is empty, the local chat fallback remains active.
let sb = null;
let chatRealtimeChannel = null;
let remoteChatUsers = [];
function realtimeEnabled(){return !!(window.REDUX_SUPABASE?.url && window.REDUX_SUPABASE?.anonKey && window.supabase?.createClient)}
function initRealtime(){if(realtimeEnabled()&&!sb) sb=window.supabase.createClient(window.REDUX_SUPABASE.url,window.REDUX_SUPABASE.anonKey); return !!sb}
async function syncPublicUser(){
  if(!initRealtime()||user.guest)return;
  try{await sb.from('profiles').upsert({login:normLogin(user.login),nickname:user.nickname||user.login,avatar:user.avatar||''},{onConflict:'login'});}catch(e){console.warn('ReDuX realtime profile sync:',e)}
}
async function loadRemoteChatUsers(){
  if(!initRealtime()||user.guest)return null;
  try{const {data,error}=await sb.from('profiles').select('login,nickname,avatar').order('login'); if(error) throw error; remoteChatUsers=data||[]; return remoteChatUsers;}catch(e){console.warn('ReDuX realtime user search:',e); return null;}
}
function stopChatRealtime(){if(sb&&chatRealtimeChannel){sb.removeChannel(chatRealtimeChannel);chatRealtimeChannel=null}}
async function startChatRealtime(){
  if(!initRealtime()||user.guest)return;
  stopChatRealtime();
  chatRealtimeChannel=sb.channel('redux-chat-'+normLogin(user.login))
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:`receiver=eq.${normLogin(user.login)}`},payload=>{
      const m=payload.new; if(!m||m.sender===normLogin(user.login))return; renderChat();
    }).subscribe();
}
async function loadRemoteMessages(other){
  if(!initRealtime()||!other)return null;
  const me=normLogin(user.login), them=normLogin(other);
  try{
    const {data,error}=await sb.from('messages').select('sender,receiver,text,created_at').or(`and(sender.eq.${me},receiver.eq.${them}),and(sender.eq.${them},receiver.eq.${me})`).order('created_at',{ascending:true});
    if(error) throw error;
    return (data||[]).map(m=>({author:m.sender,text:m.text,date:new Date(m.created_at).toLocaleString('ru-RU')}));
  }catch(e){console.warn('ReDuX realtime message load:',e); return null;}
}
async function sendRemoteMessage(other,text){
  if(!initRealtime()||!other)return false;
  try{const {error}=await sb.from('messages').insert({sender:normLogin(user.login),receiver:normLogin(other),text}); if(error)throw error; return true;}catch(e){console.warn('ReDuX realtime message send:',e); return false;}
}


let cloudReady=false;
let cloudSyncing=false;
const CLOUD_KEYS=[USERS_KEY,MODS_KEY,UPDATES_KEY,BANS_KEY,SUPPORT_KEY];
function load(k, fallback=null){try{const v=localStorage.getItem(k);return v?JSON.parse(v):fallback}catch{return fallback}}
function save(k,v){
  localStorage.setItem(k,JSON.stringify(v));
  if(cloudReady && CLOUD_KEYS.includes(k)) syncCloudState(k,v);
}
async function syncCloudState(key,value){
  if(!initRealtime()||cloudSyncing)return;
  try{await sb.from('app_state').upsert({key,data:value,updated_at:new Date().toISOString()},{onConflict:'key'});}catch(e){console.warn('ReDuX cloud sync:',e)}
}
async function uploadAsset(file,folder){
  if(!initRealtime()||!file)return '';
  try{
    const safe=(file.name||'file').replace(/[^a-zA-Z0-9._-]/g,'_');
    const path=`${folder}/${normLogin(user.login)}-${Date.now()}-${safe}`;
    const {error}=await sb.storage.from('redux-assets').upload(path,file,{upsert:false,contentType:file.type||'application/octet-stream'});
    if(error) throw error;
    const {data}=sb.storage.from('redux-assets').getPublicUrl(path);
    return data?.publicUrl||'';
  }catch(e){console.warn('ReDuX asset upload:',e);return ''}
}
async function hydrateCloudState(){
  if(!initRealtime())return;
  try{
    const {data,error}=await sb.from('app_state').select('key,data');
    if(error) throw error;
    const remoteKeys=new Set((data||[]).map(r=>r.key));
    cloudSyncing=true;
    (data||[]).forEach(r=>{if(CLOUD_KEYS.includes(r.key)) localStorage.setItem(r.key,JSON.stringify(r.data));});
    cloudSyncing=false;
    cloudReady=true;
    const users=getUsers();
    if(!users.worixy){users.worixy={name:'Worixy',login:'Worixy',nickname:'Worixy',password:'Worixy123',bio:'',role:'Президент',admin:true,guest:false,avatar:''};localStorage.setItem(USERS_KEY,JSON.stringify(users));}
    // First launch: migrate the existing local collections to the shared database.
    for(const [k,v] of [[USERS_KEY,getUsers()],[MODS_KEY,getMods()],[UPDATES_KEY,getUpdates()],[BANS_KEY,getBans()],[SUPPORT_KEY,getTickets()]]){
      if(!remoteKeys.has(k)) await syncCloudState(k,v);
    }
    const sess=load(SESSION_KEY,null);
    if(sess&&!sess.guest){const u=getUsers()[normLogin(sess.login)];if(u&&!u.banned){user={...u,guest:false};save(USER_KEY,user)}}
    applyUser();
  }catch(e){cloudReady=false;console.warn('ReDuX cloud bootstrap:',e)}
}
function startCloudRealtime(){
  if(!initRealtime())return;
  const channel=sb.channel('redux-global-state')
    .on('postgres_changes',{event:'*',schema:'public',table:'app_state'},payload=>{
      const row=payload.new; if(!row||!CLOUD_KEYS.includes(row.key))return;
      cloudSyncing=true;localStorage.setItem(row.key,JSON.stringify(row.data));cloudSyncing=false;
      if(row.key===USERS_KEY){const u=getUsers()[normLogin(user.login)];if(u&&!user.guest){user={...u,guest:false};localStorage.setItem(USER_KEY,JSON.stringify(user));}}
      renderMods();renderUpdates();renderAdminUsers();renderAdminBans();renderSupport();
    }).subscribe();
  window.reduxCloudChannel=channel;
}
function normLogin(v){return String(v||'').trim().toLowerCase()}
function getUsers(){
  const raw=load(USERS_KEY,{})||{}, clean={};
  Object.keys(raw).forEach(k=>{const u=raw[k];const login=normLogin(u?.login||k);if(login && !clean[login]) clean[login]={...u,login:u.login||k};});
  if(JSON.stringify(raw)!==JSON.stringify(clean)) save(USERS_KEY,clean);
  return clean;
}
function ensureAdmin(){
  const users=getUsers();
  const key='worixy';
  if(!users[key]) users[key]={name:'Worixy',login:'Worixy',nickname:'Worixy',password:'Worixy123',bio:'',role:'Президент',admin:true,guest:false,avatar:''};
  else {users[key]={...users[key],login:'Worixy',admin:true,role:'Президент',guest:false};}
  save(USERS_KEY,users);
}

const BANS_KEY='reduxBans', SUPPORT_KEY='reduxSupport', CHAT_KEY='reduxChats';
function saveUsers(v){save(USERS_KEY,v)}
function getBans(){return load(BANS_KEY,[])||[]}
function getTickets(){return load(SUPPORT_KEY,[])||[]}
function getChats(){return load(CHAT_KEY,[])||[]}
function isPresident(){return normLogin(user.login)==='worixy' && !user.guest}
function roleName(u){return u?.role || (normLogin(u?.login)==='worixy'?'Президент':u?.guest?'Гость':'Игрок')}
function canManageRedux(){return isPresident() || ['Вице-президент','Заместитель президента'].includes(user.role)}
function canPublishRedux(){return canManageRedux() && !user.guest}

function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function setAvatar(el,avatar,fallback){if(!el)return;if(avatar){el.style.backgroundImage=`url("${avatar}")`;el.style.backgroundSize='cover';el.style.backgroundPosition='center';el.textContent=''}else{el.style.backgroundImage='';el.textContent=fallback}}
function syncRole(){user.admin=String(user.login||'').toLowerCase()==='worixy';if(user.guest){user.admin=false;user.role='Гость';} else if(String(user.login||'').toLowerCase()==='worixy'){user.admin=true;user.role='Президент';} else {user.admin=false; if(!['Вице-президент','Заместитель президента'].includes(user.role))user.role='Игрок';}}
function applyUser(){
 syncRole(); save(USER_KEY,user);
 if(!user.guest){syncPublicUser(); startChatRealtime();}
 const n=user.nickname||user.login||'Гость', l=user.login||'guest', f=n[0]?.toUpperCase()||'Г';
 document.getElementById('sidebarNickname').textContent=n;document.getElementById('sidebarRole').textContent=user.role;
 document.getElementById('profileNickname').textContent=n;document.getElementById('profileLogin').textContent=l;document.getElementById('profileUsername').textContent='@'+l;document.getElementById('profileName').textContent=user.name||'—';document.getElementById('profileRole').textContent=user.role;document.getElementById('profileBio').textContent=user.bio||'Пока ничего не указано.';
 const edit=document.getElementById('editProfile');if(edit)edit.style.display=user.guest?'none':'inline-flex';
 document.body.classList.toggle('guest-mode',!!user.guest);document.querySelectorAll('.auth-only-nav').forEach(el=>el.style.display=user.guest?'none':'flex');const sideLogout=document.getElementById('sidebarLogout');if(sideLogout)sideLogout.textContent=user.guest?'↪  Войти в аккаунт':'↪  Выйти из аккаунта';document.getElementById('topNickname').textContent=n;document.getElementById('topLogin').textContent='@'+l;
 setAvatar(document.querySelector('.user-card .avatar'),user.avatar,f);setAvatar(document.getElementById('topAvatar'),user.avatar,f);setAvatar(document.getElementById('profileAvatar'),user.avatar,f);setAvatar(document.getElementById('modalAvatar'),user.avatar,f);
 const an=document.getElementById('openAdmin');if(an)an.style.display=canManageRedux()?'flex':'none';const ab=document.getElementById('adminBadge');if(ab)ab.style.display=user.admin?'inline-flex':'none';
 renderMods();renderUpdates();
}
function getMods(){return load(MODS_KEY,[])||[]}
function refreshModsFromServer(){renderMods()}
function getUpdates(){return load(UPDATES_KEY,[])||[]}
function showPage(page){buttons.forEach(b=>b.classList.toggle('active',b.dataset.page===page));pages.forEach(p=>p.classList.toggle('active',p.id===page));title.textContent=titles[page]||'Главная'}
buttons.forEach(b=>b.addEventListener('click',()=>showPage(b.dataset.page)));
document.getElementById('openAdmin')?.addEventListener('click',()=>{if(!canManageRedux())return;openModal('adminModal');renderAdminUsers();renderAdminBans();renderMods();});

function openModal(id){document.getElementById(id)?.classList.add('open')}function closeModal(id){document.getElementById(id)?.classList.remove('open')}
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>closeModal(b.dataset.close)));
document.querySelectorAll('.modal-backdrop').forEach(x=>x.addEventListener('click',e=>{if(e.target===x&&x.id!=='authModal')x.classList.remove('open')}));

// Auth: password only, persisted locally.
const authTabs=document.querySelectorAll('.auth-tab');const loginScreen=document.getElementById('loginScreen'),registerScreen=document.getElementById('registerScreen');
function setAuthMode(mode){authTabs.forEach(t=>t.classList.toggle('active',t.dataset.auth===mode));loginScreen.classList.toggle('active',mode==='login');registerScreen.classList.toggle('active',mode==='register')}
authTabs.forEach(t=>t.addEventListener('click',()=>{setAuthMode(t.dataset.auth);authError('loginError','');authError('registerError','')}));
function authError(id,msg){const el=document.getElementById(id);if(el){el.textContent=msg||'';el.classList.toggle('show',!!msg)}}
document.getElementById('loginContinue').addEventListener('click',()=>{
 authError('loginError','');
 const login=document.getElementById('loginUsername').value.trim(),pass=document.getElementById('loginPassword').value;
 if(!login||!pass)return authError('loginError','Заполни логин и пароль.');
 const users=getUsers(),u=users[normLogin(login)];
 if(!u)return authError('loginError','Такого аккаунта не существует.');
 if(u.password!==pass)return authError('loginError','Неверный пароль.');
 if(u.banned)return authError('loginError',`Аккаунт заблокирован.${u.banReason?` Причина: ${u.banReason}`:''}`);
 user={...u,guest:false,login:u.login};save(SESSION_KEY,{login:normLogin(u.login)});applyUser();closeModal('authModal');
});
document.getElementById('registerContinue').addEventListener('click',()=>{
 authError('registerError','');
 const name=document.getElementById('registerName').value.trim(),login=document.getElementById('registerUsername').value.trim(),p=document.getElementById('registerPassword').value,p2=document.getElementById('registerPassword2').value;
 if(!name||!login||!p)return authError('registerError','Заполни все поля.');
 if(p.length<6)return authError('registerError','Пароль должен содержать минимум 6 символов.');
 if(p!==p2)return authError('registerError','Пароли не совпадают.');
 const key=normLogin(login);if(key==='worixy')return authError('registerError','Этот логин зарезервирован.');
 const users=getUsers();if(users[key])return authError('registerError','Этот логин уже зарегистрирован.');
 const u={name,login:login,nickname:login,password:p,bio:'',role:'Игрок',admin:false,guest:false,avatar:''};users[key]=u;save(USERS_KEY,users);user=u;save(SESSION_KEY,{login:key});applyUser();syncPublicUser();closeModal('authModal');
});
document.getElementById('guestLogin').addEventListener('click',()=>{user={...defaultUser};save(SESSION_KEY,{guest:true});applyUser();closeModal('authModal')});
document.getElementById('sidebarLogout')?.addEventListener('click',()=>{if(user.guest){openModal('authModal');setAuthMode('login');return;}localStorage.removeItem(SESSION_KEY);localStorage.removeItem(USER_KEY);user={...defaultUser};applyUser();openModal('authModal');setAuthMode('login')});

// Profile
if(document.getElementById('editProfile'))document.getElementById('editProfile').addEventListener('click',()=>{document.getElementById('loginInput').value=user.login||'';document.getElementById('nicknameInput').value=user.nickname||'';document.getElementById('passwordInput').value=user.password||'';document.getElementById('bioInput').value=user.bio||'';openModal('profileModal')});
document.getElementById('avatarInput')?.addEventListener('change',e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{user.avatar=r.result;applyUser()};r.readAsDataURL(f)});
document.getElementById('saveProfile')?.addEventListener('click',()=>{const old=user.login,oldKey=normLogin(old),userNew=document.getElementById('loginInput').value.trim()||old,key=normLogin(userNew);const users=getUsers();if(key==='worixy'&&oldKey!=='worixy')return alert('Логин Worixy зарезервирован для администратора.');if(key!==oldKey&&users[key])return alert('Этот логин уже занят.');user.login=userNew;user.nickname=document.getElementById('nicknameInput').value.trim()||user.nickname;user.password=document.getElementById('passwordInput').value;user.bio=document.getElementById('bioInput').value.trim();syncRole();delete users[oldKey];users[key]=user;save(USERS_KEY,users);save(SESSION_KEY,{login:key});applyUser();closeModal('profileModal')});

function renderUpdates(){const box=document.getElementById('rightInfo');if(!box)return;const updates=getUpdates();if(!updates.length){box.innerHTML='<div class="right-empty"><div class="right-symbol">—</div><h3>Обновлений пока нет</h3><p>Новые обновления появятся здесь после публикации.</p></div>';return}box.innerHTML='<div class="updates-list">'+updates.map((d,i)=>`<article class="update-card ${i===0?'latest':''}"><div class="update-card-top"><span class="update-label">${i===0?'НОВОЕ ОБНОВЛЕНИЕ':'ОБНОВЛЕНИЕ'}</span><b>${esc(d.version)}</b></div><h3>${esc(d.title)}</h3><div class="update-date">${esc(d.date)}</div>${d.added?`<div class="update-block added"><div class="update-block-title"><span class="update-sign">+</span><span>Добавлено</span></div><div>${esc(d.added).replace(/\n/g,'<br>')}</div></div>`:''}${d.removed?`<div class="update-block removed"><div class="update-block-title"><span class="update-sign">−</span><span>Убрано</span></div><div>${esc(d.removed).replace(/\n/g,'<br>')}</div></div>`:''}${d.fixed?`<div class="update-block fixed"><div class="update-block-title"><span class="update-sign">✓</span><span>Исправлено</span></div><div>${esc(d.fixed).replace(/\n/g,'<br>')}</div></div>`:''}${isPresident()?`<div class="content-delete-row"><button class="btn danger delete-update" data-i="${i}">Удалить обновление</button></div>`:''}</article>`).join('')+'</div>';box.querySelectorAll('.delete-update').forEach(b=>b.addEventListener('click',()=>{const a=getUpdates();a.splice(+b.dataset.i,1);save(UPDATES_KEY,a);renderUpdates();}));}

function renderMods(){const grid=document.getElementById('modsGrid');if(!grid)return;const mods=getMods();const lock=document.getElementById('guestModsLock');if(lock)lock.style.display=user.guest?'flex':'none';if(!mods.length){grid.innerHTML='<div class="mods-empty">Redux пока нет. Новый контент появится после публикации.</div>';}else{grid.innerHTML=mods.map((m,i)=>`<article class="mod-card"><div class="mod-card-icon">${m.iconUrl?`<img src="${esc(m.iconUrl)}" alt="">`:'REDUX'}</div><div class="mod-card-body"><h3>${esc(m.name)}</h3><p>${esc(m.description)}</p><small>Скачивание: Яндекс Диск</small></div><div class="mod-card-actions"><button class="btn ghost mod-detail" data-i="${i}">Подробнее</button>${user.guest?'<button class="btn ghost" disabled>Недоступно гостю</button>':`<button class="btn primary mod-download" data-i="${i}">Скачать</button>`}</div></article>`).join('');grid.querySelectorAll('.mod-detail').forEach(b=>b.addEventListener('click',()=>openReduxDetail(mods[+b.dataset.i])));grid.querySelectorAll('.mod-download').forEach(b=>b.addEventListener('click',()=>downloadMod(mods[+b.dataset.i])));}const list=document.getElementById('adminModsList');if(list){const manageable=canManageRedux();
list.innerHTML=manageable&&mods.length?'<div class="admin-content-list-title">Опубликованные Redux</div>'+mods.map((m,i)=>{
 const own=isPresident() || normLogin(m.owner||'')===normLogin(user.login);
 return `<div class="admin-content-row"><div><b>${esc(m.name)}</b><small>${esc(m.description||'Без описания')}</small></div>${own?`<button class="btn danger delete-mod" data-i="${i}">Удалить</button>`:''}</div>`;
}).join(''):'<div class="admin-content-empty">Опубликованных Redux пока нет.</div>';
list.querySelectorAll('.delete-mod').forEach(b=>b.addEventListener('click',()=>{
 const a=getMods(),m=a[+b.dataset.i]; if(!m)return;
 if(!isPresident() && normLogin(m.owner||'')!==normLogin(user.login))return;
 a.splice(+b.dataset.i,1);save(MODS_KEY,a);renderMods();
}));}}

function openReduxDetail(m){currentDetail=m;document.getElementById('reduxDetailName').textContent=m.name;document.getElementById('reduxDetailShort').textContent=m.description||'';document.getElementById('reduxDetailLong').innerHTML=esc(m.longDescription||'Подробное описание отсутствует.').replace(/\n/g,'<br>');const v=document.getElementById('reduxDetailVideo');
if(m.videoUrl){const yt=m.videoUrl.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);v.innerHTML=yt?`<iframe width="100%" height="460" src="https://www.youtube.com/embed/${yt[1]}" title="Видео Redux" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`:`<video controls playsinline src="${esc(m.videoUrl)}"></video>`;}else{v.innerHTML='<div class="redux-video-empty">Видео для этого Redux пока не добавлено.</div>'; }
document.getElementById('reduxDetailDownload').disabled=user.guest;document.getElementById('reduxDetailDownload').textContent=user.guest?'Недоступно гостю':'Скачать';openModal('reduxDetailModal')}
document.getElementById('reduxDetailDownload')?.addEventListener('click',()=>{if(currentDetail&&!user.guest)downloadMod(currentDetail)});
function downloadMod(m){if(!m.downloadUrl)return alert('Ссылка на скачивание не указана.');window.open(m.downloadUrl,'_blank','noopener,noreferrer')}

// Settings — сохраняются и реально применяются в этом браузере.
function renderAdminUsers(){
 const box=document.getElementById('adminUsersList');if(!box)return;
 const q=(document.getElementById('adminUserSearch')?.value||'').toLowerCase().trim(), users=getUsers();
 const arr=Object.values(users).filter(u=>u.login&&(!q||u.login.toLowerCase().includes(q)||(u.nickname||'').toLowerCase().includes(q)));
 if(!arr.length){box.innerHTML='<div class="admin-content-empty">Пользователи не найдены.</div>';return}
 box.innerHTML=arr.map(u=>{
   const canManage=isPresident()&&normLogin(u.login)!=='worixy';
   return `<div class="admin-content-row ${u.banned?'banned-row':''}">
    <div><b>${esc(u.nickname||u.login)} <span class="role-pill">${esc(roleName(u))}</span></b><small>@${esc(u.login)}${u.banned?` · <span class="danger-text">Заблокирован</span>`:''}</small></div>
    <div class="admin-role-actions">
      ${canManage&&u.role!=='Вице-президент'?`<button class="btn ghost role-action" data-login="${esc(u.login)}" data-role="Вице-президент">Назначить вице</button>`:''}
      ${canManage&&u.role==='Вице-президент'?`<button class="btn ghost role-action" data-login="${esc(u.login)}" data-role="Игрок">Снять вице</button>`:''}
      ${canManage&&u.role!=='Заместитель президента'?`<button class="btn ghost role-action" data-login="${esc(u.login)}" data-role="Заместитель президента">Назначить замом</button>`:''}
      ${canManage&&u.role==='Заместитель президента'?`<button class="btn ghost role-action" data-login="${esc(u.login)}" data-role="Игрок">Снять зама</button>`:''}
      ${canManage&&!u.banned?`<button class="btn danger ban-user" data-login="${esc(u.login)}">Забанить</button>`:''}
      ${canManage&&u.banned?`<button class="btn primary unban-user" data-login="${esc(u.login)}">Разбанить</button>`:''}
    </div>
   </div>`;
 }).join('');
 box.querySelectorAll('.role-action').forEach(b=>b.addEventListener('click',()=>setUserRole(b.dataset.login,b.dataset.role)));
 box.querySelectorAll('.ban-user').forEach(b=>b.addEventListener('click',()=>banUser(b.dataset.login)));
 box.querySelectorAll('.unban-user').forEach(b=>b.addEventListener('click',()=>unbanUser(b.dataset.login)));
}
function setUserRole(login,role){
 if(!isPresident())return;
 const users=getUsers(),key=normLogin(login),u=users[key];if(!u||key==='worixy')return;
 if(!['Игрок','Вице-президент','Заместитель президента'].includes(role))return;
 // Only one person may hold each presidential deputy role; remove it from previous holder.
 if(role!=='Игрок') Object.values(users).forEach(x=>{if(x!==u&&x.role===role){x.role='Игрок';x.admin=false;}});
 u.role=role;u.admin=false;users[key]=u;saveUsers(users);renderAdminUsers();renderAdminBans();
}
function banUser(login){if(!isPresident())return;const users=getUsers(),key=normLogin(login),u=users[key];if(!u||key==='worixy')return;const reason=prompt('Причина блокировки:','Нарушение правил');if(reason===null)return;u.banned=true;u.banReason=reason;users[key]=u;saveUsers(users);const bans=getBans();bans.unshift({login:u.login,reason,by:user.login,date:new Date().toLocaleString('ru-RU')});save(BANS_KEY,bans);renderAdminUsers();renderAdminBans()}
function unbanUser(login){if(!isPresident())return;const users=getUsers(),key=normLogin(login),u=users[key];if(!u)return;u.banned=false;u.banReason='';users[key]=u;saveUsers(users);save(BANS_KEY,getBans().filter(x=>normLogin(x.login)!==key));renderAdminUsers();renderAdminBans()}
function renderAdminBans(){const box=document.getElementById('adminBansList');if(!box)return;const bans=getBans();box.innerHTML=bans.length?bans.map(x=>`<div class="admin-content-row"><div><b>@${esc(x.login)}</b><small>${esc(x.reason||'Без причины')} · ${esc(x.date||'')} · выдал ${esc(x.by||'')}</small></div>${isPresident()?`<button class="btn primary unban-user" data-login="${esc(x.login)}">Разбанить</button>`:''}</div>`).join(''):'<div class="admin-content-empty">Заблокированных пользователей нет.</div>';box.querySelectorAll('.unban-user').forEach(b=>b.addEventListener('click',()=>unbanUser(b.dataset.login)))}

document.getElementById('adminUserSearch')?.addEventListener('input',renderAdminUsers);
function openSupport(){openModal('supportModal');renderSupport()}
function openChat(){openModal('chatModal');renderChatUsers()}
document.getElementById('openSupport')?.addEventListener('click',()=>{if(user.guest)return;openSupport()});document.getElementById('openChat')?.addEventListener('click',()=>{if(user.guest)return;openChat()});
let activeTicket=null,activeChat=null;
function renderSupport(){const list=document.getElementById('supportList');if(!list)return;const tickets=getTickets().filter(t=>user.admin||t.author===normLogin(user.login));list.innerHTML=tickets.length?tickets.map(t=>`<div class="support-item ${activeTicket===t.id?'active':''}" data-id="${t.id}"><div class="support-item-main"><b>${esc(t.title)}</b><small>@${esc(t.author)} · ${esc(t.status)}</small></div>${user.admin?`<button class="support-delete-btn" data-id="${esc(t.id)}" title="Удалить обращение">×</button>`:''}</div>`).join(''):'<div class="admin-content-empty">Обращений пока нет.</div>';list.querySelectorAll('.support-item').forEach(x=>x.addEventListener('click',e=>{if(e.target.closest('.support-delete-btn'))return;activeTicket=x.dataset.id;renderSupport()}));list.querySelectorAll('.support-delete-btn').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();if(!user.admin)return;if(!confirm('Удалить это обращение?'))return;const a=getTickets().filter(t=>t.id!==b.dataset.id);save(SUPPORT_KEY,a);if(activeTicket===b.dataset.id)activeTicket=null;renderSupport();}));if(activeTicket){const t=getTickets().find(x=>x.id===activeTicket);if(t)renderTicket(t)}else{document.getElementById('supportHeader').textContent='Выбери обращение';document.getElementById('supportMessages').innerHTML=''}}
function renderTicket(t){document.getElementById('supportHeader').textContent=`${t.title} · ${t.status}`;document.getElementById('supportMessages').innerHTML=t.messages.map(m=>`<div class="chat-bubble ${m.author===normLogin(user.login)?'me':''}">${esc(m.text)}${m.photo?`<img class="support-photo" src="${m.photo}" alt="Фото обращения">`:''}<small>@${esc(m.author)} · ${esc(m.date)}</small></div>`).join('');const close=document.getElementById('supportClose');close.disabled= t.status!=='принято' || !(user.admin||t.author===normLogin(user.login));}
const supportNewForm=document.getElementById('supportNewForm');
document.getElementById('newSupport')?.addEventListener('click',()=>{if(supportNewForm){supportNewForm.hidden=false;document.getElementById('supportTitleInput').focus();}});
document.getElementById('cancelSupport')?.addEventListener('click',()=>{if(supportNewForm){supportNewForm.hidden=true;document.getElementById('supportTitleInput').value='';document.getElementById('supportTextInput').value='';document.getElementById('supportPhotoInput').value='';document.getElementById('supportPhotoName').textContent='';}});
document.getElementById('supportPhotoInput')?.addEventListener('change',e=>{const f=e.target.files?.[0];document.getElementById('supportPhotoName').textContent=f?f.name:'';});
document.getElementById('createSupport')?.addEventListener('click',async()=>{const title=document.getElementById('supportTitleInput').value.trim(),text=document.getElementById('supportTextInput').value.trim(),file=document.getElementById('supportPhotoInput').files?.[0];if(!title||!text){document.getElementById('supportTitleInput').classList.toggle('field-error',!title);document.getElementById('supportTextInput').classList.toggle('field-error',!text);return;}if(file&&file.size>5*1024*1024){document.getElementById('supportPhotoName').textContent='Фото слишком большое (максимум 5 МБ)';return;}const photo=file?(await uploadAsset(file,'support')):'';const t={id:Date.now().toString(36),title,author:normLogin(user.login),status:'новое',photo,messages:[{author:normLogin(user.login),text,date:new Date().toLocaleString('ru-RU')}],createdAt:new Date().toISOString()};const a=getTickets();a.unshift(t);save(SUPPORT_KEY,a);activeTicket=t.id;supportNewForm.hidden=true;document.getElementById('supportTitleInput').value='';document.getElementById('supportTextInput').value='';document.getElementById('supportPhotoInput').value='';document.getElementById('supportPhotoName').textContent='';renderSupport();});
document.getElementById('supportSend')?.addEventListener('click',()=>{if(!activeTicket)return;const input=document.getElementById('supportInput'),text=input.value.trim();if(!text)return;const a=getTickets(),t=a.find(x=>x.id===activeTicket);if(!t||t.status==='закрыто'||(!user.admin&&t.author!==normLogin(user.login)))return;if(user.admin&&t.status==='новое')t.status='принято';t.messages.push({author:normLogin(user.login),text,date:new Date().toLocaleString('ru-RU')});save(SUPPORT_KEY,a);input.value='';renderSupport()});
document.getElementById('supportClose')?.addEventListener('click',()=>{if(!activeTicket)return;const a=getTickets(),t=a.find(x=>x.id===activeTicket);if(!t||t.status!=='принято')return;if(user.admin||t.author===normLogin(user.login)){t.status='закрыто';save(SUPPORT_KEY,a);renderSupport()}});
async function renderChatUsers(){
 const box=document.getElementById('chatUsers');if(!box||user.guest)return;
 const q=normLogin(document.getElementById('chatUserSearch')?.value||'');
 const remote=await loadRemoteChatUsers();
 const source=remote||Object.values(getUsers()).map(u=>({login:u.login,nickname:u.nickname,avatar:u.avatar}));
 const users=source.filter(u=>{const login=normLogin(u.login);return login!==normLogin(user.login)&&(!q||login.includes(q));});
 box.innerHTML=users.map(u=>`<div class="support-item ${activeChat===normLogin(u.login)?'active':''}" data-login="${esc(u.login)}"><b>${esc(u.nickname||u.login)}</b><small>@${esc(u.login)}</small></div>`).join('');
 box.querySelectorAll('.support-item').forEach(x=>x.addEventListener('click',()=>{activeChat=x.dataset.login;renderChatUsers();renderChat()}));
 if(activeChat)renderChat();
}
document.getElementById('chatUserSearch')?.addEventListener('input',renderChatUsers);
function chatKey(a,b){return [normLogin(a),normLogin(b)].sort().join('|')}
async function renderChat(){
 const msgsEl=document.getElementById('chatMessages'); if(!msgsEl)return;
 const local=getChats().filter(m=>m.key===chatKey(user.login,activeChat));
 const remote=await loadRemoteMessages(activeChat); const msgs=remote||local;
 const other=(remoteChatUsers.length?remoteChatUsers:Object.values(getUsers())).find(u=>normLogin(u.login)===normLogin(activeChat));
 document.getElementById('chatHeader').textContent=other?`${other.nickname||other.login} · @${other.login}`:'Чат';
 msgsEl.innerHTML=msgs.map(m=>`<div class="chat-bubble ${m.author===normLogin(user.login)?'me':''}">${esc(m.text)}<small>@${esc(m.author)} · ${esc(m.date)}</small></div>`).join('');
 msgsEl.scrollTop=msgsEl.scrollHeight;
}
document.getElementById('chatSend')?.addEventListener('click',async()=>{
 if(!activeChat)return; const input=document.getElementById('chatInput'),text=input.value.trim();if(!text)return;
 if(realtimeEnabled()) { const ok=await sendRemoteMessage(activeChat,text); if(!ok)return; }
 else { const a=getChats();a.push({key:chatKey(user.login,activeChat),author:normLogin(user.login),text,date:new Date().toLocaleString('ru-RU')});save(CHAT_KEY,a); }
 input.value=''; renderChat();
});

// Comfortable message composer: Enter sends, Shift+Enter makes a new line.
[['chatInput','chatSend'],['supportInput','supportSend']].forEach(([inputId,buttonId])=>{const el=document.getElementById(inputId),btn=document.getElementById(buttonId);if(!el||!btn)return;el.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();btn.click();}});});


// Initialization
(function init(){
  ensureAdmin();
  const sess=load(SESSION_KEY,null);
  if(sess){
    if(sess.guest){user={...defaultUser};}
    else {const u=getUsers()[normLogin(sess.login)]; if(u && !u.banned) user={...u,guest:false}; else {localStorage.removeItem(SESSION_KEY); user={...defaultUser};}}
  } else {user={...defaultUser};}
  applyUser();
  if(sess) closeModal('authModal'); else openModal('authModal');
  showPage('home');
})();

// --- Admin panel controls ---
function setupAdminPanel(){
  document.querySelectorAll('.admin-tab').forEach(tab=>tab.addEventListener('click',()=>{
    const target=tab.dataset.adminTab;
    if(!isPresident() && ['updates','users','bans'].includes(target)) return;
    document.querySelectorAll('.admin-tab').forEach(t=>t.classList.toggle('active',t===tab));
    document.querySelectorAll('.admin-section').forEach(s=>s.classList.remove('active'));
    const sec=document.getElementById('admin'+target.charAt(0).toUpperCase()+target.slice(1)+'Section');
    if(sec) sec.classList.add('active');
    if(target==='updates') renderUpdates();
    if(target==='mods') renderMods();
    if(target==='users') renderAdminUsers();
    if(target==='bans') renderAdminBans();
  }));
  const saveUpdate=document.getElementById('saveAdminUpdate');
  saveUpdate?.addEventListener('click',()=>{
    if(!isPresident()) return;
    const version=document.getElementById('adminVersion').value.trim()||'v1.0.0';
    const title=document.getElementById('adminUpdateTitle').value.trim()||'Обновление';
    const d={version,title,added:document.getElementById('adminAdded').value.trim(),removed:document.getElementById('adminRemoved').value.trim(),fixed:document.getElementById('adminFixed').value.trim(),date:new Date().toLocaleDateString('ru-RU')};
    const a=getUpdates(); a.unshift(d); save(UPDATES_KEY,a); renderUpdates();
    const st=document.getElementById('adminStatus'); if(st){st.textContent='Обновление опубликовано';setTimeout(()=>st.textContent='',1800)}
  });
  const iconInput=document.getElementById('modIconInput');
  iconInput?.addEventListener('change',e=>{const f=e.target.files?.[0];if(!f)return;if(f.size>5*1024*1024){e.target.value='';pendingModIcon=null;return;}const r=new FileReader();r.onload=()=>{pendingModIcon=r.result;const p=document.getElementById('modIconPreview');if(p){p.style.backgroundImage=`url("${r.result}")`;p.style.backgroundSize='cover';p.textContent='';}};r.readAsDataURL(f);});
  document.getElementById('publishMod')?.addEventListener('click',async()=>{
    if(!canPublishRedux())return;
    const name=document.getElementById('modName').value.trim(), description=document.getElementById('modDescription').value.trim(), longDescription=document.getElementById('modLongDescription').value.trim(), videoUrl=document.getElementById('modVideoUrl').value.trim(), downloadUrl=document.getElementById('modDownloadUrl').value.trim();
    const status=document.getElementById('modStatus');
    if(!name||!downloadUrl){if(status)status.textContent='Укажи название и ссылку на скачивание';return;}
    const iconFile=iconInput?.files?.[0];
    let iconUrl=pendingModIcon||'';
    if(iconFile&&realtimeEnabled()) iconUrl=await uploadAsset(iconFile,'mods') || iconUrl;
    const m={id:Date.now().toString(36),name,description,longDescription,videoUrl,downloadUrl,iconUrl,owner:normLogin(user.login),ownerName:user.nickname||user.login,createdAt:new Date().toISOString()};
    const a=getMods();a.unshift(m);save(MODS_KEY,a);renderMods();
    ['modName','modDescription','modLongDescription','modVideoUrl','modDownloadUrl'].forEach(id=>{const e=document.getElementById(id);if(e)e.value=''});if(iconInput)iconInput.value='';pendingModIcon=null;const p=document.getElementById('modIconPreview');if(p){p.style.backgroundImage='';p.textContent='REDUX'}if(status){status.textContent='Redux опубликован';setTimeout(()=>status.textContent='',1800)}
  });
}

// Profile editor entry point + persistent avatar/profile data.
function openProfileEditor(){
  if(user.guest){openModal('authModal');setAuthMode('login');return;}
  document.getElementById('loginInput').value=user.login||'';
  document.getElementById('nicknameInput').value=user.nickname||'';
  document.getElementById('passwordInput').value=user.password||'';
  document.getElementById('bioInput').value=user.bio||'';
  openModal('profileModal');
}
const profileActions=document.querySelector('.account-actions');
if(profileActions){profileActions.innerHTML='<button class="btn primary" id="editProfileBtn">Изменить профиль</button>';document.getElementById('editProfileBtn').addEventListener('click',openProfileEditor);}
document.getElementById('avatarInput')?.addEventListener('change',e=>{
  const f=e.target.files?.[0]; if(!f)return;
  if(f.size>5*1024*1024){e.target.value='';return;}
  const r=new FileReader(); r.onload=async()=>{let avatar=r.result;if(realtimeEnabled()) avatar=await uploadAsset(f,'avatars')||avatar;user.avatar=avatar;const users=getUsers();const key=normLogin(user.login);if(users[key]){users[key].avatar=avatar;save(USERS_KEY,users);}save(USER_KEY,user);applyUser();};r.readAsDataURL(f);
});

// Replace profile save with inline validation instead of popup alerts.
const saveProfileBtn=document.getElementById('saveProfile');
if(saveProfileBtn){saveProfileBtn.onclick=()=>{
  const errId='profileEditError'; let err=document.getElementById(errId); if(!err){err=document.createElement('div');err.id=errId;err.className='form-error';saveProfileBtn.parentElement.parentElement.insertBefore(err,saveProfileBtn.parentElement)}
  err.textContent='';
  const old=user.login,oldKey=normLogin(old),newLogin=document.getElementById('loginInput').value.trim()||old,key=normLogin(newLogin),newPass=document.getElementById('passwordInput').value;
  const users=getUsers();
  if(!newLogin){err.textContent='Логин не может быть пустым.';return;}
  if(key==='worixy'&&oldKey!=='worixy'){err.textContent='Логин Worixy зарезервирован.';return;}
  if(key!==oldKey&&users[key]){err.textContent='Этот логин уже зарегистрирован.';return;}
  if(newPass.length<6){err.textContent='Пароль должен содержать минимум 6 символов.';return;}
  user.login=newLogin;user.nickname=document.getElementById('nicknameInput').value.trim()||newLogin;user.password=newPass;user.bio=document.getElementById('bioInput').value.trim();syncRole();
  delete users[oldKey];users[key]=user;save(USERS_KEY,users);save(USER_KEY,user);save(SESSION_KEY,{login:key});applyUser();closeModal('profileModal');
};}

// Ensure setup runs after the existing DOM handlers have been registered.
setupAdminPanel();
setTimeout(async()=>{await hydrateCloudState();startCloudRealtime();},0);
