'use strict';
const util = require('util'),
  colors = require('colors'),
  commonUtil = require('./common');
/**
 * This is the default Thorin.js logger. It defaults
 * to logging stuff to the console.
 */
let DATE_FORMAT = "yyyy-MM-dd hh:mm:ss.SSS",
  LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'],
  LOG_COLORS = {
    trace: colors.blue,
    debug: colors.cyan,
    info: colors.green,
    warn: colors.yellow,
    error: colors.red,
    fatal: colors.magenta
  };

module.exports = function init(app, info) {
  let hasColors = true;
  if (info.docker || info.kubernetes) {
    hasColors = false;
    DATE_FORMAT = '';
  }
  if (global.THORIN_LOG_FORMAT) {
    DATE_FORMAT = global.THORIN_LOG_FORMAT;
  }
  if (global.THORIN_LOG_COLORS === false) {
    hasColors = false;
  }
  colors.enabled = hasColors;
  let consoleLogging = true,
    loggerListeners = [],
    globalLoggerName = info.logName;

  class ThorinLogger {
    constructor(name, debug = true) {
      this.name = name;
      commonUtil.expose(this, {
        levels: {}
      });
      this.setLevels(debug);
    }

    /**
     * Manually set the logging levels
     * */
    setLevels(debug) {
      LOG_LEVELS.forEach((l) => {
        this.levels[l] = (typeof debug === 'object' && debug && typeof debug[l] === 'boolean' ? debug[l] : typeof debug === 'boolean' ? debug : true);
      });
    }

    /*
    * Shortcut for a log level caller.
    * */
    log(level) {
      if (typeof level !== 'string' || !level) return;
      level = level.toLowerCase();
      if (typeof this[level] !== 'function') return;
      if (!this.levels[level]) return;
      let args = [...arguments];
      args.splice(0, 1);
      this[level].apply(this, args);
    }

  }

  /**
   * Actually log the output to console.
   * */
  function output(level, name, newArgs) {
    let hasListeners = loggerListeners.length > 0,
      allArgs;
    if (hasListeners) {
      allArgs = newArgs.concat([]);
    }
    let msg = newArgs.splice(0, 1)[0] || '';
    let errArgs = [];
    let logStr = '[' + level.toUpperCase() + '] ',
      timeStr = getDateFormat(DATE_FORMAT),
      plainStr = '';
    if (timeStr) {
      logStr += '[' + timeStr + '] ';
    }
    logStr += '[' + name + '] ';
    let isFormatted = false;
    if (typeof msg !== 'string' || (typeof msg === 'string' && msg.indexOf('%') !== -1)) {
      isFormatted = true;
      plainStr = util.format.apply(util, [msg, ...newArgs]);
      logStr += plainStr;
    } else {
      plainStr = msg;
      // add any remaining strings.
      for (let i = 1; i < newArgs.length; i++) {
        let nType = typeof newArgs[i];
        if (nType === 'string' || nType === 'boolean' || nType === 'number') {
          plainStr += ' ' + newArgs[i];
        }
      }
      logStr += plainStr;
    }
    logStr = LOG_COLORS[level](logStr);
    let consoleArgs = [logStr],
      hasConsoleError = false;
    for (let i = 0; i < newArgs.length; i++) { // spit out any non-strings.
      if (typeof newArgs[i] === 'undefined') continue;
      if (newArgs[i] instanceof Error) {
        hasConsoleError = true;
        if (newArgs[i].name.indexOf('Thorin') === 0 && newArgs[i].stack && (newArgs[i].statusCode === 500 || newArgs[i].ns === 'GLOBAL')) {
          consoleArgs.push(newArgs[i].stack);
        } else if (typeof newArgs[i] !== 'undefined') {
          errArgs.push(newArgs[i]);
        }
      } else {
        let msgType = typeof msg;
        let canAdd = (msgType === 'object' && newArgs[i]);
        if (!canAdd && !isFormatted && (msgType === 'string' || msgType === 'number' || msgType === 'boolean')) {
          canAdd = true;
        }
        if (canAdd && typeof newArgs[i] !== 'undefined') {
          consoleArgs.push(newArgs[i]);
        }
      }
    }
    if (consoleLogging) {
      console.log.apply(console, consoleArgs);
      if (errArgs.length > 0 && app.env !== 'production') {
        console.trace.apply(console, errArgs);
      }
    }
    if (!hasListeners) return;
    let item = {
      ts: Date.now(),
      name: name,
      message: plainStr,
      level: level,
      args: allArgs
    };

    for (let i = 0; i < loggerListeners.length; i++) {
      let listener = loggerListeners[i];
      if (typeof listener.name === 'string' && listener.name !== name) continue;
      try {
        listener.fn(item);
      } catch (e) {
        if (consoleLogging) {
          console.log('Thorin.logger: log listener for logger ' + name + ' threw an error.');
          console.error(e);
        }
      }
    }
  }

  /**
   * Attach the various logging levels on our logger
   * */
  for (let i = 0, len = LOG_LEVELS.length; i < len; i++) {
    let level = LOG_LEVELS[i];
    ThorinLogger.prototype[level] = function log() {
      let args = [...arguments];
      return output(level, this.name, args);
    }
  }


  const loggerMap = {   // a hash of all registered loggers.
    default: new ThorinLogger('default')
  };

  /**
   * This is the actual thorin.logger functionality that will be exposed.
   * */
  function logger(loggerName, _opt) {
    if (typeof loggerName === 'undefined') loggerName = 'default';
    if (typeof loggerMap[loggerName] !== 'undefined') return loggerMap[loggerName];
    const loggerObj = new ThorinLogger(loggerName, _opt);
    loggerMap[loggerName] = loggerObj;
    return loggerObj;
  }

  /* Disables all the console logging */
  logger.disableConsole = function DisableConsoleLogging() {
    consoleLogging = false;
    return logger;
  };
  /* Enables all console logging. */
  logger.enableConsole = function EnableConsoleLogging() {
    consoleLogging = true;
    return logger;
  };
  /* Adds an log event handler. */
  logger.pipe = function PipeLogEvents(a, fn) {
    let loggerName, pipeFn, item = {};
    if (typeof a === 'string' && typeof fn === 'function') {
      loggerName = a;
      pipeFn = fn;
    } else if (typeof a === 'function') {
      pipeFn = a;
    }
    if (typeof pipeFn !== 'function') {
      if (consoleLogging) {
        console.log('thorin.logger.pipe(): callback is not a function');
      }
    } else {
      item.fn = pipeFn;
      if (loggerName) item.name = loggerName;
      loggerListeners.push(item);
    }
    return logger;
  };

  /**
   * Globalize the logger.
   * */
  logger.globalize = (name) => {
    if (name === false && typeof global[globalLoggerName] !== 'undefined') {
      delete global[globalLoggerName];
      return this;
    }
    if (typeof name === 'undefined') {
      name = globalLoggerName;
    }
    if (typeof global[globalLoggerName] !== 'undefined') {
      delete global[globalLoggerName];
    }
    globalLoggerName = name;
    global[globalLoggerName] = loggerMap['default'];
    return logger;
  }

  return logger;
}


function padWithZeros(vNumber, width) {
  let numAsString = vNumber + "";
  while (numAsString.length < width) {
    numAsString = "0" + numAsString;
  }
  return numAsString;
}

function offset(timezoneOffset) {
  // Difference to Greenwich time (GMT) in hours
  let os = Math.abs(timezoneOffset);
  let h = String(Math.floor(os / 60));
  let m = String(os % 60);
  if (h.length === 1) {
    h = "0" + h;
  }
  if (m.length === 1) {
    m = "0" + m;
  }
  return timezoneOffset < 0 ? "+" + h + m : "-" + h + m;
}

function addZero(vNumber) {
  return padWithZeros(vNumber, 2);
}

function getDateFormat(format) {
  if (!format) return '';
  let date = new Date(),
    timezoneOffset = date.getTimezoneOffset();
  date.setUTCMinutes(date.getUTCMinutes() - timezoneOffset);
  let vDay = addZero(date.getUTCDate());
  let vMonth = addZero(date.getUTCMonth() + 1);
  let vYearLong = addZero(date.getUTCFullYear());
  let vYearShort = addZero(date.getUTCFullYear().toString().substring(2, 4));
  let vYear = (format.indexOf("yyyy") > -1 ? vYearLong : vYearShort);
  let vHour = addZero(date.getUTCHours());
  let vMinute = addZero(date.getUTCMinutes());
  let vSecond = addZero(date.getUTCSeconds());
  let vMillisecond = padWithZeros(date.getUTCMilliseconds(), 3);
  let vTimeZone = offset(timezoneOffset);
  date.setUTCMinutes(date.getUTCMinutes() + timezoneOffset);
  return format
    .replace(/dd/g, vDay)
    .replace(/MM/g, vMonth)
    .replace(/y{1,4}/g, vYear)
    .replace(/hh/g, vHour)
    .replace(/mm/g, vMinute)
    .replace(/ss/g, vSecond)
    .replace(/SSS/g, vMillisecond)
    .replace(/O/g, vTimeZone);
}
