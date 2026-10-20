const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');
const {hashPassword,verifyPassword,tokenHash,ensureAuth,currentUser,setCookie} = require('../lib/auth');
module.exports = async (req,res) => {
  res.setHeader('Cache-Control','no-store');
  try {
    const sql = neon(process.env.DATABASE_URL);
    await ensureAuth(sql);
    const body = req.body || {};
    const action = body.action || 'status';
    const user = await currentUser(sql,req);
    if (action === 'status') return res.json({authenticated:!!user,user});
    if (req.method !== 'POST') return res.status(405).json({error:'Method not allowed'});
    if (req.headers.origin && req.headers.host && new URL(req.headers.origin).host !== req.headers.host) return res.status(403).json({error:'Invalid origin'});
    if (action === 'login') {
      const attemptKey = tokenHash(`${String(req.headers['x-forwarded-for'] || '').split(',')[0]}:${String(body.username || '').trim()}`);
      const attempts = await sql.query(`INSERT INTO app_login_attempts(attempt_key) VALUES($1)
        ON CONFLICT(attempt_key) DO UPDATE SET
          attempts=CASE WHEN app_login_attempts.window_start<now()-interval '15 minutes' THEN 1 ELSE app_login_attempts.attempts+1 END,
          window_start=CASE WHEN app_login_attempts.window_start<now()-interval '15 minutes' THEN now() ELSE app_login_attempts.window_start END RETURNING attempts`,[attemptKey]);
      if (Number(attempts[0].attempts)>10) return res.status(429).json({error:'محاولات دخول كثيرة، حاول بعد 15 دقيقة'});
      // Bootstrap the existing administrator once; credentials are never sent to the browser.
      const users = await sql.query('SELECT id FROM app_users LIMIT 1');
      if (!users.length) {
        const username = process.env.INITIAL_ADMIN_USERNAME || 'ahmed';
        const password = process.env.INITIAL_ADMIN_PASSWORD || '123456789';
        if (body.username !== username || body.password !== password) return res.status(401).json({error:'بيانات الدخول غير صحيحة'});
        await sql.query(`INSERT INTO app_users(username,password_hash,role) VALUES($1,$2,'admin') ON CONFLICT(username) DO NOTHING`,[username,await hashPassword(password)]);
      }
      const rows = await sql.query('SELECT * FROM app_users WHERE username=$1 AND active=true',[String(body.username || '').trim()]);
      if (!rows[0] || !(await verifyPassword(body.password || '',rows[0].password_hash))) return res.status(401).json({error:'بيانات الدخول غير صحيحة'});
      const token = crypto.randomBytes(32).toString('hex');
      await sql.query(`INSERT INTO app_sessions VALUES($1,$2,now()+interval '12 hours')`,[tokenHash(token),rows[0].id]);
      await sql.query('DELETE FROM app_login_attempts WHERE attempt_key=$1',[attemptKey]);
      setCookie(res,token,req);
      return res.json({authenticated:true,user:{id:rows[0].id,username:rows[0].username,role:rows[0].role}});
    }
    if (!user) return res.status(401).json({error:'سجل الدخول أولًا'});
    if (action === 'logout') {
      await sql.query('DELETE FROM app_sessions WHERE user_id=$1',[user.id]);
      setCookie(res,'',req,true); return res.json({success:true});
    }
    if (user.role !== 'admin') return res.status(403).json({error:'هذه العملية للمدير فقط'});
    if (action === 'list') return res.json({users:await sql.query('SELECT id,username,role,active,created_at FROM app_users ORDER BY id')});
    const username = String(body.username || '').trim();
    const role = body.role === 'admin' ? 'admin' : 'user';
    if (!username) throw new Error('اسم المستخدم مطلوب');
    if (action === 'create') {
      await sql.query('INSERT INTO app_users(username,password_hash,role) VALUES($1,$2,$3)',[username,await hashPassword(body.password || ''),role]);
    } else if (action === 'update') {
      const passwordHash = body.password ? await hashPassword(body.password) : null;
      // Serialize role/activation changes to preserve at least one active administrator.
      const result = await sql.transaction([
        sql.query(`SELECT pg_advisory_xact_lock(781352)`),
        sql.query(`UPDATE app_users SET username=$2,role=$3,active=$4,password_hash=COALESCE($5,password_hash)
          WHERE id=$1 AND (NOT(role='admin' AND active=true) OR ($3='admin' AND $4=true)
            OR (SELECT count(*) FROM app_users WHERE role='admin' AND active=true)>1) RETURNING id`,
          [body.id,username,role,body.active !== false,passwordHash]),
      ]);
      if (!result[1].length) throw new Error('لا يمكن تعطيل آخر مدير فعال');
      await sql.query('DELETE FROM app_sessions WHERE user_id=$1',[body.id]);
    } else throw new Error('Invalid action');
    return res.json({success:true});
  } catch(error) { return res.status(400).json({error:error.message}); }
};
