'use strict';
/**
 * This is the main Thorin entry file, handling the loading of everything.
 * Global variables that can be used to alter the behaviour:
 *  - global.THORIN_AUTOLOAD - if set to false, we will not automatically scan the default module/lib/actions paths.
 *  - global.THORIN_ROOT - if specified, the process's root path to work with
 *  - global.THORIN_CONFIG - the thorin config key in the .thorin config file.
 *  - global.THORIN_DOCKER - tells us if we're running in docker
 *  - global.THORIN_KUBERNETES - tells us if we're running in kubernetes
 *  - global.THORIN_APP - the name of the application.
 *  - global.THORIN_LOG_FORMAT - the format that we use to format time in the logger
 *  - global.THORIN_LOG_COLORS - if set to false, do not use colors in logging
 *  - global.THORIN_SETUP - if set to true, all components will be setup.
 *  - global.THORIN_ENCRYPTION_USE_KEY_IVN_ENCRYPTION_USE_KEY_IV - if set to true,encryption/decryption will always use key-generated IV
 * */
const path = require('path');

const TInterface = require('./base/interface'),
  TEvent = require('./base/events').EVENT,
  TApp = require('./base/app'),
  TUtil = require('./base/utils'),
  TFetch = require('./util/fetch'),
  TError = require('./util/error'),
  TIntent = require('./routing/intent'),
  TAction = require('./routing/action'),
  TAuthorization = require('./routing/authorization'),
  TMiddleware = require('./routing/middleware'),
  TDispatcher = require('./routing/dispatcher'),
  commonUtil = require('./util/common'),
  envUtil = require('./util/env');


const info = {
  docker: envUtil.isDocker(),    // This will be set to true if we are inside a docker container. The check is done in /proc/1/cgroup (only works on linux)
  kubernetes: envUtil.isKubernetes(), // This will check if we're in kubernetes
  modulePaths: [
    'app/middleware',
    'app/actions'
  ],
  version: null,    // the app's version, defaults to the one found under package.json
  root: path.normalize(typeof global.THORIN_ROOT === 'string' ? global.THORIN_ROOT : process.cwd()), // the current working dir.
  id: null,       // the current app's id, set with thorin.id
  app: global.THORIN_APP || path.basename(process.mainModule.filename).replace('.js', ''),  // the current app name, defaults to the js file name.
  env: null,   // the current application environment.
  argv: {},    // hash of startup options, with no -- or -
  pkg: {},     // the application's package.json file.
  structure: [
    '/config',
    '/config/env',
    '/config/app.js',
    '/app',
  ],  // the project's mandatory directories.
  persistFile: 'config/.thorin', // the default location where we can persist framework specific stuff.
  configName: path.basename(process.argv[1]),
  configSources: [],     // array of configuration sources to look for configs.
  logName: 'log',        // the default global logger name (used via log.debug())
  rootConfig: {},        // the main configuration of the Thorin app.
  shutdownTimeout: 2000 // number of ms till we forcequit on SIGHUP
};
envUtil.parseArgv(info);
envUtil.parsePkg(info);
envUtil.dotEnv(info.root);
envUtil.setEnv(info);

if (info.argv.setup === 'all') {
  envUtil.ensureStructure(info);
}

if (typeof global.THORIN_CONFIG === 'string') {
  info.configName = global.THORIN_CONFIG;
}
/* If we're packaged as a binary with pkg, we change it to .thorin */
if (typeof process.pkg !== 'undefined') {
  info.persistFile = '.thorin';
}
/* If we're a test app, or have AUTOLOAD set to false, disable modulePaths */
if (info.app === 'test' || info.env === 'test' || global.THORIN_AUTOLOAD === false) {
  info.modulePaths = [];
}

let isFirstCreated = false;

function create(_info) {
  const ThorinApp = TApp(_info);
  const app = new ThorinApp;
  if (!isFirstCreated) {
    // globalize logger
    app.logger.globalize();
    isFirstCreated = true;
  }
  const { fetcher, fetch } = TFetch(app);
  /**
   * Export some items, like they were statics.
   * */
  commonUtil.expose(app, {
    util: TUtil(app),
    Interface: TInterface,
    Error: TError,
    Intent: TIntent(app),
    Action: TAction(app),
    Authorization: TAuthorization(app),
    Middleware: TMiddleware(app),
    dispatcher: new (TDispatcher(app)),
    EVENT: TEvent,
    fetcher,
    fetch
  });
  return app;
}

module.exports = create(info);
module.exports.create = create;
