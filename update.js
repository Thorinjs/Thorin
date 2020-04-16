'use strict';
const path = require('path'),
  exec = require('child_process').exec,
  cwd = process.cwd();

const INSTALL_MATCH = ['thorin*'],
  NEW_INSTALLS = [],
  IS_PROD = process.env.NODE_ENV === 'production';

/**
 * This script does a thorin-* auto-update to latest version.
 * This can also perform update to the latest version of the argv modules.
 *
 * Ex:
 * node node_modules/thorin/update mymodule1 mymodule2@latest
 * */
function doUpdate(deps = []) {
  if (NEW_INSTALLS.length === 0) {
    console.log(`--> No new installs are required.`);
    return process.exit(0);
  }
  console.log(`--> Updating Thorin modules to latest version:`);
  const npmInstalls = [];
  NEW_INSTALLS.forEach((item) => {
    if (item.current && item.current.indexOf('.') !== -1) {
      item.version = item.current.split('.')[0] + '.x';
    }
    let msg = `- ${item.name}`;
    if (item.current) msg += `@${item.current}`;
    msg += ` -> ${item.version}`;
    npmInstalls.push(`${item.name}@${item.version}`);
    console.log(msg);
  });
  let cmd = ['npm install'];
  if (IS_PROD) {
    cmd.push(`--only=prod`);
  }
  cmd.push(`--no-optional`);
  cmd = cmd.concat(npmInstalls);
  cmd = cmd.join(' ');
  console.log(`--> Running: ${cmd}`);
  return new Promise((resolve, reject) => {
    exec(cmd, {
      cwd: cwd,
      env: process.env,
      maxBuffer: 1024 * 1024 * 512
    }, (err, stdout, stderr) => {
      console.log(`--> Thorin updater results\n\n`);
      if (stdout) console.log(stdout);
      if (stderr) console.log(stderr);
      if (err) return reject(err);
      resolve();
    });
  });
}

function processArgv() {
  const argv = process.argv;
  if (argv.length <= 2) return;
  for (let i = 2; i < argv.length; i++) {
    let v = argv[i].trim();
    if (v.indexOf('*') !== -1) {
      INSTALL_MATCH.push(v);
      continue;
    }
    if (v.indexOf('/') !== -1) {  // we have ns.
      let t = v.split('/').pop();
      if (t.indexOf('@') === -1) v += '@latest';
    } else {
      if (v.indexOf('@') === -1) v += '@latest';
    }
    let q = v.lastIndexOf('@');
    let name = v.substr(0, q),
      version = v.substr(q + 1);

    NEW_INSTALLS.push({
      name,
      version
    });
  }
}

function processDeps(deps) {
  let names = Object.keys(deps || {});
  for (let i = 0; i < names.length; i++) {
    let name = names[i],
      ver = deps[name],
      found = match(name);
    if (!found) continue;
    NEW_INSTALLS.push({
      name,
      current: ver || '',
      version: 'latest'
    });
  }
}

(async () => {
  let pkgPath = path.normalize(`${cwd}/package.json`),
    pkgInfo;
  try {
    pkgInfo = require(pkgPath);
  } catch (e) {
    console.error(`--> Could not read package.json from: ${pkgPath}`);
    console.log(e);
    return process.exit(1);
  }
  processArgv();
  processDeps(pkgInfo.dependencies);
  try {
    await doUpdate();
  } catch (e) {
    console.error(`--> Could not finalize update`);
    console.log(e);
    return process.exit(1);
  }
  console.log(`--> Completed`);
})();

function match(name) {
  for (let i = 0; i < INSTALL_MATCH.length; i++) {
    let p = INSTALL_MATCH[i];
    let isEnd = p.charAt(0) === '*',
      isStart = p.charAt(p.length - 1) === '*',
      m = p.replace('*', '');
    if (isStart && name.indexOf(m) === 0) {
      return true;
    }
    if (isEnd && name.substr(m.length) === m) {
      return true;
    }
  }
  return false;
}
