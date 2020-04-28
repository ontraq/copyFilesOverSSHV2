"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const os = require("os");
const path = require("path");
const tl = require("azure-pipelines-task-lib/task");
const minimatch = require("minimatch");
const sshhelper_1 = require("./sshhelper");
// This method will find the list of matching files for the specified contents
// This logic is the same as the one used by CopyFiles task except for allowing dot folders to be copied
// This will be useful to put in the task-lib
function getFilesToCopy(sourceFolder, contents) {
    // include filter
    const includeContents = [];
    // exclude filter
    const excludeContents = [];
    // evaluate leading negations `!` on the pattern
    for (const pattern of contents.map(x => x.trim())) {
        let negate = false;
        let numberOfNegations = 0;
        for (const c of pattern) {
            if (c === '!') {
                negate = !negate;
                numberOfNegations++;
            }
            else {
                break;
            }
        }
        if (negate) {
            tl.debug('exclude content pattern: ' + pattern);
            const realPattern = pattern.substring(0, numberOfNegations) + path.join(sourceFolder, pattern.substring(numberOfNegations));
            excludeContents.push(realPattern);
        }
        else {
            tl.debug('include content pattern: ' + pattern);
            const realPattern = path.join(sourceFolder, pattern);
            includeContents.push(realPattern);
        }
    }
    // enumerate all files
    let files = [];
    const allPaths = tl.find(sourceFolder);
    const allFiles = [];
    // remove folder path
    for (const p of allPaths) {
        if (!tl.stats(p).isDirectory()) {
            allFiles.push(p);
        }
    }
    // if we only have exclude filters, we need add a include all filter, so we can have something to exclude.
    if (includeContents.length === 0 && excludeContents.length > 0) {
        includeContents.push('**');
    }
    tl.debug("counted " + allFiles.length + " files in the source tree");
    // a map to eliminate duplicates
    const pathsSeen = {};
    // minimatch options
    const matchOptions = { matchBase: true, dot: true };
    if (os.platform() === 'win32') {
        matchOptions.nocase = true;
    }
    // apply include filter
    for (const pattern of includeContents) {
        tl.debug('Include matching ' + pattern);
        // let minimatch do the actual filtering
        const matches = minimatch.match(allFiles, pattern, matchOptions);
        tl.debug('Include matched ' + matches.length + ' files');
        for (const matchPath of matches) {
            if (!pathsSeen.hasOwnProperty(matchPath)) {
                pathsSeen[matchPath] = true;
                files.push(matchPath);
            }
        }
    }
    // apply exclude filter
    for (const pattern of excludeContents) {
        tl.debug('Exclude matching ' + pattern);
        // let minimatch do the actual filtering
        const matches = minimatch.match(files, pattern, matchOptions);
        tl.debug('Exclude matched ' + matches.length + ' files');
        files = [];
        for (const matchPath of matches) {
            files.push(matchPath);
        }
    }
    return files;
}
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        let sshHelper;
        try {
            tl.setResourcePath(path.join(__dirname, 'task.json'));
            // read SSH endpoint input
            const sshEndpoint = tl.getInput('sshEndpoint', true);
            const username = tl.getEndpointAuthorizationParameter(sshEndpoint, 'username', false);
            const password = tl.getEndpointAuthorizationParameter(sshEndpoint, 'password', true); //passphrase is optional
            const privateKey = require("fs").readFileSync(process.env['ENDPOINT_DATA_' + sshEndpoint + '_PRIVATEKEY']); //private key is optional, password can be used for connecting
            const hostname = tl.getEndpointDataParameter(sshEndpoint, 'host', false);
            let port = tl.getEndpointDataParameter(sshEndpoint, 'port', true); //port is optional, will use 22 as default port if not specified
            if (!port) {
                console.log(tl.loc('UseDefaultPort'));
                port = '22';
            }
            const readyTimeout = getReadyTimeoutVariable();
            // set up the SSH connection configuration based on endpoint details
            let sshConfig;
            if (privateKey) {
                tl.debug('Using private key for ssh connection.');
                sshConfig = {
                    host: hostname,
                    port: port,
                    username: username,
                    privateKey: privateKey,
                    passphrase: password,
                    readyTimeout: readyTimeout
                };
            }
            else {
                // use password
                tl.debug('Using username and password for ssh connection.');
                sshConfig = {
                    host: hostname,
                    port: port,
                    username: username,
                    password: password,
                    readyTimeout: readyTimeout
                };
            }
            // contents is a multiline input containing glob patterns
            const contents = tl.getDelimitedInput('contents', '\n', true);
            const sourceFolder = tl.getPathInput('sourceFolder', true, true);
            let targetFolder = tl.getInput('targetFolder');
            if (!targetFolder) {
                targetFolder = "./";
            }
            else {
                // '~/' is unsupported
                targetFolder = targetFolder.replace(/^~\//, "./");
            }
            // read the copy options
            const cleanTargetFolder = tl.getBoolInput('cleanTargetFolder', false);
            const overwrite = tl.getBoolInput('overwrite', false);
            const failOnEmptySource = tl.getBoolInput('failOnEmptySource', false);
            const flattenFolders = tl.getBoolInput('flattenFolders', false);
            if (!tl.stats(sourceFolder).isDirectory()) {
                throw tl.loc('SourceNotFolder');
            }
            // initialize the SSH helpers, set up the connection
            sshHelper = new sshhelper_1.SshHelper(sshConfig);
            yield sshHelper.setupConnection();
            if (cleanTargetFolder) {
                console.log(tl.loc('CleanTargetFolder', targetFolder));
                const cleanTargetFolderCmd = 'rm -rf "' + targetFolder + '"/*';
                try {
                    yield sshHelper.runCommandOnRemoteMachine(cleanTargetFolderCmd, null);
                }
                catch (err) {
                    throw tl.loc('CleanTargetFolderFailed', err);
                }
            }
            // identify the files to copy
            const filesToCopy = getFilesToCopy(sourceFolder, contents);
            // copy files to remote machine
            if (filesToCopy) {
                tl.debug('Number of files to copy = ' + filesToCopy.length);
                tl.debug('filesToCopy = ' + filesToCopy);
                let failureCount = 0;
                console.log(tl.loc('CopyingFiles', filesToCopy.length));
                for (const fileToCopy of filesToCopy) {
                    try {
                        tl.debug('fileToCopy = ' + fileToCopy);
                        let relativePath;
                        if (flattenFolders) {
                            relativePath = path.basename(fileToCopy);
                        }
                        else {
                            relativePath = fileToCopy.substring(sourceFolder.length)
                                .replace(/^\\/g, "")
                                .replace(/^\//g, "");
                        }
                        tl.debug('relativePath = ' + relativePath);
                        const targetPath = path.posix.join(targetFolder, relativePath);
                        console.log(tl.loc('StartedFileCopy', fileToCopy, targetPath));
                        if (!overwrite) {
                            const fileExists = yield sshHelper.checkRemotePathExists(targetPath);
                            if (fileExists) {
                                throw tl.loc('FileExists', targetPath);
                            }
                        }
                        // looks like scp can only handle one file at a time reliably
                        yield sshHelper.uploadFile(fileToCopy, targetPath);
                    }
                    catch (err) {
                        tl.error(tl.loc('FailedOnFile', fileToCopy, err));
                        failureCount++;
                    }
                }
                console.log(tl.loc('CopyCompleted', filesToCopy.length));
                if (failureCount) {
                    tl.setResult(tl.TaskResult.Failed, tl.loc('NumberFailed', failureCount));
                }
            }
            else if (failOnEmptySource) {
                throw tl.loc('NothingToCopy');
            }
            else {
                tl.warning(tl.loc('NothingToCopy'));
            }
        }
        catch (err) {
            tl.setResult(tl.TaskResult.Failed, err);
        }
        finally {
            // close the client connection to halt build execution
            if (sshHelper) {
                tl.debug('Closing the client connection');
                sshHelper.closeConnection();
            }
        }
    });
}
run().then(() => {
    tl.debug('Task successfully accomplished');
})
    .catch(err => {
    tl.debug('Run was unexpectedly failed due to: ' + err);
});
function getReadyTimeoutVariable() {
    let readyTimeoutString = tl.getInput('readyTimeout', true);
    const readyTimeout = parseInt(readyTimeoutString, 10);
    return readyTimeout;
}
