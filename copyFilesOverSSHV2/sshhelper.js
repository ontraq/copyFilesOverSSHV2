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
const Q = require("q");
const tl = require("azure-pipelines-task-lib/task");
var Ssh2Client = require('ssh2').Client;
var Scp2Client = require('scp2').Client;
class RemoteCommandOptions {
}
exports.RemoteCommandOptions = RemoteCommandOptions;
class SshHelper {
    /**
     * Constructor that takes a configuration object of format
     * {
            host: hostname,
            port: port,
            username: username,
            privateKey: privateKey,
            passphrase: passphrase
       }
     * @param sshConfig
     */
    constructor(sshConfig) {
        this.sshConfig = sshConfig;
    }
    setupSshClientConnection() {
        return __awaiter(this, void 0, void 0, function* () {
            const defer = Q.defer();
            this.sshClient = new Ssh2Client();
            this.sshClient.once('ready', () => {
                defer.resolve();
            }).once('error', (err) => {
                defer.reject(tl.loc('ConnectionFailed', err));
            }).connect(this.sshConfig);
            yield defer.promise;
        });
    }
    setupScpConnection() {
        return __awaiter(this, void 0, void 0, function* () {
            const defer = Q.defer();
            this.scpClient = new Scp2Client();
            this.scpClient.defaults(this.sshConfig);
            this.scpClient.sftp((err, sftp) => {
                if (err) {
                    defer.reject(tl.loc('ConnectionFailed', err));
                }
                else {
                    this.sftpClient = sftp;
                    defer.resolve();
                }
            });
            yield defer.promise;
        });
    }
    /**
     * Sets up the SSH connection
     */
    setupConnection() {
        return __awaiter(this, void 0, void 0, function* () {
            console.log(tl.loc('SettingUpSSHConnection', this.sshConfig.host));
            try {
                yield this.setupSshClientConnection();
                yield this.setupScpConnection();
            }
            catch (err) {
                throw new Error(tl.loc('ConnectionFailed', err));
            }
        });
    }
    /**
     * Close any open client connections for SSH, SCP and SFTP
     */
    closeConnection() {
        try {
            if (this.sftpClient) {
                this.sftpClient.on('error', (err) => {
                    tl.debug('sftpClient: Ignoring error diconnecting: ' + err);
                }); // ignore logout errors; see: https://github.com/mscdex/node-imap/issues/695
                this.sftpClient.close();
                this.sftpClient = null;
            }
        }
        catch (err) {
            tl.debug('Failed to close SFTP client: ' + err);
        }
        try {
            if (this.sshClient) {
                this.sshClient.on('error', (err) => {
                    tl.debug('sshClient: Ignoring error diconnecting: ' + err);
                }); // ignore logout errors; see: https://github.com/mscdex/node-imap/issues/695
                this.sshClient.end();
                this.sshClient = null;
            }
        }
        catch (err) {
            tl.debug('Failed to close SSH client: ' + err);
        }
        try {
            if (this.scpClient) {
                this.scpClient.on('error', (err) => {
                    tl.debug('scpClient: Ignoring error diconnecting: ' + err);
                }); // ignore logout errors; see: https://github.com/mscdex/node-imap/issues/695
                this.scpClient.close();
                this.scpClient = null;
            }
        }
        catch (err) {
            tl.debug('Failed to close SCP client: ' + err);
        }
    }
    /**
     * Uploads a file to the remote server
     * @param sourceFile
     * @param dest, folders will be created if they do not exist on remote server
     * @returns {Promise<string>}
     */
    uploadFile(sourceFile, dest) {
        tl.debug('Upload ' + sourceFile + ' to ' + dest + ' on remote machine.');
        var defer = Q.defer();
        if (!this.scpClient) {
            defer.reject(tl.loc('ConnectionNotSetup'));
        }
        this.scpClient.upload(sourceFile, dest, (err) => {
            if (err) {
                defer.reject(tl.loc('UploadFileFailed', sourceFile, dest, err));
            }
            else {
                defer.resolve(dest);
            }
        });
        return defer.promise;
    }
    /**
     * Returns true if the path exists on remote machine, false if it does not exist
     * @param path
     * @returns {Promise<boolean>}
     */
    checkRemotePathExists(path) {
        var defer = Q.defer();
        if (!this.sftpClient) {
            defer.reject(tl.loc('ConnectionNotSetup'));
        }
        this.sftpClient.stat(path, function (err, attr) {
            if (err) {
                //path does not exist
                defer.resolve(false);
            }
            else {
                //path exists
                defer.resolve(true);
            }
        });
        return defer.promise;
    }
    /**
     * Runs specified command on remote machine, returns error for non-zero exit code
     * @param command
     * @param options
     * @returns {Promise<string>}
     */
    runCommandOnRemoteMachine(command, options) {
        var defer = Q.defer();
        var stdErrWritten = false;
        if (!this.sshClient) {
            defer.reject(tl.loc('ConnectionNotSetup'));
        }
        if (!options) {
            tl.debug('Options not passed to runCommandOnRemoteMachine, setting defaults.');
            var options = new RemoteCommandOptions();
            options.failOnStdErr = true;
        }
        var cmdToRun = command;
        if (cmdToRun.indexOf(';') > 0) {
            //multiple commands were passed separated by ;
            cmdToRun = cmdToRun.replace(/;/g, '\n');
        }
        tl.debug('cmdToRun = ' + cmdToRun);
        this.sshClient.exec(cmdToRun, (err, stream) => {
            if (err) {
                defer.reject(tl.loc('RemoteCmdExecutionErr', cmdToRun, err));
            }
            stream.on('close', (code, signal) => {
                tl.debug('code = ' + code + ', signal = ' + signal);
                if (code && code != 0) {
                    //non zero exit code - fail
                    defer.reject(tl.loc('RemoteCmdNonZeroExitCode', cmdToRun, code));
                }
                else {
                    //no exit code or exit code of 0
                    //based on the options decide whether to fail the build or not if data was written to STDERR
                    if (stdErrWritten === true && options.failOnStdErr === true) {
                        //stderr written - fail the build
                        defer.reject(tl.loc('RemoteCmdExecutionErr', cmdToRun, tl.loc('CheckLogForStdErr')));
                    }
                    else {
                        //success
                        defer.resolve('0');
                    }
                }
            }).on('data', (data) => {
                console.log(data);
            }).stderr.on('data', (data) => {
                stdErrWritten = true;
                tl.debug('stderr = ' + data);
                if (data && data.toString().trim() !== '') {
                    tl.error(data);
                }
            });
        });
        return defer.promise;
    }
}
exports.SshHelper = SshHelper;
