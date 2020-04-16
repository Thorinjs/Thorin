'use strict';
/**
 * This is a simple wrapper over child_process.spawn
 * */
const { spawn } = require('child_process');

/**
 * The spawn function that will launch a new node.js process
 * via spawn, not cluster. The current working directory will
 * be used to search for the script
 * */
module.exports = function () {
  let args = Array.prototype.slice.call(arguments);
  if (args.length === 0) throw new Error('Please provide the script to run');
  let scriptName = args.splice(0, 1)[0];
  if (typeof scriptName !== 'string' || !scriptName) throw new Error('Please provide the script name to run');
  let fullPath = process.cwd();
  let opt = (typeof args[args.length - 1] === 'object' && args[args.length - 1]) ? args.pop() : {};
  if (!opt.cwd) opt.cwd = fullPath;
  if (!opt.env) opt.env = process.env;
  let timeout = (opt.timeout || 10000),
    command = opt.command || 'node';
  delete opt.command;
  delete opt.timeout;
  let _log = (d) => {
    d = d.toString().replace(/\n+/g, '\n');
    if (d.trim() === '') return;
    if (d.charAt(d.length - 1) === '\n') d = d.substr(0, d.length - 1);
    console.log(d);
  };
  let sargs = [scriptName].concat(args);
  let ps = spawn(command, sargs, opt);
  ps.stdout.on('data', _log);
  ps.stderr.on('data', _log);
  return new Promise((resolve, reject) => {
    let isDone = false;
    let _timer = setTimeout(() => {
      if (isDone) return;
      isDone = true;
      ps.kill('SIGHUP');
    }, timeout);
    ps.once('close', (code) => {
      clearTimeout(_timer);
      if (isDone) return;
      isDone = true;
      if (code === 0) {
        return resolve();
      }
      return reject(new Error(`Exit with code: ${code}`));
    });
    ps.once('error', (e) => {
      clearTimeout(_timer);
      if (isDone) return;
      isDone = true;
      reject(e);
    });
  });
}

/**
 * Simple function that will just wait the given time and resolve the promise
 * */
module.exports.wait = (ms) => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, ms || 1000);
  });
};
