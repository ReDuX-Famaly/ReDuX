const buttons = document.querySelectorAll('.nav-item[data-page]');
const pages = document.querySelectorAll('.page');
const title = document.getElementById('pageTitle');
const titles = {home:'Главная',mods:'Redux',settings:'Настройки',profile:'Профиль'};
const USER_KEY='reduxUser', USERS_KEY='reduxUsers', MODS_KEY='reduxMods', UPDATES_KEY='reduxUpdates', SESSION_KEY='reduxSession', SETTINGS_KEY='reduxSettings';
const BANS_KEY='reduxBans';
const defaultUser={name:'Гость',login:'guest',nickname:'Гость',bio:'Гостевой аккаунт.',role:'Гость',admin:false,guest:true,avatar:''};
let user=load(USER_KEY)||defaultUser;
let pendingModIcon=null,pendingModVideo=null,pendingModFile=null,currentDetail=null;
let remoteMods=[];

let sb = null;
function realtimeEnabled(){return !!(window.REDUX_SUPABASE?.url && window.REDUX_SUPABASE?.anonKey && window.supabase?.createClient)}
function initRealtime(){if(realtimeEnabled()&&!sb) sb=window.supabase.createClient(window.REDUX_SUPABASE.url,window.REDUX_SUPABASE.anonKey); return !!sb}
async function syncPublicUser(){
  if(!initRealtime()||user.guest)return;
  try{await sb.from('profiles').upsert({login:normLogin(user.login),nickname:user.nickname||user.login,avatar:user.avatar||''},{onConflict:'login'});}catch(e){console.warn('ReDuX profile sync:',e)}
}

let cloudReady=false;
let cloudSyncing=false;
const CLOUD_KEYS=[USERS_KEY,MODS_KEY,UPDATES_KEY,BANS_KEY];
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
    (data||[]).forEach(r=>{
      if(!CLOUD_KEYS.includes(r.key)) return;
      localStorage.setItem(r.key,JSON.stringify(r.data));
    });
    cloudSyncing=false;
    cloudReady=true;
    const users=getUsers();
    if(!users.worixy){
      users.worixy={name:'Worixy',login:'Worixy',nickname:'Worixy',password:'Worixy123',bio:'',role:'Президент',admin:true,guest:false,avatar:''};
      localStorage.setItem(USERS_KEY,JSON.stringify(users));
    }
    for(const [k,v] of [[USERS_KEY,getUsers()],[MODS_KEY,getMods()],[UPDATES_KEY,getUpdates()],[BANS_KEY,getBans()]]){
      if(!remoteKeys.has(k)) await syncCloudState(k,v);
    }
    const sess=load(SESSION_KEY,null);
    if(sess&&!sess.guest){
      const u=getUsers()[normLogin(sess.login)];
      if(u&&!u.banned){user={...u,guest:false};save(USER_KEY,user);}
    }
    applyUser();
    renderAdminUsers();
    renderAdminBans();
  }catch(e){
    cloudReady=false;
    cloudSyncing=false;
    console.warn('ReDuX cloud bootstrap:',e);
  }
}
function startCloudRealtime(){
  if(!initRealtime())return;
  const channel=sb.channel('redux-global-state')
    .on('postgres_changes',{event:'*',schema:'public',table:'app_state'},payload=>{
      const row=payload.new; if(!row||!CLOUD_KEYS.includes(row.key))return;
      cloudSyncing=true;localStorage.setItem(row.key,JSON.stringify(row.data));cloudSyncing=false;
      if(row.key===USERS_KEY){const u=getUsers()[normLogin(user.login)];if(u&&!user.guest){user={...u,guest:false};localStorage.setItem(USER_KEY,JSON.stringify(user));}}
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

function saveUsers(v){save(USERS_KEY,v)}
function getBans(){return load(BANS_KEY,[])||[]}
function isPresident(){return normLogin(user.login)==='worixy' && !user.guest}
function roleName(u){return u?.role || (normLogin(u?.login)==='worixy'?'Президент':u?.guest?'Гость':'Игрок')}
function canManageRedux(){return isPresident() || ['Вице-президент','Заместитель президента'].includes(user.role)}
function canPublishRedux(){return canManageRedux() && !user.guest}

function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function setAvatar(el,avatar,fallback){if(!el)return;if(avatar){el.style.backgroundImage=`url("${avatar}")`;el.style.backgroundSize='cover';el.style.backgroundPosition='center';el.textContent=''}else{el.style.backgroundImage='';el.textContent=fallback}}
function syncRole(){user.admin=String(user.login||'').toLowerCase()==='worixy';if(user.guest){user.admin=false;user.role='Гость';} else if(String(user.login||'').toLowerCase()==='worixy'){user.admin=true;user.role='Президент';} else {user.admin=false; if(!['Вице-президент','Заместитель президента'].includes(user.role))user.role='Игрок';}}
function applyUser(){
 syncRole(); save(USER_KEY,user);
 if(!user.guest){syncPublicUser();}
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
function renderAdminUsersLegacy(){
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
function renderAdminUsers(){
  if(!isPresident()) return;
  const box=document.getElementById('adminUsersList');
  if(!box) return;
  const input=document.getElementById('adminUserSearch');
  const q=normLogin(input?.value||'');
  const users=getUsers();
  const arr=Object.values(users)
    .filter(u=>u?.login)
    .filter(u=>!q || normLogin(u.login).includes(q) || normLogin(u.nickname||'').includes(q))
    .sort((a,b)=>String(a.nickname||a.login).localeCompare(String(b.nickname||b.login),'ru'));
  box.innerHTML=arr.length ? arr.map(u=>{
    const canManage=normLogin(u.login)!=='worixy';
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
  }).join('') : '<div class="admin-content-empty">Пользователи не найдены.</div>';
  box.querySelectorAll('.role-action').forEach(b=>b.onclick=()=>setUserRole(b.dataset.login,b.dataset.role));
  box.querySelectorAll('.ban-user').forEach(b=>b.onclick=()=>banUser(b.dataset.login));
  box.querySelectorAll('.unban-user').forEach(b=>b.onclick=()=>unbanUser(b.dataset.login));
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

document.getElementById('adminUserSearch')?.addEventListener('input',()=>renderAdminUsers());
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

// Cloud is optional and loaded AFTER the launcher UI is already alive.
// A CDN/network failure must never prevent local buttons/auth/navigation from working.
(function loadCloudInBackground(){
  if(!window.REDUX_SUPABASE?.url || !window.REDUX_SUPABASE?.anonKey) return;
  const script=document.createElement('script');
  script.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
  script.async=true;
  script.onload=async()=>{ try{ await hydrateCloudState(); startCloudRealtime(); }catch(e){ console.warn('ReDuX cloud background init:',e); } };
  script.onerror=()=>console.warn('ReDuX: Supabase CDN недоступен — локальный режим продолжает работать.');
  document.head.appendChild(script);
})();
