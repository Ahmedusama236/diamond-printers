const crypto = require('node:crypto');
const {Pool,neonConfig} = require('@neondatabase/serverless');
const {createBusiness} = require('./business.cjs');
neonConfig.webSocketConstructor = require('ws');

const tables = new Set(['suppliers','components','component_price_history','component_intake_records','products','bom_items','manufacturing_records','sales_records','damage_records','finished_stock','inventory_ledger','settings','maintenance_tickets','maintenance_parts','printer_sales']);
function identifier(value) {
  if(!/^[a-z_][a-z0-9_]*$/.test(value))throw new Error('Invalid column');
  return '"'+value+'"';
}
function normalize(result) {
  return result.rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>{
    const field=result.fields.find(f=>f.name===key);
    return [key,value instanceof Date?value.toISOString():value!=null&&[20,21,23,700,701,1700].includes(field?.dataTypeID)?Number(value):value];
  })));
}
function adapter(client) {return async input=>{
  if(!tables.has(input.table))throw new Error('Table not allowed');
  const table=identifier(input.table),values=[];
  const bind=value=>{values.push(value);return '$'+values.length;};
  const conditions=(input.eq||[]).map(([key,value])=>value==null?identifier(key)+' IS NULL':identifier(key)+' = '+bind(value));
  for(const [key,value] of input.ilike||[])conditions.push(identifier(key)+' ILIKE '+bind(value));
  let statement;
  if(input.action==='select') {
    statement='SELECT * FROM '+table+(conditions.length?' WHERE '+conditions.join(' AND '):'');
    if(input.order?.length)statement+=' ORDER BY '+input.order.map(([key,asc])=>identifier(key)+(asc?' ASC':' DESC')).join(',');
    if(input.limit){if(!Number.isInteger(input.limit)||input.limit<1||input.limit>10000)throw new Error('Invalid limit');statement+=' LIMIT '+input.limit;}
  } else if(input.action==='insert') {
    const entries=Object.entries(input.payload||{});if(!entries.length)throw new Error('Empty insert');
    statement='INSERT INTO '+table+' ('+entries.map(([key])=>identifier(key)).join(',')+') VALUES ('+entries.map(([,value])=>bind(value)).join(',')+')';
    if(input.table==='printer_sales')statement+=' ON CONFLICT(request_id) DO UPDATE SET request_id=EXCLUDED.request_id';
    statement+=' RETURNING *';
  } else if(input.action==='update') {
    if(!input.eq?.length)throw new Error('Update filter required');
    const entries=Object.entries(input.payload||{});if(!entries.length)throw new Error('Empty update');
    statement='UPDATE '+table+' SET '+entries.map(([key,value])=>identifier(key)+' = '+bind(value)).join(',')+' WHERE '+conditions.join(' AND ')+' RETURNING *';
  } else if(input.action==='delete') {
    if(!input.eq?.length)throw new Error('Delete filter required');
    statement='DELETE FROM '+table+' WHERE '+conditions.join(' AND ')+' RETURNING *';
  } else throw new Error('Invalid operation');
  return normalize(await client.query(statement,values));
};}

async function executeOperation(connectionString,user,input, poolOverride) {
  const method=String(input.method||'GET').toUpperCase();
  const path=String(input.path||'');
  if(!['GET','POST','PUT','DELETE'].includes(method)||!path.startsWith('/')||path.length>2000)throw new Error('Invalid request');
  const mutating=method!=='GET';
  if(mutating&&!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(input.request_id||''))throw new Error('Invalid request ID');
  const pool=poolOverride||new Pool({connectionString,max:1,connectionTimeoutMillis:10000});
  let client;
  try {
    client=await pool.connect();
    await client.query(mutating?'BEGIN':'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '20s'");
    if(mutating) {
      // One business lock makes multi-table stock changes and edits serializable.
      await client.query('SELECT pg_advisory_xact_lock(781353)');
      const previous=await client.query('SELECT result, fingerprint FROM app_operation_requests WHERE user_id=$1 AND request_id=$2',[user.id,input.request_id]);
      const fingerprint=crypto.createHash('sha256').update(JSON.stringify({method,path,body:input.body||{}})).digest('hex');
      if(previous.rows.length) {
        if(previous.rows[0].fingerprint!==fingerprint)throw new Error('Request ID already used');
        await client.query('COMMIT');return previous.rows[0].result;
      }
      const result=await createBusiness(adapter(client)).request(path,{method,body:JSON.stringify(input.body||{})});
      await client.query('INSERT INTO app_operation_requests(user_id,request_id,fingerprint,result) VALUES($1,$2,$3,$4::jsonb)',[user.id,input.request_id,fingerprint,JSON.stringify(result)]);
      await client.query('COMMIT');return result;
    }
    const result=await createBusiness(adapter(client)).request(path,{method});
    await client.query('COMMIT');return result;
  } catch(error) {
    if(client)await client.query('ROLLBACK').catch(()=>{});throw error;
  } finally {client?.release();if(!poolOverride)await pool.end();}
}
module.exports={executeOperation,adapter};
