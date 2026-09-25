import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {Worker} from 'node:worker_threads';
const port=Number(process.env.PORT)||8098,host='127.0.0.1';
const worker=new Worker(new URL('./live-worker.mjs',import.meta.url));let seq=0;const pending=new Map();
worker.on('message',m=>{const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error)):p.resolve(m.result);}});
worker.on('error',e=>{console.error(e);for(const p of pending.values())p.reject(e);pending.clear();});
function ask(data){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('Рушій не відповів вчасно'));},30000);pending.set(id,{resolve,reject,timer});worker.postMessage({id,...data});});}
const assets={'/':['index.html','text/html'],'/app.mjs':['app.mjs','text/javascript'],'/style.css':['style.css','text/css']};
const server=http.createServer(async(req,res)=>{
  const send=(status,data,type='application/json')=>{res.writeHead(status,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(type==='application/json'?JSON.stringify(data):data);};
  try{const u=new URL(req.url,`http://${host}:${port}`);
    if(req.method==='GET'&&assets[u.pathname]){const [file,type]=assets[u.pathname];return send(200,await readFile(new URL(`./web/${file}`,import.meta.url)),type);}
    if(req.method==='GET'&&u.pathname==='/api/state')return send(200,await ask({type:'state',selected:Number(u.searchParams.get('selected'))}));
    if(req.method==='GET'&&u.pathname==='/api/checkpoint')return send(200,await ask({type:'checkpoint'}));
    if(req.method==='POST'&&u.pathname==='/api/control'){
      if(req.headers.origin&&req.headers.origin!==`http://${host}:${port}`&&req.headers.origin!==`http://localhost:${port}`)return send(403,{error:'Недозволене джерело запиту'});
      if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'Потрібний JSON'});
      let body='',bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>50*1024*1024)return send(413,{error:'Файл завеликий'});body+=chunk;}
      const command=JSON.parse(body);if(!['run','step','reset','restore'].includes(command.type))throw Error('Невідома команда');return send(200,await ask(command));
    }
    send(404,{error:'Не знайдено'});
  }catch(e){send(400,{error:e.message});}
});
server.listen(port,host,()=>console.log(`Reaction Lab: http://${host}:${port}`));
process.on('SIGINT',()=>{worker.terminate();server.close(()=>process.exit(0));});
