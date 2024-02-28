import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';

class Player{
	constructor(ws){
		this.score=0;
		this.ws=ws;
		this.chunkPos=[0,0];
		this.id=uuidv4();
	}
	get score(){
		return this._score;
	}
	set score(val){
		this._score=val;
		//send to player
	}
}

class Cell{
	constructor(isMine, chunk, x, y){
		this.isMine=isMine;
		this.chunk=chunk;
		this.x=x;
		this.y=y;
		this.revealed=false;
		this.flagged=false;
		this.canTurnOver=true;
	}
	click(player){
		if(this.revealed||this.flagged) return;
		this.revealed=true;
		if(this.isMine){
			this.revealed=false;
			//explode
			return;
		}
		if(player) player.score+=0.1;

		let hasMines=false;
		for(let y=-1;y<=1;y++){
			for(let x=-1;x<=1;x++){
				hasMines=hasMines||this.offset(x,y).isMine;
				if(hasMines) break;
			}
		}
		if(!hasMines){
			for(let y=-1;y<=1;y++){
				for(let x=-1;x<=1;x++){
					this.offset(x,y).click();
				}
			}
		}
	}
	tryFlag(player){
		if(this.revealed) return;
		this.flagged=!this.flagged;
		player.score+=this.isMine==this.flagged?1:-1;
	}

	left(){
		if(this.x==0) return getChunk(this.chunk.x-1,this.chunk.y).cells[this.y][15];
		return this.chunk.cells[this.y][this.x-1];
	}
	right(){
		if(this.x==15) return getChunk(this.chunk.x+1,this.chunk.y).cells[this.y][0];
		return this.chunk.cells[this.y][this.x+1];
	}
	up(){
		if(this.y==0) return getChunk(this.chunk.x,this.chunk.y-1).cells[15][this.x];
		return this.chunk.cells[this.y-1][this.x];
	}
	down(){
		if(this.y==15) return getChunk(this.chunk.x,this.chunk.y+1).cells[0][this.x];
		return this.chunk.cells[this.y+1][this.x];
	}
	offset(x,y){
		let currCell=this;
		while(x>0){
			currCell=currCell.right();
			x--;
		}
		while(x<0){
			currCell=currCell.left();
			x++;
		}
		while(y>0){
			currCell=currCell.down();
			y--;
		}
		while(y<0){
			currCell=currCell.up();
			y++;
		}
		return currCell;
	}

	toJsonObj(){
		return (this.flagged?4:0)+(this.revealed?2:0)+(this.isMine?1:0);
	}
}

class Chunk{
	constructor(x, y){
		this.x=x;
		this.y=y;
		this.loaded=false;

		this.cells=[];
		for(let y=0;y<16;y++){
			this.cells[y]=[];
			for(let x=0;x<16;x++){
				this.cells[y][x]=undefined;
			}
		}
	}
	load(generator){
		for(let y=0;y<16;y++)
			for(let x=0;x<16;x++)
				this.cells[y][x]=generator(x,y,this);
		this.loaded=true;
	}

	toJsonObj(){
		return {
			map:this.cells.map(r=>r.map(c=>c.toJsonObj())).flat(), 
			features:{}
		};
	}
}

const chunks = {};
const DEFAULT_GENERATOR = (x,y,chunk)=>new Cell(Math.random()<0.2,chunk,x,y);
function getChunk(x,y){
	let toReturn = chunks[x+","+y];
	if(toReturn){
		if(!toReturn.loaded) toReturn.load(DEFAULT_GENERATOR);
		return toReturn;
	}

	toReturn = new Chunk(x,y);
	toReturn.load(DEFAULT_GENERATOR);
	chunks[x+","+y]=toReturn;
	return toReturn;
}

//--

function reply(ws, channel, data, id){
	ws.send(JSON.stringify({channel, data, id}));
}
function getPlayersInRange(pos){
	return Object.values(players).filter(player=>{
		return Math.abs(player.chunkPos[0]-pos[0]<=3)&&Math.abs(player.chunkPos[1]-pos[1]<=3);
	});
}

const wss = new WebSocketServer({ noServer: true });
const players={};//todo: sort players into mega chunks
wss.on('connection', ws => {
	const thisPlayer = new Player(ws);
	players[thisPlayer.id]=thisPlayer;

	ws.on('error', ws.close);
	ws.on('close', ()=>{
		delete players[thisPlayer.id];
	});

	ws.on('message', data => {
		try{
			const message=JSON.parse(data.toString());
			let id = message.id;
			switch(message.channel){
				case "chunk":
					if(!Number.isInteger(message.data.x)||!Number.isInteger(message.data.y))
						reply(ws, "error", "Invalid chunk coords", id);
					else
						reply(ws, "chunk", getChunk(message.data.x,message.data.y).toJsonObj(), id);
					break;
				case "click":
					if(!Number.isInteger(message.data.cx)||!Number.isInteger(message.data.cy)||
						!Number.isInteger(message.data.x)||!Number.isInteger(message.data.y))
						reply(ws, "error", "Invalid coords", id);
					else{
						thisPlayer.chunkPos=[message.data.cx,message.data.cy];
						getChunk(message.data.cx, message.data.cy).cells[message.data.y][message.data.x].click(thisPlayer);
						
						for(const player of getPlayersInRange(thisPlayer.chunkPos)){
							reply(player.ws, "click", {
								cx:message.data.cx, cy:message.data.cy,
								x:message.data.x, y:message.data.y
							}, player==thisPlayer?id:undefined);
						}
					}
					break;
				case "flag":
					if(!Number.isInteger(message.data.cx)||!Number.isInteger(message.data.cy)||
						!Number.isInteger(message.data.x)||!Number.isInteger(message.data.y))
						reply(ws, "error", "Invalid coords", id);
					else{
						thisPlayer.chunkPos=[message.data.cx,message.data.cy];
						let cell=getChunk(message.data.cx, message.data.cy).cells[message.data.y][message.data.x];
						cell.tryFlag(thisPlayer);

						for(const player of getPlayersInRange(thisPlayer.chunkPos)){
							reply(player.ws, "flag", {
								cx:message.data.cx, cy:message.data.cy,
								x:message.data.x, y:message.data.y,
								flag:cell.flagged
							}, player==thisPlayer?id:undefined);
						}
					}
					break;
			}
		}catch(e){ console.log(e); }
	});
});

function getWSS(){ return wss; }
export {getWSS}
