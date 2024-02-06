import express from "express";
import fs from "fs";
import { WebSocketServer } from "ws";
const app = express();

import cookieParser from "cookie-parser";
app.use(cookieParser());

import { fileURLToPath } from "url";
const __dirname=fileURLToPath(import.meta.url).slice(0,"/index.js".length*-1);

import { czSetDir, containerize } from "./my_modules/containerize.js";
czSetDir(__dirname);

//--

app.use("/public", express.static("public"));

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

app.listen(443);

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