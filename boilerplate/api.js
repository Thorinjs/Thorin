/*
 * thorin
 *   -> config
 *   -> router
 *     -> transport
 *       -> http
 *       -> ws
 *   -> dispatcher
 *     -> intent
 *     -> client
 *       -> websocket
 *       -> push
 *       -> http
 *   -> sanitize
 *   -> authorize
 *
 *   Stuff to look into: featherjs.com
 *
 * */

var thorin = require('thorin'),
  appConfig = require('thorin-config'),
  appLog = require('thorin-log');

thorin.name = "api";  // defaults to the fileName.
thorin.env; // the app environment. first is --env=, next is NODE_ENV, default to development.
thorin.root; // the root project cwd()
thorin.version; // the app version in package.json
thorin.id;  // return the thorin unique app id. (thorin.name + persistedUniqueId)
appConfig
  .source('disk')// app/config/$environment
  .source('sconfig', {API_KEY: '', API_SECRET: '', persist: 'config/.sconfig'});// the .sconfig file will be hidden.

thorin.config("disk") // this goes by default.
  .config("sconfig", {
    token: '',
    persist: 'app/config/.sconfig'
  }); // config loader.
thorin.logger(appLog);

var log = thorin.logger('my.namespace');  // this will append the "my.namespace" namespace to all logging.
var err = thorin.error('SOME_CODE', 'Something went wrong.', {additionalDataOr: 'error'});


thorin
  .addTransport(require('thorin-transport-http'))
  .addTransport(require('thorin-transport-ws'))
  .addStore(require('thorin-store-sql'), 'sql') // defaultName is 'sql
  .addStore(require('thorin-store-mongo'), 'mongo')
  .addStore(require('thorin-store-redis'), 'optCache', 'dbCache')//creates two separate stores of the same createFn, with different names.
  .addLibrary('thorin-mailer', 'thorin-geoip', 'thorin-utils', require('./libs/mylib'))
  .addLibrary(['libName', './lib/libName'], 'thorin-mailer')
  .addLibrary(MyLibrary)
  .addSanitier(require('./lib/sanitizers'))  // additional input sanitizers.
  .addPlugin('thorin-mail', 'thorin-push', 'thorin-auth-facebook');  // modules can be loaded only once.

// At this point, thorin will look like this:
thorin.start((err) => {
  log.info('Started with %s', err);
});

thorin.config('store.sql.username', "jodn");  // fetches the config.
thorin.config.set('myNew.key', 'anotherValue');
thorin.config.clear('myKey.myValue', 'anotherKey', 'another.V.alue');

/*
 * -------------thorin.config(key, defaultValue) -> singleton fetcher with all the configuration.
 * -------------thorin.config.set('key', 'newValue') -> updates a config.
 * thorin.lib(libraryName)  // library singleton getter
 * thorin.store('sql') // return the thorin-sql store
 * thorin.store('redisCache') // returns he redis db connection of the redisCache store
 * ------------- thorin.util -> core utilities merged with other utilities.
 * thorin.router -> the router instance
 * thorin.dispatcher -> the dispatcher instance
 * thorin.Intent -> the intent class
 *
 * thorin.sanitize.STRING({notA:"string"}, "defaultString")  => "defaultString"
 * thorin.sanitize.STRING_UNSAFE(" <UNSAFE'>") => <UNSAFE'>
 * thorin.sanitize.INTEGER("34") => 34
 * thorin.sanitize.INTEGER_POSITIVE(-34) => undefined
 * thorin.addMiddleware(
 *     "beforeCreate", "afterCreate",
 *     "beforeAuth", "afterAuth",
 *     "beforeHandler", "afterHandler",
 *     "beforeEnd", "afterEnd",
 *     "onError", "onNotFound",
 *     middlewareFn) -> if it returns a promise, it will wait for it. Otherwise, it will receive a next() callback.
 * thorin.addAuthorization(name, fn) - registers an authorization handler
 * thorin.addTransport(require transportModule)
 * thorin.addStore(require storeModule)
 * thorin.addLibrary(libraryName or require libraryModule)
 * thorin.addSanitizer(require localSanitizer)
 * thorin.router.addPath(httpPath, intentName)  -> maps an HTTP URL to an intent name.
 * thorin.router.addUpload(httpPath, handler) -> maps an HTTP Upload request to a handler.
 *
 * thorin.store('sql').addModel(modelName, modelFn) -> manually load an SQL model
 * thorin.store('mongo').addSchema(schemaName, schemaFn) -> manually load a schema.
 *
 * thorin.on('intent.create', 'intent.auth', 'intent.error', 'intent.success', 'intent.end')
 *
 * thorin.on('init:{moduleName}', 'run:{moduleName}')
 * */

/*
 * Lifecycle:
 * -> load config (disk or from sconfig)
 * -> set thorin.rootname = root directory of the app
 * -> load all stores/transports/libs/modules/sanitizers
 *   -> if dependency is a function, call it with fn(thorin, config)
 *   -> emit thorin.emit('init:transport.http')
 *
 * ----------
 * thorin.init(onDependencyLoaded(depName))
 * -> call dependency init() if available, with a callback. This will enable them to asynchronously initialize. (load models, files, etc)
 *   -> for each dependency, if onDependencyLoaded was provided, call it with the dep. name.
 * ----------
 * thorin.run(onAllDependenciesLoaded())
 * -> for each dependency, call its run() function, if provided, with a callback fn
 * -> after each run, emit thorin.emit('run:transport.http')
 * -> if any dependency callsback with an error, we stop.
 *
 * */