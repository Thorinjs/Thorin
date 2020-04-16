'use strict';
const fs = require('fs'),
  fse = require('fs-extra'),
  os = require('os'),
  path = require('path');
const DEFAULT_ENV = 'development';
const env = {};

/* Verify if we have any .env file in the root project. If we do, we set them in process.env */
env.dotEnv = (root) => {
  // Try and set from root/.env
  try {
    let env = fs.readFileSync(path.normalize(root + '/.env'), { encoding: 'utf8' });
    setValues(env);
  } catch (e) {
    // Try and set from root/config/.env
    try {
      let env = fs.readFileSync(path.normalize(root + '/config/.env'), { encoding: 'utf8' });
      setValues(env);
    } catch (e) {
    }
  }
}

/*
* Verifies if we're running in docker.
* */
env.isDocker = () => {
  let is = false;
  try {
    if (os.platform().indexOf('win') === -1) {
      let procFile = fs.readFileSync(`/proc/1/cgroup`, { encoding: 'utf8' });
      if (procFile.indexOf('docker') !== -1) {
        is = true;
      } else if (procFile.indexOf('kubepod') !== -1) {
        is = true;
      }
    }
  } catch (e) {
  }
  global.THORIN_DOCKER = is;
  return is;
};

/*
* Verifies if we're running in kube
* */
env.isKubernetes = () => {
  let is = false;
  try {
    let envs = [
      'KUBERNETES_SERVICE_HOST',
      'KUBERNETES_SERVICE_PORT',
      'KUBERNETES_PORT'
    ];
    for (let i = 0; i < envs.length; i++) {
      if (process.env[envs[i]]) {
        is = true;
        break;
      }
    }
  } catch (e) {}
  global.THORIN_KUBERNETES = is;
  return is;
}

/**
 * Parses all the process.argv options and places them in the given info object.
 * */
env.parseArgv = (info) => {
  let items = [];
  for (let i = 2; i < process.argv.length; i++) {
    let tmp = process.argv[i].split(' ');
    items = items.concat(tmp);
  }
  for (let i = 0; i < items.length; i++) {
    let tmp = items[i].split('=');
    if (tmp.length === 0) continue;
    let k = tmp[0],
      v = tmp[1] || '';
    k = k.replace(/-/g, '');
    if (v === 'true' || v === 'false') {
      v = (v === 'true');
    } else if (v.indexOf(',') !== -1) {
      v = v.split(',');
    }
    if (typeof info.argv[k] !== 'undefined') {
      info.argv[k] = [info.argv[k]];
      info.argv[k].push(v);
    } else {
      info.argv[k] = v;
    }
  }
}

/**
 * Returns the env for the app
 * */
env.setEnv = (info) => {
  let e = info.argv['env'] || info.argv['environment'] || process.env.NODE_ENV;
  if (e) {
    info.env = e;
  } else {
    info.env = DEFAULT_ENV;
  }
  process.env.NODE_ENV = info.env;
  return info.env;
}

/**
 * Tries to open up the package.json file of the root project, and
 * places it in the info
 * */
env.parsePkg = (info) => {
  try {
    let pkg = fs.readFileSync(path.normalize(info.root + "/package.json"), { encoding: 'utf8' });
    info.pkg = JSON.parse(pkg);
    if (info.pkg.version) {
      info.version = info.pkg.version;
    }
  } catch (e) {
    info.pkg = {};
  }
};

/**
 * Ensures that the structure of the app is the same.
 * */
env.ensureStructure = (info) => {
  (info.structure || []).forEach((folder) => {
    let folderPath = path.normalize(info.root + '/' + folder);
    if (folder.indexOf('.js') !== -1) {
      // we have to ensure the .js file.
      try {
        fse.createFileSync(folderPath);
      } catch (e) {
      }
    } else {
      try {
        fse.ensureDirSync(folderPath);
      } catch (e) {
      }
    }
  });
}

module.exports = env;

function setValues(env) {
  env = env.replace(/\r\n/g, "\r").replace(/\n/g, "\r").split(/\r/);
  for (let i = 0; i < env.length; i++) {
    let val = env[i].trim();
    if (!val) continue;
    let eq = val.indexOf('=');
    if (eq === -1) continue;
    let key = val.substr(0, eq).trim(),
      value = val.substr(eq + 1).trim();
    process.env[key] = value;
  }
}

