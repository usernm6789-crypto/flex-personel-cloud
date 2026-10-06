const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({limit:'25mb'}));
app.use(express.static(path.join(__dirname,'public')));

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname,'data.json');
const SECRET = process.env.SESSION_SECRET || 'CHANGE_ME_SESSION_SECRET_2026';
const RECOVERY = process.env.FLEX_RECOVERY_CODE || 'FLEX-2026';
const OBJECTS = [
  {id:'jois', name:'JOIS', short:'JOIS'},
  {id:'nagatino', name:'NAGATINO', short:'NAG 1'},
  {id:'nagatino2', name:'NAGATINO 2', short:'NAG 2'},
  {id:'preobrejenka', name:'PREOBREJENKA', short:'PRB'}
];

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return {salt, hash};
}
function verifyPassword(password, stored) {
  if (!stored || !stored.salt || !stored.hash) return false;
  const {hash} = hashPassword(password, stored.salt);
  return crypto.timingSafeEqual(Buffer.from(hash,'hex'), Buffer.from(stored.hash,'hex'));
}
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return body+'.'+sig;
}
function verify(token) {
  try {
    const [body,sig] = String(token||'').split('.');
    const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
    if (!body || !sig || !crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected))) return null;
    const p = JSON.parse(Buffer.from(body,'base64url').toString());
    if (!p.exp || p.exp < Date.now()) return null;
    return p;
  } catch { return null; }
}
function cookieToken(req){
  const m = (req.headers.cookie||'').match(/(?:^|; )flex_session=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}
function auth(req,res,next){
  const u = verify(cookieToken(req));
  if (!u) return res.status(401).json({error:'AUTH_REQUIRED'});
  req.user=u; next();
}
function writeData(db){
  const tmp=DATA_FILE+'.tmp'; fs.writeFileSync(tmp, JSON.stringify(db,null,2)); fs.renameSync(tmp,DATA_FILE);
}
function readData(){
  if (!fs.existsSync(DATA_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(DATA_FILE,'utf8')); } catch { return null; }
}
function makeInitial(){
  const accounts={};
  const initial=[
    ['admin','abduraupovsahobiddin@gmail.com','admin', 'admin123'],
    ['jois','jois','obj','jois123'],
    ['nagatino','nag1','obj','nag1123'],
    ['nagatino2','nag2','obj','nag2123'],
    ['preobrejenka','prb','obj','prb123']
  ];
  for(const [id,login,role,password] of initial){ accounts[id]={login,role,obj:role==='obj'?id:null,password:hashPassword(password)}; }
  return {version:1,accounts,state:{},createdAt:new Date().toISOString()};
}
let db=readData() || makeInitial();
writeData(db);

function objectFromKey(key){
  for(const o of OBJECTS){ if(key.endsWith('_'+o.id) || key.includes('_'+o.id+'_')) return o.id; }
  const m=String(key).match(/(?:^|_)(jois|nagatino2|nagatino|preobrejenka)(?:_|$)/);
  return m ? m[1] : null;
}
function allowed(user,key){
  if (user.role==='admin') return true;
  const obj=objectFromKey(key);
  return obj===user.obj;
}

// Seed JOIS from the existing bundled source on first server start.
if(Object.keys(db.state).length===0){
  try{
    const src=fs.readFileSync(path.join(__dirname,'public','jois_data.js'),'utf8');
    const m=src.match(/const\s+JOIS_SEED\s*=\s*(\[[\s\S]*\]);?\s*$/);
    if(m){ const arr=JSON.parse(m[1].replace(/;\s*$/,'')); db.state['workers_jois']=JSON.stringify(arr); }
  }catch(e){ console.error('JOIS seed skipped:',e.message); }
  writeData(db);
}

app.get('/api/me',auth,(req,res)=>res.json({user:req.user,objects:OBJECTS}));

app.post('/api/login',(req,res)=>{
  const login=String(req.body?.login||'').trim().toLowerCase();
  const password=String(req.body?.password||'');
  const entry=Object.entries(db.accounts).find(([,a])=>a.login.toLowerCase()===login);
  if(!entry || !verifyPassword(password,entry[1].password)) return res.status(401).json({error:'Login yoki parol noto\'g\'ri'});
  const [id,a]=entry;
  const user={id,login:a.login,role:a.role,obj:a.obj||null,exp:Date.now()+1000*60*60*24*30};
  res.setHeader('Set-Cookie',`flex_session=${encodeURIComponent(sign(user))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60*60*24*30}`);
  res.json({ok:true,user,objects:OBJECTS});
});

app.post('/api/logout',(req,res)=>{res.setHeader('Set-Cookie','flex_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');res.json({ok:true});});

app.get('/api/bootstrap',auth,(req,res)=>{
  const state={};
  for(const [k,v] of Object.entries(db.state)) if(allowed(req.user,k)) state[k]=v;
  const accounts={};
  if(req.user.role==='admin') for(const [id,a] of Object.entries(db.accounts)) accounts[id]={login:a.login,role:a.role,obj:a.obj||null};
  res.json({user:req.user,objects:OBJECTS,state,accounts});
});

app.put('/api/state',auth,(req,res)=>{
  const key=String(req.body?.key||'');
  if(!key || key.length>300) return res.status(400).json({error:'Invalid key'});
  if(!allowed(req.user,key)) return res.status(403).json({error:'FORBIDDEN'});
  if(req.body.remove) delete db.state[key];
  else db.state[key]=JSON.stringify(req.body.value);
  writeData(db); res.json({ok:true});
});

app.put('/api/accounts',auth,(req,res)=>{
  if(req.user.role!=='admin') return res.status(403).json({error:'FORBIDDEN'});
  const accounts=req.body?.accounts;
  if(!accounts || typeof accounts!=='object') return res.status(400).json({error:'Invalid accounts'});
  const logins=new Set();
  for(const id of ['admin','jois','nagatino','nagatino2','preobrejenka']){
    const x=accounts[id]; if(!x || !String(x.login||'').trim()) return res.status(400).json({error:'Login bo\'sh bo\'lmasin'});
    const login=String(x.login).trim(); if(logins.has(login.toLowerCase())) return res.status(400).json({error:'Loginlar takrorlanmasin'}); logins.add(login.toLowerCase());
    db.accounts[id].login=login;
    if(x.password) { if(String(x.password).length<4) return res.status(400).json({error:'Parol kamida 4 belgi'}); db.accounts[id].password=hashPassword(String(x.password)); }
  }
  writeData(db); res.json({ok:true});
});

app.post('/api/reset-password',(req,res)=>{
  const {account,code,password}=req.body||{};
  if(code!==RECOVERY) return res.status(400).json({error:'Tiklash kodi noto\'g\'ri'});
  if(!['admin','jois','nagatino','nagatino2','preobrejenka'].includes(account)) return res.status(400).json({error:'Hisob noto\'g\'ri'});
  if(String(password||'').length<4) return res.status(400).json({error:'Parol kamida 4 belgi'});
  db.accounts[account].password=hashPassword(String(password)); writeData(db); res.json({ok:true});
});

app.get('/api/health',(req,res)=>res.json({ok:true,time:new Date().toISOString()}));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

app.listen(PORT,()=>console.log(`Flex Personel Cloud running on port ${PORT}`));
