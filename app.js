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
  try{
    await sb.from('redux_users').upsert({login:normLogin(user.login),name:user.name||user.login,nickname:user.nickname||user.login,password_hash:user.password_hash||'',bio:user.bio||'',role:user.role||'Игрок',admin:!!user.admin,guest:false,avatar:user.avatar||'',banned:!!user.banned,ban_reason:user.banReason||''},{onConflict:'login'});
  }catch(e){console.warn('ReDuX user sync:',e)}
}
async function loadRemoteUsers(){
  if(!initRealtime())return null;
  try{
    const {data,error}=await sb.from('redux_users').select('*').order('login');
    if(error)throw error;
    const users={};(data||[]).forEach(u=>{users[normLogin(u.login)]={name:u.name||u.login,login:u.login,nickname:u.nickname||u.login,password_hash:u.password_hash||'',bio:u.bio||'',role:u.role||'Игрок',admin:!!u.admin,guest:false,avatar:u.avatar||'',banned:!!u.banned,banReason:u.ban_reason||''};});
    if(!users.worixy) users.worixy={name:'Worixy',login:'Worixy',nickname:'Worixy',password_hash:'',bio:'',role:'Президент',admin:true,guest:false,avatar:'',banned:false,banReason:''};
    localStorage.setItem(USERS_KEY,JSON.stringify(users));
    return users;
  }catch(e){console.warn('ReDuX remote users load:',e);return null;}
}
async function syncAllUsers(users){
  if(!initRealtime())return false;
  try{
    const rows=Object.values(users).filter(u=>u&&u.login&&normLogin(u.login)!=='guest').map(u=>({login:normLogin(u.login),name:u.name||u.login,nickname:u.nickname||u.login,password_hash:u.password_hash||'',bio:u.bio||'',role:u.role||'Игрок',admin:!!u.admin,guest:false,avatar:u.avatar||'',banned:!!u.banned,ban_reason:u.banReason||''}));
    const {error}=await sb.from('redux_users').upsert(rows,{onConflict:'login'});
    if(error)throw error; return true;
  }catch(e){console.warn('ReDuX users save:',e);return false;}
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
const BANS_KEY='reduxBans', SUPPORT_KEY='reduxSupport', CHAT_KEY='reduxChats';
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
    await loadRemoteUsers();
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
  save(USERS_KEY,users); syncAllUsers(users);
}


function saveUsers(v){save(USERS_KEY,v); syncAllUsers(v)}
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

// Auth: login + password only. No email and no confirmation code.
const authTabs=document.querySelectorAll('.auth-tab');const loginScreen=document.getElementById('loginScreen'),registerScreen=document.getElementById('registerScreen');
function setAuthMode(mode){authTabs.forEach(t=>t.classList.toggle('active',t.dataset.auth===mode));loginScreen.classList.toggle('active',mode==='login');registerScreen.classList.toggle('active',mode==='register')}
authTabs.forEach(t=>t.addEventListener('click',()=>{setAuthMode(t.dataset.auth);authError('loginError','');authError('registerError','')}));
function authError(id,msg){const el=document.getElementById(id);if(el){el.textContent=msg||'';el.classList.toggle('show',!!msg)}}
async function hashPassword(pass){const data=new TextEncoder().encode(pass);const buf=await crypto.subtle.digest('SHA-256',data);return Array.from(new Uint8Array(buf)).map(x=>x.toString(16).padStart(2,'0')).join('')}
async function refreshUsers(){const remote=await loadRemoteUsers();return remote||getUsers()}
document.getElementById('loginContinue').addEventListener('click',async()=>{
 authError('loginError','');
 const login=document.getElementById('loginUsername').value.trim(),pass=document.getElementById('loginPassword').value;
 if(!login||!pass)return authError('loginError','Заполни логин и пароль.');
 const users=await refreshUsers(),u=users[normLogin(login)];
 if(!u)return authError('loginError','Такого аккаунта не существует.');
 const hash=await hashPassword(pass);
 if(u.password_hash!==hash)return authError('loginError','Неверный пароль.');
 if(u.banned)return authError('loginError',`Аккаунт заблокирован.${u.banReason?` Причина: ${u.banReason}`:''}`);
 user={...u,guest:false,login:u.login};save(USER_KEY,user);save(SESSION_KEY,{login:normLogin(u.login)});applyUser();closeModal('authModal');
});
document.getElementById('registerContinue').addEventListener('click',async()=>{
 authError('registerError','');
 const name=document.getElementById('registerName').value.trim(),login=document.getElementById('registerUsername').value.trim(),p=document.getElementById('registerPassword').value,p2=document.getElementById('registerPassword2').value;
 if(!name||!login||!p)return authError('registerError','Заполни все поля.');
 if(p.length<6)return authError('registerError','Пароль должен содержать минимум 6 символов.');
 if(p!==p2)return authError('registerError','Пароли не совпадают.');
 const key=normLogin(login);if(key==='worixy')return authError('registerError','Этот логин зарезервирован.');
 const users=await refreshUsers();if(users[key])return authError('registerError','Этот логин уже зарегистрирован.');
 const u={name,login,nickname:login,password_hash:await hashPassword(p),bio:'',role:'Игрок',admin:false,guest:false,avatar:'',banned:false,banReason:''};
 users[key]=u;
 if(!(await syncAllUsers(users)))return authError('registerError','Не удалось сохранить аккаунт в Supabase. Проверь подключение.');
 localStorage.setItem(USERS_KEY,JSON.stringify(users));user=u;save(SESSION_KEY,{login:key});applyUser();closeModal('authModal');
});
document.getElementById('guestLogin').addEventListener('click',()=>{user={...defaultUser};save(SESSION_KEY,{guest:true});applyUser();closeModal('authModal')});
document.getElementById('sidebarLogout')?.addEventListener('click',()=>{if(user.guest){openModal('authModal');setAuthMode('login');return;}localStorage.removeItem(SESSION_KEY);localStorage.removeItem(USER_KEY);user={...defaultUser};applyUser();openModal('authModal');setAuthMode('login')});

// Profile
if(document.getElementById('editProfile'))document.getElementById('editProfile').addEventListener('click',()=>{document.getElementById('loginInput').value=user.login||'';document.getElementById('nicknameInput').value=user.nickname||'';document.getElementById('passwordInput').value=user.password||'';document.getElementById('bioInput').value=user.bio||'';openModal('profileModal')});
document.getElementById('avatarInput')?.addEventListener('change',e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{user.avatar=r.result;applyUser()};r.readAsDataURL(f)});
document.getElementById('saveProfile')?.addEventListener('click',async()=>{const old=user.login,oldKey=normLogin(old),userNew=document.getElementById('loginInput').value.trim()||old,key=normLogin(userNew);const users=await refreshUsers();if(key==='worixy'&&oldKey!=='worixy')return alert('Логин Worixy зарезервирован для администратора.');if(key!==oldKey&&users[key])return alert('Этот логин уже занят.');user.login=userNew;user.nickname=document.getElementById('nicknameInput').value.trim()||user.nickname;const np=document.getElementById('passwordInput').value;if(np)user.password_hash=await hashPassword(np);user.bio=document.getElementById('bioInput').value.trim();syncRole();delete users[oldKey];users[key]=user;if(!(await syncAllUsers(users)))return alert('Не удалось сохранить профиль в Supabase.');localStorage.setItem(USERS_KEY,JSON.stringify(users));save(SESSION_KEY,{login:key});applyUser();closeModal('profileModal')});

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
 box=document.getElementById('adminUsersList');if(!box)return;
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
 box=document.getElementById('adminUsersList');if(!box)return;
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
  if(cloudReady){
    hydrateCloudState().then(()=>{
      applyUser();
      renderUpdates();
      renderMods();

      if(!user.guest){
        syncPublicUser();
        startChatRealtime();
      }
    });
  }

  renderUpdates();
  renderMods();

  if(!user.guest){
    startChatRealtime();
  }

// ReDuX initialization
ensureAdmin();
const savedSession=load(SESSION_KEY,null);
if(savedSession && !savedSession.guest){
  const savedUser=getUsers()[normLogin(savedSession.login)];
  if(savedUser && !savedUser.banned){user={...savedUser,guest:false};}
}else if(savedSession?.guest){
  user={...defaultUser};
}
applyUser();
renderUpdates();
renderMods();
if(initRealtime()){
  startCloudRealtime();
  hydrateCloudState().then(()=>{
    applyUser();
    renderUpdates();
    renderMods();
  });
}
