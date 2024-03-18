import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';

let DynStruct;

class Player{
	constructor(ws, username){
		this.ws=ws;
		this.username=username;
		this.chunkPos=[0,0];
		this.id=uuidv4();
		this.reset(false);
	}

	incFlag(wasGood){
		if(wasGood) this.goodflags+=1n;
		else this.badflags+=1n;
		this.sendScore();
	}
	decFlag(wasGood){
		if(wasGood) this.goodflags-=1n;
		else this.badflags-=1n;
		this.sendScore();
	}
	incRevealed(){
		this.revealed+=1n;
		let currRevealed = this.revealed;
		setTimeout(()=>{
			if(currRevealed==this.revealed) this.sendScore();
		},500);
	}
	sendScore(){
		reply(this.ws, "score", this.fakeScore().toString());
	}
	fakeScore(){
		return (this.goodflags+this.badflags)*10n+this.revealed;
	}
	realScore(){
		return (this.goodflags-this.badflags)*10n+this.revealed;
	}

	updateDB(hitMine=true){
		if(!username) return;

		let realScore = Number(this.realScore());
		let revealed = Number(this.revealed);
		let flags = Number(this.goodflags+this.badflags);
		DynStruct.user.get(this.username, (e, user)=>{
			if(!e&&user){
				DynStruct.user.update({username: this.username, stats:{
					//todo:convert these to bigints
			        tScore: user.attrs.stats.tScore+realScore,
			        tRevealed: user.attrs.stats.tRevealed+revealed,
			        tFlags: user.attrs.stats.tFlags+flags,
			        tMines: user.attrs.stats.tMines+hitMine?1:0,
			        highscore: Math.max(user.attrs.stats.highscore, realScore),
				}},(e, user)=>{
					console.log(e,user)
					console.log("updated")
				});
			}
		});
	}
	reset(updateDB=true){
		if(updateDB) this.updateDB();

		this.goodflags=0n;
		this.badflags=0n;
		this.revealed=0n;
		this.sendScore();
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
		//if(player&&player.score==0n) this.isMine=false;//need more criteria than this
		if(player) player.incRevealed();

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
	explode(player){
		const radius = Math.min(Number(player.realScore() / 40n), 75);
		for(let y=-radius;y<=radius;y++){
			for(let x=-radius;x<=radius;x++){
				if(Math.sqrt(x**2+y**2)<=radius){
					let cellToExplode=this.offset(x,y);
					let newCellData=DEFAULT_GENERATOR(cellToExplode.x,cellToExplode.y,cellToExplode.chunk);
					cellToExplode.chunk.cells[cellToExplode.y][cellToExplode.x]=newCellData.cell;
					delete cellToExplode.chunk.features[cellToExplode.y*16+cellToExplode.x];
					if(newCellData.feature)
						cellToExplode.chunk.features[cellToExplode.y*16+cellToExplode.x]=newCellData.feature;
				}
			}
		}
		for(const player of getPlayersInRange([this.chunk.x,this.chunk.y]))
			reply(player.ws, "explode", {
				cx:this.chunk.x, cy:this.chunk.y,
				x:this.x, y:this.y,
				radius
			});
	}
	tryFlag(player){
		if(this.revealed) return;
		this.flagged=!this.flagged;
		if(player){
			if(this.flagged)
				player.incFlag(this.isMine);
			else
				player.decFlag(this.isMine);
		}
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

		this.features={};
	}
	load(generator){
		for(let y=0;y<16;y++){
			for(let x=0;x<16;x++){
				let data = generator(x,y,this);
				this.cells[y][x]=data.cell;
				if(data.feature)
					this.features[y*16+x]=data.feature;
			}
		}
		this.loaded=true;
	}

	toJsonObj(){
		return {
			map:this.cells.map(r=>r.map(c=>c.toJsonObj())).flat(), 
			features:this.features
		};
	}
}

const chunks = {};
const DEFAULT_GENERATOR = (x,y,chunk)=>{
	return {
		cell:new Cell(Math.random()<0.2,chunk,x,y),
		feature:Math.random()<0.004?"coin":undefined
	};
};
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

{
	let firstChunk = getChunk(0,0);
	for(let y=0;y<3;y++)
		for(let x=0;x<3;x++)
			firstChunk.cells[y][x].isMine=false;
	firstChunk.cells[1][1].click();
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

function processCellPos(message, player, id){
	if(!Number.isInteger(message.data.cx)||!Number.isInteger(message.data.cy)||
		!Number.isInteger(message.data.x)||!Number.isInteger(message.data.y)||
		message.data.x<0||message.data.x>=16||message.data.y<0||message.data.y>=16){
		reply(player.ws, "error", "Invalid coords", id);
		return false;
	}else{
		player.chunkPos=[message.data.cx,message.data.cy];
		return true;
	}
}

const wss = new WebSocketServer({ noServer: true });
const players={};//todo: sort players into mega chunks
wss.on('connection', (ws, username) => {
	const thisPlayer = new Player(ws, username);
	players[thisPlayer.id]=thisPlayer;

	ws.on('error', ws.close);
	ws.on('close', ()=>{
		thisPlayer.updateDB(false);
		delete players[thisPlayer.id];
	});

	ws.on('message', data => {
		try{
			const message=JSON.parse(data.toString());
			let id = message.id;
			switch(message.channel){
				case "chunk":{
					if(!Number.isInteger(message.data.x)||!Number.isInteger(message.data.y))
						reply(ws, "error", "Invalid chunk coords", id);
					else
						reply(ws, "chunk", getChunk(message.data.x,message.data.y).toJsonObj(), id);
					}break;
				case "click":{
					if(!processCellPos(message, thisPlayer, id)) break;

					let cell=getChunk(message.data.cx, message.data.cy).cells[message.data.y][message.data.x];

					if(cell.isMine){
						cell.explode(thisPlayer);
						reply(ws, "gameover", {
							fakescore: thisPlayer.fakeScore().toString(),
							score: thisPlayer.realScore().toString()
						});
						thisPlayer.reset();
					}else{
						cell.click(thisPlayer);
						for(const player of getPlayersInRange(thisPlayer.chunkPos)){
							reply(player.ws, "click", {
								cx:message.data.cx, cy:message.data.cy,
								x:message.data.x, y:message.data.y
							});
						}
					}
					}break;
				case "flag":{
					if(!processCellPos(message, thisPlayer, id)) break;

					let cell=getChunk(message.data.cx, message.data.cy).cells[message.data.y][message.data.x];
					cell.tryFlag(thisPlayer);

					for(const player of getPlayersInRange(thisPlayer.chunkPos)){
						reply(player.ws, "flag", {
							cx:message.data.cx, cy:message.data.cy,
							x:message.data.x, y:message.data.y,
							flag:cell.flagged
						});
					}
					}break;
				case "interact":{
					if(!processCellPos(message, thisPlayer, id)) break;

					let chunk=getChunk(message.data.cx, message.data.cy);
					const feature = chunk.features[message.data.y*16+message.data.x];
					switch(feature){
						case "coin":
							delete chunk.features[message.data.y*16+message.data.x];
							//do smth

							reply(thisPlayer.ws, "interact", true, id);
							for(const player of getPlayersInRange(thisPlayer.chunkPos)){
								reply(player.ws, "fUpdate", {
									cx:message.data.cx, cy:message.data.cy,
									x:message.data.x, y:message.data.y,
									feature:undefined
								});
							}
							break;
					}
					}break;
			}
		}catch(e){}
	});
});

function getWSS(){ return wss; }
function initGame(s){ DynStruct = s; }
export {getWSS, initGame}
