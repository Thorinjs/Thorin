'use strict';
const fs = require('fs'),
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
  loadedPaths = Symbol();
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
    for(let i=0; i < ifaces.length; i++) {
      let iClass = require(ifaces[i]),
        iName = iClass.name;
      if(iName.charAt(0) === 'I') iName = iName.substr(1);
      this.app.Interface[iName] = iClass;
    }
    /* Attach additional utilities */
    attached(this.app);

    /* Attach the default functionality */
    this.app.addSanitizer('thorin-sanitize');

    /* Add the default app paths. */
    this.app.loadPath(['app/actions', 'app/middleware']);

    /* Ensure the app file system structure */
    try {
      fse.ensureDirSync(this.app.root + '/config/env');
    } catch(e) {
    }
    try {
      fse.ensureDirSync(this.app.root + '/app');
    } catch(e) {}

  }

  /* Initializes the arguments, package.json and other such. */
  init(info) {
    this.info = info;

    /* set the info argv. */
    (() => {
      for (let i = 2; i < process.argv.length; i++) {
        let tmp = process.argv[i].split('=');
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
    })();
    /* Read the current package.json to have it in-memory for later user. */
    (() => {
      var pkg;
      try {
        pkg = fs.readFileSync(path.normalize(info.root + "/package.json"), {encoding: 'utf8'});
        info.pkg = JSON.parse(pkg);
      } catch (e) {
        console.error('Thorin: failed to read the project package.json:', e);
      }
    })();

    /* Checks if we have a .gitignore file in the root dir. If not, we add one. */
    (() => {
      let gitIgnore = path.normalize(info.root + '/.gitignore'),
        ignoreContent = '';
      try {
        ignoreContent = fs.readFileSync(gitIgnore, {encoding: 'utf8'})
      } catch (e) {
      }
      if (ignoreContent.indexOf('.thorin') === -1) {
        ignoreContent += '\n.thorin\n';
        try {
          fs.writeFileSync(gitIgnore, ignoreContent, {encoding: 'utf8'});
        } catch (e) {
          console.warn('Thorin: failed to update .gitignore file:', e);
        }
      }
    })();
  }

  set persistFile(v) {
    persistFile = v;
  }

  get persistFile() {
    if (persistFile) return persistFile;
    let files = utils.readDirectory(this.info.root, {
      ext: '.thorin',
      levels: 4
    });
    if (files.length !== 0) {
      persistFile = files[0];
    } else {
      persistFile = path.normalize(this.info.root + '/' + this.info.persistFile);
    }
    return persistFile;
  }


  /* Reads previously persisted configuration  */
  readConfig(_allConfig) {
    let oldConfig = null;
    try {
      fse.ensureFileSync(this.persistFile);
    } catch(e) {
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
    if(typeof item.path !== 'string') return;
    let self = this,
      p = item.path,
      args = item.args;
    function doRequire(filePath) {
      if(self[loadedPaths][filePath]) return;
      if(!path.isAbsolute(filePath)) {
        filePath = path.normalize(self.app.root + '/' + filePath);
      }
      try {
        let stat = fs.statSync(filePath);
        if(!stat.isFile()) {
          let e = new Error("");
          e.code = "NOT_FILE";
          throw e;
        }
      } catch(e) {
        if(e.code === 'ENOENT') {
          console.warn(`Thorin.loadPath: module path ${filePath} not found.`);
          return;
        }
        if(e.code === 'NOT_FILE') {
          console.warn(`Thorin.loadPath: module path ${filePath} is not a file.`);
          return;
        }
      }
      let itemFn = require(filePath);
      if(typeof itemFn === 'function' && args.length > 0) {
        // call the function passing the arguments.
        itemFn.apply(global, args);
      }
      self[loadedPaths][filePath] = true;
    }
    if(path.basename(p) === '.js') {
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
    if(items instanceof Array) {
      /* Add the env=specific one. */
      items.splice(0, 0, {
        name: "disk",
        type: "thorin",
        options: {
          path: ['config/env/' + this.app.env + '.js'],
          required: false
        }
      });

      /* IF the thorin apps' name is not app, add the app's name config. */
      if (this.app.app !== 'app') {
        items.splice(0, 0, {
          name: "disk",
          type: "thorin",
          options: {
            path: "config/" + this.app.app + ".js",
            required: false
          }
        });
      } else {
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
    } else {
      items = [items];
    }
    let rootConfig = {};
    let calls = [];
    /* We load up all config sources and fetch em' */
    items.forEach((iObj) => {
      calls.push((done) => {
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
      if(err) {
        console.error('Thorin.config: failed to load all configuration sources.');
        return done(err);
      }
      done(null, rootConfig);
    });
  }


};