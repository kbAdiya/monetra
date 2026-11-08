import { createApp } from './app.js';
import { createStore } from './store.js';
const {server,store}=createApp({store:createStore(process.env.MONETRA_DB || 'data/monetra.sqlite'),authOptions:{secureCookies:process.env.NODE_ENV==='production',publicOrigin:process.env.MONETRA_ORIGIN}});
const port=Number(process.env.API_PORT || 4000);
server.listen(port,'127.0.0.1',()=>console.log(`Monetra API: http://127.0.0.1:${port}`));
server.on('error',error=>{console.error(error.message);store.close();process.exitCode=1;});
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>{store.close();process.exit(0);}));
