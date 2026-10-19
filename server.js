import express from 'express';
import {createServer} from 'node:http';
import {Server} from 'socket.io';
import crypto from 'node:crypto';
import {evaluate7,describe} from './poker.js';
const app=express();app.use(express.static('public'));const server=createServer(app),io=new Server(server);const rooms=new Map();
const START=2000,SB=10,BB=20,MAX=6,stages=['preflop','flop','turn','river'];
const uid=()=>crypto.randomBytes(4).toString('hex').toUpperCase(),token=()=>crypto.randomBytes(24).toString('hex');
const deck=()=>['S','H','D','C'].flatMap(s=>Array.from({length:13},(_,i)=>`${i+2}${s}`));
function shuffle(a){for(let i=a.length-1;i>0;i--){let j=crypto.randomInt(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;}
function compare(a,b){for(let i=0;i<a.length;i++)if(a[i]!==b[i])return a[i]-b[i];return 0;}
function room(){let r={id:uid(),players:[],button:-1,hand:0,stage:'waiting',board:[],pot:0,bet:0,minRaise:BB,turn:null,deck:[],log:[],report:null,revealed:false,actedSinceFullRaise:new Set()};rooms.set(r.id,r);return r;}
function log(r,s){r.log.unshift(s);r.log=r.log.slice(0,70);}
function name(n){return String(n||'Player').trim().slice(0,22)||'Player';}
function newPlayer(n){return {name:name(n),token:token(),socket:null,stack:START,cards:[],committed:0,total:0,folded:false,allin:false,acted:false,raiseAllowed:true,inHand:false};}
function connected(r){return r.players.map((p,i)=>i).filter(i=>r.players[i].socket);}
function live(r){return r.players.map((p,i)=>i).filter(i=>p.inHand&&!p.folded);}
function actors(r){return live(r).filter(i=>!r.players[i].allin);}
function next(r,from,filter){for(let n=1;n<=r.players.length;n++){let i=(from+n)%r.players.length;if(filter(i))return i;}return null;}
function needs(r,i){let p=r.players[i];return p.inHand&&!p.folded&&!p.allin&&(!p.acted||p.committed<r.bet);}
function nextActor(r,from){return next(r,from,i=>needs(r,i));}
function chips(p,n){if(!Number.isSafeInteger(n)||n<0||n>p.stack)throw Error('Invalid chip amount');p.stack-=n;p.committed+=n;p.total+=n;if(!p.stack)p.allin=true;}
function syncPot(r){r.pot=r.players.reduce((sum,p)=>sum+p.total,0);}
function board(r,n){r.deck.pop();for(let i=0;i<n;i++)r.board.push(r.deck.pop());}
function publish(r,i){return {room:r.id,stage:r.stage,hand:r.hand,button:r.button,board:r.board,pot:r.pot,bet:r.bet,minRaise:r.minRaise,turn:r.turn,smallBlind:SB,bigBlind:BB,report:r.report,log:r.log,you:i,players:r.players.map((p,j)=>({name:p.name,seat:j,stack:p.stack,committed:p.committed,total:p.total,folded:p.folded,allin:p.allin,connected:!!p.socket,acted:p.acted,raiseAllowed:p.raiseAllowed,inHand:p.inHand,cards:j===i||(r.revealed&&p.inHand&&!p.folded)?p.cards:[],cardCount:p.cards.length})),canStart:['waiting','finished'].includes(r.stage)&&connected(r).length>=2,canAct:r.turn===i&&stages.includes(r.stage)};}
function broadcast(r){r.players.forEach((p,i)=>{if(p.socket)io.to(p.socket).emit('state',publish(r,i));});}
function save(socket,r,i){let p=r.players[i];if(p.socket&&p.socket!==socket.id)io.to(p.socket).emit('notice','Your seat was opened on another device.');p.socket=socket.id;socket.data.room=r.id;socket.data.seat=i;socket.join(r.id);socket.emit('identity',{room:r.id,seat:i,token:p.token});broadcast(r);}
function finish(r,report,reveal){r.report=report;r.stage='finished';r.turn=null;r.revealed=reveal;r.pot=0;log(r,report.summary);}
function foldWin(r){const i=live(r)[0],p=r.players[i],amount=r.pot;p.stack+=amount;finish(r,{type:'fold',summary:`${p.name} wins ${amount} chips uncontested: every other player folded.`,ranking:[],pots:[{label:'Pot',amount,winners:[p.name],reason:'All other players folded.'}],returns:[]},false);}
function showdown(r){while(r.board.length<5)board(r,r.board.length===0?3:1);syncPot(r);let scores=r.players.map(p=>p.inHand&&!p.folded?evaluate7([...p.cards,...r.board]):null);const ranking=live(r).sort((a,b)=>compare(scores[b],scores[a])).map((i,rank)=>({seat:i,name:r.players[i].name,cards:r.players[i].cards,score:scores[i],hand:describe(scores[i]),rank:rank+1,tied:rank>0&&compare(scores[i],scores[live(r).sort((a,b)=>compare(scores[b],scores[a]))[rank-1]])===0}));
 const levels=[...new Set(r.players.filter(p=>p.inHand&&p.total>0).map(p=>p.total))].sort((a,b)=>a-b);let previous=0,pots=[],returns=[],payout=Array(r.players.length).fill(0);
 for(const level of levels){const contributors=r.players.map((p,i)=>i).filter(i=>r.players[i].inHand&&r.players[i].total>=level);const amount=(level-previous)*contributors.length;previous=level;if(!amount)continue;
 const contenders=contributors.filter(i=>!r.players[i].folded);if(contributors.length===1){payout[contributors[0]]+=amount;returns.push({name:r.players[contributors[0]].name,amount});continue;}
 if(!contenders.length)throw Error('Pot without eligible players');let best=contenders[0];for(const i of contenders)if(compare(scores[i],scores[best])>0)best=i;let winners=contenders.filter(i=>compare(scores[i],scores[best])===0);let share=Math.floor(amount/winners.length),odd=amount%winners.length;for(const i of winners)payout[i]+=share;
 // Odd chips go to the first winning seat clockwise from the button.
 let order=[...winners].sort((a,b)=>((a-r.button+r.players.length)%r.players.length)-((b-r.button+r.players.length)%r.players.length));for(let j=0;j<odd;j++)payout[order[j]]++;
 pots.push({label:pots.length?'Side pot '+pots.length:'Main pot',amount,winners:winners.map(i=>r.players[i].name),hand:describe(scores[best]),eligible:contenders.map(i=>r.players[i].name),oddChips:odd,reason:winners.length>1?`Tied ${describe(scores[best]).toLowerCase()}; split ${amount} chips${odd?' with odd chip awarded clockwise from the dealer':''}.`:`${r.players[best].name}'s ${describe(scores[best]).toLowerCase()} is highest among players eligible for this pot.`});}
 r.players.forEach((p,i)=>p.stack+=payout[i]);let summary=pots.map(p=>`${p.label}: ${p.winners.join(' and ')} ${p.winners.length>1?'split':'win'} ${p.amount} chips (${p.hand}).`).join(' ');if(returns.length)summary+=' Uncalled chips returned: '+returns.map(x=>`${x.amount} to ${x.name}`).join(', ')+'.';
 finish(r,{type:'showdown',summary,ranking,pots,returns,payouts:r.players.map((p,i)=>({name:p.name,amount:payout[i]})).filter(p=>p.amount)},true);
}
function nextStreet(r){if(r.stage==='river'){showdown(r);return;}r.stage=stages[stages.indexOf(r.stage)+1];board(r,r.stage==='flop'?3:1);r.bet=0;r.minRaise=BB;r.actedSinceFullRaise.clear();r.players.forEach(p=>{p.committed=0;p.acted=false;p.raiseAllowed=true;});log(r,`--- ${r.stage.toUpperCase()} ---`);r.turn=nextActor(r,r.button);if(r.turn===null)showdown(r);}
function advance(r,from){syncPot(r);if(live(r).length===1){foldWin(r);return;}const can=actors(r);if(can.length===0){showdown(r);return;}if(can.length===1&&r.players[can[0]].committed>=r.bet){showdown(r);return;}let nxt=nextActor(r,from);if(nxt!==null){r.turn=nxt;return;}nextStreet(r);}
function start(r){if(!['waiting','finished'].includes(r.stage))throw Error('Hand already running');let seats=connected(r).filter(i=>r.players[i].stack>0);if(seats.length<2)throw Error('At least two connected players with chips required');r.hand++;r.deck=shuffle(deck());r.board=[];r.pot=0;r.bet=0;r.minRaise=BB;r.stage='preflop';r.turn=null;r.report=null;r.revealed=false;r.actedSinceFullRaise.clear();
 r.players.forEach((p,i)=>{p.cards=[];p.committed=0;p.total=0;p.folded=false;p.allin=false;p.acted=false;p.raiseAllowed=true;p.inHand=seats.includes(i);});r.button=next(r,r.button<0?r.players.length-1:r.button,i=>seats.includes(i));const sb=seats.length===2?r.button:next(r,r.button,i=>seats.includes(i)),bb=next(r,sb,i=>seats.includes(i));
 // Deal cards one at a time, beginning with the small blind.
 let cursor=sb;for(let round=0;round<2;round++){for(let k=0;k<seats.length;k++){r.players[cursor].cards.push(r.deck.pop());cursor=next(r,cursor,i=>seats.includes(i));}}
 chips(r.players[sb],Math.min(SB,r.players[sb].stack));chips(r.players[bb],Math.min(BB,r.players[bb].stack));r.bet=Math.max(...seats.map(i=>r.players[i].committed));syncPot(r);log(r,`Hand #${r.hand}: ${r.players[sb].name} posts small blind; ${r.players[bb].name} posts big blind.`);r.turn=nextActor(r,bb);if(r.turn===null)showdown(r);}
function action(r,i,kind,value){if(r.turn!==i||!stages.includes(r.stage))throw Error('Not your turn');const p=r.players[i],due=Math.max(0,r.bet-p.committed);if(kind==='fold'){p.folded=true;log(r,`${p.name} folds.`);advance(r,i);return;}
 if(kind==='check'){if(due)throw Error('Cannot check when facing a bet');p.acted=true;log(r,`${p.name} checks.`);}
 else if(kind==='call'){let n=Math.min(due,p.stack);chips(p,n);p.acted=true;log(r,`${p.name} calls ${n}${p.allin?' (all-in)':''}.`);}
 else if(kind==='raise'){if(!p.raiseAllowed)throw Error('Betting not reopened for you');if(actors(r).length<2)throw Error('No other player can respond to a raise');let target=Number(value),max=p.committed+p.stack;if(!Number.isSafeInteger(target)||target<=r.bet||target>max)throw Error(`Raise-to must be greater than ${r.bet} and at most ${max}`);let size=target-r.bet;if(size<r.minRaise&&target!==max)throw Error(`Minimum raise-to ${r.bet+r.minRaise}, unless all-in`);chips(p,target-p.committed);const full=size>=r.minRaise;if(full){r.minRaise=size;r.actedSinceFullRaise.clear();}r.bet=target;p.acted=true;log(r,`${p.name} raises to ${target}${p.allin?' (all-in)':''}.`);for(let j=0;j<r.players.length;j++)if(j!==i&&r.players[j].inHand&&!r.players[j].folded){r.players[j].acted=false;if(!full&&r.actedSinceFullRaise.has(j))r.players[j].raiseAllowed=false;else if(full)r.players[j].raiseAllowed=true;}}
 else throw Error('Unknown action');r.actedSinceFullRaise.add(i);advance(r,i);}
io.on('connection',socket=>{
 socket.on('create',({name:n}={},ack=()=>{})=>{try{let r=room(),p=newPlayer(n);r.players.push(p);save(socket,r,0);ack({ok:true,room:r.id,token:p.token});}catch(e){ack({error:e.message});}});
 socket.on('join',({room:code,name:n,token:t}={},ack=()=>{})=>{try{let r=rooms.get(String(code||'').toUpperCase());if(!r)throw Error('Room not found');let i=r.players.findIndex(p=>t&&p.token===t);if(i>=0){save(socket,r,i);ack({ok:true,room:r.id,token:t});return;}if(r.players.length>=MAX)throw Error('Room full (six players)');if(!['waiting','finished'].includes(r.stage))throw Error('Wait until this hand finishes before joining');let p=newPlayer(n);r.players.push(p);i=r.players.length-1;save(socket,r,i);log(r,`${p.name} joined seat ${i+1}.`);ack({ok:true,room:r.id,token:p.token});}catch(e){ack({error:e.message});}});
 socket.on('start',(_,ack=()=>{})=>{try{let r=rooms.get(socket.data.room);if(r?.players[socket.data.seat]?.socket!==socket.id)throw Error('Join first');start(r);broadcast(r);ack({ok:true});}catch(e){ack({error:e.message});}});
 socket.on('act',({kind,value}={},ack=()=>{})=>{try{let r=rooms.get(socket.data.room);if(r?.players[socket.data.seat]?.socket!==socket.id)throw Error('Invalid seat');action(r,socket.data.seat,kind,value);broadcast(r);ack({ok:true});}catch(e){ack({error:e.message});}});
 socket.on('rebuy',(_,ack=()=>{})=>{try{let r=rooms.get(socket.data.room),p=r?.players[socket.data.seat];if(!p||p.socket!==socket.id)throw Error('Join first');if(!['waiting','finished'].includes(r.stage))throw Error('Wait until the hand finishes');if(p.stack!==0)throw Error('Rebuy is available at zero chips');p.stack=START;log(r,`${p.name} replenished 2,000 play chips.`);broadcast(r);ack({ok:true});}catch(e){ack({error:e.message});}});
 socket.on('disconnect',()=>{let r=rooms.get(socket.data.room),p=r?.players[socket.data.seat];if(p?.socket===socket.id){p.socket=null;log(r,`${p.name} disconnected; seat reserved for reconnect.`);broadcast(r);}});
});
app.get('/health',(_,res)=>res.json({ok:true}));server.listen(process.env.PORT||3000,()=>console.log('Holdem Friends running'));
