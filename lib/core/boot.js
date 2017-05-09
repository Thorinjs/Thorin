'use strict';
const fs = require('fs'),
  os = require('os'),
  fse = require('fs-extra'),
  async = require('async'),
  attached = require('../util/attached'),
  utils = require('../util/util.js'),
  ThorinConfig = require('./config'),
  path = require('path');
/**
 * Boot loader file, parses arguments and processes data.
 */
let persistFile,
  isInDocker = false,
  loadedPaths = Symbol();

/* Check if we're inside docker. */
try {
  if (os.platform().indexOf('win') === -1) {
    let procFile = fs.readFileSync(`/proc/1/cgroup`, {encoding: 'utf8'});
    if (procFile.indexOf('docker') !== -1) {
      isInDocker = true;
    }
  }
} catch (e) {
}
global.THORIN_DOCKER = isInDocker;

module.exports = class ThorinBoot {

  constructor(app) {
    this[loadedPaths] = {}; // a hash of loaded modules, so we do not require twice.
    this.app = app;
    this.info = null;
    this.configName = path.basename(process.argv[1]); // the key in the .thorin file will always be the node.js file name
  }

  /*
   * Bootstraps all libraries that use thorin's utilities.
   * */
  bootstrap() {
    this.app.util = utils;  // thorin.util;
    /* load up all interfaces in thorin.Interface */
    let ifaces = utils.readDirectory(__dirname + '/../interface', {
      extension: 'js'
    });

    /* globalize the logger. */
    this.app.logger.globalize('log'); // default log.debug in global.

    /* Attach the Thorin interfaces. */
    for (let i = 0; i < ifaces.length; i++) {
      let iClass = require(ifaces[i]),
        iName = iClass.name;
      if (iName.charAt(0) === 'I') iName = iName.substr(1);
      this.app.Interface[iName] = iClass;
    }
    /* Attach additional utilities */
    attached(this.app);

    /* Attach the default functionality */
    this.app.addSanitizer('thorin-sanitize');

    /* Add the default app paths. */
    /* NOTE: Apps that run in "test" mode, weill not load app/
     * NOTE2: to disable autoloading, set global.THORIN_AUTOLOAD = false;
     * NOTE3: if the file is under tests/ we set autoload to false.
     * */
    let jsFilePath = process.argv[1].split(path.sep),
      tmp1 = jsFilePath.pop(),
      tmp2 = jsFilePath.pop();
    if (tmp1 === 'tests' || tmp2 === 'tests') {
      global.THORIN_AUTOLOAD = false;
    }
    if (this.app.app !== 'test' && global.THORIN_AUTOLOAD !== false) {
      if (this.app.app !== 'build') {  // build apps will not have their actions/ loaded.
        this.app.loadPath(['app/actions', 'app/middleware']);
      }
      const isSetup = this.app.argv('setup', null);
      if (isSetup) {
        /* Ensure the app file system structure */
        try {
          fse.ensureDirSync(this.app.root + '/config/env');
        } catch (e) {
        }
        try {
          fse.ensureDirSync(this.app.root + '/app');
        } catch (e) {
        }
      }
    }
  }

  /* Initializes the arguments, package.json and other such. */
  init(info) {
    this.info = info;
    info.docker = isInDocker;
    /* set the info argv. */
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
      info.argv[k] = v;
    }
    /* Read the current package.json to have it in-memory for later user. */
    var pkg;
    try {
      pkg = fs.readFileSync(path.normalize(info.root + "/package.json"), {encoding: 'utf8'});
      info.pkg = JSON.parse(pkg);
    } catch (e) {
      console.error('Thorin: failed to read the project package.json:', e);
    }

    /* Checks if we have a .gitignore file in the root dir. If not, we add one. */
    this.app.addIgnore('.thorin');

    /* Load our thorin config and check if we have to set any ENV variables */
    let config = this.readConfig(true);
    if (typeof config === 'object' && config) {
      if (typeof config._APP_ENV === 'object' && config._APP_ENV) {
        Object.keys(config._APP_ENV).forEach((name) => {
          process.env[name] = config._APP_ENV[name];
        });
      }
    }
  }

  set persistFile(v) {
    persistFile = v;
  }

  get persistFile() {
    if (persistFile) return persistFile;
    persistFile = path.normalize(this.info.root + '/' + this.info.persistFile);
    return persistFile;
  }


  /* Reads previously persisted configuration  */
  readConfig(_allConfig) {
    let oldConfig = null;
    try {
      fse.ensureFileSync(this.persistFile);
    } catch (e) {
      console.warn('Thorin: failed to read .thorin config file:', e);
    }
    try {
      oldConfig = fs.readFileSync(this.persistFile, {encoding: 'utf8'});
    } catch (e) {
      console.warn('Thorin: failed to read old .thorin config: ', e);
      oldConfig = null;
    }
    if (typeof oldConfig === 'string') {
      try {
        oldConfig = JSON.parse(oldConfig);
      } catch (e) {
      }
    }
    if (!oldConfig) oldConfig = {};
    if (_allConfig === true) {
      return oldConfig;
    }
    return oldConfig[this.configName];
  }

  /*
   * Persists thorin-related configurations to the .thorin file.
   * */
  writeConfig(_data) {
    try {
      fse.ensureFileSync(this.persistFile);
    } catch (e) {
      console.error('Thorin: failed to ensure .thorin config file in %s: ', this.persistFile, e);
      return this;
    }
    if (typeof _data !== 'object' || !_data) return this;  // nothing to persist.
    let oldConfig = this.readConfig(true),
      newConfig = {};
    newConfig[this.configName] = _data;
    let finalConfig = utils.extend(oldConfig, newConfig),
      oldString = JSON.stringify(oldConfig, null, 1),
      newString = JSON.stringify(finalConfig, null, 1);
    if (oldString === newString) return this;
    try {
      fs.writeFileSync(this.persistFile, newString, {encoding: 'utf8'});
    } catch (e) {
      console.warn('Thorin: failed to persist new config in .thorin file:', e);
    }
  }

  /*
   * Require() the given file paths.
   * */
  loadPath(item) {
    if (typeof item.path !== 'string') return;
    let self = this,
      p = item.path,
      args = item.args;

    function doRequire(filePath) {
      if (self[loadedPaths][filePath]) return;
      if (!path.isAbsolute(filePath)) {
        filePath = path.normalize(self.app.root + '/' + filePath);
      }
      try {
        let stat = fs.statSync(filePath);
        if (!stat.isFile()) {
          let e = new Error("");
          e.code = "NOT_FILE";
          throw e;
        }
      } catch (e) {
        if (e.code === 'ENOENT') {
          console.warn(`Thorin.loadPath: module path ${filePath} not found.`);
          return;
        }
        if (e.code === 'NOT_FILE') {
          console.warn(`Thorin.loadPath: module path ${filePath} is not a file.`);
          return;
        }
      }

      let itemFn = require(filePath);
      if (typeof itemFn === 'function') {
        // call the function passing the arguments.
        itemFn.apply(global, args);
      }
      self[loadedPaths][filePath] = true;
    }

    if (path.extname(p) === '.js') {
      doRequire(p);
    } else {
      let files = utils.readDirectory(p, {
        ext: '.js'
      });
      files.forEach((p) => doRequire(p));
    }
  }

  /* PUBLIC INTEREST FUNCTIONALITIES */

  /*
   * Loads up all the thorin app's configurations, the order that they were specified.
   * We will always have a "disk" configuration loader, so by default we add it.
   * */
  loadAppConfig(items, done) {
    // first call
    if (items instanceof Array) {
      /* Add the env=specific one. */
      items.splice(0, 0, {
        name: "disk",
        type: "thorin",
        options: {
          path: 'config/env/' + this.app.env + '.js',
          required: false
        }
      });

      /* IF the thorin apps' name is not app, add the app's name config. */
      let appConfig = path.normalize(this.app.root + '/config/' + this.app.app + '.js'),
        defaultAppConfig = path.normalize(this.app.root + '/config/app.js');
      if (utils.isFile(appConfig)) {
        items.splice(0, 0, {
          name: "disk",
          type: "thorin",
          options: {
            path: "config/" + this.app.app + ".js",
            required: false
          }
        });
      } else if (utils.isFile(defaultAppConfig)) {
        /* Add the default app.js config if available. */
        items.splice(0, 0, {
          name: "disk",
          type: "thorin",
          options: {
            path: "config/app.js",
            required: false
          }
        });
      }
      /* SECRETS always come first, before anything */
      let hasDockerSecrets = false;
      for (let i = 0, len = items.length; i < len; i++) {
        let itm = items[i];
        if (itm.name !== 'secret') continue;
        let secret = items.splice(i, 1)[0];
        items.unshift(secret);
        hasDockerSecrets = true;
        break;
      }
      /* IF we are in docker, we always tro to load any docker secrets and place them in the env file. */
      if (global.THORIN_DOCKER && !hasDockerSecrets) {
        items.unshift({
          name: 'secret',
          type: 'thorin'
        });
      }
    } else {
      items = [items];
    }
    let rootConfig = {};
    let calls = [];
    /* We load up all config sources and fetch em' */
    items.forEach((iObj, idx) => {
      calls.push((done) => {
        iObj.tracked = true;
        if (iObj.type === 'thorin') {
          // we have a Thorin config function.
          if (typeof ThorinConfig[iObj.name] === 'undefined') {
            return done(new Error('Thorin.loadAppConfig: configSource name ' + iObj.name + ' does not exist.'));
          }
          return ThorinConfig[iObj.name](this.app, rootConfig, iObj.options, done);
        }
        // we have a normal FN function.
        if (iObj.type === 'fn') {
          return iObj.fn(this.app, rootConfig, iObj.options, done);
        }
        return done();  // not available.
      });
    });

    /*
     * Next, we process the configuration.
     * */
    calls.push((done) => {
      return ThorinConfig.__processConfiguration(this.app, rootConfig, done);
    });
    async.series(calls, (err) => {
      if (err) {
        console.error('Thorin.config: failed to load all configuration sources.');
        return done(err);
      }
      // see if any config file added another config
      let newConfigs = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].tracked) continue;
        newConfigs.push(items[i]);
      }
      if (newConfigs.length === 0) {
        return done(null, rootConfig);
      }
      this.loadAppConfig(newConfigs, done);
    });
  }


};
