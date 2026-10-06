const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const app = express();
app.use(express.json({limit:'25mb'}));
app.use(express.static(path.join(__dirname,'public')));

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname,'data.json');
const SECRET = process.env.SESSION_SECRET || 'CHANGE_ME_SESSION_SECRET_2026';
const RECOVERY = process.env.FLEX_RECOVERY_CODE || 'FLEX-2026';
const IS_PROD = process.env.NODE_ENV === 'production';
const pool = process.env.DATABASE_URL ? new Pool({connectionString:process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'false' ? false : {rejectUnauthorized:false}, max:Number(process.env.DB_POOL_MAX||10)}) : null;

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

function objectFromKey(key){
  for(const o of OBJECTS){ if(key.endsWith('_'+o.id) || key.includes('_'+o.id+'_')) return o.id; }
  const m=String(key).match(/(?:^|_)(jois|nagatino2|nagatino|preobrejenka)(?:_|$)/);
  return m ? m[1] : null;
}
function allowed(user,key){
  if (user.role==='admin') return true;
  return objectFromKey(key)===user.obj;
}

// In production use PostgreSQL. Local development keeps the original JSON fallback.
function readData(){
  if (!fs.existsSync(DATA_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(DATA_FILE,'utf8')); } catch { return null; }
}
function writeData(db){
  const tmp=DATA_FILE+'.tmp'; fs.writeFileSync(tmp, JSON.stringify(db,null,2)); fs.renameSync(tmp,DATA_FILE);
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
  return {version:2,accounts,state:{},createdAt:new Date().toISOString()};
}

let db = null;
let ready = null;
let loginAttempts = new Map();

async function seedJoisIfEmpty() {
  const src=fs.readFileSync(path.join(__dirname,'public','jois_data.js'),'utf8');
  const m=src.match(/const\s+JOIS_SEED\s*=\s*(\[[\s\S]*\]);?\s*$/);
  if(!m) return;
  const arr=JSON.parse(m[1].replace(/;\s*$/,''));
  const value=JSON.stringify(arr);
  await pool.query(`INSERT INTO app_state(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING`,['workers_jois',value]);
}

async function initDb(){
  if(!pool){
    db=readData() || makeInitial();
    writeData(db);
    if(Object.keys(db.state).length===0){
      try{
        const src=fs.readFileSync(path.join(__dirname,'public','jois_data.js'),'utf8');
        const m=src.match(/const\s+JOIS_SEED\s*=\s*(\[[\s\S]*\]);?\s*$/);
        if(m) db.state['workers_jois']=JSON.stringify(JSON.parse(m[1].replace(/;\s*$/,'')));
      }catch(e){ console.error('JOIS seed skipped:',e.message); }
      writeData(db);
    }
    return;
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, login TEXT NOT NULL UNIQUE, role TEXT NOT NULL, obj TEXT, password JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());`);
  await pool.query(`CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());`);
  const count=(await pool.query('SELECT COUNT(*)::int AS n FROM accounts')).rows[0].n;
  if(count===0){
    const initial=[
      ['admin','abduraupovsahobiddin@gmail.com','admin',null,'admin123'],
      ['jois','jois','obj','jois','jois123'],
      ['nagatino','nag1','obj','nagatino','nag1123'],
      ['nagatino2','nag2','obj','nagatino2','nag2123'],
      ['preobrejenka','prb','obj','preobrejenka','prb123']
    ];
    for(const [id,login,role,obj,password] of initial){
      await pool.query('INSERT INTO accounts(id,login,role,obj,password) VALUES($1,$2,$3,$4,$5)',[id,login,role,obj,JSON.stringify(hashPassword(password))]);
    }
  }
  const n=(await pool.query('SELECT COUNT(*)::int AS n FROM app_state')).rows[0].n;
  if(n===0){ try{ await seedJoisIfEmpty(); }catch(e){ console.error('JOIS seed skipped:',e.message); } }
}

async function listAccounts(){
  if(!pool) return db.accounts;
  const rows=(await pool.query('SELECT id,login,role,obj,password FROM accounts')).rows;
  return Object.fromEntries(rows.map(a=>[a.id,a]));
}
async function findAccount(login){
  if(!pool) return Object.entries(db.accounts).find(([,a])=>a.login.toLowerCase()===login.toLowerCase());
  const r=await pool.query('SELECT id,login,role,obj,password FROM accounts WHERE lower(login)=lower($1) LIMIT 1',[login]);
  return r.rows[0] ? [r.rows[0].id,r.rows[0]] : null;
}
async function getStateForUser(user){
  if(!pool){ const state={}; for(const [k,v] of Object.entries(db.state)) if(allowed(user,k)) state[k]=v; return state; }
  const rows=(await pool.query('SELECT key,value FROM app_state')).rows;
  return Object.fromEntries(rows.filter(r=>allowed(user,r.key)).map(r=>[r.key,r.value]));
}

ready=initDb();
app.use(async (req,res,next)=>{ try{await ready; next();}catch(e){console.error(e);res.status(503).json({error:'DATABASE_NOT_READY'});} });

app.get('/api/me',auth,async(req,res)=>res.json({user:req.user,objects:OBJECTS}));

app.post('/api/login',async(req,res)=>{
  const login=String(req.body?.login||'').trim().toLowerCase();
  const password=String(req.body?.password||'');
  const now=Date.now(), prev=loginAttempts.get(login)||{n:0,until:0};
  if(prev.until>now) return res.status(429).json({error:'Juda ko‘p urinish. Bir necha daqiqadan keyin qayta urinib ko‘ring.'});
  const entry=await findAccount(login);
  if(!entry || !verifyPassword(password,entry[1].password)){
    const n=prev.n+1; loginAttempts.set(login,n>=5?{n:0,until:now+5*60*1000}:{n,until:0});
    return res.status(401).json({error:'Login yoki parol noto\'g\'ri'});
  }
  loginAttempts.delete(login);
  const [id,a]=entry;
  const user={id,login:a.login,role:a.role,obj:a.obj||null,exp:Date.now()+1000*60*60*24*30};
  const secure=IS_PROD?' Secure;':'';
  res.setHeader('Set-Cookie',`flex_session=${encodeURIComponent(sign(user))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60*60*24*30};${secure}`);
  res.json({ok:true,user,objects:OBJECTS});
});

app.post('/api/logout',(req,res)=>{res.setHeader('Set-Cookie','flex_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');res.json({ok:true});});

app.get('/api/bootstrap',auth,async(req,res)=>{
  const state=await getStateForUser(req.user);
  const accounts={};
  if(req.user.role==='admin'){
    const all=await listAccounts();
    for(const [id,a] of Object.entries(all)) accounts[id]={login:a.login,role:a.role,obj:a.obj||null};
  }
  res.json({user:req.user,objects:OBJECTS,state,accounts});
});

app.put('/api/state',auth,async(req,res)=>{
  const key=String(req.body?.key||'');
  if(!key || key.length>300) return res.status(400).json({error:'Invalid key'});
  if(!allowed(req.user,key)) return res.status(403).json({error:'FORBIDDEN'});
  if(pool){
    if(req.body.remove) await pool.query('DELETE FROM app_state WHERE key=$1',[key]);
    else await pool.query('INSERT INTO app_state(key,value,updated_at) VALUES($1,$2,now()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()',[key,JSON.stringify(req.body.value)]);
  } else {
    if(req.body.remove) delete db.state[key]; else db.state[key]=JSON.stringify(req.body.value);
    writeData(db);
  }
  res.json({ok:true});
});

app.put('/api/accounts',auth,async(req,res)=>{
  if(req.user.role!=='admin') return res.status(403).json({error:'FORBIDDEN'});
  const accounts=req.body?.accounts;
  if(!accounts || typeof accounts!=='object') return res.status(400).json({error:'Invalid accounts'});
  const ids=['admin','jois','nagatino','nagatino2','preobrejenka']; const logins=new Set();
  for(const id of ids){
    const x=accounts[id]; if(!x || !String(x.login||'').trim()) return res.status(400).json({error:'Login bo\'sh bo\'lmasin'});
    const login=String(x.login).trim(); if(logins.has(login.toLowerCase())) return res.status(400).json({error:'Loginlar takrorlanmasin'}); logins.add(login.toLowerCase());
  }
  for(const id of ids){
    const x=accounts[id], login=String(x.login).trim();
    if(pool){
      if(x.password) { if(String(x.password).length<4) return res.status(400).json({error:'Parol kamida 4 belgi'}); await pool.query('UPDATE accounts SET login=$1,password=$2,updated_at=now() WHERE id=$3',[login,JSON.stringify(hashPassword(String(x.password))),id]); }
      else await pool.query('UPDATE accounts SET login=$1,updated_at=now() WHERE id=$2',[login,id]);
    } else { db.accounts[id].login=login; if(x.password){ if(String(x.password).length<4) return res.status(400).json({error:'Parol kamida 4 belgi'}); db.accounts[id].password=hashPassword(String(x.password)); } }
  }
  if(!pool) writeData(db);
  res.json({ok:true});
});

app.post('/api/reset-password',async(req,res)=>{
  const {account,code,password}=req.body||{};
  if(code!==RECOVERY) return res.status(400).json({error:'Tiklash kodi noto\'g\'ri'});
  if(!['admin','jois','nagatino','nagatino2','preobrejenka'].includes(account)) return res.status(400).json({error:'Hisob noto\'g\'ri'});
  if(String(password||'').length<4) return res.status(400).json({error:'Parol kamida 4 belgi'});
  if(pool) await pool.query('UPDATE accounts SET password=$1,updated_at=now() WHERE id=$2',[JSON.stringify(hashPassword(String(password))),account]);
  else { db.accounts[account].password=hashPassword(String(password)); writeData(db); }
  res.json({ok:true});
});

app.get('/api/health',async(req,res)=>{ if(pool) await pool.query('SELECT 1'); res.json({ok:true,time:new Date().toISOString(),database:pool?'postgres':'local-file'}); });
app.get('/api/storage-info',auth,async(req,res)=>{
  if(req.user.role!=='admin') return res.status(403).json({error:'FORBIDDEN'});
  if(pool){ const n=(await pool.query('SELECT COUNT(*)::int AS n FROM app_state')).rows[0].n; res.json({mode:'postgres',stateKeys:n}); }
  else res.json({mode:'local-file',stateKeys:Object.keys(db.state).length});
});

app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

app.listen(PORT,()=>console.log(`Flex Personel Cloud running on port ${PORT} | DB=${pool?'PostgreSQL':'local-file'}`));
