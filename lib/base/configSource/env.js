'use strict';
/**
 * Adds configuration from the specified environment variable name
 * @Options
 *  - opt.name - the env name
 *  - opt.required - if set, throws on error
 * */
module.exports = async function sourceEnv(opt = {}) {
  let envName = opt.name;
  if (!envName) {
    if (opt.required) throw new Error(`Env variable ${envName} not set`);
    return;
  }
  let d;
  try {
    d = JSON.parse(process.env[envName] || '');
  } catch (e) {
    if (opt.required) throw new Error(`Could not parse env ${envName}`);
  }
  return d;
}
