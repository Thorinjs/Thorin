'use strict';
const async = require('async'),
  request = require('node-fetch'),
  fs = require('fs'),
  exec = require('child_process').exec,
  fse = require('fs-extra'),
  path = require('path');
const API = process.env.RELEASER_API || 'https://release.unloqapp.io/api';

const DEPS = ['unzip2@0.2.5'];

/**
 * Utility used to install a custom thorin module
 * from releaser.
 * It will:
 *  - download the ZIP
 *  - create the target folder
 *  - install unzip2
 *  - unzip the downloaded ZIP
 * */

function install(thorin, item, done) {
  let calls = [];
  let config = item.opt.releaser,
    url = `${API}/services/download?token=` + config.token,
    zipPath,
    folderPath = path.normalize(`${thorin.root}/node_modules/thorin-module-${item.name}`);
  let filePath = folderPath + '.zip',
    result = {
      path: folderPath
    };

  /* Step one: download from Releaser if we have a releaser config */
  calls.push((fn) => {
    console.log(`Thorin: downloading module ${item.name} to ${folderPath}`);
    download(url, {
      path: folderPath
    }, fn);
  });

  /* Next, we have to unzip the file */
  calls.push((fn) => {
    fse.ensureDir(folderPath, fn);
  });

  /* Next, we have to install archiver */
  calls.push((fn) => {
    console.log(`Thorin: installing ${DEPS.join(', ')}`);
    let cmd = `npm i -p ${DEPS.join(' ')}`,
      opt = {
        cwd: thorin.root
      };
    exec(cmd, opt, (err, res) => {
      if (err) return fn(err);
      fn();
    });
  });

  /* Next, unzip it */
  calls.push(async (fn) => {
    console.log(`Thorin: unzipping to: ${folderPath}`);
    const unzip2 = require(path.normalize(thorin.root + `/node_modules/unzip2`));
    unzip(unzip2, filePath, folderPath, fn);
  });

  /* Finally, install its dependencies */
  calls.push((fn) => {
    console.log(`Thorin: installing module dependencies`);
    let cmd = `npm i -p`;
    exec(cmd, {
      cwd: folderPath
    }, fn);
  });

  /* Cleanup */
  calls.push((fn) => {
    fs.unlink(filePath, (e) => {
      if (e) {
        console.log(`Thorin: failed to remove module ${filePath}`);
        console.log(e);
      }
      fn();
    });
  });

  async.series(calls, (e) => {
    if (e) return done(e);
    done(null, result);
  });
}

module.exports = install;


function download(url, opt, done) {
  let isDone = false;
  let reqOpt = {
    method: 'GET',
    headers: {
      'User-Agent': 'releaser-cli'
    },
    request: (req) => {
      req.on('response', (res) => {
        if (isDone) return;
        let size = res.headers['content-length'];
        if (size) {
          size = parseInt(size, 10);
        }
        if (res.statusCode !== 200) {
          isDone = true;
          return done(new Error(res.statusMessage || 'Error ' + res.statusCode));
        }
        if (opt.path.indexOf('.') === -1) {
          opt.path += '.zip';
        }
        let folderPath = opt.path.split('.zip')[0];
        let fileObj;
        try {
          fs.unlinkSync(opt.path);
        } catch (e) {
        }
        try {
          fileObj = fs.createWriteStream(opt.path);
        } catch (e) {
          return done(e);
        }
        fileObj.on('error', (e) => {
          if (isDone) return;
          isDone = true;
          done(e);
        });
        res
          .on('error', (e) => {
            if (isDone) return;
            isDone = true;
            return done(e);
          })
          .on('end', () => {
            if (isDone) return;
            isDone = true;
            done();
          });
        res.pipe(fileObj);
      })
        .on('error', (e) => {
          if (isDone) return;
          isDone = true;
          done(e);
        })
    }
  };
  let r = request(url, reqOpt).then(() => {
    if (isDone) return;
    isDone = true;
    done();
  }).catch((e) => {
    if (isDone) return;
    isDone = true;
    done(e);
  });
}


function unzip(unzip2, source, target, done) {
  let readObj = fs.createReadStream(source),
    isDone = false;
  readObj
    .on('error', (e) => {
      if (isDone) return;
      isDone = true;
      done(e);
    });
  let targetFolderName = path.basename(target) + '/';

  let unzipObj = unzip2.Parse(),
    count = 0;
  unzipObj
    .on('entry', (entry) => {
      if (isDone) return;
      let entryType = entry.type,
        entryPath = entry.path;
      if (entryPath === targetFolderName) {
        entry.autodrain();
        return;
      }
      if (entryPath.substr(0, targetFolderName.length - 1) === targetFolderName) {
        entryPath = entryPath.substr(targetFolderName.length);
      }
      if (entryPath.indexOf('__MACOSX') !== -1) {
        entry.autodrain();
        return;
      }
      if (entryPath.indexOf('.DS_Store') !== -1) {
        entry.autodrain();
        return;
      }
      let targetFilePath = path.normalize(target + '/' + entryPath);
      if (entryType.toLowerCase() === 'directory') {
        try {
          fse.ensureDirSync(targetFilePath);
        } catch (e) {
        }
        entry.autodrain();
        return;
      }
      if (entryPath.indexOf('/') !== -1) {
        let basename = path.normalize(path.dirname(targetFilePath));
        try {
          mkdirp.sync(basename);
        } catch (e) {
        }
      }
      let writerObj;
      try {
        writerObj = fs.createWriteStream(targetFilePath);
      } catch (e) {
        isDone = true;
        entry.autodrain();
        return done(e);
      }
      count++;
      writerObj
        .on('error', (e) => {
          if (isDone) return;
          isDone = true;
          done(e);
        });
      entry.pipe(writerObj);
    })
    .on('error', (e) => {
      if (isDone) return;
      isDone = true;
      done(e);
    })
    .on('close', () => {
      if (isDone) return;
      isDone = true;
      done();
    });
  readObj.pipe(unzipObj);
}
