import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import crypto from 'node:crypto';
import { evaluate7, describe } from './poker.js';

const app = express(); app.use(express.static('public'));
const server = createServer(app); const io = new Server(server);
const rooms = new Map();
const START_STACK = 2000, SMALL = 10, BIG = 20;
const id = () => crypto.randomBytes(4).toString('hex').toUpperCase();
const token = () => crypto.randomBytes(24).toString('hex');
const cardDeck = () => ['S','H','D','C'].flatMap(s => Array.from({length:13},(_,i)=>`${i+2}${s}`));
function shuffle(a){ for(let i=a.length-1;i>0;i--){let j=crypto.randomInt(i+1);[a[i],a[j]]=[a[j],a[i]];}return a; }
function makeRoom(){const r={id:id(),players:[],button:0,hand:0,stage:'waiting',board:[],pot:0,bet:0,minRaise:BIG,turn:null,deck:[],log:[],winnerText:'',revealed:false};rooms.set(r.id,r);return r;}
function addLog(r,s){r.log.unshift(s);r.log=r.log.slice(0,35);}
function publicState(r,viewer){return {room:r.id,stage:r.stage,hand:r.hand,button:r.button,board:r.board,pot:r.pot,bet:r.bet,minRaise:r.minRaise,turn:r.turn,smallBlind:SMALL,bigBlind:BIG,winnerText:r.winnerText,log:r.log,players:r.players.map((p,i)=>({name:p.name,seat:i,stack:p.stack,committed:p.committed,total:p.total,folded:p.folded,allin:p.allin,connected:!!p.socket,acted:p.acted,raiseAllowed:p.raiseAllowed,cards:(i===viewer || (r.revealed&&!p.folded))?p.cards:[],cardCount:p.cards.length})),you:viewer,canStart:r.players.length===2&&r.players.every(p=>p.socket)&&['waiting','finished'].includes(r.stage),canAct:r.turn===viewer&&['preflop','flop','turn','river'].includes(r.stage)};}
function broadcast(r){r.players.forEach((p,i)=>{if(p.socket)io.to(p.socket).emit('state',publicState(r,i));});}
function emitError(socket,msg){socket.emit('notice',msg);}
function saveSeat(socket,r,i){r.players[i].socket=socket.id;socket.data.room=r.id;socket.data.seat=i;socket.join(r.id);socket.emit('identity',{room:r.id,seat:i,token:r.players[i].token});broadcast(r);}
function bet(p,amount){if(!Number.isSafeInteger(amount)||amount<0||amount>p.stack)throw Error('Invalid bet');p.stack-=amount;p.committed+=amount;p.total+=amount;}
function active(r){return r.players.filter(p=>!p.folded);}
function eligible(r){return r.players.map((p,i)=>({p,i})).filter(x=>!x.p.folded&&!x.p.allin);}
function nextActor(r,after){for(let d=1;d<=2;d++){let i=(after+d)%2,p=r.players[i];if(!p.folded&&!p.allin&&(p.committed<r.bet||!p.acted))return i;}return null;}
function dealBoard(r,n){r.deck.pop();for(let i=0;i<n;i++)r.board.push(r.deck.pop());}
function awardFold(r){let w=r.players.findIndex(p=>!p.folded);r.players[w].stack+=r.pot;r.winnerText=`${r.players[w].name} wins ${r.pot} chips (fold).`;addLog(r,r.winnerText);r.pot=0;r.turn=null;r.stage='finished';r.revealed=false;}
function showdown(r){while(r.board.length<5)dealBoard(r,r.board.length===0?3:1);const a=r.players;const scores=a.map(p=>p.folded?null:evaluate7([...p.cards,...r.board]));const contenders=[0,1].filter(i=>!a[i].folded);let payouts=[0,0];
 // Each player's total contribution creates a matched pot; unmatched chips return to contributor.
 const match=Math.min(a[0].total,a[1].total);const contested=2*match;for(let i=0;i<2;i++)payouts[i]+=a[i].total-match;
 if(contenders.length===1)payouts[contenders[0]]+=contested;
 else {const cmp=compare(scores[0],scores[1]);if(cmp===0){payouts[0]+=Math.floor(contested/2);payouts[1]+=Math.floor(contested/2);if(contested%2)payouts[(r.button+1)%2]++;}else payouts[cmp>0?0:1]+=contested;}
 a.forEach((p,i)=>p.stack+=payouts[i]);r.winnerText=contenders.length===2?`${payouts[0]===payouts[1]?'Split pot':a[payouts[0]>payouts[1]?0:1].name+' wins'} — ${a.map((p,i)=>`${p.name}: ${describe(scores[i])} (+${payouts[i]})`).join(' | ')}`:`${a[contenders[0]].name} wins.`;
 addLog(r,r.winnerText);r.pot=0;r.turn=null;r.stage='finished';r.revealed=true;
}
function compare(a,b){for(let i=0;i<a.length;i++){if(a[i]!==b[i])return a[i]-b[i];}return 0;}
function finishRound(r){if(active(r).length===1){awardFold(r);return;}if(r.players.some(p=>p.allin)){showdown(r);return;}r.players.forEach(p=>{p.committed=0;p.acted=false;p.raiseAllowed=true;});r.bet=0;r.minRaise=BIG;
 if(r.stage==='preflop'){r.stage='flop';dealBoard(r,3);}else if(r.stage==='flop'){r.stage='turn';dealBoard(r,1);}else if(r.stage==='turn'){r.stage='river';dealBoard(r,1);}else {showdown(r);return;}
 addLog(r,`--- ${r.stage.toUpperCase()} ---`);r.turn=nextActor(r,r.button);
}
function advance(r,after){if(active(r).length===1){awardFold(r);return;}let next=nextActor(r,after);if(next===null)finishRound(r);else r.turn=next;}
function start(r){if(r.players.length!==2||r.players.some(p=>!p.socket))throw Error('Both players must be connected');if(!['waiting','finished'].includes(r.stage))throw Error('Hand already in progress');if(r.players.some(p=>p.stack===0)){r.players.forEach(p=>p.stack=START_STACK);addLog(r,'Stacks automatically reset to 2,000 play chips.');}
 if(r.hand>0)r.button=(r.button+1)%2;r.hand++;r.deck=shuffle(cardDeck());r.board=[];r.pot=0;r.bet=0;r.minRaise=BIG;r.stage='preflop';r.turn=null;r.winnerText='';r.revealed=false;
 r.players.forEach(p=>{p.cards=[r.deck.pop(),r.deck.pop()];p.committed=0;p.total=0;p.folded=false;p.allin=false;p.acted=false;p.raiseAllowed=true;});
 const sb=r.button,bb=1-sb;bet(r.players[sb],Math.min(SMALL,r.players[sb].stack));bet(r.players[bb],Math.min(BIG,r.players[bb].stack));r.players.forEach(p=>{if(p.stack===0)p.allin=true;});r.bet=Math.max(...r.players.map(p=>p.committed));r.pot=r.players.reduce((s,p)=>s+p.total,0);addLog(r,`Hand #${r.hand}: ${r.players[sb].name} posts small blind, ${r.players[bb].name} posts big blind.`);
 if(r.players.some(p=>p.allin))showdown(r);else r.turn=sb;
}
function action(r,seat,kind,value){if(r.turn!==seat||!['preflop','flop','turn','river'].includes(r.stage))throw Error('Not your turn');const p=r.players[seat],other=r.players[1-seat],toCall=Math.max(0,r.bet-p.committed);if(!other.socket)throw Error('Wait for your opponent to reconnect');
 if(kind==='fold'){p.folded=true;addLog(r,`${p.name} folds.`);advance(r,seat);return;}
 if(kind==='check'){if(toCall!==0)throw Error('Cannot check: you must call, raise or fold');p.acted=true;addLog(r,`${p.name} checks.`);}
 else if(kind==='call'){const paid=Math.min(toCall,p.stack);bet(p,paid);p.acted=true;if(p.stack===0)p.allin=true;addLog(r,`${p.name} ${paid<toCall?'calls all-in':'calls'} ${paid}.`);}
 else if(kind==='raise'){if(!p.raiseAllowed)throw Error('Betting has not been reopened');if(other.allin)throw Error('Cannot raise when opponent is all-in');const target=Number(value);const max=p.committed+p.stack;if(!Number.isSafeInteger(target)||target<=r.bet||target>max)throw Error(`Raise-to amount must exceed ${r.bet} and be at most ${max}`);
 const raiseSize=target-r.bet;if(raiseSize<r.minRaise&&target!==max)throw Error(`Minimum raise-to is ${r.bet+r.minRaise}, unless going all-in`);
 bet(p,target-p.committed);const full=raiseSize>=r.minRaise;if(full)r.minRaise=raiseSize;r.bet=target;p.acted=true;other.acted=false;other.raiseAllowed=full; if(p.stack===0)p.allin=true;addLog(r,`${p.name} raises to ${target}${p.allin?' (all-in)':''}.`);
 }else throw Error('Unknown action');
 r.pot=r.players.reduce((s,q)=>s+q.total,0);advance(r,seat);
}
io.on('connection',socket=>{
 socket.on('create',({name}={},ack=()=>{})=>{try{const r=makeRoom(),p={name:cleanName(name),token:token(),socket:null,stack:START_STACK,cards:[],committed:0,total:0,folded:false,allin:false,acted:false,raiseAllowed:true};r.players.push(p);saveSeat(socket,r,0);ack({ok:true,room:r.id,token:p.token});}catch(e){ack({error:e.message});}});
 socket.on('join',({room,name,token:oldToken}={},ack=()=>{})=>{try{const r=rooms.get(String(room||'').toUpperCase());if(!r)throw Error('Room not found. Check the room code.');const i=r.players.findIndex(p=>p.token===oldToken&&oldToken);if(i>=0){saveSeat(socket,r,i);ack({ok:true,room:r.id,token:oldToken});return;}if(r.players.length>=2)throw Error('Room is full');r.players.push({name:cleanName(name),token:token(),socket:null,stack:START_STACK,cards:[],committed:0,total:0,folded:false,allin:false,acted:false,raiseAllowed:true});saveSeat(socket,r,1);addLog(r,`${r.players[1].name} joined.`);ack({ok:true,room:r.id,token:r.players[1].token});}catch(e){ack({error:e.message});}});
 socket.on('start',(_,ack=()=>{})=>{try{const r=rooms.get(socket.data.room);if(!r||r.players[socket.data.seat]?.socket!==socket.id)throw Error('Join a room first');start(r);broadcast(r);ack({ok:true});}catch(e){ack({error:e.message});}});
 socket.on('act',({kind,value}={},ack=()=>{})=>{try{const r=rooms.get(socket.data.room);if(!r||r.players[socket.data.seat]?.socket!==socket.id)throw Error('Invalid seat');action(r,socket.data.seat,kind,value);broadcast(r);ack({ok:true});}catch(e){ack({error:e.message});}});
 socket.on('disconnect',()=>{const r=rooms.get(socket.data.room),p=r?.players[socket.data.seat];if(p?.socket===socket.id){p.socket=null;addLog(r,`${p.name} disconnected. Waiting for reconnection.`);broadcast(r);}});
});
function cleanName(n){const s=String(n||'Player').trim().slice(0,22);return s||'Player';}
app.get('/health',(_,res)=>res.json({ok:true}));
server.listen(process.env.PORT||3000,()=>console.log('Holdem server running'));
