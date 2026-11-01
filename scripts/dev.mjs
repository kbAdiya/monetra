import { createServer } from 'vite';
import { createApp } from '../server/app.js';
const {server,store}=createApp();
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(4000,'127.0.0.1',resolve);});
let vite;
try {vite=await createServer();await vite.listen();vite.printUrls();console.log('Monetra API: http://127.0.0.1:4000');}
catch(error) {server.close();store.close();throw error;}
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=>{await vite.close();server.close(()=>{store.close();process.exit(0);});});
