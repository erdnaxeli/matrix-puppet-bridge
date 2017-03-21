const debug = require('./debug')('Base');
const Promise = require('bluebird');
const { Bridge, RemoteUser } = require('matrix-appservice-bridge');
const bangCommand = require('./bang-command');
const urlParse = require('url').parse;
const inspect = require('util').inspect;
const path = require('path');
const { download } = require('./utils');

/**
 * Extend your app from this class to get started.
 *
 *
 * @example 
 * // The following example is from {@link https://github.com/matrix-hacks/matrix-puppet-facebook|the facebook bridge}
const {
  MatrixAppServiceBridge: {
    Cli, AppServiceRegistration
  },
  Puppet,
  MatrixPuppetBridgeBase
} = require("matrix-puppet-bridge");
const FacebookClient = require('./client');
const config = require('./config.json');
const path = require('path');
const puppet = new Puppet(path.join(__dirname, './config.json' ));
const debug = require('debug')('matrix-puppet:facebook');

class App extends MatrixPuppetBridgeBase {
  getServicePrefix() {
    return "facebook";
  }
  initThirdPartyClient() {
    this.threadInfo = {};
    this.thirdPartyClient = new FacebookClient(this.config.facebook);
    this.thirdPartyClient.on('message', (data)=>{
      const { senderID, body, threadID, isGroup } = data;
      const isMe = senderID === this.thirdPartyClient.userId;
      this.threadInfo[threadID] = { isGroup };
      const payload = {
        roomId: threadID,
        senderId: isMe ? undefined : senderID,
        text: body
      };
      debug(payload);
      return this.handleThirdPartyRoomMessage(payload);
    });
    return this.thirdPartyClient.login();
  }
  getThirdPartyUserDataById(id) {
    return this.thirdPartyClient.getUserInfoById(id).then(userInfo=>{
      debug('got user data', userInfo);
      return { senderName: userInfo.name };
    });
  }
  getThirdPartyRoomDataById(threadId) {
    debug('getting third party room data by thread id', threadId);
    let label = this.threadInfo[threadId].isGroup ? "Group" : "Friend";
    return this.thirdPartyClient.getThreadInfo(threadId).then(data=>{
      let roomData = {
        name: data.name,
        topic: `Facebook ${label}`
      };
      debug('room data', roomData);
      return roomData;
    });
  }
  sendMessageAsPuppetToThirdPartyRoomWithId(id, text) {
    return this.thirdPartyClient.sendMessage(id, text);
  }
}

new Cli({
  port: config.port,
  registrationPath: config.registrationPath,
  generateRegistration: function(reg, callback) {
    puppet.associate().then(()=>{
      reg.setId(AppServiceRegistration.generateToken());
      reg.setHomeserverToken(AppServiceRegistration.generateToken());
      reg.setAppServiceToken(AppServiceRegistration.generateToken());
      reg.setSenderLocalpart("facebookbot");
      reg.addRegexPattern("users", "@facebook_.*", true);
      callback(reg);
    }).catch(err=>{
      console.error(err.message);
      process.exit(-1);
    });
  },
  run: function(port) {
    const app = new App(config, puppet);
    return puppet.startClient().then(()=>{
      return app.initThirdPartyClient();
    }).then(() => {
      return app.bridge.run(port, config);
    }).then(()=>{
      console.log('Matrix-side listening on port %s', port);
    }).catch(err=>{
      console.error(err.message);
      process.exit(-1);
    });
  }
}).run();
 */
class Base {
  /**
   * The short string to put before the ghost user name.
   * e.g. return "groupme" for @groupme_bob:your.host.com
   *
   * @returns {string} The string to prefix localpart user ids of ghost users
   */
  getServicePrefix() {
    throw new Error("override me");
  }
  /**
   * A friendly name for the protocol.
   * Use proper capitalization and make it look nice.
   * e.g. return "GroupMe"
   *
   * @returns {string} A friendly name for the bridged protocol.
   */
  getServiceName() {
    throw new Error("override me");
  }

  /**
   * Return a user id to match against 3rd party user id's in order to know if the message is of self-origin
   *
   * @returns {string} Your user ID from the perspective of the third party
   */
  getPuppetThirdPartyUserId() {
    throw new Error('override me');
  }

  /**
   * Implement how a text-based message is sent over the third party network
   *
   * @param {string} _thirdPartyRoomId
   * @param {string} _messageText
   * @param {object} _matrixEvent
   * @returns {Promise}
   */
  sendMessageAsPuppetToThirdPartyRoomWithId(_thirdPartyRoomId, _messageText, _matrixEvent) {
    throw new Error('override me');
  }

  /**
   * Implement how an image message is sent over the third party network
   *
   * @param {string} _thirdPartyRoomId
   * @param {object} _messageData
   * @returns {Promise}
   */
  sendImageMessageAsPuppetToThirdPartyRoomWithId(_thirdPartyRoomId, _data) {
    throw new Error('override me');
  }

  /**
   * Return a postfix for the status room name.
   * It should be fairly unique so that it's unlikely to clash with a legitmate user.
   * (Let's hope nobody likes the name 'puppetStatusRoom')
   *
   * If you use the default below, the bridge room's alias will end up being
   * something like '#groupme_puppetStatusRoom'.
   *
   * There should be no need to override this.
   *
   * @returns {string} Postfix for the status room name.
   */
  getStatusRoomPostfix() {
    return "puppetStatusRoom";
  }

  /**
   * @constructor
   *
   * @param {object} config Config as a JavaScript object
   * @param {object} puppet Instance of Puppet to use
   * @param {object} bridge Optional instance of Bridge to use
   */
  constructor(config, puppet, bridge) {
    const { info } = debug();
    this.allowNullSenderName = false;
    this.config = config;
    this.puppet = puppet;
    this.domain = config.bridge.domain;
    this.homeserver = urlParse(config.bridge.homeserverUrl);
    this.deduplicationTag = this.config.deduplicationTag || this.defaultDeduplicationTag();
    this.deduplicationTagPattern = this.config.deduplicationTagPattern || this.defaultDeduplicationTagPattern();
    this.deduplicationTagRegex = new RegExp(this.deduplicationTagPattern);
    this.bridge = bridge || this.setupBridge(config);
    info('initialized');
  }

  /**
   * Optional async call to get additional data about the third party user, for when this information does not arrive in the original payload
   *
   * @param {string} thirdPartyRoomId The unique identifier on the third party's side
   * @returns {Promise} Resolve with an object like {senderName: 'some name'}
   */
  getThirdPartyUserDataById(_thirdPartyUserId) {
    throw new Error("override me and return or resolve a promise with at least {senderName: 'some name'}, otherwise provide it in the original payload and i will never be invoked");
  }
  /**
   * Optional async call to get additional data about the third party room, for when this information does not arrive in the original payload
   *
   * @param {string} thirdPartyRoomId The unique identifier on the third party's side
   * @returns {Promise} Resolve with an object like { name:string, topic:string }
   */
  getThirdPartyRoomDataById(_thirdPartyRoomId) {
    throw new Error("override me");
  }

  /**
   * Instantiates a Bridge for you. Called by the constructor if an existing bridge instance was not provided.
   *
   * @param {object} config bridge configuration (homeserverUrl, domain, registration)
   *
   * @private
   */
  setupBridge(config) {
    return new Bridge(Object.assign({}, config.bridge, {
      controller: {
        onUserQuery: function(queriedUser) {
          console.log('got user query', queriedUser);
          return {}; // auto provision users w no additional data
        },
        onEvent: this.handleMatrixEvent.bind(this),
        onAliasQuery: function() {
          console.log('on alias query');
        },
        thirdPartyLookup: {
          protocols: [this.getServicePrefix()],
          getProtocol: function() {
            console.log('get proto');
          },
          getLocation: function() {
            console.log('get loc');
          },
          getUser: function() {
            console.log('get user');
          }
        }
      }
    }));
  }
  /**
   * Send a message to the status room
   *
   * @param {object} options={} Optional options object: fixedWidthOutput:boolean
   * @param {string} ...args additional arguments are formatted and send to the room
   *
   * @returns {Promise}
   */
  sendStatusMsg(options={}, ...args) {
    if (typeof options !== 'object') {
      throw new Error('sendStatusMsg requires first parameter to be an options object which can be empty.');
    }
    if (options.fixedWidthOutput === undefined)
    {
      options.fixedWidthOutput = true;
    }

    const msgText = args.reduce((acc, arg, index)=>{
      const sep = index > 0 ? ' ' : '';
      if (typeof arg === 'object') {
        return acc+sep+inspect(arg, {depth:null,showHidden:true});
      } else {
        return acc+sep+arg.toString();
      }
    }, '');

    const { warn, info } = debug(this.sendStatusMsg.name);
    const roomAliasLocalPart = options.roomAliasLocalPart || this.getServicePrefix()+"_"+this.getStatusRoomPostfix();
    const roomAlias = "#"+roomAliasLocalPart+":"+this.domain;

    const puppetClient = this.puppet.getClient();

    info('looking up', roomAlias);
    info('gonna send', msgText);
    return puppetClient.getRoomIdForAlias(roomAlias).then(({room_id}) => {
      info("found matrix room via alias. room_id:", room_id);
      return room_id;
    }, (_err) => {
      const name = this.getServiceName() + " Protocol";
      const topic = this.getServiceName() + " Protocol Status Messages";
      info("creating status room !!!!", ">>>>"+roomAliasLocalPart+"<<<<", name, topic);
      return puppetClient.createRoom({
        name, topic, room_alias_name: roomAliasLocalPart
      }).then(({room_id}) => {
        info("room created", room_id, roomAliasLocalPart);
        return room_id;
      });
    }).then(matrixRoomId => {
      info("making puppet join room", matrixRoomId);
      return puppetClient.joinRoom(matrixRoomId).then(()=>{
        info("returning room id after join room attempt", matrixRoomId);
        return matrixRoomId;
      }, (err) => {
        if ( err.message === 'No known servers' ) {
          warn('we cannot use this room anymore because you cannot currently rejoin an empty room (synapse limitation? riot throws this error too). we need to de-alias it now so a new room gets created that we can actually use.');
          return puppetClient.deleteAlias(roomAlias).then(()=>{
            warn('deleted alias... trying again to get or create room.');
            return this.getOrCreateMatrixRoomFromThirdPartyRoomId(thirdPartyRoomId)
          })
        } else {
          warn("ignoring error from puppet join room: ", err.message);
          return matrixRoomId;
        }
      });
    }).then(statusRoomId => {
      var botIntent = this.bridge.getIntent();
      if (botIntent === null) {
        warn('cannot send a status message before the bridge is ready');
        return false;
      }
      let promiseList = [];

      promiseList.push(() => {
        info("joining protocol bot to room >>>", statusRoomId, "<<<");
        botIntent.join(statusRoomId)
      });

      // AS Bots don't have display names? Weird...
      // PUT https://<REDACTED>/_matrix/client/r0/profile/%40hangoutsbot%3Aexample.org/displayname (AS) HTTP 404 Error: {"errcode":"M_UNKNOWN","error":"No row found"}
      //promiseList.push(() => botIntent.setDisplayName(this.getServiceName() + " Bot"));

      promiseList.push(() => {
        if(options.fixedWidthOutput)
        {
          return botIntent.sendMessage(statusRoomId, {
            body: msgText,
            formatted_body: "<pre><code>" + msgText + "</code></pre>",
            format: "org.matrix.custom.html",
            msgtype: "m.notice" // <-- Important! Or we will cause message looping...
          });
        }
        else
        {
          return botIntent.sendMessage(statusRoomId, {
            body: msgText,
            msgtype: "m.notice" // <-- Important! Or we will cause message looping...
          });
        }
      });

      return Promise.mapSeries(promiseList, p => p());
    });
  }
  getGhostUserFromThirdPartySenderId(id) {
    return "@"+this.getServicePrefix()+"_"+id+":"+this.domain;
  }
  getRoomAliasFromThirdPartyRoomId(id) {
    return "#"+this.getRoomAliasLocalPartFromThirdPartyRoomId(id)+':'+this.domain;
  }
  getThirdPartyUserIdFromMatrixGhostId(matrixGhostId) {
    const patt = new RegExp(`^@${this.getServicePrefix()}_(.+)$`);
    const localpart = matrixGhostId.replace(':'+this.domain, '');
    const matches = localpart.match(patt);
    return matches ? matches[1] : null;
  }
  getThirdPartyRoomIdFromMatrixRoomId(matrixRoomId) {
    const { info } = debug(this.getThirdPartyRoomIdFromMatrixRoomId.name);
    const patt = new RegExp(`^#${this.getServicePrefix()}_(.+)$`);
    const room = this.puppet.getClient().getRoom(matrixRoomId);
    info('reducing array of alases to a 3prid');
    return room.getAliases().reduce((result, alias) => {
      const localpart = alias.replace(':'+this.domain, '');
      const matches = localpart.match(patt);
      return matches ? matches[1] : result;
    }, null);
  }
  getRoomAliasLocalPartFromThirdPartyRoomId(id) {
    return this.getServicePrefix()+"_"+id;
  }
  getIntentFromThirdPartySenderId(senderId) {
    return this.bridge.getIntent(this.getGhostUserFromThirdPartySenderId(senderId));
  }
  getIntentFromApplicationServerBot() {
    return this.bridge.getIntent();
  }
  /**
   * Returns a Promise resolving {senderName}
   *
   * Optional code path which is only called if the derived class does not
   * provide a senderName when invoking handleThirdPartyRoomMessage
   *
   * @param {string} thirdPartyUserId
   * @returns {Promise}
   */
  getOrInitRemoteUserStoreDataFromThirdPartyUserId(thirdPartyUserId) {
    const { info } = debug(this.getOrInitRemoteUserStoreDataFromThirdPartyUserId.name);
    const userStore = this.bridge.getUserStore();
    return userStore.getRemoteUser(thirdPartyUserId).then(rUser=>{
      if ( rUser ) {
        info("found existing remote user in store", rUser);
        return rUser;
      } else {
        info("did not find existing remote user in store, we must create it now");
        return this.getThirdPartyUserDataById(thirdPartyUserId).then(thirdPartyUserData => {
          info("got 3p user data:", thirdPartyUserData);
          return new RemoteUser(thirdPartyUserId, {
            senderName: thirdPartyUserData.senderName
          });
        }).then(rUser => {
          return userStore.setRemoteUser(rUser);
        }).then(()=>{
          return userStore.getRemoteUser(thirdPartyUserId);
        }).then(rUser => {
          return rUser;
        });
      }
    });
  }
  getOrCreateMatrixRoomFromThirdPartyRoomId(thirdPartyRoomId) {
    const { warn, info } = debug(this.getOrCreateMatrixRoomFromThirdPartyRoomId.name);
    const roomAlias = this.getRoomAliasFromThirdPartyRoomId(thirdPartyRoomId);
    const roomAliasName = this.getRoomAliasLocalPartFromThirdPartyRoomId(thirdPartyRoomId);
    info('looking up', thirdPartyRoomId);
    const puppetClient = this.puppet.getClient();


    return puppetClient.getRoomIdForAlias(roomAlias).then(({room_id}) => {
      info("found matrix room via alias. room_id:", room_id);
      return room_id;
    }, (_err) => {
      info("the room doesn't exist. we need to create it for the first time");
      return Promise.resolve(this.getThirdPartyRoomDataById(thirdPartyRoomId)).then(thirdPartyRoomData => {
        info("got 3p room data", thirdPartyRoomData);
        const { name, topic } = thirdPartyRoomData;
        info("creating room !!!!", ">>>>"+roomAliasName+"<<<<", name, topic);
        return puppetClient.createRoom({
          name, topic, room_alias_name: roomAliasName
        }).then(({room_id}) => {
          info("room created", room_id, roomAliasName);
          return room_id;
        });
      });
    }).then(matrixRoomId => {
      info("making puppet join room", matrixRoomId);
      return puppetClient.joinRoom(matrixRoomId).then(()=>{
        info("returning room id after join room attempt", matrixRoomId);
        return matrixRoomId
      }, (err) => {
        if ( err.message === 'No known servers' ) {
          warn('we cannot use this room anymore because you cannot currently rejoin an empty room (synapse limitation? riot throws this error too). we need to de-alias it now so a new room gets created that we can actually use.');
          return puppetClient.deleteAlias(roomAlias).then(()=>{
            warn('deleted alias... trying again to get or create room.');
            return this.getOrCreateMatrixRoomFromThirdPartyRoomId(thirdPartyRoomId)
          })
        } else {
          warn("ignoring error from puppet join room: ", err.message);
          return matrixRoomId;
        }
      });
    });
  }

  /**
   * Returns a promise
   */
  getUserClient(roomId, senderId, senderName, avatarUrl, doNotTryToGetRemoteUserStoreData) {
    const { info } = debug(this.getUserClient.name);
    info("get user client for third party user %s (%s)", senderId, senderName);

    if (senderId === undefined) {
      return Promise.resolve(this.puppet.getClient());
    } else {
      if (!senderName && !this.allowNullSenderName) {
        if (doNotTryToGetRemoteUserStoreData)
          throw new Error('preventing an endless loop');

        info("no senderName provided with payload, will check store");
        return this.getOrInitRemoteUserStoreDataFromThirdPartyUserId(senderId).then((remoteUser)=>{
          info("got remote user from store, with a possible client API call in there somewhere", remoteUser);
          info("will retry now");
          const senderName = remoteUser.get('senderName');
          return this.getUserClient(roomId, senderId, senderName, avatarUrl, true);
        });
      }

      info("this message was not sent by me");
      const ghostIntent = this.getIntentFromThirdPartySenderId(senderId);
      return ghostIntent.join(roomId).then(() => {
        let promiseList = [];
        if (senderName) {
          info("Set the display name to %s", senderName);
          promiseList.push(ghostIntent.setDisplayName(senderName));
        }

        if (avatarUrl) {
          info("Set the avatar to %s", avatarUrl);
          promiseList.push(this.setGhostAvatar(ghostIntent, avatarUrl));
        }

        return Promise.all(promiseList).then(() => ghostIntent.getClient());
      }).then(() => ghostIntent.getClient());
    }
  }
  /**
   * Returns a promise
   */
  handleThirdPartyRoomImageMessage(thirdPartyRoomImageMessageData) {
    const { info, warn } = debug(this.handleThirdPartyRoomMessage.name);
    info('handling third party room image message', thirdPartyRoomImageMessageData);
    let {
      roomId,
      senderName,
      senderId,
      avatarUrl,
      text,
      url,
      h,
      w,
      mimetype
    } = thirdPartyRoomImageMessageData;

    return this.getOrCreateMatrixRoomFromThirdPartyRoomId(roomId).then((matrixRoomId) => {
      return this.getUserClient(matrixRoomId, senderId, senderName, avatarUrl).then((client) => {
        return download.getBufferAndType(url).then(({buffer,type}) => {
          client.uploadContent(buffer, {
            name: text,
            type: mimetype || type,
            rawResponse: false
          }).then((res) => {
            let msg;
            if (senderId === undefined) {
              // tag the message to know it was sent by the bridge
              msg = this.tagMatrixMessage(text);
            } else {
              msg = text;
            }

            let opts = { mimetype, h, w, size: buffer.length };
            return client.sendImageMessage(matrixRoomId, res.content_uri, opts, msg);
          }, (err) =>{
            warn('upload error', err);

            let msg;
            if (senderId === undefined) {
              // tag the message to know it was sent by the bridge
              msg = this.tagMatrixMessage(url);
            } else {
              msg = url;
            }

            let opts = {
              body: msg,
              msgtype: "m.text"
            };
            return client.sendMessage(matrixRoomId, opts);
          });
        });
      });
    });
  }
  /**
   * Returns a promise
   */
  handleThirdPartyRoomMessage(thirdPartyRoomMessageData) {
    const { info } = debug(this.handleThirdPartyRoomMessage.name);
    info('handling third party room message', thirdPartyRoomMessageData);
    const {
      roomId,
      senderName,
      senderId,
      avatarUrl,
      text,
      html
    } = thirdPartyRoomMessageData;

    return this.getOrCreateMatrixRoomFromThirdPartyRoomId(roomId).then((matrixRoomId) => {
      return this.getUserClient(matrixRoomId, senderId, senderName, avatarUrl).then((client) => {
        if (senderId === undefined) {
          info("this message was sent by me, but did it come from a matrix client or a 3rd party client?");
          info("if it came from a 3rd party client, we want to repeat it as a 'notice' type message");
          info("if it came from a matrix client, then it's already in the client, sending again would dupe");
          info("we use a tag on the end of messages to determine if it came from matrix");

          if (this.isTaggedMatrixMessage(text)) {
            info('it is from matrix, so just ignore it.');
            return;
          } else {
            info('it is from 3rd party client');
          }
        }

        let msg;
        if (senderId === undefined) {
          // tag the message to know it was sent by the bridge
          msg = this.tagMatrixMessage(text);
        } else {
          msg = text;
        }

        if (html) {
          return client.sendMessage(matrixRoomId, {
            body: msg,
            formatted_body: html,
            format: "org.matrix.custom.html",
            msgtype: "m.text"
          });
        } else {
          return client.sendMessage(matrixRoomId, {
            body: msg,
            msgtype: "m.text"
          });
        }
      });
    });
  }
  handleMatrixEvent(req, _context) {
    const { info, warn } = debug(this.handleMatrixEvent.name);
    const data = req.getData();
    if (data.type === 'm.room.message') {
      info('incoming message. data:', data);
      return this.handleMatrixMessageEvent(data);
    } else {
      return warn('ignored a matrix event', data.type);
    }
  }
  handleMatrixMessageEvent(data) {
    const logger = debug(this.handleMatrixMessageEvent.name);
    const { room_id, content: { body, msgtype, info} } = data;
    if (this.isTaggedMatrixMessage(body)) {
      logger.info("ignoring tagged message, it was sent by the bridge");
      return;
    }

    const thirdPartyRoomId = this.getThirdPartyRoomIdFromMatrixRoomId(room_id);
    if (!thirdPartyRoomId) {
      throw new Error('could not determine third party room id!!'); // XXX fire notice
    }

    // We may wish to process bang commands here at some point,
    // but for now let's just drop these.
    if (thirdPartyRoomId == this.getStatusRoomPostfix())
    {
      logger.info("ignoring incoming message to status room");
      return;
    }

    const msg = this.tagMatrixMessage(body);

    if (msgtype === 'm.text') {
      if (this.handleMatrixUserBangCommand) {
        const bc = bangCommand(body);
        if (bc) return this.handleMatrixUserBangCommand(bc, data);
      }
      return this.sendMessageAsPuppetToThirdPartyRoomWithId(thirdPartyRoomId, msg, data);
    } else if (msgtype === 'm.image') {
      logger.info("picture message from riot");

      let url = this.puppet.getClient().mxcUrlToHttp(data.content.url);
      return this.sendImageMessageAsPuppetToThirdPartyRoomWithId(thirdPartyRoomId, {
        url, text: this.tagMatrixMessage(body),
        mimetype: data.content.info.mimetype,
        width: data.content.info.w,
        height: data.content.info.h,
        size: data.content.info.size,
      });
    }
  }
  defaultDeduplicationTag() {
    return " \ufeff";
  }
  defaultDeduplicationTagPattern() {
    return " \\ufeff$";
  }
  tagMatrixMessage(text) {
    return text+this.deduplicationTag;
  }
  isTaggedMatrixMessage(text) {
    return this.deduplicationTagRegex.test(text);
  }
  /**
   * Sets the ghost avatar using a regular URL
   * Will check to see if an existing avatar exists, and if so,
   * will not bother downloading from URL, uploading to media store,
   * and setting in the ghost user profile. Why? I do not know if
   * this is the same image or a different one, and without such
   * information, we'd constantly be running this whole routine
   * for the same exact image.
   *
   * @param {Intent} ghostIntent represents the ghost user
   * @param {string} avatarUrl a resource on the public web
   * @returns {Promise}
   */
  setGhostAvatar(ghostIntent, avatarUrl) {
    const { info }  = debug(this.setGhostAvatar.name);
    const client = ghostIntent.getClient();

    return client.getProfileInfo(client.credentials.userId, 'avatar_url').then(({avatar_url})=>{
      if (avatar_url) {
        info('refusing to overwrite existing avatar');
        return null;
      } else {
        info('downloading avatar from public web', avatarUrl);
        return download.getBufferAndType(avatarUrl).then(({buffer, type})=> {
          let opts = {
            name: path.basename(avatarUrl),
            type,
            rawResponse: false
          };
          return client.uploadContent(buffer, opts);
        }).then((res)=>{
          const contentUri = res.content_uri;
          info('uploaded avatar and got back content uri', contentUri);
          return ghostIntent.setAvatarUrl(contentUri);
        });
      }
    });
  }
}

module.exports = Base;
