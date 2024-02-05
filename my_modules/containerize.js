import fs from "fs";

let dirName;
let container;
export function czSetDir(dirname){
	dirName=dirname;
	container=fs.readFileSync(dirname+"/views/container.html").toString();
}

const regexes = {
	title:/<!--TITLE-->(.+?)(?:\n<!--|$)/g,
	head:/<!--HEAD-->([^]+?)(?:\n<!--|$)/g,
	body:/<!--BODY-->([^]+?)(?:\n<!--|$)/g,
}
export function containerize(filePath){
	let fileContents = fs.readFileSync(dirName+filePath).toString();
	let title = [...fileContents.matchAll(regexes.title)][0];
	let head = [...fileContents.matchAll(regexes.head)][0];
	let body = [...fileContents.matchAll(regexes.body)][0];
	return container
		.replace("<!--TITLE-->","meiket"+(title==undefined?"":" | "+title[1]))
		.replace("<!--HEAD-->",(head==undefined?"":head[1]))
		.replace("<!--BODY-->",(body==undefined?"":body[1]));
}