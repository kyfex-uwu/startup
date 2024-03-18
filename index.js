import express from "express";
import dynamo from "dynamodb";
import Joi from "joi";
import * as http from 'http';
import fs from "fs";
const app = express();

import cookieParser from "cookie-parser";
app.use(cookieParser());

import { fileURLToPath } from "url";
const __dirname=fileURLToPath(import.meta.url).slice(0,"/index.js".length*-1);

import { czSetDir, containerize } from "./my_modules/containerize.js";
czSetDir(__dirname);

//--

dynamo.AWS.config.loadFromPath("./dynamodb_credentials.json");
const DynStruct = {
  user: dynamo.define("User", {
    hashKey: "username",
   
    schema: {
      username: Joi.string().pattern(/[\w-]{3,24}/),
      password: Joi.string().pattern(/.{8,}/),//todo: DONT STORE THIS AS PLAINTEXT
      email: Joi.string().email(),

      stats: Joi.object().keys({
        tScore: Joi.number().default(0),
        tRevealed: Joi.number().default(0),
        tFlags: Joi.number().default(0),
        tMines: Joi.number().default(0),
        highscore: Joi.number().default(0),
      }).default({
        tScore: 0,
        tRevealed: 0,
        tFlags: 0,
        tMines: 0,
        highscore: 0,
      })
    }
  })
};

dynamo.createTables(e=>{
  if(e) console.log(e);
});

//--

//app.use("/public", express.static("public"));
app.use("/public", (req, res) => {
  res.redirect("https://kyfexuwu-byucs260-public.s3.amazonaws.com"+req.path);
});

app.get("/", (req, res) => {
  res.send(containerize("/views/main.html"));
});
app.get("/about", (req, res) => {
  res.send(containerize("/views/about.html"));
});
app.get("/login", (req, res) => {
  res.send(containerize("/views/login.html"));
});
app.get("/register", (req, res) => {
  res.send(containerize("/views/register.html"));
});
app.get("/play", (req, res) => {
  res.send(containerize("/views/play.html"));
});

app.get("/user/:username", (req, res) => {
  res.send(containerize("/views/user.html", {username:req.params.username.replace(/[^\w\d]/g, '')}));
  //replaces non alphanumeric with empty
});

//--

const api = express.Router();
api.use(express.json());
api.get("/user/:username", (req, res)=>{
  DynStruct.user.get(req.params.username, (e, user)=>{
    if(e||!user){
      res.sendStatus(404);
    }else{
      res.send(user.attrs.stats);
    }
  });
});

api.post("/register", (req, res)=>{
  DynStruct.user.create({
    username:req.body.username,
    password:req.body.password,
    email:req.body.email,

    stats: {
      tScore: 0,
      tRevealed: 0,
      tFlags: 0,
      tMines: 0,
      highscore: 0,
    }
  }, {overwrite:false}, (e, user)=>{
    //todo: differentiate between taken username and invalid data
    if(e) res.sendStatus(400);
    else res.sendStatus(201);
  });
});
const tokens={};
const reverseTokens={};
const tokenChars="qwertyuiopasdfghjklzxcvbnmQWERTYUIOPASDFGHJKLZXCVBNM1234567890";
api.post("/login", (req, res)=>{
  DynStruct.user.get(req.body.username, (e, user)=>{
    if(user&&user.attrs.password===req.body.password){
      if(!tokens[req.body.username]){
        tokens[req.body.username]=
          " ".repeat(48).split("").map(()=>tokenChars[Math.floor(Math.random()*tokenChars.length)]).join("");
          reverseTokens[tokens[req.body.username]]=req.body.username;
      }
      res.send({ token:tokens[req.body.username] });
    }else{
      res.sendStatus(400);
    }
  });
});

api.get("/verify-token/:token", (req, res)=>{
  let toSend={
    valid:!!reverseTokens[req.params.token]
  };
  if(toSend.valid){
    toSend.username=reverseTokens[req.params.token]
  };
  res.send(toSend);
});
app.use("/api", api);

//--

const server = http.createServer(app);

import { getWSS, initGame } from "./my_modules/gameLogic.js";
import { parse } from 'url';
const wss = getWSS();
initGame(DynStruct);
server.on('upgrade', (request, socket, head) => {
  if (parse(request.url).pathname === '/websocket') {
    wss.handleUpgrade(request, socket, head, ws => {
      let cookieIndex = request.rawHeaders.indexOf("Cookie");
      let token;
      if(cookieIndex!=-1){
        try{
          token=request.rawHeaders[cookieIndex+1].split(";").map(c=>c.trim())
            .find(c=>c.startsWith("token=")).slice("token=".length);
        }catch{}
      }

      wss.emit('connection', ws, reverseTokens[token]);
    });
  } else {
    socket.destroy();
  }
});

//--

app.get("*", (req, res)=>res.send(containerize("/views/404.html")));

server.listen(4000);

//--

import readline from "readline";
import childProcess from 'child_process';
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.on("line", async function(input) {
  console.log(await commandLineHandler(...input.split(" ")));
});

async function commandLineHandler(...input) {
  switch (input[0]) {
    case "help":
      return "help: this command\n"+
        "restart (r): restarts\n"+
        "shutdown: shuts down";

    case "r":
    case "restart":
      childProcess.exec('cmd /c start "" cmd /c node index.js');
      setTimeout(function() {
        process.exit()
      }, 100);
      return "inactive...";
    case "shutdown":
      setTimeout(function() {
        process.exit()
      }, 5000);
      return "shutting down...";
    default:
      return "not a command. type help to see all commands";
  }
  return "something happened";
};

function onError(error, identifier){
  console.log(`Caught exception (${identifier}): `);
  console.log(error);
}
process.on('uncaughtException', (err)=>onError(err, "exception"));
process.on('unhandledRejection', (err)=>onError(err, "rejection"));
app.use((err, req, res, next) => {
  onError(err, "express");
  res.status(500).send('ono');
});