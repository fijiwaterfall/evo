import http from 'node:http';
import {readFile} from 'node:fs/promises';
const assets={'/':['index.html','text/html'],'/style.css':['style.css','text/css'],'/app.mjs':['app.mjs','text/javascript'],'/core.mjs':['core.mjs','text/javascript'],'/runner.mjs':['runner.mjs','text/javascript'],'/worker.mjs':['worker.mjs','text/javascript']};
const server=http.createServer(async(req,res)=>{const asset=assets[new URL(req.url,'http://localhost').pathname];if(!asset){res.writeHead(404);res.end('Not found');return;}try{const data=await readFile(new URL(asset[0],import.meta.url));res.writeHead(200,{'Content-Type':asset[1]+'; charset=utf-8','Cache-Control':'no-store'});res.end(data);}catch{res.writeHead(500);res.end('Read error');}});
server.listen(8100,'127.0.0.1',()=>console.log('EVO basic: http://127.0.0.1:8100'));
